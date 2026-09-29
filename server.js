import express from "express";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";

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
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS note TEXT;
  CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id);
  CREATE INDEX IF NOT EXISTS entries_user_started_idx ON entries(user_id, started_at);
`);

// --- sessions: signed cookie "uid.expiry.hmac" ---
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function makeSession(uid) {
  const v = `${uid}.${Date.now() + SESSION_DAYS * 864e5}`;
  return `${v}.${sign(v)}`;
}
function readSession(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.get("cookie") || "");
  if (!m) return null;
  const [uid, exp, mac] = decodeURIComponent(m[1]).split(".");
  if (!mac) return null;
  const expected = Buffer.from(sign(`${uid}.${exp}`));
  const got = Buffer.from(mac);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(uid);
}
function setCookie(req, res, value, maxAgeMs) {
  res.cookie("sid", value, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: maxAgeMs, path: "/" });
}

const app = express();
app.set("trust proxy", 1);
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

app.use("/api", jsonOnly, (req, res, next) => {
  const uid = readSession(req);
  if (!uid) return res.status(401).json({ error: "Please sign in" });
  req.uid = uid;
  next();
});

function validTz(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

app.get("/api/state", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const [user] = await q("SELECT email, name, picture FROM users WHERE id=$1", [req.uid]);
  if (!user) return res.status(401).json({ error: "Please sign in" });
  const activities = await q(
    `SELECT a.id, a.name, a.color, a.sort, a.kind, a.goal_minutes, a.goal_period,
       (SELECT max(COALESCE(e.stopped_at, now())) FROM entries e WHERE e.activity_id=a.id AND e.user_id=$1) AS last_at
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
  res.json({ user, activities, running: running || null, stats, totals, serverNow: new Date().toISOString() });
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
  return { ...s, streak };
}

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

app.post("/api/activities", h(async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: "Name required" });
  const color = COLOR_RE.test(req.body.color) ? req.body.color : "#3987e5";
  const [{ n }] = await q("SELECT count(*)::int AS n FROM activities WHERE user_id=$1 AND NOT archived", [req.uid]);
  if (n >= MAX_ACTIVITIES) return res.status(400).json({ error: `Limit is ${MAX_ACTIVITIES} activities` });
  const goal = parseGoal(req.body);
  if (goal.error) return res.status(400).json({ error: goal.error });
  const [row] = await q(
    `INSERT INTO activities(user_id,name,color,kind,goal_minutes,goal_period,sort)
     VALUES($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(sort),0)+1 FROM activities WHERE user_id=$1))
     RETURNING id,name,color,kind,goal_minutes,goal_period,sort`,
    [req.uid, name, color, req.body.kind === "limit" ? "limit" : "good", goal.minutes ?? null, goal.period ?? null]
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
  const [row] = await q(
    `UPDATE activities SET name=COALESCE($3,name), color=COALESCE($4,color), sort=COALESCE($5,sort), kind=COALESCE($6,kind),
       goal_minutes=CASE WHEN $7 THEN $8::int ELSE goal_minutes END,
       goal_period=CASE WHEN $7 THEN $9::text ELSE goal_period END
     WHERE id=$1 AND user_id=$2 RETURNING id,name,color,kind,goal_minutes,goal_period,sort`,
    [req.params.id, req.uid, cleanName(name), color, sort, kind, goal.set, goal.minutes ?? null, goal.period ?? null]
  );
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
}));

app.delete("/api/activities/:id", h(async (req, res) => {
  await q("UPDATE entries SET stopped_at=now() WHERE activity_id=$1 AND user_id=$2 AND stopped_at IS NULL", [req.params.id, req.uid]);
  await q("UPDATE activities SET archived=TRUE WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
  res.json({ ok: true });
}));

app.post("/api/start", h(async (req, res) => {
  const [act] = await q("SELECT id FROM activities WHERE id=$1 AND user_id=$2 AND NOT archived", [req.body.activity_id, req.uid]);
  if (!act) return res.status(404).json({ error: "Activity not found" });
  await q("UPDATE entries SET stopped_at=now() WHERE user_id=$1 AND stopped_at IS NULL", [req.uid]);
  const [row] = await q("INSERT INTO entries(user_id,activity_id) VALUES($1,$2) RETURNING *", [req.uid, act.id]);
  res.json(row);
}));

app.post("/api/stop", h(async (req, res) => {
  await q("UPDATE entries SET stopped_at=now() WHERE user_id=$1 AND stopped_at IS NULL", [req.uid]);
  res.json({ ok: true });
}));

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
}));

// Time per activity per day/week/month (user's local calendar), splitting entries across bucket edges
app.get("/api/summary", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const bucket = ["day", "week", "month"].includes(req.query.bucket) ? req.query.bucket : "week";
  const count = Math.min(Math.max(parseInt(req.query.count) || 12, 1), 60);
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

app.get("/api/backup.json", h(async (req, res) => {
  const activities = await q(
    "SELECT id, name, color, kind, sort, archived, goal_minutes, goal_period FROM activities WHERE user_id=$1 ORDER BY id",
    [req.uid]
  );
  const entries = await q(
    "SELECT activity_id, started_at, stopped_at, note FROM entries WHERE user_id=$1 AND stopped_at IS NOT NULL ORDER BY started_at",
    [req.uid]
  );
  const stamp = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="timetrack-backup-${stamp}.json"`);
  res.json({ app: "timetrack", version: 1, exported_at: new Date().toISOString(), activities, entries });
}));

// Merge a backup into this account: activities are matched by name, entries already present are skipped
app.post("/api/restore", express.json({ limit: "20mb" }), h(async (req, res) => {
  const { app: appName, activities, entries } = req.body || {};
  if (appName !== "timetrack" || !Array.isArray(activities) || !Array.isArray(entries)) {
    return res.status(400).json({ error: "This is not a Timetrack backup file" });
  }
  if (activities.length > 1000 || entries.length > 200000) return res.status(400).json({ error: "Backup is too large" });
  const client = await pool.connect();
  let actsAdded = 0, added = 0, skipped = 0;
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
          `INSERT INTO activities(user_id,name,color,kind,sort,archived,goal_minutes,goal_period)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [req.uid, name, COLOR_RE.test(a.color) ? a.color : "#3987e5", a.kind === "limit" ? "limit" : "good",
            Number.isInteger(a.sort) ? a.sort : 0, a.archived === true,
            goal.error ? null : goal.minutes ?? null, goal.error ? null : goal.period ?? null]
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
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ activities_added: actsAdded, entries_added: added, entries_skipped: skipped });
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

app.listen(process.env.PORT || 3000, () => console.log("timetrack up"));
