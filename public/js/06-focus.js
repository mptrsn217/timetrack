/* ---------- focus mode ---------- */
const focusLeft = () => (state.focus ? (new Date(state.focus.ends) - now()) / 1000 : 0);
function focusHero(f) {
  const work = f.phase === "work", last = f.round >= f.rounds;
  const dots = Array.from({ length: f.rounds }, (_, i) => {
    const n = i + 1;
    const cls = n < f.round || (n === f.round && !work) ? "done" : n === f.round ? "now" : "";
    return `<i class="${cls}"></i>`;
  }).join("");
  return `<section class="hero ${work ? "on" : "paused"} focus" style="--c:${f.color}">
    <button class="lvopen" data-live aria-label="Open live screen">${icon("expand", 18)}</button>
    <div><div class="label"><span class="pulse"></span>${work ? `Focus · round ${f.round} of ${f.rounds}` : `Break · round ${f.round + 1} of ${f.rounds} next`}</div>
      <div class="name">${esc(f.name)}</div></div>
    <div class="row">
      <div><div class="clock num" id="focusclock">${fmt(Math.max(0, focusLeft()))}</div>
        <div class="since">${work ? (last ? "Session ends" : `Break (${f.brk} min)`) : "Focus resumes"} at ${clock(f.ends)}</div></div>
      <span class="hbtns">
        <button class="btn-pause" id="fskip" aria-label="${work ? (last ? "Finish now" : "Skip to break") : "Skip break"}">${icon("skip", 18)}</button>
        <button class="btn-stop" id="fstop">${icon("stop", 16)}${work ? "Stop" : "End"}</button></span>
    </div>
    <div class="rounds" aria-label="Round ${f.round} of ${f.rounds}">${dots}<span>${f.work} min focus · ${f.brk} min break</span></div></section>`;
}
function bindFocusHero() {
  $("#fskip")?.addEventListener("click", async () => {
    try { await api("/focus/skip", { method: "POST" }); await load(); } catch (e) { toast(e.message); }
  });
  $("#fstop")?.addEventListener("click", async () => {
    try { const out = await api("/focus/stop", { method: "POST" }); await load(); notify(); toast(out.message); } catch (e) { toast(e.message); }
  });
}
let advancing = false;
async function advanceFocusNow() {
  if (advancing) return;
  advancing = true;
  try { await api("/focus/advance", { method: "POST" }); await load(); notify(); } catch {}
  setTimeout(() => (advancing = false), 3000);
}
function openFocus() {
  const acts = state.activities.filter((a) => a.kind !== "limit");
  if (!acts.length) return toast("Add an activity first");
  const r = state.running;
  const last = acts.find((a) => a.id === r?.activity_id) || [...acts].sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))[0];
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>Focus mode</h3>
    <form class="eform" id="focusform">
      <p class="hint" style="margin:0 4px">Work in focused rounds with short breaks in between. Timetrack switches by itself and notifies you; break time isn't counted.</p>
      <label>Activity<select class="field" name="act">${acts.map((a) => `<option value="${a.id}" ${a.id === last.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <div class="goalrow three">
        <label>Focus (min)<input class="field num" type="number" name="w" min="5" max="180" value="25" inputmode="numeric"></label>
        <label>Break (min)<input class="field num" type="number" name="b" min="1" max="60" value="5" inputmode="numeric"></label>
        <label>Rounds<input class="field num" type="number" name="n" min="1" max="12" value="4" inputmode="numeric"></label>
      </div>
      <p class="edur num" id="ftotal"></p>
      <div class="eactions"><span></span><span></span><button type="button" class="btn ghost" id="fcancel">Cancel</button>
        <button type="submit" class="btn">${icon("target", 16)}Start</button></div>
    </form>`;
  const f = $("#focusform");
  const upd = () => {
    const w = +f.w.value, b = +f.b.value, n = +f.n.value;
    $("#ftotal").textContent = w && n ? `${fmtShort(w * n * 60)} of focus, done at ${clock(now() + (w * n + b * (n - 1)) * 60e3)}` : "";
  };
  f.oninput = upd; upd();
  $("#fcancel").onclick = () => editSheet.close();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const out = await api("/focus", { method: "POST", body: { activity_id: Number(f.act.value), work: +f.w.value, brk: +f.b.value, rounds: +f.n.value } });
      editSheet.close();
      await load();
      notify();
      toast(out.message);
      if (autoLivePref()) openLive();
    } catch (e) { toast(e.message); }
  };
  editSheet.showModal();
}
