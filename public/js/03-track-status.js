/* ---------- track ---------- */
// progress of the running session: first toward the usual (average) length, then toward the record
const daysSince = (d) => Math.round((dayStart(new Date()) - dayStart(new Date(d))) / 864e5);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function goalHTML() {
  const st = state.stats, r = state.running;
  if (!st || !r) return "";
  if (state.activities.find((a) => a.id === r.activity_id)?.kind === "limit") return limitGoalHTML(st, r);
  const el = runSec();
  const left = (sec) => (sec < 60 ? `${Math.ceil(sec)}s` : fmtShort(sec + 59));
  const sk = state.streaks?.[r.activity_id];
  const streak = sk?.current >= 2 ? `<span class="streak" title="Best: ${sk.best} days">${sk.current}-day streak</span>` : "";
  if (!st.sessions) {
    return `<div class="gl1"><span>First ${esc(r.name)} session</span>${streak}</div>
      <div class="gsub">Your average and record start from this one.</div>`;
  }
  const facts = `Average ${fmtShort(st.avg)} · Record ${fmtShort(st.max)}`;
  let head, pct, mark = "", cls = "";
  if (el < st.avg) {
    head = `${left(st.avg - el)} to your average`;
    pct = el / st.avg;
  } else if (el < st.max) {
    head = `Past average · ${left(st.max - el)} to your record`;
    pct = el / st.max;
    mark = `<span class="gmark" style="left:${(st.avg / st.max) * 100}%" title="Average"></span>`;
  } else {
    head = "New record!";
    pct = 1;
    cls = "rec";
  }
  const sub = cls ? `Previous best ${fmtShort(st.max)} · ${fmtShort(el - st.max)} longer` : facts;
  return `<div class="gl1 ${cls}"><span>${head}</span>${streak}</div>
    <div class="gbar" role="progressbar" aria-valuenow="${Math.round(pct * 100)}" aria-valuemin="0" aria-valuemax="100">
      <div class="gfill" style="width:${pct * 100}%"></div>${mark}</div>
    <div class="gsub num">${sub}</div>`;
}

// habits to cut back: shorter is better, so warn past the usual length instead of cheering toward a record
function limitGoalHTML(st, r) {
  const el = runSec();
  const left = (sec) => (sec < 60 ? `${Math.ceil(sec)}s` : fmtShort(sec + 59));
  const gap = st.prev_end ? daysSince(st.prev_end) : 0;
  const badge = gap >= 1 ? `<span class="streak">First in ${plural(gap, "day")}</span>` : "";
  if (!st.sessions) {
    return `<div class="gl1"><span>First ${esc(r.name)} session tracked</span>${badge}</div>
      <div class="gsub">Your usual length starts from this one.</div>`;
  }
  let head, pct, mark = "", sub, warn = false;
  if (el < st.avg) {
    head = `${left(st.avg - el)} until your usual ${fmtShort(st.avg)}`;
    pct = el / st.avg;
    sub = "Stop before then to beat your average";
  } else if (el < st.max) {
    head = `Over your usual by ${fmtShort(el - st.avg) === "0m" ? "under 1m" : fmtShort(el - st.avg)}`;
    pct = el / st.max;
    mark = `<span class="gmark" style="left:${(st.avg / st.max) * 100}%" title="Usual"></span>`;
    sub = `Longest so far ${fmtShort(st.max)}`;
    warn = true;
  } else {
    head = "Longest session so far";
    pct = 1;
    sub = `Previous longest ${fmtShort(st.max)} · ${fmtShort(el - st.max)} longer`;
    warn = true;
  }
  return `<div class="gl1 ${warn ? "warn" : ""}"><span>${warn ? icon("alert", 16) : ""}${head}</span>${badge}</div>
    <div class="gbar" role="progressbar" aria-valuenow="${Math.round(pct * 100)}" aria-valuemin="0" aria-valuemax="100">
      <div class="gfill" style="width:${pct * 100}%"></div>${mark}</div>
    <div class="gsub num">${sub}</div>`;
}

function tileSub(a) {
  const today = total(a.id, "today");
  const g = goalState(a);
  if (a.kind === "limit" && !today && (!g || a.goal_period === "day")) {
    if (!a.last_at) return "Not tracked yet";
    const n = daysSince(a.last_at);
    if (n >= 1) return `${plural(n, "day")} free`;
  }
  if (g) {
    if (g.over) return `Over limit by ${fmtShort(g.v - g.g)}`;
    if (g.done) return `Goal reached · ${fmtShort(g.v)}`;
    return `${fmtShort(g.v)} of ${fmtShort(g.g)} ${periodWord(a.goal_period)}`;
  }
  return `${fmtShort(today)} today`;
}
function tileBar(a) {
  const g = goalState(a);
  if (!g) return "";
  return `<span class="tbar${g.over ? " over" : ""}${g.done ? " done" : ""}" aria-hidden="true"><i style="width:${g.pct * 100}%"></i></span>`;
}
