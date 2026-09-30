/* ---------- breaks ---------- */
const pauseLeft = () => (state.pause ? (new Date(state.pause.until) - now()) / 1000 : 0);
function pausedHero(p) {
  return `<section class="hero paused" style="--c:${p.color}">
    <button class="lvopen" data-live aria-label="Open live screen">${icon("expand", 18)}</button>
    <div><div class="label"><span class="pulse"></span>On a break</div><div class="name">${esc(p.name)}</div></div>
    <div class="row">
      <div><div class="clock num" id="pauseclock">${fmt(Math.max(0, pauseLeft()))}</div><div class="since">Continues at ${clock(p.until)}</div></div>
      <button class="btn-stop" id="resumenow">${icon("play", 16)}Resume</button>
    </div>
    <button class="linkbtn endbreak" id="endbreak">End the session instead</button></section>`;
}
function openPause() {
  const r = state.running;
  if (!r) return;
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>Take a break</h3>
    <form class="eform" id="pauseform">
      <p class="hint" style="margin:0 4px">${esc(r.name)} stops now and starts again when the break is over. You'll get a notification.</p>
      <div class="pchoices">${[5, 10, 15, 30, 60].map((m) => `<button type="button" class="pchoice" data-m="${m}">${m} min</button>`).join("")}</div>
      <label>Or minutes<input class="field num" type="number" name="m" min="1" max="240" placeholder="e.g. 20" inputmode="numeric"></label>
      <div class="eactions"><span></span><span></span><button type="button" class="btn ghost" id="pcancel">Cancel</button><button type="submit" class="btn">Start break</button></div>
    </form>`;
  const f = $("#pauseform");
  const go = async (minutes) => {
    if (!(minutes >= 1 && minutes <= 240)) return toast("Pick 1 to 240 minutes");
    try {
      const out = await api("/pause", { method: "POST", body: { minutes } });
      editSheet.close();
      await stopNotify();
      await load();
      toast(out.message);
    } catch (e) { toast(e.message); }
  };
  $$(".pchoice", f).forEach((b) => b.onclick = () => go(Number(b.dataset.m)));
  f.onsubmit = (ev) => { ev.preventDefault(); go(Number(f.m.value)); };
  $("#pcancel").onclick = () => editSheet.close();
  editSheet.showModal();
}
let resuming = false;
async function resumeBreak(auto) {
  if (resuming) return;
  resuming = true;
  try {
    const out = await api("/pause/resume", { method: "POST" });
    await load();
    notify();
    toast(auto === true ? `Break over · ${state.running?.name || "timer"} continues` : out.message);
  } catch (e) { toast(e.message); }
  resuming = false;
}

// When nothing is running: a one-tap way back into the last activity, and where today's goals stand.
function idleHero(acts) {
  if (!acts.length) {
    return `<section class="hero idle"><div class="label">Nothing running</div>
      <div class="since">Add an activity to get started</div></section>`;
  }
  // last thing you did, skipping habits you're cutting back on
  const last = acts.filter((a) => a.kind !== "limit" && a.last_at).sort((a, b) => new Date(b.last_at) - new Date(a.last_at))[0];
  const ago = last ? fmtShort((now() - new Date(last.last_at)) / 1000) : "";
  const resume = last
    ? `<button class="resume" id="resume" data-id="${last.id}" style="--c:${last.color}">
        <span class="rplay">${icon("play", 16)}</span>
        <span><b>Continue ${esc(last.name)}</b><small>${ago === "0m" ? "stopped just now" : `stopped ${ago} ago`}</small></span></button>`
    : `<div class="since">Tap an activity below to start the clock</div>`;

  const withGoals = acts.filter((a) => a.goal_minutes).map((a) => ({ a, g: goalState(a) }));
  // unfinished goals first, then limits (closest to the limit first), finished goals last
  const rank = ({ a, g }) => (a.kind === "limit" ? (g.over ? 0 : 1) + (1 - g.pct) : g.done ? 3 : 0.5 - g.pct);
  withGoals.sort((x, y) => rank(x) - rank(y));
  const rows = withGoals.slice(0, 5).map(({ a, g }) => {
    const when = periodWord(a.goal_period);
    let text, cls = "";
    if (a.kind === "limit") {
      if (g.over) { text = `Over by ${fmtShort(g.v - g.g)}`; cls = "warn"; }
      else text = `${fmtShort(g.g - g.v)} left of ${fmtShort(g.g)} ${when}`;
    } else if (g.done) { text = `Done · ${fmtShort(g.v)} ${when}`; cls = "done"; }
    else text = `${fmtShort(g.v)} of ${fmtShort(g.g)} ${when}`;
    return `<div class="grow" style="--c:${a.color}">
      <span class="gname"><i></i>${esc(a.name)}</span><span class="gval num ${cls}">${text}</span>
      <span class="gtrack${g.over ? " over" : ""}"><span style="width:${g.pct * 100}%"></span></span></div>`;
  }).join("");
  const goals = withGoals.length
    ? `<div class="glist"><div class="label">Goals</div>${rows}</div>`
    : `<button class="linkbtn setgoals" id="setgoals">${icon("flag", 14)}Set daily or weekly goals</button>`;

  return `<section class="hero idle"><div class="label">Nothing running</div>${resume}${goals}
</section>`;
}

// "5-day streak · best 12"; for cut-back habits with a daily limit, days stayed under it
function streakLine(a) {
  const sk = state.streaks?.[a.id];
  if (!sk || sk.current < 2) return "";
  if (a.kind === "limit" && !(a.goal_minutes && a.goal_period === "day")) return ""; // the tile already says "N days free"
  const what = a.kind === "limit" ? `${sk.current} days under limit` : `${sk.current}-day streak`;
  return `<div class="streakl num">${icon("bolt", 12)}${what}${sk.best > sk.current ? ` · best ${sk.best}` : ""}</div>`;
}

/* ---------- 10,000 hours ---------- */
const MASTERY_SEC = 10000 * 3600;
const MILESTONES = [1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 10000];
const fmtHours = (sec) => (sec / 3600).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hoursToGo = (sec) => (sec < 3600 ? fmtShort(sec) : `${Math.ceil(sec / 3600).toLocaleString()} h`);
function fmtSpan(days) {
  if (days < 1) return "less than a day";
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
}
// lifetime hours (earlier practice + finished sessions + the one running now) and the 30-day pace
function masteryState(a) {
  const live = state.running?.activity_id === a.id ? runSec() : 0;
  const sec = (a.mastery_base_hours || 0) * 3600 + Number(a.mastery_sec || 0) + live;
  const perDay = (Number(a.mastery_30d || 0) + live) / 30;
  const h = sec / 3600, next = MILESTONES.find((m) => m > h);
  return { sec, perDay, pct: Math.min(1, sec / MASTERY_SEC), next, done: sec >= MASTERY_SEC };
}
function masteryPace(ms) {
  if (ms.done) return "You've reached 10,000 hours. Mastery!";
  if (ms.perDay < 60) return "Track a few sessions to see when you'll get there";
  const days = (MASTERY_SEC - ms.sec) / ms.perDay;
  if (days > 36500) return `At ${fmtShort(ms.perDay)} a day (last 30 days) it would take over a century. More practice brings it closer`;
  const year = new Date(now() + days * 864e5).getFullYear();
  return `At ${fmtShort(ms.perDay)} a day (last 30 days): 10,000 h in about ${fmtSpan(days)}, around ${year}`;
}
function masteryHTML(acts) {
  const list = acts.filter((a) => a.mastery);
  if (!list.length) return "";
  return `<h2 class="section"><span>10,000 hours</span></h2><div class="card mastery">${list.map((a) => {
    const ms = masteryState(a);
    const pctTxt = (ms.pct * 100).toLocaleString(undefined, { maximumFractionDigits: ms.pct < 0.1 ? 2 : 1 });
    return `<div class="mrow" style="--c:${a.color}">
      <div class="mhead"><span class="gname"><i></i>${esc(a.name)}</span><b class="num"><span data-mh="${a.id}">${fmtHours(ms.sec)}</span> <em>/ 10,000 h</em></b></div>
      <span class="mtrack"><span style="width:${ms.pct * 100}%"></span></span>
      <div class="mfoot num"><span>${pctTxt}% there</span>${ms.next && !ms.done
        ? `<span>next milestone ${ms.next.toLocaleString()} h · ${hoursToGo(ms.next * 3600 - ms.sec)} to go</span>` : ""}</div>
      <p class="mpace">${masteryPace(ms)}</p></div>`;
  }).join("")}</div>`;
}

function renderTrack() {
  const r = state.running;
  const acts = state.activities;
  const runAct = r && acts.find((a) => a.id === r.activity_id);

  const hero = r
    ? `<section class="hero on" style="--c:${runAct?.color || "var(--accent)"}">
        <button class="lvopen" data-live aria-label="Open live screen">${icon("expand", 18)}</button>
        <div><div class="label"><span class="pulse"></span>Tracking now</div>
        <div class="name">${esc(r.name)}</div></div>
        <div class="row">
          <div><div class="clock num" id="clock">${fmt(runSec())}</div><div class="since">Started ${clock(r.started_at)} · tap the time for a minimal screen</div></div>
          <span class="hbtns"><button class="btn-pause" id="pausebtn" aria-label="Take a break">${icon("pause", 18)}</button>
          <button class="btn-stop" id="stopbtn">${icon("stop", 16)}Stop</button></span>
        </div>
        <div class="goal" id="goal">${goalHTML()}</div>
        <div class="goal live" id="livegoal">${liveGoalHTML(runAct)}</div></section>`
    : state.pause ? pausedHero(state.pause) : idleHero(acts);

  const list = acts.length
    ? `<h2 class="section"><span>Activities</span><button class="linkbtn" id="addact">${icon("plus", 16)}Add</button></h2>
       <div class="grid">${acts.map((a) => {
         const on = r && r.activity_id === a.id;
         return `<button class="tile ${on ? "on" : ""}" data-id="${a.id}" style="--c:${a.color}" aria-pressed="${!!on}">
           <span class="play">${icon(on ? "stop" : "play", 14)}</span>
           <span class="top-l"><span class="dot"></span>${a.kind === "limit" ? `<span class="kindtag">Cut back</span>` : a.mastery ? `<span class="kindtag">10k h</span>` : ""}</span>
           <span><div class="nm">${esc(a.name)}</div>
           <div class="sub num${goalState(a)?.over ? " warn" : ""}" data-sub="${a.id}">${on ? fmt(runSec()) : tileSub(a)}</div>
           ${streakLine(a)}</span>
           ${tileBar(a)}
         </button>`;
       }).join("")}</div><p class="hint holdhint">Tap to start or stop · press and hold to edit</p>${masteryHTML(acts)}`
    : starterHTML();

  app.innerHTML = (acts.length || r ? hero : "") + list;
  if (r) $("#stopbtn").onclick = stop;
  $("#pausebtn")?.addEventListener("click", openPause);
  bindStarter();
  $$("[data-live]").forEach((b) => b.onclick = openLive);
  $("#clock")?.addEventListener("click", (e) => openMini(pointOf(e.currentTarget))); // the big timer opens the minimal screen
  $("#resumenow")?.addEventListener("click", resumeBreak);
  $("#endbreak")?.addEventListener("click", async () => {
    try { await api("/pause/cancel", { method: "POST" }); await load(); toast("Session ended"); } catch (e) { toast(e.message); }
  });
  bindLiveGoal(runAct);
  $("#goadd")?.addEventListener("click", () => openActivity());
  $("#resume")?.addEventListener("click", (e) => start(Number(e.currentTarget.dataset.id), pointOf(e.currentTarget)));
  $("#setgoals")?.addEventListener("click", () => openGoal(state.activities.find((a) => !a.goal_minutes) || state.activities[0]));
  $$(".tile").forEach((b) => {
    b.onclick = () => (r && r.activity_id == b.dataset.id) ? stop() : start(Number(b.dataset.id), pointOf(b));
    onHold(b, () => openActivity(state.activities.find((a) => a.id == b.dataset.id)));
  });
  $("#addact")?.addEventListener("click", () => openActivity());
}

// `from`: where the tap was, so the minimal screen can grow out of that tile
async function start(id, from) {
  try {
    const out = await api("/start", { method: "POST", body: { activity_id: id } });
    if (out.queued) { // offline: show it running now; the server gets it later with this start time
      const a = state.activities.find((x) => x.id === id);
      state = { ...state, running: { id: -1, activity_id: id, name: a?.name, started_at: new Date(now()).toISOString() }, stats: null, pause: null };
      render();
    } else await load();
    notify();
    openAutoScreen(from);
  } catch (e) { toast(e.message); }
}
async function stop() {
  try {
    const out = await api("/stop", { method: "POST" });
    if (out.queued) { state = { ...state, running: null, pause: null }; render(); closeLive(); closeMini(); }
    else await load();
    notify();
  } catch (e) { toast(e.message); }
}
