/* ---------- goals ---------- */
const periodWord = (p) => (p === "day" ? "today" : "this week");

// Live progress of the running activity toward its daily/weekly goal (or limit), recomputed every second
function liveGoalHTML(a) {
  if (!a) return "";
  if (!a.goal_minutes) {
    return `<div class="gl1"><span class="muted">No ${a.kind === "limit" ? "limit" : "goal"} for ${esc(a.name)} yet</span>
      <button type="button" class="linkbtn" id="setlivegoal">${icon("flag", 14)}Set ${a.kind === "limit" ? "limit" : "goal"}</button></div>`;
  }
  const g = goalState(a);
  const left = g.g - g.v;
  const at = (sec) => clock(now() + sec * 1000);
  const when = periodWord(a.goal_period);
  const label = `${a.kind === "limit" ? "Limit" : "Goal"} ${fmtShort(g.g)} ${when}`;
  let head, sub, cls = "";
  if (a.kind === "limit") {
    if (g.over) { head = `${icon("alert", 16)}Over limit by ${fmtShort(-left)}`; sub = `${label} · stop now to limit the damage`; cls = "warn"; }
    else { head = `${fmtShort(left)} left before your limit`; sub = `${label} · reached at ${at(left)} if you keep going`; }
  } else if (g.done) {
    head = `Goal reached · ${fmtShort(-left) === "0m" ? "just now" : `+${fmtShort(-left)}`}`; sub = `${label} · ${fmtShort(g.v)} done`; cls = "rec";
  } else {
    head = `${fmtShort(left + 59)} to your goal`; sub = `${label} · ${fmtShort(g.v)} done · reached at ${at(left)}`;
  }
  return `<div class="gl1 ${cls}"><span>${icon("flag", 15)}${head}</span></div>
    <div class="gbar${g.over ? " over" : ""}" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${Math.round(g.pct * 100)}" aria-valuemin="0" aria-valuemax="100">
      <div class="gfill" style="width:${g.pct * 100}%"></div></div>
    <div class="gsub num">${sub}</div>`;
}
function bindLiveGoal(a) {
  const b = $("#setlivegoal");
  if (b && a) b.onclick = () => openGoal(a);
}
function goalState(a) {
  if (!a.goal_minutes) return null;
  const v = total(a.id, a.goal_period === "day" ? "today" : "week"), g = a.goal_minutes * 60;
  return { v, g, pct: Math.min(v / g, 1), done: a.kind !== "limit" && v >= g, over: a.kind === "limit" && v > g };
}
function goalLabel(a) {
  if (!a.goal_minutes) return a.kind === "limit" ? "Set limit" : "Set goal";
  return `${a.kind === "limit" ? "Limit" : "Goal"} ${fmtShort(a.goal_minutes * 60)} / ${a.goal_period}`;
}
function openGoal(act, onSaved) {
  const limit = act.kind === "limit";
  let period = act.goal_period || "off";
  const mins = act.goal_minutes || (limit ? 30 : 60);
  $("#editsheet .sheet").innerHTML = `
    <div class="grab"></div>
    <h3 tabindex="-1" autofocus>${esc(act.name)}: ${limit ? "limit" : "goal"}</h3>
    <form id="goalform" class="eform">
      <p class="hint" style="margin:0 4px">${limit ? "Try to stay under this much time. The tile warns you when you go over." : "Aim for at least this much time. The tile fills up as you go."}</p>
      <div class="seg" role="tablist" aria-label="Period">
        ${[["off", "Off"], ["day", "Per day"], ["week", "Per week"]].map(([p, l]) => `<button type="button" role="tab" data-p="${p}" aria-selected="${period === p}">${l}</button>`).join("")}
      </div>
      <div class="goalrow" id="goalrow">
        <label>Hours<input class="field num" type="number" name="h" min="0" max="168" value="${Math.floor(mins / 60)}" inputmode="numeric"></label>
        <label>Minutes<input class="field num" type="number" name="m" min="0" max="59" step="5" value="${mins % 60}" inputmode="numeric"></label>
      </div>
      <div class="eactions">
        <span></span><span></span>
        <button type="button" class="btn ghost" id="gcancel">Cancel</button>
        <button type="submit" class="btn">Save</button>
      </div>
    </form>`;
  const f = $("#goalform");
  const sync = () => {
    $$("[data-p]", f).forEach((b) => b.setAttribute("aria-selected", b.dataset.p === period));
    $("#goalrow").hidden = period === "off";
  };
  $$("[data-p]", f).forEach((b) => b.onclick = () => { period = b.dataset.p; sync(); });
  sync();
  $("#gcancel").onclick = () => editSheet.close();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const total = (Number(f.h.value) || 0) * 60 + (Number(f.m.value) || 0);
    if (period !== "off" && (total < 1 || total > 10080)) return toast("Enter between 1 minute and 168 hours");
    const body = period === "off" ? { goal_minutes: null } : { goal_minutes: total, goal_period: period };
    try {
      await api(`/activities/${act.id}`, { method: "PUT", body });
      editSheet.close();
      await load();
      onSaved?.();
    } catch (err) { toast(err.message); }
  };
  editSheet.showModal();
}
