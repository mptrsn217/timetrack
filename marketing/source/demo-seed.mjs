// Demo account for landing-page screenshots: ~60 days of believable tracking.
import pg from "pg";
const db = new pg.Pool({ connectionString: "postgres://postgres:pw@localhost:55432/tt" });
const q = (t, p) => db.query(t, p).then((r) => r.rows);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + rnd() * (b - a);

const [{ id: uid }] = await q("INSERT INTO users(google_sub,email,name,tz) VALUES('demo','demo@moonglare.app','Alex','Europe/Tallinn') RETURNING id");
const acts = {};
for (const [name, color, kind, gm, gp, mastery, base] of [
  ["Deep work", "#3987e5", "good", 180, "day", true, 860],
  ["Reading", "#199e70", "good", 30, "day", false, 0],
  ["Exercise", "#d95926", "good", 240, "week", false, 0],
  ["Spanish", "#9085e9", "good", null, null, true, 140],
  ["Social media", "#d55181", "limit", 45, "day", false, 0],
  ["Gaming", "#c98500", "limit", 300, "week", false, 0],
]) {
  const [r] = await q(
    `INSERT INTO activities(user_id,name,color,kind,goal_minutes,goal_period,mastery,mastery_base_hours,sort)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(sort),0)+1 FROM activities WHERE user_id=$1)) RETURNING id`,
    [uid, name, color, kind, gm, gp, mastery, base]);
  acts[name] = r.id;
}

const entries = [];
const add = (name, day, h, min) => {
  const s = new Date(day); s.setHours(0, 0, 0, 0); s.setMinutes(Math.round(h * 60));
  const e = new Date(s.getTime() + min * 60e3);
  if (e < Date.now() - 5 * 60e3) entries.push([acts[name], s, e]);
};
const DAYS = 60;
for (let d = DAYS; d >= 0; d--) {
  const day = new Date(Date.now() - d * 864e5), wd = day.getDay(), weekend = wd === 0 || wd === 6;
  const progress = 1 - d / DAYS; // habits improve over time
  if (!weekend) {
    add("Deep work", day, between(8.6, 9.3), between(80, 130));
    if (rnd() < 0.8) add("Deep work", day, between(13.2, 14), between(50, 110));
  } else if (rnd() < 0.4) add("Deep work", day, between(10, 11), between(40, 90));
  if (rnd() < 0.55 + progress * 0.35) add("Reading", day, between(21.2, 22), between(18, 45));
  if ([1, 3, 5].includes(wd) || (weekend && rnd() < 0.5)) add("Exercise", day, between(17.5, 18.5), between(40, 75));
  if (rnd() < 0.5 + progress * 0.4) add("Spanish", day, between(7.3, 7.8), between(15, 30));
  // social media shrinks as the weeks go by
  const sm = Math.round(between(3, 6) * (1.3 - progress));
  for (let k = 0; k < sm; k++) add("Social media", day, between(12, 23), between(6, 22) * (1.25 - progress * 0.5));
  if (weekend && rnd() < 0.7 - progress * 0.3) add("Gaming", day, between(19, 20.5), between(50, 140));
}
// today: a morning session done, and deep work running for the last 47 minutes
const today = new Date();
for (const [a, s, e] of entries) {
  await q("INSERT INTO entries(activity_id,user_id,started_at,stopped_at) VALUES($1,$2,$3,$4)", [a, uid, s, e]);
}
await q("DELETE FROM entries WHERE user_id=$1 AND started_at > now() - interval '60 minutes'", [uid]);
await q("INSERT INTO entries(activity_id,user_id,started_at) VALUES($1,$2,now() - interval '47 minutes')", [acts["Deep work"], uid]);

// habits: yes/no and counters, getting steadier over time
const habits = [
  ["Workout", "do", "#008300", null, 1], ["Meditate", "do", "#2f9fd0", null, 1],
  ["Sugar", "avoid", "#e66767", null, 1], ["Alcohol", "avoid", "#b86e2e", null, 1],
  ["Push-ups", "count", "#5b6bd8", 50, 10], ["Glasses of water", "count", "#009b8f", 8, 1],
];
for (const [i, [name, kind, color, target, step]] of habits.entries()) {
  const [h] = await q("INSERT INTO habits(user_id,name,kind,color,sort,target,step,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '100 days') RETURNING id",
    [uid, name, kind, color, i, target, step]);
  for (let d = 90; d >= 1; d--) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10), p = 1 - d / 90;
    if (kind === "count") {
      if (rnd() < 0.15) continue;
      const v = name === "Push-ups" ? Math.round(between(20, 45 + p * 30) / 10) * 10 : Math.round(between(4, 7 + p * 3));
      await q("INSERT INTO habit_counts(habit_id,day,count) VALUES($1,$2,$3)", [h.id, day, v]);
    } else {
      if (rnd() < 0.1) continue;
      const good = rnd() < 0.5 + p * 0.4;
      await q("INSERT INTO habit_marks(habit_id,day,value) VALUES($1,$2,$3)", [h.id, day, kind === "do" ? good : !good]);
    }
  }
}
console.log("seeded user", uid, "entries", entries.length);
await db.end();
