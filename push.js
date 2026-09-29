// Web Push: lock-screen notifications for the running timer, forgotten timers, and goals/limits.
// Works on Android/desktop browsers and on iPhone for the Home Screen app (iOS 16.4+).
import webpush from "web-push";

export const DEFAULT_PREFS = { running: true, forgot: true, goals: true, review: true, habits: true, habitsAt: "21:00" };
const LIMIT_WARN_SECONDS = 5 * 60;
let keys = null;
let q = null;

export async function initPush(query) {
  q = query;
  await q(`
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
    -- one row per notification already sent (e.g. "goal:12:2026-09-29"), so each fires once
    CREATE TABLE IF NOT EXISTS push_log (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tz TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify JSONB;
  `);
  // VAPID keys identify this server to the push services. They must never change once devices have
  // subscribed, so they come from env vars or are generated once and kept in the database.
  let publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    const fresh = webpush.generateVAPIDKeys();
    await q(
      "INSERT INTO app_settings(key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO NOTHING",
      [fresh.publicKey, fresh.privateKey]
    );
    const rows = await q("SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')");
    publicKey = rows.find((r) => r.key === "vapid_public").value;
    privateKey = rows.find((r) => r.key === "vapid_private").value;
  }
  keys = { publicKey, privateKey };
}

export const vapidPublicKey = () => keys?.publicKey;

// Push services want a contact for the sender: VAPID_SUBJECT, else the site's own https origin
export async function rememberOrigin(origin) {
  if (!/^https:\/\/[^/]+$/.test(origin || "") || /localhost|127\.0\.0\.1/.test(origin)) return;
  await q("INSERT INTO app_settings(key, value) VALUES ('vapid_subject', $1) ON CONFLICT (key) DO NOTHING", [origin]);
}
async function subject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const [row] = await q("SELECT value FROM app_settings WHERE key='vapid_subject'");
  return row?.value || "mailto:timetrack@example.com";
}

export const prefsOf = (notify) => ({ ...DEFAULT_PREFS, ...(notify || {}) });

export async function sendToUser(uid, payload) {
  const subs = await q("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1", [uid]);
  if (!subs.length) return 0;
  const vapidDetails = { subject: await subject(), ...keys };
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { vapidDetails, TTL: payload.ttl ?? 4 * 3600, urgency: "high" }
      );
      sent++;
    } catch (err) {
      // the device unsubscribed or the subscription expired
      if (err.statusCode === 404 || err.statusCode === 410) await q("DELETE FROM push_subscriptions WHERE id=$1", [s.id]);
      else console.warn(`push to ${new URL(s.endpoint).host} failed:`, err.statusCode || "", err.body || err.message);
    }
  }));
  return sent;
}

// send once per key (per user); returns true if this call sent it
export async function sendOnce(uid, key, payload) {
  const [row] = await q("INSERT INTO push_log(user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1 AS ok", [uid, key]);
  if (!row) return false;
  await sendToUser(uid, payload);
  return true;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
export const clockIn = (d, tz) => new Date(d).toLocaleTimeString("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit" });

// After a start/stop: show the running timer, or replace it with a "stopped" summary.
// (iPhone needs every push to show something, so a stop can't silently clear the notification.)
export async function notifyRunning(uid) {
  const [user] = await q("SELECT tz, notify FROM users WHERE id=$1", [uid]);
  if (!user || !prefsOf(user.notify).running) return;
  const [running] = await q(
    `SELECT e.started_at, a.name FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 AND e.stopped_at IS NULL ORDER BY e.started_at DESC LIMIT 1`,
    [uid]
  );
  if (running) {
    return sendToUser(uid, {
      title: running.name, body: `Tracking since ${clockIn(running.started_at, user.tz)}`,
      tag: "running", sticky: true, actions: [{ action: "stop", title: "Stop" }],
    });
  }
  const [last] = await q(
    `SELECT e.started_at, e.stopped_at, a.name FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 AND e.stopped_at > now() - interval '2 minutes' ORDER BY e.stopped_at DESC LIMIT 1`,
    [uid]
  );
  if (last) {
    await sendToUser(uid, {
      title: `${last.name} stopped`,
      body: `${fmtDur((last.stopped_at - last.started_at) / 1000)} · ${clockIn(last.started_at, user.tz)}–${clockIn(last.stopped_at, user.tz)}`,
      tag: "running", ttl: 600,
    });
  }
}

// Every minute: look at running timers of users with a subscription and send reminders that are due.
export async function pushTick(sessionStats) {
  const rows = await q(
    `SELECT e.id, e.user_id, e.activity_id, e.started_at, a.name, a.kind, a.goal_minutes, a.goal_period, u.tz, u.notify
     FROM entries e JOIN activities a ON a.id=e.activity_id JOIN users u ON u.id=e.user_id
     WHERE e.stopped_at IS NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=e.user_id)`
  );
  for (const r of rows) {
    const prefs = prefsOf(r.notify), tz = r.tz || "UTC";
    const elapsed = (Date.now() - new Date(r.started_at)) / 1000;
    if (prefs.forgot) {
      const st = await sessionStats(r.user_id, r.activity_id, r.id, tz);
      const threshold = Math.max(4 * 3600, st.sessions ? 3 * st.avg : 0);
      if (elapsed >= threshold) {
        await sendOnce(r.user_id, `forgot:${r.id}`, {
          title: `Still doing ${r.name}?`,
          body: `It has been running for ${fmtDur(elapsed)}${st.sessions ? ` (usually ${fmtDur(st.avg)})` : ""}. Tap to set when you stopped.`,
          tag: "forgot",
        });
      }
    }
    if (prefs.goals && r.goal_minutes) {
      const [{ pk, total }] = await q(
        `SELECT date_trunc($3, now() AT TIME ZONE $2)::date::text AS pk,
           COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM COALESCE(stopped_at, now())
             - GREATEST(started_at, date_trunc($3, now() AT TIME ZONE $2) AT TIME ZONE $2)))), 0)::int AS total
         FROM entries WHERE user_id=$1 AND activity_id=$4
           AND COALESCE(stopped_at, now()) > date_trunc($3, now() AT TIME ZONE $2) AT TIME ZONE $2`,
        [r.user_id, tz, r.goal_period === "week" ? "week" : "day", r.activity_id]
      );
      const goal = r.goal_minutes * 60;
      const when = r.goal_period === "week" ? "this week" : "today";
      if (r.kind === "limit") {
        if (total >= goal) {
          await sendOnce(r.user_id, `limit:${r.activity_id}:${pk}`, {
            title: `Over your ${r.name} limit`, body: `${fmtDur(total)} ${when} · limit ${fmtDur(goal)}. Time to stop?`, tag: "goal",
          });
        } else if (goal - total <= LIMIT_WARN_SECONDS && goal > LIMIT_WARN_SECONDS * 2) {
          await sendOnce(r.user_id, `limitsoon:${r.activity_id}:${pk}`, {
            title: `${fmtDur(goal - total)} left on ${r.name}`, body: `Your limit is ${fmtDur(goal)} ${when}.`, tag: "goal",
          });
        }
      } else if (total >= goal) {
        await sendOnce(r.user_id, `goal:${r.activity_id}:${pk}`, {
          title: `Goal reached: ${r.name}`, body: `${fmtDur(goal)} ${when}. Nice work!`, tag: "goal",
        });
      }
    }
  }
}

export function startPushLoop(sessionStats) {
  const every = Number(process.env.PUSH_TICK_MS) || 60e3;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await pushTick(sessionStats); } catch (e) { console.warn("push tick failed:", e.message); } finally { busy = false; }
  }, every);
  setInterval(() => q("DELETE FROM push_log WHERE sent_at < now() - interval '60 days'").catch(() => {}), 6 * 3600e3);
}
