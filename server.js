import express from "express";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: DB_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DB_URL) || process.env.PGSSL === "disable" ? undefined : { rejectUnauthorized: false },
});
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
    color TEXT NOT NULL DEFAULT '#d7a43b',
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
app.use(express.json({ limit: "10kb" }));
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
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

app.get("/api/state", h(async (req, res) => {
  const tz = validTz(req.query.tz) ? req.query.tz : "UTC";
  const [user] = await q("SELECT email, name, picture FROM users WHERE id=$1", [req.uid]);
  if (!user) return res.status(401).json({ error: "Please sign in" });
  const activities = await q("SELECT id,name,color,sort FROM activities WHERE user_id=$1 AND NOT archived ORDER BY sort, id", [req.uid]);
  const [running] = await q(
    `SELECT e.*, a.name FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [req.uid]
  );
  const totals = await q(
    `SELECT activity_id,
       SUM(CASE WHEN started_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
           THEN EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - started_at) ELSE 0 END)::int AS today,
       SUM(CASE WHEN started_at >= date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1
           THEN EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - started_at) ELSE 0 END)::int AS week
     FROM entries WHERE user_id=$2 AND started_at >= now() - interval '8 days' GROUP BY activity_id`,
    [tz, req.uid]
  );
  res.json({ user, activities, running: running || null, totals, serverNow: new Date().toISOString() });
}));

function cleanName(name) {
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
}

app.post("/api/activities", h(async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: "Name required" });
  const color = COLOR_RE.test(req.body.color) ? req.body.color : "#d7a43b";
  const [{ n }] = await q("SELECT count(*)::int AS n FROM activities WHERE user_id=$1 AND NOT archived", [req.uid]);
  if (n >= MAX_ACTIVITIES) return res.status(400).json({ error: `Limit is ${MAX_ACTIVITIES} activities` });
  const [row] = await q(
    `INSERT INTO activities(user_id,name,color,sort)
     VALUES($1,$2,$3,(SELECT COALESCE(MAX(sort),0)+1 FROM activities WHERE user_id=$1)) RETURNING id,name,color,sort`,
    [req.uid, name, color]
  );
  res.json(row);
}));

app.put("/api/activities/:id", h(async (req, res) => {
  const { name, color, sort } = req.body;
  if (name !== undefined && !cleanName(name)) return res.status(400).json({ error: "Name required" });
  if (color !== undefined && !COLOR_RE.test(color)) return res.status(400).json({ error: "Bad color" });
  if (sort !== undefined && !Number.isInteger(sort)) return res.status(400).json({ error: "Bad sort" });
  const [row] = await q(
    `UPDATE activities SET name=COALESCE($3,name), color=COALESCE($4,color), sort=COALESCE($5,sort)
     WHERE id=$1 AND user_id=$2 RETURNING id,name,color,sort`,
    [req.params.id, req.uid, cleanName(name), color, sort]
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
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 366);
  res.json(
    await q(
      `SELECT e.*, a.name, a.color FROM entries e JOIN activities a ON a.id=e.activity_id
       WHERE e.user_id=$1 AND started_at >= now() - make_interval(days => $2) ORDER BY started_at DESC LIMIT 500`,
      [req.uid, days]
    )
  );
}));

app.delete("/api/entries/:id", h(async (req, res) => {
  await q("DELETE FROM entries WHERE id=$1 AND user_id=$2", [req.params.id, req.uid]);
  res.json({ ok: true });
}));

app.get("/api/export.csv", h(async (req, res) => {
  const rows = await q(
    `SELECT a.name, e.started_at, e.stopped_at FROM entries e JOIN activities a ON a.id=e.activity_id
     WHERE e.user_id=$1 ORDER BY e.started_at`,
    [req.uid]
  );
  // prefix values a spreadsheet would treat as formulas
  const cell = (s) => `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  res.type("text/csv").send(
    "activity,started_at,stopped_at,seconds\n" +
      rows
        .map((r) => {
          const s = r.stopped_at ? (new Date(r.stopped_at) - new Date(r.started_at)) / 1000 : "";
          return `${cell(r.name)},${r.started_at.toISOString()},${r.stopped_at?.toISOString() || ""},${s}`;
        })
        .join("\n")
  );
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
