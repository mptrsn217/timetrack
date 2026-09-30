/* ---------- live screen: the running activity, full screen, for a phone propped up in front of you ---------- */
const liveDlg = $("#live");
let wakeLock = null;
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch {} };
const keepOnPref = () => pref("liveKeepOn", true);
// what opens when a timer starts: "off", "mini" (minimal screen) or "live" (detailed screen)
const autoScreenPref = () => {
  try { return localStorage.getItem("autoScreen") || (localStorage.getItem("liveAuto") === "1" ? "live" : "mini"); } catch { return "mini"; }
};
// `from`: the screen point the minimal screen grows out of (the tapped tile)
function openAutoScreen(from) {
  const p = autoScreenPref();
  if (p === "mini") openMini(from); else if (p === "live") openLive();
}
const canWake = "wakeLock" in navigator;
async function setWake(on) {
  try {
    if (on && canWake && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
// the screen lock is dropped whenever the page is hidden; take it again when it's back
document.addEventListener("visibilitychange", () => { if (!document.hidden && liveDlg.open && keepOnPref()) setWake(true); });
const liveActive = () => !!(state.running || state.pause);
function openLive() {
  if (!liveActive()) return;
  renderLive();
  if (!liveDlg.open) liveDlg.showModal();
  if (keepOnPref()) setWake(true);
}
function closeLive() { if (liveDlg.open) liveDlg.close(); }
liveDlg.addEventListener("close", () => setWake(false));

// whole minutes, rounded up, so "X to go" and "your usual Y" always agree
const upMin = (sec) => fmtShort(Math.ceil(Math.max(0, sec) / 60) * 60);
function liveModel() {
  const r = state.running, p = !r ? state.pause : null;
  const id = r?.activity_id ?? p?.activity_id;
  const a = state.activities.find((x) => x.id === id) || { id, name: r?.name || p?.name, color: p?.color, kind: "good" };
  const limit = a.kind === "limit";
  const st = r ? state.stats : null;
  const el = r ? runSec() : 0;
  const m = { a, limit, st, el, tone: "", ringColor: a.color || "var(--accent)", pct: 0 };
  if (p) {
    m.big = fmt(Math.max(0, pauseLeft()));
    m.label = "On a break";
    m.sub = `${a.name} continues at ${clock(p.until)}`;
    m.msg = "Take a breath. You'll be notified when it's time";
  } else {
    m.big = fmt(el);
    m.label = "Tracking now";
    m.sub = `Started ${clock(r.started_at)}`;
    if (!st?.sessions) {
      m.pct = Math.min(el / 1800, 1);
      m.msg = limit ? "Tracking it is the first step. Stop whenever you're ready" : "First session. Every minute counts";
    } else if (!limit) {
      if (el < st.avg) { m.pct = el / st.avg; m.msg = `${upMin(st.avg - el)} to beat your usual ${upMin(st.avg)}`; }
      else if (el < st.max) { m.pct = el / st.max; m.msg = `Past your usual! ${upMin(st.max - el)} to a new record`; m.tone = "good"; }
      else { m.pct = 1; m.msg = `New record! ${fmtShort(el - st.max)} longer than ever`; m.tone = "good"; }
    } else if (el < st.avg) {
      m.pct = el / st.avg;
      m.msg = `You usually stop around ${upMin(st.avg)}. ${upMin(st.avg - el)} to go`;
    } else {
      m.pct = 1; m.tone = "bad"; m.ringColor = "var(--danger)";
      m.msg = `Longer than usual (${upMin(st.avg)}). Time to stop?`;
    }
    const g = goalState(a);
    if (limit && g?.over) { m.tone = "bad"; m.ringColor = "var(--danger)"; m.msg = `Over your limit by ${fmtShort(g.v - g.g)}. Time to stop?`; }
  }
  return m;
}

function liveBody() {
  const m = liveModel(), a = m.a, st = m.st;
  const C = 2 * Math.PI * 54;
  const ring = `<svg class="lvring" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="54" class="track"/>
    <circle cx="60" cy="60" r="54" class="prog" style="stroke:${m.ringColor};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - Math.min(1, Math.max(0, m.pct)))}"/></svg>`;
  const cmp = (v, ref, limit) => {
    if (!ref) return "";
    const d = v - ref;
    if (Math.abs(d) < 60) return `<span class="delta">about the same</span>`;
    return `<span class="delta ${(d > 0) === !limit ? "better" : "worse"}">${d > 0 ? "▲" : "▼"} ${fmtShort(Math.abs(d))}</span>`;
  };
  const today = total(a.id, "today"), week = total(a.id, "week");
  const cards = [];
  if (state.running) {
    cards.push(`<div class="lvcard"><small>Today</small><b class="num">${fmtShort(today)}</b>
      <span>${st?.dayAvg ? `usual day ${fmtShort(st.dayAvg)} ${cmp(today, st.dayAvg, m.limit)}` : "no usual day yet"}</span></div>`);
    cards.push(`<div class="lvcard"><small>This week</small><b class="num">${fmtShort(week)}</b>
      <span>${st?.lastWeekToDate ? `vs last week by now ${cmp(week, st.lastWeekToDate, m.limit)}` : "nothing last week by now"}</span></div>`);
    const g = goalState(a);
    if (g) {
      const left = g.g - g.v;
      const txt = m.limit
        ? (g.over ? `<span class="delta worse">over by ${fmtShort(-left)}</span>` : `limit reached at ${clock(now() + left * 1000)}`)
        : (g.done ? `<span class="delta better">goal reached</span>` : `goal reached at ${clock(now() + left * 1000)}`);
      cards.push(`<div class="lvcard"><small>${m.limit ? "Limit" : "Goal"} ${periodWord(a.goal_period)}</small>
        <b class="num">${fmtShort(g.v)} <em>/ ${fmtShort(g.g)}</em></b>
        <i class="lvbar${g.over ? " over" : ""}"><i style="width:${g.pct * 100}%"></i></i><span>${txt}</span></div>`);
    } else {
      cards.push(`<div class="lvcard"><small>${m.limit ? "Limit" : "Goal"}</small><b>None yet</b>
        <button class="linkbtn" id="lvsetgoal">${icon("flag", 14)}Set ${m.limit ? "a limit" : "a goal"}</button></div>`);
    }
    const sk = state.streaks?.[a.id];
    cards.push(`<div class="lvcard"><small>${m.limit ? "Days under limit" : "Streak"}</small>
      <b class="num">${sk?.current || 0} ${sk?.current === 1 ? "day" : "days"}</b>
      <span>${sk?.best > (sk?.current || 0) ? `best ${sk.best} days` : sk?.current ? "your best yet" : "start one today"}</span></div>`);
  }
  // how it ranks among the other activities of the same kind today
  let rank = "";
  if (state.running) {
    const same = state.activities.filter((x) => (x.kind === "limit") === m.limit).map((x) => ({ x, v: total(x.id, "today") }))
      .sort((p, q) => q.v - p.v);
    const max = Math.max(1, ...same.map((s) => s.v));
    const pos = same.findIndex((s) => s.x.id === a.id) + 1;
    const sum = same.reduce((t, s) => t + s.v, 0);
    const title = m.limit
      ? `Habits you're cutting back · ${fmtShort(sum)} today`
      : `${pos === 1 ? "Your top activity today" : `#${pos} of your ${same.length} activities today`}`;
    rank = same.length > 1 ? `<div class="lvrank"><small>${title}</small>${same.slice(0, 3).map((s) => `
      <div class="lvrrow${s.x.id === a.id ? " me" : ""}" style="--c:${s.x.color}"><span>${esc(s.x.name)}</span>
        <i><i style="width:${(s.v / max) * 100}%"></i></i><b class="num">${fmtShort(s.v)}</b></div>`).join("")}</div>` : "";
  }
  return `<div class="lvhero">
      <div class="lvclockwrap">${ring}<div class="lvclock"><small>${esc(m.label)}</small><b class="num">${m.big}</b><span>${esc(m.sub)}</span></div></div>
      <p class="lvmsg ${m.tone}">${m.tone === "bad" ? icon("alert", 18) : ""}${esc(m.msg)}</p>
      ${st?.sessions ? `<p class="lvfacts num">usual ${upMin(st.avg)} · record ${upMin(st.max)} · ${st.sessions} sessions</p>` : ""}
    </div>
    ${cards.length ? `<div class="lvcards">${cards.join("")}</div>` : ""}${rank}`;
}

function renderLive() {
  const m = liveModel(), running = !!state.running;
  const buttons = running
    ? `<button class="lvbtn" id="lvmini">${icon("sun", 20)}Minimal</button>
       <button class="lvbtn" id="lvpause">${icon("pause", 20)}Break</button>
       <button class="lvbtn stop" id="lvstop">${icon("stop", 18)}Stop</button>`
    : `<button class="lvbtn" id="lvresume">${icon("play", 18)}Resume now</button>
       <button class="lvbtn stop" id="lvend">End session</button>`;
  liveDlg.style.setProperty("--c", m.a.color || "var(--accent)");
  liveDlg.innerHTML = `<div class="lv">
    <div class="lvtop">
      <button class="icon-btn" id="lvclose" aria-label="Close live screen">${icon("x", 22)}</button>
      <div class="lvname"><span class="pulse"></span>${esc(m.a.name)}${m.limit ? ` <span class="kindtag">Cut back</span>` : ""}</div>
      ${canWake ? `<button class="icon-btn lvwake${keepOnPref() ? " on" : ""}" id="lvwake" aria-pressed="${keepOnPref()}" aria-label="Keep screen on">${icon("sun", 20)}</button>` : "<span></span>"}
    </div>
    <div id="lvbody">${liveBody()}</div>
    <div class="lvactions">${buttons}</div>
  </div>`;
  $("#lvclose").onclick = closeLive;
  $("#lvwake")?.addEventListener("click", () => {
    const on = !keepOnPref();
    setPref("liveKeepOn", on);
    setWake(on);
    toast(on ? "Screen stays on while this is open" : "Screen can turn off");
    renderLive();
  });
  $("#lvstop")?.addEventListener("click", stop);
  $("#lvmini")?.addEventListener("click", (e) => { const p = pointOf(e.currentTarget); closeLive(); openMini(p); });
  $("#lvpause")?.addEventListener("click", openPause);
  $("#lvresume")?.addEventListener("click", resumeBreak);
  $("#lvend")?.addEventListener("click", async () => { try { await api("/pause/cancel", { method: "POST" }); await load(); } catch (e) { toast(e.message); } });
  bindLiveBody();
}
function bindLiveBody() {
  $("#lvsetgoal")?.addEventListener("click", () => { const a = liveModel().a; openGoal(a, () => liveDlg.open && renderLive()); });
}
// every second: redraw only the numbers, not the buttons
function tickLive() {
  const b = $("#lvbody");
  if (!b || !liveActive()) return;
  b.innerHTML = liveBody();
  bindLiveBody();
}

/* ---------- minimal screen: a dim, nearly black screen with the timer and one sentence ---------- */
const miniDlg = $("#mini");
function renderMini() {
  const m = liveModel();
  miniDlg.style.setProperty("--c", m.a.color || "var(--accent)");
  miniDlg.innerHTML = `<div class="mini">
    <span class="mname"><i></i>${esc(m.a.name)}</span>
    <b class="num mclock" id="miniclock">${m.big}</b>
    <p class="mmsg ${m.tone}" id="minimsg">${esc(m.msg)}</p>
    <span class="mhint">Tap anywhere to go back</span></div>`;
}
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// the centre of an element, as a point the animation can start from
const pointOf = (el) => { const r = el?.getBoundingClientRect?.(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; };

function openMini(from) {
  if (!liveActive()) return;
  if (miniClosing) finishCloseMini(); // reopened mid-fade: start the entrance fresh
  const wasOpen = miniDlg.open;
  renderMini();
  if (!wasOpen) miniDlg.showModal();
  if (keepOnPref()) setWake(true);
  if (!wasOpen) animateMiniIn(Array.isArray(from) ? from : pointOf(from));
}
// A dark circle grows out of the tapped tile until it fills the screen, then the name, time and sentence
// rise into place one after another.
function animateMiniIn(point) {
  if (reducedMotion()) { miniDlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }); return; }
  const [x, y] = point || [innerWidth / 2, innerHeight / 2];
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  miniDlg.animate(
    [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${Math.ceil(r)}px at ${x}px ${y}px)` }],
    { duration: 560, easing: "cubic-bezier(.65,0,.35,1)" }
  );
  miniDlg.querySelectorAll(".mname, .mclock, .mmsg").forEach((el, i) => el.animate(
    [{ opacity: 0, transform: "translateY(16px) scale(.97)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
    { duration: 650, delay: 260 + i * 110, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" }
  ));
}
let miniClosing = null; // the running fade-out, if any
function finishCloseMini() {
  if (!miniClosing) return;
  miniClosing = null;
  miniDlg.close();
  miniDlg.getAnimations({ subtree: true }).forEach((x) => x.cancel());
}
function closeMini() {
  if (!miniDlg.open || miniClosing) return;
  if (reducedMotion()) return miniDlg.close();
  miniClosing = miniDlg.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.02)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
  miniClosing.onfinish = finishCloseMini;
  setTimeout(finishCloseMini, 320); // animations don't run in a hidden page; close anyway
}
miniDlg.addEventListener("click", closeMini);
miniDlg.addEventListener("close", () => { if (!liveDlg.open) setWake(false); });
// every second: just the numbers and the sentence
function tickMini() {
  if (!liveActive()) return closeMini();
  const m = liveModel();
  $("#miniclock").textContent = m.big;
  const msg = $("#minimsg");
  if (msg.textContent !== m.msg) msg.textContent = m.msg;
  msg.className = `mmsg ${m.tone}`;
}
