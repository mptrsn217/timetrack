/* ---------- navigation & account ---------- */
function go(v) {
  view = v;
  if (v === "history" || v === "overview" || (v === "habits" && !habitsData)) {
    // entries are fetched per visit; don't flash a stale or empty list first
    $$(".tabs button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
    app.innerHTML = `<div class="empty" style="margin-top:24px">Loading…</div>`;
    return load();
  }
  render();
  load({ background: true });
}
$$(".tabs button").forEach((b) => b.onclick = () => go(b.dataset.view));

const sheet = $("#sheet");
$("#me").onclick = () => {
  const u = state.user || {};
  renderAvatar($("#sheet-av"));
  $("#sheet-name").textContent = u.name || "Signed in";
  $("#sheet-email").textContent = u.email || "";
  sheet.showModal();
};
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

// Swipe a sheet down to close it. Only starts when the sheet is scrolled to the top and the finger
// isn't in a text field or a horizontally scrolling area; a short drag springs back.
function enableSheetDrag(dlg) {
  let y0 = null, x0 = 0, dy = 0, t0 = 0, dragging = false;
  const settle = (transform, then) => {
    dlg.style.transition = "transform .2s ease";
    dlg.style.transform = transform;
    setTimeout(() => { dlg.style.transition = ""; then?.(); }, 200);
  };
  dlg.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || dlg.scrollTop > 0) return;
    if (e.target.closest("input, textarea, select, .hscroll, .cchart")) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; t0 = Date.now(); dragging = false;
  }, { passive: true });
  dlg.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    const d = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!dragging) {
      if (d > 8 && d > Math.abs(dx)) { dragging = true; dlg.style.transition = "none"; }
      else if (d < -4 || Math.abs(dx) > 10) { y0 = null; return; } // scrolling up or sideways: not ours
      else return;
    }
    e.preventDefault(); // the sheet moves instead of the page
    dy = Math.max(0, d);
    dlg.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    if (!dragging) return;
    const speed = dy / Math.max(1, Date.now() - t0); // px per ms
    if (dy > dlg.offsetHeight * 0.3 || (dy > 40 && speed > 0.6)) {
      settle(`translateY(${dlg.offsetHeight}px)`, () => { dlg.close(); dlg.style.transform = ""; });
    } else settle("");
  };
  dlg.addEventListener("touchend", end);
  dlg.addEventListener("touchcancel", end);
}
[sheet, editSheet, liveDlg].forEach(enableSheetDrag);

function signedOut() {
  sheet.close();
  cacheClear();
  habitsData = null; insightsData = null;
  signedIn = false; state = { activities: [], running: null, totals: [], user: null }; view = "track";
  render();
}
$("#logout").onclick = async () => {
  await stopNotify();
  try {
    const sub = await currentSub();
    if (sub) { await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
  } catch {}
  await fetch("/auth/logout", { method: "POST" });
  window.google?.accounts?.id?.disableAutoSelect();
  signedOut();
};
$("#delacct").onclick = async () => {
  if (!confirm("Delete your account and all tracked time? This cannot be undone.")) return;
  try { await api("/me", { method: "DELETE" }); } catch (e) { return toast(e.message); }
  await stopNotify();
  signedOut();
  toast("Account deleted");
};
$("#csv").onclick = async () => {
  const r = await fetch("/api/export.csv");
  if (!r.ok) return toast("Export failed");
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement("a"), { href: url, download: "timetrack.csv" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10e3);
  sheet.close();
};

async function download(url, fallbackName) {
  const r = await fetch(url);
  if (!r.ok) return toast("Download failed");
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || fallbackName;
  const href = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement("a"), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10e3);
}
$("#backup").onclick = async () => { sheet.close(); await download("/api/backup.json", "timetrack-backup.json"); };
$("#restore").onclick = () => $("#restorefile").click();
$("#restorefile").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't a Timetrack backup"); }
  if (data?.app !== "timetrack") return toast("That file isn't a Timetrack backup");
  const n = Array.isArray(data.entries) ? data.entries.length : 0;
  if (!confirm(`Restore ${n} ${n === 1 ? "entry" : "entries"} from ${new Date(data.exported_at).toLocaleDateString()}? Nothing is deleted; entries you already have are skipped.`)) return;
  sheet.close();
  try {
    const r = await fetch("/api/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || "Restore failed");
    toast(`Restored ${out.entries_added} entries${out.entries_skipped ? `, skipped ${out.entries_skipped}` : ""}`);
    load();
  } catch (e) { toast(e.message); }
};

// live tick
setInterval(() => {
  if (signedIn && liveDlg.open) tickLive();
  if (signedIn && miniDlg.open) tickMini();
  if (signedIn && !state.running && state.pause) {
    const left = pauseLeft();
    const pc = $("#pauseclock"); if (pc) pc.textContent = fmt(Math.max(0, left));
    if (left <= 0) resumeBreak(true);
    return;
  }
  if (!state.running || !signedIn) return;
  const v = fmt(runSec());
  const c = $("#clock"); if (c) c.textContent = v;
  const g = $("#goal");
  if (g) g.innerHTML = goalHTML();
  const runAct = state.activities.find((a) => a.id === state.running.activity_id);
  const lg = $("#livegoal");
  if (lg && runAct?.goal_minutes) lg.innerHTML = liveGoalHTML(runAct);
  const gs = runAct && goalState(runAct);
  const tb = $(`.tile[data-id="${state.running.activity_id}"] .tbar`);
  if (tb && gs) {
    tb.firstElementChild.style.width = `${gs.pct * 100}%`;
    tb.classList.toggle("over", gs.over);
    tb.classList.toggle("done", gs.done);
  }
  const sub = $(`[data-sub="${state.running.activity_id}"]`); if (sub) sub.textContent = v;
}, 1000);
setInterval(() => signedIn && load({ background: true }), 30000);
document.addEventListener("visibilitychange", () => !document.hidden && signedIn && load({ background: true }));

// notifications (persistent timer in shade / lock screen on Android)
let swReg = null;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then((r) => swReg = r);
