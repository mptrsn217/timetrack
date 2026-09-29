/* ---------- add / edit entry ---------- */
const toLocalInput = (d) => { const x = new Date(d); return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
// separate date and time boxes, so changing only the time is one tap
function dateTimeField(name, label, value) {
  const [d, t] = toLocalInput(value).split("T");
  return `<fieldset class="dt"><legend>${label}</legend>
    <input class="field num" type="date" name="${name}_d" value="${d}" max="${toLocalInput(new Date()).slice(0, 10)}" aria-label="${label} date" required>
    <input class="field num" type="time" name="${name}_t" value="${t}" aria-label="${label} time" required></fieldset>`;
}
const readDT = (f, name) => `${f[name + "_d"].value}T${f[name + "_t"].value}`;
const editSheet = $("#editsheet");
const roundTo5 = (ms) => Math.floor(ms / 3e5) * 3e5;
function openEntry(e) {
  const isNew = !e;
  if (isNew) {
    if (!state.activities.length) return toast("Add an activity first");
    const end = roundTo5(now());
    e = { activity_id: (entries[0] && state.activities.some((a) => a.id === entries[0].activity_id) ? entries[0].activity_id : state.activities[0].id),
      started_at: new Date(end - 3600e3).toISOString(), stopped_at: new Date(end).toISOString(), note: "" };
  }
  const running = !e.stopped_at;
  const acts = state.activities.some((a) => a.id === e.activity_id) ? state.activities : [{ id: e.activity_id, name: e.name }, ...state.activities];
  $("#editsheet .sheet").innerHTML = `
    <div class="grab"></div>
    <h3 tabindex="-1" autofocus>${isNew ? "Add entry" : "Edit entry"}</h3>
    <form id="entryform" class="eform">
      <label>Activity
        <select class="field" name="activity">${acts.map((a) => `<option value="${a.id}" ${a.id === e.activity_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      ${dateTimeField("start", "Start", e.started_at)}
      ${running
        ? `<p class="hint" style="margin:0">Still running. Stop it to set an end time.</p>`
        : dateTimeField("end", "End", e.stopped_at)}
      <label>Note
        <textarea class="field" name="note" rows="2" maxlength="500" placeholder="Optional, e.g. what you worked on">${esc(e.note || "")}</textarea></label>
      <p class="edur num" id="edur"></p>
      <div class="eactions">
        ${isNew ? "<span></span>" : `<button type="button" class="btn ghost danger" id="edel">${icon("trash", 18)}Delete</button>`}
        <span></span>
        <button type="button" class="btn ghost" id="ecancel">Cancel</button>
        <button type="submit" class="btn" id="esave">${isNew ? "Add" : "Save"}</button>
      </div>
    </form>`;
  const f = $("#entryform");
  const initial = isNew ? {} : { start: readDT(f, "start"), end: running ? null : readDT(f, "end") };
  // the inputs drop seconds; keep the exact stored time for a field the user didn't touch
  const values = () => ({
    start: readDT(f, "start") === initial.start ? new Date(e.started_at) : new Date(readDT(f, "start")),
    end: running ? null : readDT(f, "end") === initial.end ? new Date(e.stopped_at) : new Date(readDT(f, "end")),
  });
  // moving the start to another day takes a same-day end along with it
  let prevStartDay = f.start_d.value;
  f.start_d.addEventListener("change", () => {
    if (f.end_d && f.end_d.value === prevStartDay) f.end_d.value = f.start_d.value;
    prevStartDay = f.start_d.value;
  });
  const upd = () => {
    const { start, end } = values();
    const secs = ((end ? end.getTime() : now()) - start) / 1000;
    $("#edur").textContent = isNaN(secs) ? "" : secs > 0 ? `Duration ${fmtShort(secs)}` : "End must be after start";
    $("#edur").classList.toggle("bad", !(secs > 0));
  };
  f.oninput = upd; upd();
  $("#ecancel").onclick = () => editSheet.close();
  $("#edel")?.addEventListener("click", async () => {
    if (!confirm("Delete this entry?")) return;
    try { await api(`/entries/${e.id}`, { method: "DELETE" }); editSheet.close(); await refreshAfterEdit(); toast("Entry deleted"); }
    catch (err) { toast(err.message); }
  });
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const { start, end } = values();
    if (isNaN(start) || (end && isNaN(end))) return toast("Enter a valid date and time");
    const body = { activity_id: Number(f.activity.value), started_at: start.toISOString(), note: f.note.value };
    if (!running) body.stopped_at = end.toISOString();
    $("#esave").disabled = true;
    try {
      await api(isNew ? "/entries" : `/entries/${e.id}`, { method: isNew ? "POST" : "PUT", body });
      editSheet.close();
      await refreshAfterEdit();
      if (running) notify();
      toast(isNew ? "Entry added" : "Entry updated");
    } catch (err) {
      toast(err.message);
      $("#esave").disabled = false;
    }
  };
  editSheet.showModal();
}
async function refreshAfterEdit() {
  if (searchResults && searchQ) { try { searchResults = await api(`/entries?q=${encodeURIComponent(searchQ)}`); } catch {} }
  await load();
}
editSheet.addEventListener("click", (ev) => { if (ev.target === editSheet) editSheet.close(); });

/* ---------- forgotten timer ---------- */
// A timer running far longer than usual was probably left on by accident; offer to set the real end time.
let keepRunning = [];
try { keepRunning = JSON.parse(localStorage.getItem("keepRunning") || "[]"); } catch {}
function maybeForgotten() {
  const r = state.running;
  if (!r || editSheet.open || sheet.open || keepRunning.includes(r.id)) return;
  const usual = state.stats?.sessions ? state.stats.avg : 0;
  if (runSec() < Math.max(4 * 3600, 3 * usual)) return;
  const start = new Date(r.started_at).getTime();
  const suggest = Math.min(start + (usual || 3600) * 1000, now() - 60e3);
  const since = new Date(r.started_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  $("#editsheet .sheet").innerHTML = `
    <div class="grab"></div>
    <h3 tabindex="-1" autofocus>Still doing ${esc(r.name)}?</h3>
    <form id="forgotform" class="eform">
      <p class="hint" style="margin:0 4px">It has been running for <b class="num">${fmtShort(runSec())}</b>, since ${since}${usual ? `. It usually lasts about ${fmtShort(usual)}` : ""}.</p>
      ${dateTimeField("end", "When did you actually stop?", suggest)}
      <div class="eactions">
        <button type="button" class="btn ghost" id="fkeep">Keep running</button>
        <span></span>
        <button type="button" class="btn ghost" id="fnow">Stop now</button>
        <button type="submit" class="btn">Save</button>
      </div>
    </form>`;
  const f = $("#forgotform");
  $("#fkeep").onclick = () => {
    keepRunning = [...keepRunning.slice(-19), r.id];
    try { localStorage.setItem("keepRunning", JSON.stringify(keepRunning)); } catch {}
    editSheet.close();
  };
  $("#fnow").onclick = async () => { editSheet.close(); await stop(); };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const end = new Date(readDT(f, "end"));
    if (isNaN(end) || end <= start) return toast("Pick a time after it started");
    try {
      await api(`/entries/${r.id}`, { method: "PUT", body: { stopped_at: end.toISOString() } });
      editSheet.close();
      await load();
      notify();
      toast(`Stopped at ${clock(end)}`);
    } catch (err) { toast(err.message); }
  };
  editSheet.showModal();
}
