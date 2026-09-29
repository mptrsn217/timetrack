/* ---------- habits: daily yes/no check-ins, one year heatmap each ---------- */
let habitsData = null;
let hDay = null; // the day being checked in (defaults to today)
const countOf = (id, day) => habitsData.counts.find((c) => c.habit_id === id && c.day === day)?.count || 0;
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftDay = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
const markOf = (id, day) => habitsData.marks.find((m) => m.habit_id === id && m.day === day)?.value;
const goodDay = (h, v) => (h.kind === "avoid" ? v === false : v === true);

function habitStats(h) {
  if (h.kind === "count") return countStats(h);
  const today = habitsData.today;
  const map = new Map(habitsData.marks.filter((m) => m.habit_id === h.id).map((m) => [m.day, m.value]));
  let d = today, current = 0;
  if (!map.has(d)) d = shiftDay(d, -1); // today not logged yet doesn't break the streak
  while (map.has(d) && goodDay(h, map.get(d))) { current++; d = shiftDay(d, -1); }
  let best = 0, run = 0;
  const days = [...map.keys()].sort();
  for (let x = days[0]; x && x <= today; x = shiftDay(x, 1)) { run = map.has(x) && goodDay(h, map.get(x)) ? run + 1 : 0; best = Math.max(best, run); }
  let good = 0, logged = 0;
  for (let i = 0; i < 30; i++) { const x = shiftDay(today, -i); if (map.has(x)) { logged++; if (goodDay(h, map.get(x))) good++; } }
  return { current, best, good, logged, map };
}

function countStats(h) {
  const today = habitsData.today;
  const map = new Map(habitsData.counts.filter((c) => c.habit_id === h.id).map((c) => [c.day, c.count]));
  const good = (d) => (map.get(d) || 0) >= (h.target || 1);
  let d = today, current = 0;
  if (!good(d)) d = shiftDay(d, -1); // today isn't over yet
  while (good(d)) { current++; d = shiftDay(d, -1); }
  let best = 0, run = 0;
  const days = [...map.keys()].sort();
  for (let x = days[0]; x && x <= today; x = shiftDay(x, 1)) { run = good(x) ? run + 1 : 0; best = Math.max(best, run); }
  const monday = shiftDay(today, -((parseDay(today).getDay() + 6) % 7));
  let week = 0, last7 = 0;
  for (let x = monday; x <= today; x = shiftDay(x, 1)) week += map.get(x) || 0;
  for (let i = 1; i <= 7; i++) last7 += map.get(shiftDay(today, -i)) || 0;
  return { current, best, map, week, avg7: Math.round(last7 / 7), bestDay: Math.max(0, ...map.values()), today: map.get(today) || 0 };
}

// shared year grid: Monday-first weeks, month labels, one <i> per day
function yearGrid(dates, cell) {
  const pad = (parseDay(dates[0]).getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...dates];
  const weeks = Math.ceil(cells.length / 7);
  let months = "", prev = -1;
  for (let w = 0; w < weeks; w++) {
    const d = cells.slice(w * 7, w * 7 + 7).find(Boolean);
    const m = parseDay(d).getMonth();
    months += `<span>${m !== prev && w < weeks - 1 ? parseDay(d).toLocaleDateString(undefined, { month: "short" }) : ""}</span>`;
    prev = m;
  }
  return `<div class="hscroll"><div class="hwrap">
    <div class="hdays"><span></span><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span></div>
    <div><div class="hmonths" style="grid-template-columns:repeat(${weeks}, var(--cell))">${months}</div>
    <div class="hgrid">${cells.map((d) => (d ? cell(d) : '<i class="pad"></i>')).join("")}</div></div></div></div>`;
}

// "On days you Workout, you spend 1h 20m more on Deep work": habits vs tracked time, last 90 days
let insightsData = null, insightsAt = 0;
async function loadInsights() {
  if (Date.now() - insightsAt < 10 * 60e3 && insightsData) return;
  insightsAt = Date.now();
  try { insightsData = await api(`/insights?tz=${encodeURIComponent(tz)}`); } catch { insightsAt = 0; }
}
function insightsHTML() {
  const list = insightsData?.insights || [];
  if (!habitsData?.habits.length) return "";
  if (!list.length) return `<h2 class="section"><span>What goes together</span></h2>
    <div class="empty small">After a few weeks of habits and tracked time, connections show up here, like
    "on days you work out, you do 1h more Deep work".</div>`;
  const on = (hb, yes) => hb.kind === "count" ? `${yes ? "hit" : "miss"} your ${esc(hb.name)} target`
    : hb.kind === "avoid" ? `${yes ? "had" : "skip"} ${esc(hb.name)}` : `${yes ? "" : "skip "}${esc(hb.name)}`;
  return `<h2 class="section"><span>What goes together</span><span class="num">last ${insightsData.days} days</span></h2>
    <div class="card insights">${list.slice(0, 5).map((x) => {
      const more = x.avgYes > x.avgNo, diff = Math.abs(x.avgYes - x.avgNo);
      const good = more === (x.activity.kind !== "limit");
      return `<div class="ins" style="--c:${x.activity.color}">
        <p>On days you <b>${on(x.habit, true)}</b>, you spend <b class="${good ? "better" : "worse"}">${fmtShort(diff)} ${more ? "more" : "less"}</b> on ${esc(x.activity.name)}</p>
        <small class="num">${fmtShort(x.avgYes)} a day vs ${fmtShort(x.avgNo)} on days you ${on(x.habit, false)} · ${x.daysYes} vs ${x.daysNo} days</small></div>`;
    }).join("")}</div>`;
}

function renderHabits() {
  if (!habitsData) { app.innerHTML = `<div class="empty" style="margin-top:24px">Loading…</div>`; return; }
  const { habits, today } = habitsData;
  if (!hDay || hDay > today) hDay = today;
  const dayLabel = hDay === today ? "Today" : hDay === shiftDay(today, -1) ? "Yesterday"
    : parseDay(hDay).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  const check = habits.length ? `<section class="card hcheck">
      <div class="hdaynav"><button class="icon-btn" id="hprev" aria-label="Previous day">${icon("up", 18)}</button>
        <b>${dayLabel}</b><button class="icon-btn" id="hnext" aria-label="Next day" ${hDay >= today ? "disabled" : ""}>${icon("down", 18)}</button></div>
      ${habits.map((h) => {
        if (h.kind === "count") {
          const n = countOf(h.id, hDay), pct = h.target ? Math.min(1, n / h.target) : 0;
          return `<div class="hrow count" data-hold="${h.id}" style="--c:${h.color}">
            <span class="hq"><i></i>${esc(h.name)}${h.target ? `<small class="num">${n >= h.target ? "target reached · " : ""}${n} / ${h.target}</small>` : ""}</span>
            <span class="cnt">
              <button type="button" data-cadd="${h.id}" data-d="${-h.step}" aria-label="Minus ${h.step}" ${n ? "" : "disabled"}>−${h.step > 1 ? h.step : ""}</button>
              <button type="button" class="cval num" data-cset="${h.id}" aria-label="Set ${esc(h.name)}">${n}</button>
              <button type="button" class="plus" data-cadd="${h.id}" data-d="${h.step}">+${h.step}</button>
              <button type="button" class="plus" data-cadd="${h.id}" data-d="${h.step * 5}">+${h.step * 5}</button></span>
            ${h.target ? `<span class="cbar"><i style="width:${pct * 100}%"></i></span>` : ""}</div>`;
        }
        const v = markOf(h.id, hDay);
        return `<div class="hrow" data-hold="${h.id}" style="--c:${h.color}"><span class="hq"><i></i>${esc(h.name)}?${h.kind === "avoid" ? ` <span class="kindtag">Avoid</span>` : ""}</span>
          <span class="yn"><button type="button" data-mark="${h.id}" data-v="true" aria-pressed="${v === true}" class="${h.kind === "avoid" ? "bad" : "good"}">Yes</button>
          <button type="button" data-mark="${h.id}" data-v="false" aria-pressed="${v === false}" class="${h.kind === "avoid" ? "good" : "bad"}">No</button></span></div>`;
      }).join("")}
    </section>` : `<section class="card hcheck empty-h"><b>Track yes/no habits</b>
      <p class="hint" style="margin:4px 0 0">One tap a day: did you do it? See every day of the year as a heatmap. Tap <b>New habit</b> to add one.</p></section>`;
  const dates = Array.from({ length: 371 }, (_, i) => shiftDay(today, i - 370));
  const cards = habits.map((h) => {
    if (h.kind === "count") return countCard(h, dates, today);
    const st = habitStats(h);
    const grid = yearGrid(dates, (d) => {
      const v = st.map.get(d);
      const cls = v === undefined ? "hk-none" : goodDay(h, v) ? "hk-ok" : "hk-bad";
      const txt = v === undefined ? "not logged" : v ? "yes" : "no";
      return `<i class="${cls}${d === today ? " today" : ""}" data-hday="${d}" data-habit="${h.id}" title="${esc(parseDay(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }))}: ${txt}"></i>`;
    });
    return `<section class="card heat habitcard" data-hold="${h.id}" style="--c:${h.color}">
      <div class="hhead"><span class="hq"><i></i>${esc(h.name)}${h.kind === "avoid" ? ` <span class="kindtag">Avoid</span>` : ""}</span>
        <button class="icon-btn" data-edithabit="${h.id}" aria-label="Edit habit">${icon("more", 18)}</button></div>
      <div class="hstats num"><span><b>${st.current}</b> day streak</span><span>best <b>${st.best}</b></span><span><b>${st.good}</b> of last 30 days${h.kind === "avoid" ? " clean" : ""}</span></div>
      ${grid}
      <div class="hfoot"><span class="hinfo num">Tap a day to change it</span>
        <span class="hlegend">${h.kind === "avoid" ? "Didn't" : "Did"} <i class="hk-ok"></i> ${h.kind === "avoid" ? "Did" : "Didn't"} <i class="hk-bad"></i> Not logged <i class="hk-none"></i></span></div>
    </section>`;
  }).join("");
  app.innerHTML = `<h2 class="section"><span>Check in</span><button class="linkbtn" id="newhabit">${icon("plus", 16)}New habit</button></h2>
    ${check}${habits.length ? `<p class="hint holdhint">Press and hold a habit to edit or reorder it</p>` : ""}
    ${insightsHTML()}
    ${habits.length ? `<h2 class="section"><span>Year</span><span></span></h2>${cards}` : ""}`;

  $$(".hscroll", app).forEach((sc) => (sc.scrollLeft = sc.scrollWidth));
  $("#newhabit").onclick = () => openHabit();
  $("#hprev")?.addEventListener("click", () => { hDay = shiftDay(hDay, -1); renderHabits(); });
  $("#hnext")?.addEventListener("click", () => { hDay = shiftDay(hDay, 1); renderHabits(); });
  $$("[data-mark]").forEach((b) => b.onclick = () => {
    const v = b.dataset.v === "true";
    setMark(Number(b.dataset.mark), hDay, markOf(Number(b.dataset.mark), hDay) === v ? null : v);
  });
  // heatmap cells cycle: not logged → yes → no → not logged
  $$("[data-hday]").forEach((c) => c.onclick = () => {
    const id = Number(c.dataset.habit), d = c.dataset.hday, v = markOf(id, d);
    const next = v === undefined ? true : v === true ? false : null;
    setMark(id, d, next, true);
  });
  $$("[data-edithabit]").forEach((b) => b.onclick = () => openHabit(habitsData.habits.find((h) => h.id == b.dataset.edithabit)));
  $$("[data-hold]").forEach((el) => onHold(el, () => openHabit(habitsData.habits.find((h) => h.id == el.dataset.hold))));
  $$("[data-cadd]").forEach((b) => b.onclick = async () => {
    pendingAdds++;
    try { await addCount(Number(b.dataset.cadd), hDay, Number(b.dataset.d)); } finally { pendingAdds--; }
  });
  $$("[data-cset]").forEach((b) => b.onclick = () => openCountEdit(habitsData.habits.find((h) => h.id == b.dataset.cset), hDay));
  $$("[data-cday]").forEach((c) => c.onclick = () => openCountEdit(habitsData.habits.find((h) => h.id == c.dataset.habit), c.dataset.cday));
}
const nextHabitColor = () => {
  const used = new Set((habitsData?.habits || []).map((h) => h.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[(habitsData?.habits.length || 0) % PALETTE.length];
};

function countCard(h, dates, today) {
  const st = countStats(h);
  const max = Math.max(1, st.bestDay);
  const level = (n) => (!n ? 0 : h.target ? (n >= h.target ? 4 : Math.min(3, 1 + Math.floor((n / h.target) * 3))) : Math.min(4, Math.ceil((n / max) * 4)));
  const grid = yearGrid(dates, (d) => {
    const n = st.map.get(d) || 0;
    return `<i class="l${level(n)}${d === today ? " today" : ""}" data-cday="${d}" data-habit="${h.id}" title="${esc(parseDay(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }))}: ${n}"></i>`;
  });
  return `<section class="card heat habitcard" data-hold="${h.id}" style="--c:${h.color}">
    <div class="hhead"><span class="hq"><i></i>${esc(h.name)} <span class="kindtag">${h.target ? `${h.target}/day` : "Count"}</span></span>
      <button class="icon-btn" data-edithabit="${h.id}" aria-label="Edit">${icon("more", 18)}</button></div>
    <div class="hstats num"><span><b>${st.current}</b> day streak${h.target ? "" : " (any)"}</span><span>best <b>${st.best}</b></span>
      <span>this week <b>${st.week}</b></span><span>best day <b>${st.bestDay}</b></span><span>7-day avg <b>${st.avg7}</b></span></div>
    ${grid}
    <div class="hfoot"><span class="hinfo num">Tap a day to change it</span>
      <span class="hlegend">Less <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> ${h.target ? "Target" : "More"}</span></div>
  </section>`;
}

// counters: optimistic too; the server's number wins
async function addCount(id, day, delta) {
  const c = habitsData.counts.find((x) => x.habit_id === id && x.day === day);
  const before = c?.count || 0;
  const next = Math.max(0, before + delta);
  if (c) c.count = next; else habitsData.counts.push({ habit_id: id, day, count: next });
  const y = window.scrollY; renderHabits(); window.scrollTo(0, y);
  const h = habitsData.habits.find((x) => x.id === id);
  if (h.target && before < h.target && next >= h.target) toast(`${h.name}: target reached!`);
  try {
    const out = await api(`/habits/${id}/add`, { method: "POST", body: { day, delta } });
    const cc = habitsData.counts.find((x) => x.habit_id === id && x.day === day);
    // only the last of several quick taps syncs, so the number doesn't jump back mid-burst
    if (!out.queued && cc && cc.count !== out.count && pendingAdds === 1) { cc.count = out.count; renderHabits(); window.scrollTo(0, y); }
  } catch (e) { toast(e.message); habitsData = await api(`/habits?tz=${encodeURIComponent(tz)}`); renderHabits(); }
}
let pendingAdds = 0;
function openCountEdit(h, day) {
  const n = countOf(h.id, day);
  const label = day === habitsData.today ? "today" : parseDay(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>${esc(h.name)}, ${label}</h3>
    <form class="eform" id="countform">
      <label>How many?<input class="field num bigfield" type="number" name="n" min="0" max="10000000" value="${n || ""}" placeholder="0" inputmode="numeric"></label>
      ${h.target ? `<p class="hint" style="margin:0 4px">Target: ${h.target} a day</p>` : ""}
      <div class="eactions"><button type="button" class="btn ghost danger" id="cclear">Clear</button><span></span>
        <button type="button" class="btn ghost" id="ccancel">Cancel</button><button type="submit" class="btn">Save</button></div>
    </form>`;
  const f = $("#countform");
  const save = async (count) => {
    try {
      await api(`/habits/${h.id}/count`, { method: "PUT", body: { day, count } });
      habitsData.counts = habitsData.counts.filter((c) => !(c.habit_id === h.id && c.day === day));
      if (count) habitsData.counts.push({ habit_id: h.id, day, count });
      editSheet.close();
      const y = window.scrollY; renderHabits(); window.scrollTo(0, y);
    } catch (e) { toast(e.message); }
  };
  f.onsubmit = (ev) => { ev.preventDefault(); const v = Math.floor(Number(f.n.value) || 0); if (v < 0) return toast("Can't be negative"); save(v); };
  $("#cclear").onclick = () => save(0);
  $("#ccancel").onclick = () => editSheet.close();
  editSheet.showModal();
}

// optimistic: show it at once, undo if the server says no
async function setMark(id, day, value, announce) {
  const before = habitsData.marks.slice();
  habitsData.marks = habitsData.marks.filter((m) => !(m.habit_id === id && m.day === day));
  if (value !== null) habitsData.marks.push({ habit_id: id, day, value });
  const y = window.scrollY;
  renderHabits();
  window.scrollTo(0, y);
  if (announce) {
    const h = habitsData.habits.find((x) => x.id === id);
    toast(`${h.name}, ${parseDay(day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ${value === null ? "cleared" : value ? "yes" : "no"}`);
  }
  try { await api(`/habits/${id}/marks`, { method: "PUT", body: { day, value } }); }
  catch (e) { habitsData.marks = before; renderHabits(); toast(e.message); }
}

function openHabit(h) {
  const isNew = !h;
  let kind = h?.kind || "do", color = h?.color || nextHabitColor();
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>${isNew ? "New habit" : "Edit habit"}</h3>
    <form class="eform" id="habitform" autocomplete="off">
      <label>Name<input class="field" name="name" maxlength="60" placeholder="e.g. Ate sugar, or Pushups" value="${esc(h?.name || "")}"></label>
      <div class="seg" role="radiogroup" aria-label="Type">
        <button type="button" data-k="do">To do</button><button type="button" data-k="avoid">To avoid</button><button type="button" data-k="count">Count</button></div>
      <p class="hint" style="margin:-4px 4px 0" id="kindhint"></p>
      <div class="goalrow" id="countrow">
        <label>Daily target<input class="field num" type="number" name="target" min="1" max="100000" placeholder="none" value="${h?.target || ""}" inputmode="numeric"></label>
        <label>+ button adds<input class="field num" type="number" name="step" min="1" max="1000" value="${h?.step || 1}" inputmode="numeric"></label>
      </div>
      <div class="swatches">${PALETTE.map((c) => `<button type="button" class="sw" style="--c:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join("")}</div>
      ${isNew ? "" : `<div class="actmore"><span class="hint" style="margin:0">Position</span><span class="movebtns">
        <button type="button" class="icon-btn" id="hup" aria-label="Move up">${icon("up")}</button>
        <button type="button" class="icon-btn" id="hdown" aria-label="Move down">${icon("down")}</button></span></div>`}
      <div class="eactions">
        ${isNew ? "<span></span>" : `<button type="button" class="btn ghost danger" id="hdel">${icon("trash", 18)}Delete</button>`}
        <span></span><button type="button" class="btn ghost" id="hcancel">Cancel</button><button type="submit" class="btn">${isNew ? "Add" : "Save"}</button></div>
    </form>`;
  const f = $("#habitform");
  const sync = () => {
    $$("[data-k]", f).forEach((b) => b.setAttribute("aria-selected", b.dataset.k === kind));
    $$(".sw", f).forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === color));
    $("#kindhint").textContent = kind === "avoid" ? "A day counts as good when the answer is No."
      : kind === "count" ? "Count something each day, like pushups or glasses of water. A day counts as good when it reaches the target."
      : "A day counts as good when the answer is Yes.";
    $("#countrow").hidden = kind !== "count";
  };
  $$("[data-k]", f).forEach((b) => b.onclick = () => { kind = b.dataset.k; sync(); });
  $$(".sw", f).forEach((b) => b.onclick = () => { color = b.dataset.c; sync(); });
  sync();
  $("#hcancel").onclick = () => editSheet.close();
  if (!isNew) {
    const list = habitsData.habits, i = list.findIndex((x) => x.id === h.id);
    $("#hup").disabled = i <= 0;
    $("#hdown").disabled = i >= list.length - 1;
    const move = async (dir) => {
      try {
        await moveInList(list, h.id, dir, "/habits");
        habitsData = await api(`/habits?tz=${encodeURIComponent(tz)}`);
        renderHabits();
        openHabit(habitsData.habits.find((x) => x.id === h.id));
      } catch (e) { toast(e.message); }
    };
    $("#hup").onclick = () => move(-1);
    $("#hdown").onclick = () => move(1);
  }
  $("#hdel")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${h.name}" and every day you logged for it?`)) return;
    try { await api(`/habits/${h.id}`, { method: "DELETE" }); editSheet.close(); await load(); } catch (e) { toast(e.message); }
  });
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const name = f.name.value.trim().replace(/\?+$/, "");
    if (!name) return f.name.focus();
    try {
      const body = { name, kind, color };
      if (kind === "count") {
        const t = Math.floor(Number(f.target.value) || 0), st = Math.floor(Number(f.step.value) || 1);
        body.target = t >= 1 ? t : null;
        body.step = Math.min(1000, Math.max(1, st));
      }
      await api(isNew ? "/habits" : `/habits/${h.id}`, { method: isNew ? "POST" : "PUT", body });
      editSheet.close();
      await load();
    } catch (e) { toast(e.message); }
  };
  editSheet.showModal();
}
