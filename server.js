import express from "express";
import compression from "compression";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";
import { initPush, vapidPublicKey, rememberOrigin, sendToUser, notifyRunning, startPushLoop, prefsOf, fmtDur, clockIn, sendOnce } from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL) {
  console.error("DATABASE_URL is not set. On Railway set it to ${{Postgres.DATABASE_URL}}");
  process.exit(1);
}
// private networks (Railway internal, localhost) usually have no SSL; public hosts usually require it.
// Try the likely setting first and fall back to the other one.
const makePool = (ssl) => new Pool({ connectionString: DB_URL, ssl: ssl ? { rejectUnauthorized: false } : undefined });
const sslFirst = process.env.PGSSL ? process.env.PGSSL !== "disable" : !/localhost|127\.0\.0\.1|\.railway\.internal/.test(DB_URL);
let pool = makePool(sslFirst);
try {
  await pool.query("SELECT 1");
} catch (e) {
  if (process.env.PGSSL) throw e;
  console.warn(`Database connection with ssl=${sslFirst} failed (${e.message}); retrying with ssl=${!sslFirst}`);
  await pool.end().catch(() => {});
  pool = makePool(!sslFirst);
  try {
    await pool.query("SELECT 1");
  } catch (e2) {
    console.error(`Cannot connect to the database: ${e2.message}`);
    process.exit(1);
  }
}
// data created before Google login existed is handed to this account on its first sign-in
const LEGACY_OWNER_EMAIL = (process.env.LEGACY_OWNER_EMAIL || "").toLowerCase();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
if (!GOOGLE_CLIENT_ID) console.warn("GOOGLE_CLIENT_ID is not set; sign-in will not work");
let SECRET = process.env.SESSION_SECRET || "";
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET is not set; using a random one (everyone is signed out on restart)");
}
const google = new OAuth2Client(GOOGLE_CLIENT_ID);
const SESSION_DAYS = 180;
const MAX_ACTIVITIES = 100;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_sub TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    picture TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS activities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3987e5',
    sort INT NOT NULL DEFAULT 0,
    archived BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE TABLE IF NOT EXISTS entries (
    id SERIAL PRIMARY KEY,
    activity_id INT NOT NULL REFERENCES activities(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ
  );
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
  -- 'good' = something to do more of; 'limit' = a habit to cut back on
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'good';
  -- optional target (good) or limit (cut back), in minutes per day or per week
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS goal_minutes INT;
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS goal_period TEXT;
  -- the 10,000-hour tracker: lifetime hours toward mastery, plus hours practised before using the app
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS mastery BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS mastery_base_hours INT NOT NULL DEFAULT 0;
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS note TEXT;
  CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id);
  CREATE INDEX IF NOT EXISTS entries_user_started_idx ON entries(user_id, started_at);
  -- "sign out everywhere": sessions issued before this moment are rejected
  ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ;
  -- a break: which activity to resume, and when
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pause_activity_id INT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pause_until TIMESTAMPTZ;
  -- focus mode was removed; drop its columns if an older version added them
  ALTER TABLE users DROP COLUMN IF EXISTS focus_activity_id, DROP COLUMN IF EXISTS focus_phase, DROP COLUMN IF EXISTS focus_ends,
    DROP COLUMN IF EXISTS focus_round, DROP COLUMN IF EXISTS focus_rounds, DROP COLUMN IF EXISTS focus_work, DROP COLUMN IF EXISTS focus_break;
  -- yes/no daily habits ("Workout?", "Ate sugar?"); kind 'do' = yes is good, 'avoid' = no is good
  CREATE TABLE IF NOT EXISTS habits (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'do',
    color TEXT NOT NULL DEFAULT '#3987e5',
    sort INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS habit_marks (
    habit_id INT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    value BOOLEAN NOT NULL,
    PRIMARY KEY (habit_id, day)
  );
  CREATE INDEX IF NOT EXISTS habits_user_idx ON habits(user_id);
  -- counters (kind 'count'): an optional daily target, the + button step, and one number per day
  ALTER TABLE habits ADD COLUMN IF NOT EXISTS target INT;
  ALTER TABLE habits ADD COLUMN IF NOT EXISTS step INT NOT NULL DEFAULT 1;
  CREATE TABLE IF NOT EXISTS habit_counts (
    habit_id INT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    count INT NOT NULL CHECK (count >= 0),
    PRIMARY KEY (habit_id, day)
  );
  -- iPhone Shortcuts keys were removed; drop their table if an older version made it
  DROP TABLE IF EXISTS api_tokens;
`);
await initPush((text, params) => pool.query(text, params).then((r) => r.rows));

// --- sessions: signed cookie "uid.issuedAt.expiry.hmac" (older cookies "uid.expiry.hmac" count as issued at 0) ---
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function makeSession(uid) {
  const now = Date.now();
  const v = `${uid}.${now}.${now + SESSION_DAYS * 864e5}`;
  return `${v}.${sign(v)}`;
}
function readSession(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.get("cookie") || "");
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const mac = parts.pop();
  const [uid, iat, exp] = parts.length === 3 ? parts : [parts[0], "0", parts[1]];
  const expected = Buffer.from(sign(parts.join(".")));
  const got = Buffer.from(mac);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  if (Number(exp) < Date.now()) return null;
  return { uid: Number(uid), iat: Number(iat) };
}
function setCookie(req, res, value, maxAgeMs) {
  res.cookie("sid", value, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: maxAgeMs, path: "/" });
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(compression());

// Security headers. Google Sign-In needs its script, iframe and styles from accounts.google.com;
// inline style attributes are used throughout the UI, inline scripts are not.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: https://*.googleusercontent.com",
  "manifest-src 'self'", "worker-src 'self'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'none'", "object-src 'none'",
].join("; ");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups", // the Google sign-in popup
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
  next();
});

// Simple fixed-window rate limits kept in memory (one server instance)
function rateLimit(max, windowMs, keyOf) {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = keyOf(req), t = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < t) hits.set(key, (e = { n: 0, reset: t + windowMs }));
    if (++e.n > max) {
      res.set("Retry-After", String(Math.ceil((e.reset - t) / 1000)));
      return res.status(429).json({ error: "Too many requests, try again in a moment" });
    }
    next();
  };
}
const ipOf = (req) => req.ip || "?";
app.use("/auth", rateLimit(Number(process.env.AUTH_RATE_MAX) || 20, 15 * 60e3, ipOf)); // sign-in attempts per IP
app.use("/api", rateLimit(Number(process.env.API_RATE_MAX) || 600, 60e3, ipOf));      // everything else per IP
// small bodies everywhere except restoring a backup
const smallJson = express.json({ limit: "10kb" });
app.use((req, res, next) => (req.path === "/api/restore" ? next() : smallJson(req, res, next)));
app.use(express.static(path.join(__dirname, "public")));

// Express 4 does not catch async errors; route them to the error handler instead of crashing
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const q = (text, params) => pool.query(text, params).then((r) => r.rows);

// Cross-site forms cannot send JSON without a CORS preflight, so requiring it blocks CSRF
const jsonOnly = (req, res, next) =>
  req.method === "GET" || /^application\/json\b/i.test(req.get("content-type") || "") ? next() : res.status(415).json({ error: "JSON required" });

app.get("/config", (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

app.post("/auth/google", jsonOnly, h(async (req, res) => {
  let payload;
  try {
    const ticket = await google.verifyIdToken({ idToken: String(req.body.credential || ""), audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "Google sign-in failed" });
  }
  if (!payload?.sub || !payload.email_verified) return res.status(401).json({ error: "Google account email not verified" });
  const [user] = await q(
    `INSERT INTO users(google_sub,email,name,picture) VALUES($1,$2,$3,$4)
     ON CONFLICT (google_sub) DO UPDATE SET email=$2, name=$3, picture=$4 RETURNING id`,
    [payload.sub, payload.email, payload.name || null, payload.picture || null]
  );
  if (LEGACY_OWNER_EMAIL && payload.email.toLowerCase() === LEGACY_OWNER_EMAIL) {
    await q("UPDATE activities SET user_id=$1 WHERE user_id IS NULL", [user.id]);
    await q("UPDATE entries SET user_id=$1 WHERE user_id IS NULL", [user.id]);
  }
  setCookie(req, res, makeSession(user.id), SESSION_DAYS * 864e5);
  res.json({ ok: true });
}));

app.post("/auth/logout", (req, res) => {
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
});

app.use("/api", h(async (req, res, next) => {
  if (req.method !== "GET" && !/^application\/json\b/i.test(req.get("content-type") || "")) return res.status(415).json({ error: "JSON required" });
  const sess = readSession(req);
  if (!sess) return res.status(401).json({ error: "Please sign in" });
  const [u] = await q("SELECT sessions_valid_after FROM users WHERE id=$1", [sess.uid]);
  if (!u || (u.sessions_valid_after && sess.iat < u.sessions_valid_after.getTime())) {
    res.clearCookie("sid", { path: "/" });
    return res.status(401).json({ error: "Please sign in" });
  }
  req.uid = sess.uid;
  next();
}));

function validTz(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

app.get("/api/state", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  // remember the user's time zone so background reminders use their local day/week
  if (validTz(req.query.tz)) await q("UPDATE users SET tz=$2 WHERE id=$1 AND tz IS DISTINCT FROM $2", [req.uid, tz]);
  const [user] = await q("SELECT email, name, picture FROM users WHERE id=$1", [req.uid]);
  if (!user) return res.status(401).json({ error: "Please sign in" });
  const activities = await q(
    `SELECT a.id, a.name, a.color, a.sort, a.kind, a.goal_minutes, a.goal_period, a.mastery, a.mastery_base_hours,
       (SELECT max(COALESCE(e.stopped_at, now())) FROM entries e WHERE e.activity_id=a.id AND e.user_id=$1) AS last_at,
       -- finished sessions only (the client adds the running one): all time, and the last 30 days for the pace
       CASE WHEN a.mastery THEN (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.stopped_at - e.started_at)), 0)::bigint
         FROM entries e WHERE e.activity_id=a.id AND e.user_id=$1 AND e.stopped_at IS NOT NULL) END AS mastery_sec,
       CASE WHEN a.mastery THEN (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.stopped_at - GREATEST(e.started_at, now() - interval '30 days'))), 0)::bigint
         FROM entries e WHERE e.activity_id=a.id AND e.user_id=$1 AND e.stopped_at > now() - interval '30 days') END AS mastery_30d
     FROM activities a WHERE a.user_id=$1 AND NOT a.archived ORDER BY a.sort, a.id`,
    [req.uid]
  );
  const [running] = await q(
    `SELECT e.*, a.name FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [req.uid]
  );
  const totals = await q(
    // only the part of each entry inside today / this week counts, so sessions crossing midnight split correctly
    `SELECT activity_id,
       SUM(GREATEST(0, EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - GREATEST(started_at, b.day))))::int AS today,
       SUM(GREATEST(0, EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - GREATEST(started_at, b.week))))::int AS week
     FROM entries,
       (SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS day,
               date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1 AS week) b
     WHERE user_id=$2 AND COALESCE(stopped_at, now()) > b.week GROUP BY activity_id`,
    [tz, req.uid]
  );
  const stats = running ? await sessionStats(req.uid, running.activity_id, running.id, tz) : null;
  const [pause] = await q(
    `SELECT u.pause_activity_id AS activity_id, u.pause_until AS until, a.name, a.color
     FROM users u JOIN activities a ON a.id=u.pause_activity_id WHERE u.id=$1 AND u.pause_until IS NOT NULL`,
    [req.uid]
  );
  res.json({
    user, activities, running: running || null, stats, totals, pause: pause || null,
    streaks: await streaks(req.uid, tz, activities), serverNow: new Date().toISOString(),
  });
}));

// Past sessions of an activity (excluding the running one): average and longest length,
// the streak of consecutive local days, ending today, on which it was tracked, and when the previous session ended.
async function sessionStats(uid, activityId, runningId, tz) {
  const [s] = await q(
    `SELECT count(*)::int AS sessions,
       COALESCE(avg(EXTRACT(EPOCH FROM stopped_at - started_at)), 0)::int AS avg,
       COALESCE(max(EXTRACT(EPOCH FROM stopped_at - started_at)), 0)::int AS max,
       max(stopped_at) AS prev_end
     FROM entries WHERE user_id=$1 AND activity_id=$2 AND id<>$3 AND stopped_at IS NOT NULL
       AND stopped_at - started_at >= interval '1 minute'`,
    [uid, activityId, runningId]
  );
  const days = await q(
    `SELECT DISTINCT (started_at AT TIME ZONE $3)::date::text AS d FROM entries
     WHERE user_id=$1 AND activity_id=$2 AND started_at > now() - interval '400 days' ORDER BY d DESC`,
    [uid, activityId, tz]
  );
  const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [tz]);
  const have = new Set(days.map((r) => r.d));
  let streak = 0;
  for (const d = new Date(today + "T00:00:00Z"); have.has(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1)) streak++;
  // for the live screen: a usual day (last 4 weeks, days it was done, not today) and last week up to this moment
  const [extra] = await q(
    `WITH days AS (
       SELECT (started_at AT TIME ZONE $3)::date AS d, SUM(EXTRACT(EPOCH FROM stopped_at - started_at)) AS s
       FROM entries WHERE user_id=$1 AND activity_id=$2 AND stopped_at IS NOT NULL
         AND started_at > now() - interval '28 days' AND (started_at AT TIME ZONE $3)::date < (now() AT TIME ZONE $3)::date
       GROUP BY 1),
     wk AS (SELECT date_trunc('week', now() AT TIME ZONE $3) AT TIME ZONE $3 - interval '7 days' AS s, now() - interval '7 days' AS e)
     SELECT (SELECT COALESCE(avg(s), 0)::int FROM days) AS day_avg,
       (SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM LEAST(COALESCE(stopped_at, now()), wk.e) - GREATEST(started_at, wk.s)))), 0)::int
        FROM entries, wk WHERE user_id=$1 AND activity_id=$2 AND started_at < wk.e AND COALESCE(stopped_at, now()) > wk.s) AS last_week_to_date`,
    [uid, activityId, tz]
  );
  return { ...s, streak, dayAvg: extra.day_avg, lastWeekToDate: extra.last_week_to_date };
}

const pushLater = (uid) => notifyRunning(uid).catch((e) => console.warn("push failed:", e.message));

// --- push notification settings for the signed-in user ---
app.get("/api/push", h(async (req, res) => {
  const [u] = await q("SELECT notify FROM users WHERE id=$1", [req.uid]);
  const [{ n }] = await q("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1", [req.uid]);
  res.json({ publicKey: vapidPublicKey(), prefs: prefsOf(u?.notify), devices: n });
}));

app.post("/api/push/subscribe", h(async (req, res) => {
  const sub = req.body.subscription || {};
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const { p256dh, auth } = sub.keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
    return res.status(400).json({ error: "Bad subscription" });
  }
  const [{ n }] = await q("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=$1 AND endpoint<>$2", [req.uid, endpoint]);
  if (n >= 20) return res.status(400).json({ error: "Too many devices; turn notifications off on an old one" });
  // the same browser can move between accounts: the endpoint belongs to whoever subscribed last
  await q(
    `INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4`,
    [req.uid, endpoint, p256dh, auth]
  );
  await rememberOrigin(req.get("origin"));
  res.json({ ok: true });
}));

app.post("/api/push/unsubscribe", h(async (req, res) => {
  await q("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2", [req.uid, String(req.body.endpoint || "")]);
  res.json({ ok: true });
}));

app.put("/api/push/prefs", h(async (req, res) => {
  const prefs = {};
  for (const k of ["running", "forgot", "goals", "review", "habits"]) if (typeof req.body[k] === "boolean") prefs[k] = req.body[k];
  if (typeof req.body.habitsAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.habitsAt)) prefs.habitsAt = req.body.habitsAt;
  const [u] = await q("SELECT notify FROM users WHERE id=$1", [req.uid]);
  const next = { ...prefsOf(u?.notify), ...prefs };
  await q("UPDATE users SET notify=$2 WHERE id=$1", [req.uid, JSON.stringify(next)]);
  res.json({ prefs: next });
}));

app.post("/api/push/test", h(async (req, res) => {
  const sent = await sendToUser(req.uid, { title: "Moonglare", body: "Notifications are working 👍", tag: "test", ttl: 300 });
  res.json({ sent });
}));

function cleanName(name) {
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
}
const cleanNote = (note) => (typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null);

// goal_minutes null clears the goal; otherwise 1 minute .. 1 week, per 'day' or 'week'
function parseGoal(body) {
  if (!("goal_minutes" in body)) return { set: false };
  if (body.goal_minutes === null) return { set: true, minutes: null, period: null };
  const m = body.goal_minutes, p = body.goal_period;
  if (!Number.isInteger(m) || m < 1 || m > 10080 || !["day", "week"].includes(p)) return { error: "Bad goal" };
  return { set: true, minutes: m, period: p };
}

// mastery: the 10,000-hour flag; mastery_base_hours: hours practised before tracking, 0 .. 9,999
function parseMastery(body) {
  const out = {};
  if ("mastery" in body) {
    if (typeof body.mastery !== "boolean") return { error: "Bad mastery" };
    out.on = body.mastery;
  }
  if ("mastery_base_hours" in body) {
    const b = body.mastery_base_hours;
    if (!Number.isInteger(b) || b < 0 || b > 9999) return { error: "Earlier hours must be 0 to 9,999" };
    out.base = b;
  }
  return out;
}

app.post("/api/activities", h(async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: "Name required" });
  const color = COLOR_RE.test(req.body.color) ? req.body.color : "#3987e5";
  const [{ n }] = await q("SELECT count(*)::int AS n FROM activities WHERE user_id=$1 AND NOT archived", [req.uid]);
  if (n >= MAX_ACTIVITIES) return res.status(400).json({ error: `Limit is ${MAX_ACTIVITIES} activities` });
  const goal = parseGoal(req.body);
  if (goal.error) return res.status(400).json({ error: goal.error });
  const ms = parseMastery(req.body);
  if (ms.error) return res.status(400).json({ error: ms.error });
  const kind = req.body.kind === "limit" ? "limit" : "good";
  const [row] = await q(
    `INSERT INTO activities(user_id,name,color,kind,goal_minutes,goal_period,mastery,mastery_base_hours,sort)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(sort),0)+1 FROM activities WHERE user_id=$1))
     RETURNING id,name,color,kind,goal_minutes,goal_period,mastery,mastery_base_hours,sort`,
    [req.uid, name, color, kind, goal.minutes ?? null, goal.period ?? null, kind === "good" && !!ms.on, ms.base ?? 0]
  );
  res.json(row);
}));

app.put("/api/activities/:id", h(async (req, res) => {
  const { name, color, sort, kind } = req.body;
  if (name !== undefined && !cleanName(name)) return res.status(400).json({ error: "Name required" });
  if (color !== undefined && !COLOR_RE.test(color)) return res.status(400).json({ error: "Bad color" });
  if (sort !== undefined && !Number.isInteger(sort)) return res.status(400).json({ error: "Bad sort" });
  if (kind !== undefined && !["good", "limit"].includes(kind)) return res.status(400).json({ error: "Bad kind" });
  const goal = parseGoal(req.body);
  if (goal.error) return res.status(400).json({ error: goal.error });
  const ms = parseMastery(req.body);
  if (ms.error) return res.status(400).json({ error: ms.error });
  const [row] = await q(
    `UPDATE activities SET name=COALESCE($3,name), color=COALESCE($4,color), sort=COALESCE($5,sort), kind=COALESCE($6,kind),
       goal_minutes=CASE WHEN $7 THEN $8::int ELSE goal_minutes END,
       goal_period=CASE WHEN $7 THEN $9::text ELSE goal_period END,
       mastery_base_hours=COALESCE($10::int, mastery_base_hours)
     WHERE id=$1 AND user_id=$2 RETURNING id,name,color,kind,goal_minutes,goal_period,sort`,
    [req.params.id, req.uid, cleanName(name), color, sort, kind, goal.set, goal.minutes ?? null, goal.period ?? null, ms.base ?? null]
  );
  if (row) {
    // cut-back habits aren't skills to master
    await q("UPDATE activities SET mastery=(kind='good' AND COALESCE($3::boolean, mastery)) WHERE id=$1 AND user_id=$2", [row.id, req.uid, ms.on ?? null]);
  }
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
}));

// Deleting an activity deletes all its tracked time too, so History, charts and reviews forget it.
app.delete("/api/activities/:id", h(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [act] } = await client.query("SELECT id FROM activities WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
    if (!act) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Not found" }); }
    await client.query("DELETE FROM entries WHERE activity_id=$1", [act.id]);
    await client.query("UPDATE users SET pause_activity_id=NULL, pause_until=NULL WHERE id=$1 AND pause_activity_id=$2", [req.uid, act.id]);
    await client.query("DELETE FROM activities WHERE id=$1", [act.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
  pushLater(req.uid);
}));

// the app sends the activity's id; a name ({"activity": "Deep work"}) works too
async function findActivity(uid, body) {
  if (body?.activity_id !== undefined) {
    const [a] = await q("SELECT id, name FROM activities WHERE id=$1 AND user_id=$2 AND NOT archived", [body.activity_id, uid]);
    return a;
  }
  const name = typeof body?.activity === "string" ? body.activity.trim() : "";
  if (!name) return null;
  const [a] = await q("SELECT id, name FROM activities WHERE user_id=$1 AND NOT archived AND lower(name)=lower($2) LIMIT 1", [uid, name]);
  return a;
}
// any manual start/stop replaces a pending break
const clearPause = (uid) => q("UPDATE users SET pause_activity_id=NULL, pause_until=NULL WHERE id=$1 AND pause_until IS NOT NULL", [uid]);

// Changes made offline arrive later with the time they really happened ("at"): trust it for up to 2 days back
function eventTime(at) {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  if (isNaN(t)) return null;
  const now = Date.now();
  return t > now + 60e3 || t < now - 2 * 864e5 ? null : new Date(Math.min(t, now));
}
async function startActivity(uid, act, at) {
  await clearPause(uid);
  const when = at || new Date();
  await q("UPDATE entries SET stopped_at=GREATEST(started_at, $2::timestamptz) WHERE user_id=$1 AND stopped_at IS NULL", [uid, when]);
  await q("DELETE FROM entries WHERE user_id=$1 AND stopped_at = started_at", [uid]); // nothing left of it
  const [row] = await q("INSERT INTO entries(user_id,activity_id,started_at) VALUES($1,$2,$3) RETURNING *", [uid, act.id, when]);
  pushLater(uid);
  return { ...row, message: `Started ${act.name}` };
}
async function stopRunning(uid, at) {
  await clearPause(uid);
  const [e] = await q(
    `UPDATE entries e SET stopped_at=GREATEST(e.started_at, $2::timestamptz) FROM activities a
     WHERE e.user_id=$1 AND e.stopped_at IS NULL AND a.id=e.activity_id RETURNING a.name, e.started_at, e.stopped_at`,
    [uid, at || new Date()]
  );
  if (!e) return { ok: true, message: "Nothing was running" };
  pushLater(uid);
  return { ok: true, message: `Stopped ${e.name} · ${fmtDur((e.stopped_at - e.started_at) / 1000)}` };
}

app.post("/api/start", h(async (req, res) => {
  const act = await findActivity(req.uid, req.body);
  if (!act) return res.status(404).json({ error: "Activity not found", message: "No activity with that name" });
  res.json(await startActivity(req.uid, act, eventTime(req.body?.at)));
}));

app.post("/api/stop", h(async (req, res) => res.json(await stopRunning(req.uid, eventTime(req.body?.at)))));


// A break: stop the running entry now, and start the same activity again when the break is over
app.post("/api/pause", h(async (req, res) => {
  const minutes = Number.isInteger(req.body?.minutes) ? req.body.minutes : 15;
  if (minutes < 1 || minutes > 240) return res.status(400).json({ error: "Pause between 1 and 240 minutes" });
  const [e] = await q(
    `UPDATE entries e SET stopped_at=now() FROM activities a
     WHERE e.user_id=$1 AND e.stopped_at IS NULL AND a.id=e.activity_id RETURNING e.activity_id, a.name`,
    [req.uid]
  );
  if (!e) return res.status(400).json({ error: "Nothing is running", message: "Nothing is running" });
  const [u] = await q(
    "UPDATE users SET pause_activity_id=$2, pause_until=now() + make_interval(mins => $3) WHERE id=$1 RETURNING pause_until, tz",
    [req.uid, e.activity_id, minutes]
  );
  const back = clockIn(u.pause_until, u.tz);
  res.json({ ok: true, until: u.pause_until, message: `${e.name} paused · back at ${back}` });
  sendToUser(req.uid, { title: `${e.name} paused`, body: `Break until ${back}. It continues automatically.`, tag: "running", sticky: true })
    .catch((err) => console.warn("push failed:", err.message));
}));

// End a break: early (the user asked) or on time (the server's loop). Only one caller wins the update.
async function resumePause(uid, onTime) {
  const [p] = await q(
    `WITH old AS (SELECT pause_activity_id, pause_until FROM users
                  WHERE id=$1 AND pause_until IS NOT NULL ${onTime ? "AND pause_until <= now()" : ""} FOR UPDATE)
     UPDATE users SET pause_activity_id=NULL, pause_until=NULL FROM old WHERE users.id=$1
     RETURNING old.pause_activity_id AS aid, old.pause_until AS until, users.tz`,
    [uid]
  );
  if (!p) return null;
  const [act] = await q("SELECT id, name FROM activities WHERE id=$1 AND user_id=$2 AND NOT archived", [p.aid, uid]);
  const [busy] = await q("SELECT 1 FROM entries WHERE user_id=$1 AND stopped_at IS NULL", [uid]);
  if (!act || busy) return null;
  const [row] = await q(
    "INSERT INTO entries(user_id,activity_id,started_at) VALUES($1,$2,LEAST(now(), $3::timestamptz)) RETURNING started_at",
    [uid, act.id, p.until]
  );
  await sendToUser(uid, {
    title: onTime ? "Break over" : `${act.name} resumed`,
    body: `${act.name} continues from ${clockIn(row.started_at, p.tz)}`,
    tag: "running", sticky: true, actions: [{ action: "stop", title: "Stop" }],
  }).catch((err) => console.warn("push failed:", err.message));
  return act;
}

app.post("/api/pause/resume", h(async (req, res) => {
  const act = await resumePause(req.uid, false);
  res.json({ ok: !!act, message: act ? `${act.name} resumed` : "No break to resume" });
}));

app.post("/api/pause/cancel", h(async (req, res) => {
  await clearPause(req.uid);
  res.json({ ok: true });
}));


// --- insights: how habits go together with tracked time (last 90 days, days before today) ---
app.get("/api/insights", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [tz]);
  const from = (await q("SELECT ($1::date - 90)::text AS d", [today]))[0].d;
  const time = await q(
    `SELECT (started_at AT TIME ZONE $2)::date::text AS d, activity_id, SUM(EXTRACT(EPOCH FROM stopped_at - started_at))::int AS sec
     FROM entries WHERE user_id=$1 AND stopped_at IS NOT NULL AND started_at > now() - interval '92 days'
     GROUP BY 1, 2`,
    [req.uid, tz]
  );
  const acts = await q("SELECT id, name, kind, color FROM activities WHERE user_id=$1 AND NOT archived", [req.uid]);
  const habits = await q("SELECT id, name, kind, color, target FROM habits WHERE user_id=$1", [req.uid]);
  const marks = await q(
    `SELECT m.habit_id, m.day::text AS d, m.value FROM habit_marks m JOIN habits h ON h.id=m.habit_id
     WHERE h.user_id=$1 AND m.day >= $2 AND m.day < $3`, [req.uid, from, today]);
  const counts = await q(
    `SELECT c.habit_id, c.day::text AS d, c.count FROM habit_counts c JOIN habits h ON h.id=c.habit_id
     WHERE h.user_id=$1 AND c.day >= $2 AND c.day < $3`, [req.uid, from, today]);
  const sec = new Map(time.map((t) => [`${t.activity_id}|${t.d}`, t.sec]));
  const days = [];
  for (let d = from; d < today; ) { days.push(d); const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10); }
  const out = [];
  for (const hb of habits) {
    // split days into "yes" (did it / hit the target) and "no" (didn't), using only days that say something
    let yes = [], no = [];
    if (hb.kind === "count") {
      const c = new Map(counts.filter((x) => x.habit_id === hb.id).map((x) => [x.d, x.count]));
      const first = [...c.keys()].sort()[0];
      if (!first) continue;
      for (const d of days) if (d >= first) ((c.get(d) || 0) >= (hb.target || 1) ? yes : no).push(d);
    } else {
      for (const m of marks) if (m.habit_id === hb.id) (m.value ? yes : no).push(m.d);
    }
    if (yes.length < 5 || no.length < 5) continue;
    for (const a of acts) {
      const avg = (list) => list.reduce((t, d) => t + (sec.get(`${a.id}|${d}`) || 0), 0) / list.length;
      const ay = avg(yes), an = avg(no), diff = ay - an;
      if (Math.abs(diff) < 15 * 60 || Math.abs(diff) < 0.25 * Math.max(ay, an)) continue;
      out.push({ habit: { id: hb.id, name: hb.name, kind: hb.kind, color: hb.color, target: hb.target },
        activity: { id: a.id, name: a.name, kind: a.kind, color: a.color },
        avgYes: Math.round(ay), avgNo: Math.round(an), daysYes: yes.length, daysNo: no.length });
    }
  }
  out.sort((x, y) => Math.abs(y.avgYes - y.avgNo) - Math.abs(x.avgYes - x.avgNo));
  res.json({ insights: out.slice(0, 8), days: days.length });
}));

// Evening habit reminder, at the user's chosen time (default 21:00), only if something is still unlogged today
setInterval(async () => {
  try {
    const users = await q(
      `SELECT u.id, u.tz, u.notify FROM users u
       WHERE u.tz IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)
         AND EXISTS (SELECT 1 FROM habits h WHERE h.user_id=u.id)`
    );
    for (const u of users) {
      const prefs = prefsOf(u.notify);
      if (!prefs.habits) continue;
      const hm = new Intl.DateTimeFormat("en-GB", { timeZone: u.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
      if (hm < prefs.habitsAt) continue;
      const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [u.tz]);
      const hs = await q(
        `SELECT h.name, (h.kind <> 'count' AND EXISTS (SELECT 1 FROM habit_marks m WHERE m.habit_id=h.id AND m.day=$2))
                     OR (h.kind = 'count' AND EXISTS (SELECT 1 FROM habit_counts c WHERE c.habit_id=h.id AND c.day=$2)) AS done
         FROM habits h WHERE h.user_id=$1 ORDER BY h.sort, h.id`,
        [u.id, today]
      );
      const open = hs.filter((x) => !x.done);
      if (!open.length) continue;
      await sendOnce(u.id, `habits:${today}`, {
        title: "Check in on your habits",
        body: `${hs.length - open.length} of ${hs.length} logged today. Still open: ${open.slice(0, 3).map((x) => x.name).join(", ")}${open.length > 3 ? "…" : ""}`,
        tag: "habits", url: "/?view=habits", ttl: 4 * 3600,
      });
    }
  } catch (e) { console.warn("habit reminder loop failed:", e.message); }
}, Number(process.env.REVIEW_TICK_MS) || 5 * 60e3);

// --- weekly review ---
// One week (Mon–Sun, user's time zone) against the week before: totals, goals, best day.
async function weekReview(uid, tz, start) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) {
    [{ start }] = await q("SELECT date_trunc('week', now() AT TIME ZONE $1)::date::text AS start", [tz]);
  }
  const rows = await q(
    `WITH b AS (SELECT gs AS s, gs + interval '1 day' AS e
                FROM generate_series(($2::date - 7)::timestamp, ($2::date + 6)::timestamp, interval '1 day') gs),
     en AS (SELECT activity_id, started_at AT TIME ZONE $3 AS s, COALESCE(stopped_at, now()) AT TIME ZONE $3 AS e FROM entries
            WHERE user_id=$1 AND COALESCE(stopped_at, now()) AT TIME ZONE $3 > ($2::date - 7)::timestamp
              AND started_at AT TIME ZONE $3 < ($2::date + 7)::timestamp)
     SELECT b.s::date::text AS d, en.activity_id, SUM(EXTRACT(EPOCH FROM LEAST(en.e, b.e) - GREATEST(en.s, b.s)))::int AS sec
     FROM b JOIN en ON en.s < b.e AND en.e > b.s GROUP BY 1, 2`,
    [uid, start, tz]
  );
  const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [tz]);
  const addDay = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const days = Array.from({ length: 7 }, (_, i) => addDay(start, i));
  const elapsed = days.filter((d) => d <= today);
  const acts = await q("SELECT id, name, color, kind, archived, goal_minutes, goal_period FROM activities WHERE user_id=$1 ORDER BY sort, id", [uid]);
  const cur = new Map(), prev = new Map(), perDay = new Map(days.map((d) => [d, 0])), actDay = new Map();
  for (const r of rows) {
    const inWeek = r.d >= start;
    (inWeek ? cur : prev).set(r.activity_id, ((inWeek ? cur : prev).get(r.activity_id) || 0) + r.sec);
    if (inWeek) {
      perDay.set(r.d, perDay.get(r.d) + r.sec);
      actDay.set(`${r.activity_id}:${r.d}`, r.sec);
    }
  }
  const list = acts.filter((a) => cur.get(a.id) || (!a.archived && (prev.get(a.id) || a.goal_minutes))).map((a) => {
    const sec = cur.get(a.id) || 0, before = prev.get(a.id) || 0;
    let goal = null;
    if (a.goal_minutes) {
      const g = a.goal_minutes * 60, limit = a.kind === "limit";
      if (a.goal_period === "week") goal = { period: "week", minutes: a.goal_minutes, met: limit ? sec <= g : sec >= g };
      else {
        const met = elapsed.filter((d) => { const v = actDay.get(`${a.id}:${d}`) || 0; return limit ? v <= g : v >= g; }).length;
        goal = { period: "day", minutes: a.goal_minutes, daysMet: met, days: elapsed.length };
      }
    }
    return { id: a.id, name: a.name, color: a.color, kind: a.kind, seconds: sec, prev: before, goal };
  }).sort((x, y) => y.seconds - x.seconds);
  const total = [...cur.values()].reduce((x, y) => x + y, 0), prevTotal = [...prev.values()].reduce((x, y) => x + y, 0);
  const best = [...perDay.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    start, end: days[6], current: today <= days[6], days: days.map((d) => ({ date: d, seconds: perDay.get(d) })),
    total, prevTotal, daysTracked: [...perDay.values()].filter((v) => v >= 60).length, daysElapsed: elapsed.length,
    bestDay: best && best[1] > 0 ? { date: best[0], seconds: best[1] } : null, activities: list,
  };
}

app.get("/api/review", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : (await q("SELECT tz FROM users WHERE id=$1", [req.uid]))[0]?.tz || "UTC";
  res.json(await weekReview(req.uid, tz, req.query.start));
}));

// Sunday from 19:00 (user's time zone): one "your week" notification per week
setInterval(async () => {
  try {
    const users = await q(
      `SELECT u.id, u.tz, u.notify FROM users u
       WHERE u.tz IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)`
    );
    for (const u of users) {
      if (!prefsOf(u.notify).review) continue;
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: u.tz, weekday: "short", hour: "numeric", hourCycle: "h23" })
        .formatToParts(new Date()).map((p) => [p.type, p.value]));
      if (parts.weekday !== "Sun" || Number(parts.hour) < 19) continue;
      const r = await weekReview(u.id, u.tz);
      if (r.total < 60) continue;
      const diff = r.total - r.prevTotal;
      const change = r.prevTotal ? ` (${diff >= 0 ? "▲" : "▼"} ${fmtDur(Math.abs(diff))})` : "";
      const top = r.activities.filter((a) => a.seconds >= 60).slice(0, 2).map((a) => `${a.name} ${fmtDur(a.seconds)}`).join(" · ");
      const goals = r.activities.filter((a) => a.goal).map((a) => a.goal.period === "week"
        ? `${a.name} ${a.goal.met ? "✓" : "✗"}` : `${a.name} ${a.goal.daysMet}/${a.goal.days} days`).slice(0, 3).join(" · ");
      await sendOnce(u.id, `review:${r.start}`, {
        title: `Your week: ${fmtDur(r.total)} tracked${change}`,
        body: [top, goals && `Goals: ${goals}`].filter(Boolean).join("\n") + "\nTap for your weekly review",
        tag: "review", url: `/?review=${r.start}`, ttl: 12 * 3600,
      });
    }
  } catch (e) { console.warn("review loop failed:", e.message); }
}, Number(process.env.REVIEW_TICK_MS) || 5 * 60e3);

// breaks end even when no app is open
setInterval(async () => {
  try {
    const due = await q("SELECT id FROM users WHERE pause_until <= now()");
    for (const u of due) await resumePause(u.id, true);
  } catch (e) { console.warn("pause loop failed:", e.message); }
}, Number(process.env.PAUSE_TICK_MS) || 15e3);

// Daily streaks per activity (days in the user's time zone, by start time):
// good: days tracked (or days the daily goal was met); cut back: days under the daily limit (or days without it).
async function streaks(uid, tz, activities) {
  const rows = await q(
    `SELECT activity_id, (started_at AT TIME ZONE $2)::date::text AS d,
       SUM(EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - started_at))::int AS s
     FROM entries WHERE user_id=$1 AND started_at > now() - interval '400 days' GROUP BY 1, 2`,
    [uid, tz]
  );
  const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [tz]);
  const byAct = new Map();
  for (const r of rows) {
    if (!byAct.has(r.activity_id)) byAct.set(r.activity_id, new Map());
    byAct.get(r.activity_id).set(r.d, r.s);
  }
  const prev = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const out = {};
  for (const a of activities) {
    const days = byAct.get(a.id);
    if (!days) continue;
    const dailyGoal = a.goal_period === "day" && a.goal_minutes ? a.goal_minutes * 60 : null;
    const ok = a.kind === "limit"
      ? (d) => (days.get(d) || 0) <= (dailyGoal ?? 0)
      : (d) => (days.get(d) || 0) >= (dailyGoal ?? 60);
    const first = [...days.keys()].sort()[0];
    let current = 0, d = today;
    // an unfinished today doesn't break a good streak; a limit already broken today does
    if (!ok(d) && a.kind !== "limit") d = prev(d);
    while (d >= first && ok(d)) { current++; d = prev(d); }
    let best = 0, run = 0;
    for (let x = today; x >= first; x = prev(x)) { run = ok(x) ? run + 1 : 0; best = Math.max(best, run); }
    out[a.id] = { current, best };
  }
  return out;
}

app.get("/api/entries", h(async (req, res) => {
  const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (search) {
    const like = "%" + search.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    return res.json(
      await q(
        `SELECT e.*, a.name, a.color FROM entries e JOIN activities a ON a.id=e.activity_id
         WHERE e.user_id=$1 AND (e.note ILIKE $2 OR a.name ILIKE $2) ORDER BY started_at DESC LIMIT 200`,
        [req.uid, like]
      )
    );
  }
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 366);
  res.json(
    await q(
      `SELECT e.*, a.name, a.color FROM entries e JOIN activities a ON a.id=e.activity_id
       WHERE e.user_id=$1 AND COALESCE(stopped_at, now()) >= now() - make_interval(days => $2)
       ORDER BY started_at DESC LIMIT 2000`,
      [req.uid, days]
    )
  );
}));

const parseDate = (v) => (typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v) : null);

// Shared checks for creating/editing an entry; returns [status, message] on failure
async function checkEntry(uid, { start, stop, activityId, excludeId }) {
  const soon = Date.now() + 60e3;
  if (start > soon || (stop && stop > soon)) return [400, "Times can't be in the future"];
  if (stop && stop <= start) return [400, "End must be after start"];
  if (!Number.isInteger(activityId)) return [400, "Activity not found"];
  const [act] = await q("SELECT id FROM activities WHERE id=$1 AND user_id=$2", [activityId, uid]);
  if (!act) return [400, "Activity not found"];
  const [clash] = await q(
    `SELECT a.name FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 AND e.id<>$2
       AND tstzrange(e.started_at, COALESCE(e.stopped_at, now())) && tstzrange($3::timestamptz, COALESCE($4::timestamptz, now()))
     LIMIT 1`,
    [uid, excludeId || 0, start, stop]
  );
  if (clash) return [409, `Overlaps with ${clash.name}`];
  return null;
}

app.post("/api/entries", h(async (req, res) => {
  const start = parseDate(req.body.started_at), stop = parseDate(req.body.stopped_at);
  if (!start || !stop) return res.status(400).json({ error: "Start and end are required" });
  const activityId = Number(req.body.activity_id);
  const bad = await checkEntry(req.uid, { start, stop, activityId });
  if (bad) return res.status(bad[0]).json({ error: bad[1] });
  const [row] = await q(
    "INSERT INTO entries(user_id,activity_id,started_at,stopped_at,note) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [req.uid, activityId, start, stop, cleanNote(req.body.note)]
  );
  res.json(row);
}));

app.put("/api/entries/:id", h(async (req, res) => {
  const [entry] = await q("SELECT * FROM entries WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
  if (!entry) return res.status(404).json({ error: "Not found" });
  const start = req.body.started_at === undefined ? entry.started_at : parseDate(req.body.started_at);
  const stop = req.body.stopped_at === undefined ? entry.stopped_at : req.body.stopped_at === null ? null : parseDate(req.body.stopped_at);
  if (!start || (req.body.stopped_at && !stop)) return res.status(400).json({ error: "Invalid date" });
  if (stop === null && entry.stopped_at !== null) return res.status(400).json({ error: "End time required" });
  const activityId = req.body.activity_id === undefined ? entry.activity_id : Number(req.body.activity_id);
  const bad = await checkEntry(req.uid, { start, stop, activityId, excludeId: entry.id });
  if (bad) return res.status(bad[0]).json({ error: bad[1] });
  const note = req.body.note === undefined ? entry.note : cleanNote(req.body.note);
  const [row] = await q(
    "UPDATE entries SET started_at=$3, stopped_at=$4, activity_id=$5, note=$6 WHERE id=$1 AND user_id=$2 RETURNING *",
    [entry.id, req.uid, start, stop, activityId, note]
  );
  res.json(row);
  if (entry.stopped_at === null && stop) pushLater(req.uid); // a running timer was stopped by editing it
}));

// Time per activity per day/week/month (user's local calendar), splitting entries across bucket edges
app.get("/api/summary", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const bucket = ["day", "week", "month"].includes(req.query.bucket) ? req.query.bucket : "week";
  const count = Math.min(Math.max(parseInt(req.query.count) || 12, 1), bucket === "day" ? 371 : 60);
  const step = `1 ${bucket}`;
  const buckets = await q(
    `SELECT gs::date::text AS start FROM generate_series(
       date_trunc($1, now() AT TIME ZONE $2) - ($3::int - 1) * $4::interval,
       date_trunc($1, now() AT TIME ZONE $2), $4::interval) gs`,
    [bucket, tz, count, step]
  );
  const rows = await q(
    `WITH b AS (
       SELECT gs AS s, gs + $5::interval AS e FROM generate_series(
         date_trunc($2, now() AT TIME ZONE $3) - ($4::int - 1) * $5::interval,
         date_trunc($2, now() AT TIME ZONE $3), $5::interval) gs),
     en AS (
       SELECT activity_id, started_at AT TIME ZONE $3 AS s, COALESCE(stopped_at, now()) AT TIME ZONE $3 AS e
       FROM entries WHERE user_id=$1
         AND COALESCE(stopped_at, now()) AT TIME ZONE $3 > (SELECT min(s) FROM b))
     SELECT b.s::date::text AS bucket, en.activity_id,
       SUM(EXTRACT(EPOCH FROM LEAST(en.e, b.e) - GREATEST(en.s, b.s)))::int AS seconds
     FROM b JOIN en ON en.s < b.e AND en.e > b.s
     GROUP BY 1, 2 ORDER BY 1`,
    [req.uid, bucket, tz, count, step]
  );
  const activities = await q("SELECT id, name, color, kind, sort, archived FROM activities WHERE user_id=$1 ORDER BY sort, id", [req.uid]);
  res.json({ bucket, buckets: buckets.map((b) => b.start), rows, activities });
}));

app.delete("/api/entries/:id", h(async (req, res) => {
  await q("DELETE FROM entries WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
  res.json({ ok: true });
}));

app.get("/api/export.csv", h(async (req, res) => {
  const rows = await q(
    `SELECT a.name, e.started_at, e.stopped_at, e.note FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 ORDER BY e.started_at`,
    [req.uid]
  );
  // prefix values a spreadsheet would treat as formulas
  const cell = (s) => `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  res.type("text/csv").send(
    "activity,started_at,stopped_at,seconds,note\n" +
      rows
        .map((r) => {
          const s = r.stopped_at ? (new Date(r.stopped_at) - new Date(r.started_at)) / 1000 : "";
          return `${cell(r.name)},${r.started_at.toISOString()},${r.stopped_at?.toISOString() || ""},${s},${r.note ? cell(r.note) : ""}`;
        })
        .join("\n")
  );
}));

// --- yes/no habits ---
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
app.get("/api/habits", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const habits = await q("SELECT id, name, kind, color, sort, target, step FROM habits WHERE user_id=$1 ORDER BY sort, id", [req.uid]);
  const [{ today }] = await q("SELECT (now() AT TIME ZONE $1)::date::text AS today", [tz]);
  const marks = await q(
    `SELECT m.habit_id, m.day::text AS day, m.value FROM habit_marks m JOIN habits h ON h.id=m.habit_id
     WHERE h.user_id=$1 AND m.day > $2::date - 400 ORDER BY m.day`,
    [req.uid, today]
  );
  const counts = await q(
    `SELECT c.habit_id, c.day::text AS day, c.count FROM habit_counts c JOIN habits h ON h.id=c.habit_id
     WHERE h.user_id=$1 AND c.day > $2::date - 400 ORDER BY c.day`,
    [req.uid, today]
  );
  res.json({ habits, marks, counts, today });
}));

app.post("/api/habits", h(async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: "Name required" });
  const [{ n }] = await q("SELECT count(*)::int AS n FROM habits WHERE user_id=$1", [req.uid]);
  if (n >= 50) return res.status(400).json({ error: "Limit is 50 habits" });
  const kind = ["avoid", "count"].includes(req.body.kind) ? req.body.kind : "do";
  const cfg = countCfg(req.body);
  if (cfg.error) return res.status(400).json({ error: cfg.error });
  const [row] = await q(
    `INSERT INTO habits(user_id, name, kind, color, target, step, sort)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(sort),0)+1 FROM habits WHERE user_id=$1)) RETURNING id, name, kind, color, sort, target, step`,
    [req.uid, name, kind, COLOR_RE.test(req.body.color) ? req.body.color : "#3987e5", cfg.target ?? null, cfg.step ?? 1]
  );
  res.json(row);
}));

app.put("/api/habits/:id", h(async (req, res) => {
  const { name, kind, color, sort } = req.body;
  if (name !== undefined && !cleanName(name)) return res.status(400).json({ error: "Name required" });
  if (kind !== undefined && !["do", "avoid", "count"].includes(kind)) return res.status(400).json({ error: "Bad kind" });
  const cfg = countCfg(req.body);
  if (cfg.error) return res.status(400).json({ error: cfg.error });
  if (color !== undefined && !COLOR_RE.test(color)) return res.status(400).json({ error: "Bad color" });
  if (sort !== undefined && !Number.isInteger(sort)) return res.status(400).json({ error: "Bad sort" });
  const [row] = await q(
    `UPDATE habits SET name=COALESCE($3,name), kind=COALESCE($4,kind), color=COALESCE($5,color), sort=COALESCE($6,sort),
       target=CASE WHEN $7 THEN $8::int ELSE target END, step=COALESCE($9, step)
     WHERE id=$1 AND user_id=$2 RETURNING id, name, kind, color, sort, target, step`,
    [req.params.id, req.uid, cleanName(name), kind, color, sort, "target" in req.body, cfg.target ?? null, cfg.step ?? null]
  );
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
}));

app.delete("/api/habits/:id", h(async (req, res) => {
  await q("DELETE FROM habits WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
  res.json({ ok: true });
}));

// counters: target null = no target; step is what one tap of + adds
function countCfg(body) {
  const out = {};
  if ("target" in body) {
    if (body.target !== null && !(Number.isInteger(body.target) && body.target >= 1 && body.target <= 100000)) return { error: "Target 1–100000" };
    out.target = body.target;
  }
  if (body.step !== undefined) {
    if (!(Number.isInteger(body.step) && body.step >= 1 && body.step <= 1000)) return { error: "Step 1–1000" };
    out.step = body.step;
  }
  return out;
}
async function countHabit(uid, id, day) {
  if (!DAY_RE.test(day || "") || isNaN(Date.parse(day))) return [400, "Bad day"];
  const [hb] = await q("SELECT h.id, h.kind, u.tz FROM habits h JOIN users u ON u.id=h.user_id WHERE h.id=$1 AND h.user_id=$2", [id, uid]);
  if (!hb) return [404, "Not found"];
  if (hb.kind !== "count") return [400, "Not a counter"];
  const [{ ok }] = await q("SELECT $1::date <= (now() AT TIME ZONE $2)::date + 1 AS ok", [day, hb.tz || "UTC"]);
  if (!ok) return [400, "That day hasn't happened yet"];
  return null;
}
// add to a day's count (negative to take away); atomic, so fast repeated taps all count
app.post("/api/habits/:id/add", h(async (req, res) => {
  const { day, delta } = req.body;
  if (!Number.isInteger(delta) || Math.abs(delta) > 100000) return res.status(400).json({ error: "Bad amount" });
  const bad = await countHabit(req.uid, req.params.id, day);
  if (bad) return res.status(bad[0]).json({ error: bad[1] });
  const [row] = await q(
    `INSERT INTO habit_counts(habit_id, day, count) VALUES ($1,$2,GREATEST(0,$3))
     ON CONFLICT (habit_id, day) DO UPDATE SET count=LEAST(10000000, GREATEST(0, habit_counts.count + $3)) RETURNING count`,
    [req.params.id, day, delta]
  );
  res.json({ count: row.count });
}));
// set a day's count exactly (0 clears it)
app.put("/api/habits/:id/count", h(async (req, res) => {
  const { day, count } = req.body;
  if (!Number.isInteger(count) || count < 0 || count > 10000000) return res.status(400).json({ error: "Bad count" });
  const bad = await countHabit(req.uid, req.params.id, day);
  if (bad) return res.status(bad[0]).json({ error: bad[1] });
  if (count === 0) await q("DELETE FROM habit_counts WHERE habit_id=$1 AND day=$2", [req.params.id, day]);
  else await q("INSERT INTO habit_counts(habit_id, day, count) VALUES ($1,$2,$3) ON CONFLICT (habit_id, day) DO UPDATE SET count=$3", [req.params.id, day, count]);
  res.json({ count });
}));

// value: true (yes), false (no) or null (clear the day)
app.put("/api/habits/:id/marks", h(async (req, res) => {
  const { day, value } = req.body;
  if (!DAY_RE.test(day || "") || isNaN(Date.parse(day))) return res.status(400).json({ error: "Bad day" });
  if (value !== null && typeof value !== "boolean") return res.status(400).json({ error: "Bad value" });
  const [hb] = await q("SELECT h.id, u.tz FROM habits h JOIN users u ON u.id=h.user_id WHERE h.id=$1 AND h.user_id=$2", [req.params.id, req.uid]);
  if (!hb) return res.status(404).json({ error: "Not found" });
  // no marking the future (one day of slack for time zones)
  const [{ ok }] = await q("SELECT $1::date <= (now() AT TIME ZONE $2)::date + 1 AS ok", [day, hb.tz || "UTC"]);
  if (!ok) return res.status(400).json({ error: "That day hasn't happened yet" });
  if (value === null) await q("DELETE FROM habit_marks WHERE habit_id=$1 AND day=$2", [hb.id, day]);
  else await q(
    "INSERT INTO habit_marks(habit_id, day, value) VALUES ($1,$2,$3) ON CONFLICT (habit_id, day) DO UPDATE SET value=$3",
    [hb.id, day, value]
  );
  res.json({ ok: true });
}));


// Sign out everywhere: every session issued before now stops working, and notifications are removed
app.post("/api/signout-all", h(async (req, res) => {
  await q("UPDATE users SET sessions_valid_after=now() WHERE id=$1", [req.uid]);
  await q("DELETE FROM push_subscriptions WHERE user_id=$1", [req.uid]);
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
}));

app.get("/api/backup.json", h(async (req, res) => {
  const activities = await q(
    "SELECT id, name, color, kind, sort, archived, goal_minutes, goal_period, mastery, mastery_base_hours FROM activities WHERE user_id=$1 ORDER BY id",
    [req.uid]
  );
  const entries = await q(
    "SELECT activity_id, started_at, stopped_at, note FROM entries WHERE user_id=$1 AND stopped_at IS NOT NULL ORDER BY started_at",
    [req.uid]
  );
  const stamp = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="moonglare-backup-${stamp}.json"`);
  const habits = await q("SELECT id, name, kind, color, sort, target, step FROM habits WHERE user_id=$1 ORDER BY id", [req.uid]);
  const habit_counts = await q(
    "SELECT c.habit_id, c.day::text AS day, c.count FROM habit_counts c JOIN habits h ON h.id=c.habit_id WHERE h.user_id=$1 ORDER BY c.day",
    [req.uid]
  );
  const habit_marks = await q(
    "SELECT m.habit_id, m.day::text AS day, m.value FROM habit_marks m JOIN habits h ON h.id=m.habit_id WHERE h.user_id=$1 ORDER BY m.day",
    [req.uid]
  );
  // "timetrack" is the file-format marker from before the Moonglare rename; kept so every backup restores
  res.json({ app: "timetrack", version: 3, exported_at: new Date().toISOString(), activities, entries, habits, habit_marks, habit_counts });
}));

// Merge a backup into this account: activities are matched by name, entries already present are skipped
app.post("/api/restore", express.json({ limit: "20mb" }), h(async (req, res) => {
  const { app: appName, activities, entries } = req.body || {};
  if (appName !== "timetrack" || !Array.isArray(activities) || !Array.isArray(entries)) {
    return res.status(400).json({ error: "This is not a Moonglare backup file" });
  }
  if (activities.length > 1000 || entries.length > 200000) return res.status(400).json({ error: "Backup is too large" });
  const client = await pool.connect();
  let actsAdded = 0, added = 0, skipped = 0, habitsAdded = 0, marksAdded = 0;
  try {
    await client.query("BEGIN");
    const existing = (await client.query("SELECT id, lower(name) AS key FROM activities WHERE user_id=$1", [req.uid])).rows;
    const byName = new Map(existing.map((a) => [a.key, a.id]));
    const idMap = new Map();
    for (const a of activities) {
      const name = cleanName(a?.name);
      if (!name) continue;
      let id = byName.get(name.toLowerCase());
      if (!id) {
        const goal = parseGoal({ goal_minutes: a.goal_minutes ?? null, goal_period: a.goal_period });
        const { rows: [row] } = await client.query(
          `INSERT INTO activities(user_id,name,color,kind,sort,archived,goal_minutes,goal_period,mastery,mastery_base_hours)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [req.uid, name, COLOR_RE.test(a.color) ? a.color : "#3987e5", a.kind === "limit" ? "limit" : "good",
            Number.isInteger(a.sort) ? a.sort : 0, a.archived === true,
            goal.error ? null : goal.minutes ?? null, goal.error ? null : goal.period ?? null,
            a.mastery === true && a.kind !== "limit",
            Number.isInteger(a.mastery_base_hours) && a.mastery_base_hours >= 0 && a.mastery_base_hours <= 9999 ? a.mastery_base_hours : 0]
        );
        id = row.id;
        byName.set(name.toLowerCase(), id);
        actsAdded++;
      }
      idMap.set(a.id, id);
    }
    const acts = [], starts = [], stops = [], notes = [];
    for (const e of entries) {
      const act = idMap.get(e?.activity_id), st = parseDate(e?.started_at), sp = parseDate(e?.stopped_at);
      if (!act || !st || !sp || sp <= st) { skipped++; continue; }
      acts.push(act); starts.push(st); stops.push(sp); notes.push(cleanNote(e.note));
    }
    const { rowCount } = await client.query(
      `INSERT INTO entries(user_id, activity_id, started_at, stopped_at, note)
       SELECT DISTINCT ON (x.a, x.s) $1::int, x.a, x.s, x.t, x.n
       FROM unnest($2::int[], $3::timestamptz[], $4::timestamptz[], $5::text[]) AS x(a, s, t, n)
       WHERE NOT EXISTS (SELECT 1 FROM entries e WHERE e.user_id=$1 AND e.activity_id=x.a AND e.started_at=x.s)`,
      [req.uid, acts, starts, stops, notes]
    );
    added = rowCount;
    skipped += acts.length - rowCount;
    // habits (backups from version 2): matched by name; marks already there are kept
    const hbs = Array.isArray(req.body.habits) ? req.body.habits.slice(0, 200) : [];
    const hMarks = Array.isArray(req.body.habit_marks) ? req.body.habit_marks.slice(0, 200000) : [];
    const existingH = new Map((await client.query("SELECT id, lower(name) AS key FROM habits WHERE user_id=$1", [req.uid])).rows.map((x) => [x.key, x.id]));
    const hMap = new Map();
    for (const hb of hbs) {
      const name = cleanName(hb?.name);
      if (!name) continue;
      let id = existingH.get(name.toLowerCase());
      if (!id) {
        ({ rows: [{ id }] } = await client.query(
          "INSERT INTO habits(user_id, name, kind, color, sort, target, step) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [req.uid, name, ["avoid", "count"].includes(hb.kind) ? hb.kind : "do", COLOR_RE.test(hb.color) ? hb.color : "#3987e5",
            Number.isInteger(hb.sort) ? hb.sort : 0,
            Number.isInteger(hb.target) && hb.target >= 1 && hb.target <= 100000 ? hb.target : null,
            Number.isInteger(hb.step) && hb.step >= 1 && hb.step <= 1000 ? hb.step : 1]
        ));
        existingH.set(name.toLowerCase(), id);
        habitsAdded++;
      }
      hMap.set(hb.id, id);
    }
    const mh = [], md = [], mv = [];
    for (const m of hMarks) {
      const id = hMap.get(m?.habit_id);
      if (!id || !DAY_RE.test(m?.day || "") || typeof m.value !== "boolean") continue;
      mh.push(id); md.push(m.day); mv.push(m.value);
    }
    if (mh.length) {
      ({ rowCount: marksAdded } = await client.query(
        `INSERT INTO habit_marks(habit_id, day, value)
         SELECT DISTINCT ON (x.h, x.d) x.h, x.d, x.v FROM unnest($1::int[], $2::date[], $3::bool[]) AS x(h, d, v)
         ON CONFLICT (habit_id, day) DO NOTHING`,
        [mh, md, mv]
      ));
    }
    const cnts = Array.isArray(req.body.habit_counts) ? req.body.habit_counts.slice(0, 200000) : [];
    const ch = [], cd = [], cc = [];
    for (const c of cnts) {
      const id = hMap.get(c?.habit_id);
      if (!id || !DAY_RE.test(c?.day || "") || !Number.isInteger(c.count) || c.count < 1 || c.count > 10000000) continue;
      ch.push(id); cd.push(c.day); cc.push(c.count);
    }
    if (ch.length) {
      const { rowCount } = await client.query(
        `INSERT INTO habit_counts(habit_id, day, count)
         SELECT DISTINCT ON (x.h, x.d) x.h, x.d, x.c FROM unnest($1::int[], $2::date[], $3::int[]) AS x(h, d, c)
         ON CONFLICT (habit_id, day) DO NOTHING`,
        [ch, cd, cc]
      );
      marksAdded += rowCount;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ activities_added: actsAdded, entries_added: added, entries_skipped: skipped, habits_added: habitsAdded, habit_days_added: marksAdded });
}));

app.delete("/api/me", h(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM entries WHERE user_id=$1", [req.uid]);
    await client.query("DELETE FROM activities WHERE user_id=$1", [req.uid]);
    await client.query("DELETE FROM users WHERE id=$1", [req.uid]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : "Server error" });
});

startPushLoop(sessionStats);
app.listen(process.env.PORT || 3000, () => console.log("moonglare up"));
