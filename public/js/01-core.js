const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
// validated categorical order: adjacent pairs stay distinguishable for colorblind users on light and dark
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
  "#2f9fd0", "#b86e2e", "#009b8f", "#8a62c9", "#7c8a1a", "#b3478c", "#5b6bd8", "#b0584f"];
let signedIn = false;
let state = { activities: [], running: null, totals: [], user: null };
let view = "track";
let offset = 0; // serverNow - clientNow ms
let entries = [];
let newColor = null; // user-picked color for the next activity; null = next unused palette slot

// Changes that can wait for the network: made offline, they're kept on the phone (in order) and sent later.
const QUEUEABLE = [/^\/start$/, /^\/stop$/, /^\/habits\/\d+\/(marks|add|count)$/];
let online = navigator.onLine;
const outbox = () => { try { return JSON.parse(localStorage.getItem("outbox") || "[]"); } catch { return []; } };
const saveOutbox = (list) => { try { localStorage.setItem("outbox", JSON.stringify(list)); } catch {} };
class Offline extends Error { constructor() { super("You're offline. This will sync when you're back online"); this.offline = true; } }
async function api(path, opts = {}) {
  const queueable = opts.method && opts.method !== "GET" && QUEUEABLE.some((re) => re.test(path));
  // start/stop carry the moment they happened, so a delayed send still records the right time
  if (queueable && /^\/(start|stop)$/.test(path)) opts = { ...opts, body: { ...(opts.body || {}), at: new Date(now()).toISOString() } };
  let r;
  try {
    r = await fetch("/api" + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    setOnline(false);
    if (queueable) { saveOutbox([...outbox(), { path, method: opts.method, body: opts.body }]); offlineBanner(); return { queued: true }; }
    throw new Offline();
  }
  setOnline(true);
  if (r.status === 401) { signedIn = false; render(); throw new Error("Please sign in"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
let toastTimer;
function toast(msg, action) {
  const e = $("#toast");
  // an open modal sheet sits in the top layer above the page; move the toast into it so it stays visible
  const host = $("dialog[open]") || document.body;
  if (e.parentElement !== host) host.appendChild(e);
  e.textContent = msg;
  e.classList.toggle("act", !!action);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { e.classList.remove("show"); action.run(); };
    e.appendChild(b);
  }
  e.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove("show"), action ? 6000 : 2800);
}
function now() { return Date.now() + offset; }
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtShort(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function runSec() { return state.running ? (now() - new Date(state.running.started_at)) / 1000 : 0; }
// server totals are a snapshot; add the time elapsed since then for the running activity
let loadedAt = Date.now();
function total(id, key) {
  const t = state.totals.find((x) => x.activity_id === id);
  let v = t ? Number(t[key]) : 0;
  if (state.running?.activity_id === id) v += (Date.now() - loadedAt) / 1000;
  return v;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, size = 20) => `<svg width="${size}" height="${size}"><use href="#i-${id}"/></svg>`;
const editing = () => app.contains(document.activeElement) && document.activeElement.matches("input, textarea, select");

function setOnline(v) {
  if (online === v) return;
  online = v;
  offlineBanner();
  if (v) flushOutbox();
}
function offlineBanner() {
  const n = outbox().length;
  let b = $("#offline");
  if (online && !n) { b?.remove(); return; }
  if (!b) { b = Object.assign(document.createElement("div"), { id: "offline" }); document.body.appendChild(b); }
  b.textContent = online ? `Syncing ${n} ${n === 1 ? "change" : "changes"}…` : `Offline${n ? ` · ${n} ${n === 1 ? "change" : "changes"} will sync` : ""}`;
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !outbox().length) return;
  flushing = true;
  try {
    while (outbox().length) {
      const [item, ...rest] = outbox();
      try {
        const r = await fetch("/api" + item.path, { method: item.method, headers: { "content-type": "application/json" }, body: JSON.stringify(item.body || {}) });
        if (!r.ok && r.status !== 401) toast(`A change made offline couldn't be saved: ${(await r.json().catch(() => ({}))).error || r.status}`);
        if (r.status === 401) break;
      } catch { online = false; break; }
      saveOutbox(rest);
    }
  } finally { flushing = false; offlineBanner(); }
  if (!outbox().length) load({ background: true });
}
window.addEventListener("online", () => { online = true; flushOutbox(); load({ background: true }); });
window.addEventListener("offline", () => setOnline(false));

// the last data seen, so the app still opens without a connection
const CACHE_KEYS = ["state", "habits"];
function cacheSet(k, v) { try { localStorage.setItem("cache:" + k, JSON.stringify(v)); } catch {} }
function cacheGet(k) { try { return JSON.parse(localStorage.getItem("cache:" + k)); } catch { return null; } }
const cacheClear = () => { try { CACHE_KEYS.forEach((k) => localStorage.removeItem("cache:" + k)); localStorage.removeItem("outbox"); } catch {} };

async function load({ background = false } = {}) {
  try {
    let s, fresh = true;
    try { s = await api(`/state?tz=${encodeURIComponent(tz)}`); cacheSet("state", s); }
    catch (e) {
      fresh = false;
      if (!e.offline || !cacheGet("state")) throw e;
      s = cacheGet("state"); // offline: show the last known data
      if (state.user && state.running !== undefined && signedIn) s = { ...s, running: state.running, focus: state.focus, pause: state.pause };
    }
    // the clock correction only comes from a live answer: a saved copy's server time is old,
    // and using it would drag "now" (and the times of offline starts/stops) into the past
    if (fresh) { offset = new Date(s.serverNow) - Date.now(); loadedAt = Date.now(); }
    state = s;
    signedIn = true;
    if (view === "history" || view === "overview") await loadHistoryData();
    if (view === "habits" || view === "overview") {
      try { habitsData = await api(`/habits?tz=${encodeURIComponent(tz)}`); cacheSet("habits", habitsData); if (view === "overview") await loadInsights(); }
      catch (e) { if (!e.offline) throw e; if (!habitsData) habitsData = cacheGet("habits"); }
    }
    // never redraw under someone's fingers: a background refresh would wipe what they are typing
    if (background && editing()) return;
    render();
    if (liveDlg.open) liveActive() ? renderLive() : closeLive();
    maybeForgotten();
  } catch (e) { if (signedIn && !background) toast(e.message); if (!signedIn) render(); }
  offlineBanner();
}

function render() {
  document.body.classList.toggle("out", !signedIn);
  $$(".tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  if (!signedIn) return renderLogin();
  renderAvatar($("#me"));
  if (view === "track") renderTrack();
  else if (view === "habits") renderHabits();
  else if (view === "overview") renderOverview();
  else renderHistory();
}

function renderAvatar(el) {
  const u = state.user || {};
  const initial = (u.name || u.email || "?").trim()[0].toUpperCase();
  el.innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc(initial);
}
