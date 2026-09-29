/* ---------- starter setup (new users) ---------- */
const STARTERS = [
  ["Work", "good", 2400, "week"], ["Deep work", "good", 120, "day"], ["Study", "good", 60, "day"], ["Exercise", "good", 180, "week"],
  ["Reading", "good", 30, "day"], ["Walking", "good", 30, "day"], ["Meditation", "good", 10, "day"], ["Language learning", "good", 20, "day"],
  ["Housework", "good", null, null], ["Social media", "limit", 30, "day"], ["Gaming", "limit", 60, "day"], ["TV & streaming", "limit", 90, "day"],
];
function starterHTML() {
  const row = ([name, kind, m, p], i) => `<button type="button" class="nrow" data-starter="${i}" aria-pressed="false"><span class="box" aria-hidden="true"></span>
    <span><b>${name}</b><small>${m ? `${kind === "limit" ? "Limit" : "Goal"} ${fmtShort(m * 60)} / ${p}` : "No goal"}</small></span></button>`;
  return `<section class="card starter">
    <h2>Let's set up your activities</h2>
    <p class="hint" style="margin:0">Pick what you'd like to track. Goals and limits are suggestions; change them any time under Activities.</p>
    <div class="label">Things to do more of</div>
    <div class="nprefs">${STARTERS.map((t, i) => (t[1] === "good" ? row(t, i) : "")).join("")}</div>
    <div class="label">Habits to cut back</div>
    <div class="nprefs">${STARTERS.map((t, i) => (t[1] === "limit" ? row(t, i) : "")).join("")}</div>
    <button class="btn" id="starterbtn" disabled>Pick at least one</button>
    <button class="linkbtn" id="goadd">${icon("plus", 14)}Or create your own</button></section>`;
}
function bindStarter() {
  const btn = $("#starterbtn");
  if (!btn) return;
  const picked = () => $$("[data-starter][aria-pressed='true']").map((b) => STARTERS[b.dataset.starter]);
  $$("[data-starter]").forEach((b) => b.onclick = () => {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    const n = picked().length;
    btn.disabled = !n;
    btn.textContent = n ? `Add ${n} ${n === 1 ? "activity" : "activities"}` : "Pick at least one";
  });
  btn.onclick = async () => {
    const list = picked();
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      for (const [i, [name, kind, m, p]] of list.entries()) {
        await api("/activities", { method: "POST", body: { name, kind, color: PALETTE[i % PALETTE.length], ...(m ? { goal_minutes: m, goal_period: p } : {}) } });
      }
      await load();
      toast(`Added ${list.length}. Tap one to start its timer`);
    } catch (e) { toast(e.message); await load(); }
  };
}
