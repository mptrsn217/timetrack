import express from "express";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : undefined,
});
const PIN = process.env.APP_PIN || "";

await pool.query(`
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
  CREATE INDEX IF NOT EXISTS entries_started_idx ON entries(started_at);
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res, next) => {
  if (PIN && req.get("x-pin") !== PIN) return res.status(401).json({ error: "Wrong PIN" });
  next();
});

const q = (text, params) => pool.query(text, params).then((r) => r.rows);

app.get("/api/state", async (req, res) => {
  const tz = req.query.tz || "UTC";
  const activities = await q("SELECT * FROM activities WHERE NOT archived ORDER BY sort, id");
  const [running] = await q(
    "SELECT e.*, a.name FROM entries e JOIN activities a ON a.id=e.activity_id WHERE stopped_at IS NULL ORDER BY started_at DESC LIMIT 1"
  );
  const totals = await q(
    `SELECT activity_id,
       SUM(CASE WHEN started_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
           THEN EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - started_at) ELSE 0 END)::int AS today,
       SUM(CASE WHEN started_at >= date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1
           THEN EXTRACT(EPOCH FROM COALESCE(stopped_at, now()) - started_at) ELSE 0 END)::int AS week
     FROM entries WHERE started_at >= now() - interval '8 days' GROUP BY activity_id`,
    [tz]
  );
  res.json({ activities, running: running || null, totals, serverNow: new Date().toISOString() });
});

app.post("/api/activities", async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });
  const [row] = await q(
    "INSERT INTO activities(name,color,sort) VALUES($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM activities)) RETURNING *",
    [name.trim(), color || "#d7a43b"]
  );
  res.json(row);
});

app.put("/api/activities/:id", async (req, res) => {
  const { name, color, sort } = req.body;
  const [row] = await q(
    "UPDATE activities SET name=COALESCE($2,name), color=COALESCE($3,color), sort=COALESCE($4,sort) WHERE id=$1 RETURNING *",
    [req.params.id, name?.trim(), color, sort]
  );
  res.json(row);
});

app.delete("/api/activities/:id", async (req, res) => {
  await q("UPDATE entries SET stopped_at=now() WHERE activity_id=$1 AND stopped_at IS NULL", [req.params.id]);
  await q("UPDATE activities SET archived=TRUE WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/start", async (req, res) => {
  const { activity_id } = req.body;
  await q("UPDATE entries SET stopped_at=now() WHERE stopped_at IS NULL");
  const [row] = await q("INSERT INTO entries(activity_id) VALUES($1) RETURNING *", [activity_id]);
  res.json(row);
});

app.post("/api/stop", async (req, res) => {
  await q("UPDATE entries SET stopped_at=now() WHERE stopped_at IS NULL");
  res.json({ ok: true });
});

app.get("/api/entries", async (req, res) => {
  const days = Number(req.query.days) || 7;
  res.json(
    await q(
      `SELECT e.*, a.name, a.color FROM entries e JOIN activities a ON a.id=e.activity_id
       WHERE started_at >= now() - ($1 || ' days')::interval ORDER BY started_at DESC LIMIT 500`,
      [days]
    )
  );
});

app.delete("/api/entries/:id", async (req, res) => {
  await q("DELETE FROM entries WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/export.csv", async (req, res) => {
  const rows = await q(
    "SELECT a.name, e.started_at, e.stopped_at FROM entries e JOIN activities a ON a.id=e.activity_id ORDER BY e.started_at"
  );
  res.type("text/csv").send(
    "activity,started_at,stopped_at,seconds\n" +
      rows
        .map((r) => {
          const s = r.stopped_at ? (new Date(r.stopped_at) - new Date(r.started_at)) / 1000 : "";
          return `"${r.name.replace(/"/g, '""')}",${r.started_at.toISOString()},${r.stopped_at?.toISOString() || ""},${s}`;
        })
        .join("\n")
  );
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.listen(process.env.PORT || 3000, () => console.log("timetrack up"));
