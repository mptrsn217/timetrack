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

// redraw whichever page shows habit data, keeping the scroll position
function rerenderHabits() {
  const y = window.scrollY;
  if (view === "overview") renderOverview(); else renderHabits();
  window.scrollTo(0, y);
}

// ---------- Habits page: today's check-in, yes/no and counters in separate cards ----------
function renderHabits() {
  if (!habitsData) { app.innerHTML = `<div class="empty" style="margin-top:24px">Loading…</div>`; return; }
  const { habits, today } = habitsData;
  if (!hDay || hDay > today) hDay = today;
  const dayLabel = hDay === today ? "Today" : hDay === shiftDay(today, -1) ? "Yesterday"
    : parseDay(hDay).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  const binary = habits.filter((h) => h.kind !== "count"), counters = habits.filter((h) => h.kind === "count");
  const yesNoRow = (h) => {
    const v = markOf(h.id, hDay);
    return `<div class="hrow" data-hold="${h.id}" style="--c:${h.color}"><span class="hq"><i></i>${esc(h.name)}?${h.kind === "avoid" ? ` <span class="kindtag">Avoid</span>` : ""}</span>
      <span class="yn"><button type="button" data-mark="${h.id}" data-v="true" aria-pressed="${v === true}" class="${h.kind === "avoid" ? "bad" : "good"}">Yes</button>
      <button type="button" data-mark="${h.id}" data-v="false" aria-pressed="${v === false}" class="${h.kind === "avoid" ? "good" : "bad"}">No</button></span></div>`;
  };
  const counterRow = (h) => {
    const n = countOf(h.id, hDay), pct = h.target ? Math.min(1, n / h.target) : 0;
    return `<div class="hrow count" data-hold="${h.id}" style="--c:${h.color}">
      <span class="hq"><i></i>${esc(h.name)}${h.target ? `<small class="num">${n >= h.target ? "target reached · " : ""}${n} / ${h.target}</small>` : ""}</span>
      <span class="cnt">
        <button type="button" data-cadd="${h.id}" data-d="${-h.step}" aria-label="Minus ${h.step}" ${n ? "" : "disabled"}>−${h.step > 1 ? h.step : ""}</button>
        <button type="button" class="cval num" data-cset="${h.id}" aria-label="Set ${esc(h.name)}">${n}</button>
        <button type="button" class="plus" data-cadd="${h.id}" data-d="${h.step}">+${h.step}</button>
        <button type="button" class="plus" data-cadd="${h.id}" data-d="${h.step * 5}">+${h.step * 5}</button></span>
      ${h.target ? `<span class="cbar"><i style="width:${pct * 100}%"></i></span>` : ""}</div>`;
  };
  const dayNav = `<div class="card hdaynav daybar-nav"><button class="icon-btn" id="hprev" aria-label="Previous day">${icon("up", 18)}</button>
    <b>${dayLabel}</b><button class="icon-btn" id="hnext" aria-label="Next day" ${hDay >= today ? "disabled" : ""}>${icon("down", 18)}</button></div>`;
  app.innerHTML = `<h2 class="section"><span>Check in</span><button class="linkbtn" id="newhabit">${icon("plus", 16)}New habit</button></h2>
    ${habits.length ? dayNav : `<section class="card hcheck empty-h"><b>Habits and counters</b>
      <p class="hint" style="margin:4px 0 0">Yes/no questions like "Ate sugar?", or counters like pushups. Tap <b>New habit</b> to add one;
      their heatmaps and charts appear under Overview.</p></section>`}
    ${binary.length ? `<h2 class="section"><span>Yes / No</span><span></span></h2><section class="card hcheck">${binary.map(yesNoRow).join("")}</section>` : ""}
    ${counters.length ? `<h2 class="section"><span>Counters</span><span></span></h2><section class="card hcheck">${counters.map(counterRow).join("")}</section>` : ""}
    ${habits.length ? `<p class="hint holdhint">Press and hold a habit to edit or reorder it · heatmaps and charts are in Overview</p>` : ""}`;

  $("#newhabit").onclick = () => openHabit();
  $("#hprev")?.addEventListener("click", () => { hDay = shiftDay(hDay, -1); renderHabits(); });
  $("#hnext")?.addEventListener("click", () => { hDay = shiftDay(hDay, 1); renderHabits(); });
  $$("[data-mark]").forEach((b) => b.onclick = () => {
    const v = b.dataset.v === "true";
    setMark(Number(b.dataset.mark), hDay, markOf(Number(b.dataset.mark), hDay) === v ? null : v);
  });
  $$("[data-hold]").forEach((el) => onHold(el, () => openHabit(habitsData.habits.find((h) => h.id == el.dataset.hold))));
  $$("[data-cadd]").forEach((b) => b.onclick = async () => {
    pendingAdds++;
    try { await addCount(Number(b.dataset.cadd), hDay, Number(b.dataset.d)); } finally { pendingAdds--; }
  });
  $$("[data-cset]").forEach((b) => b.onclick = () => openCountEdit(habitsData.habits.find((h) => h.id == b.dataset.cset), hDay));
}

// ---------- Overview: a year heatmap per yes/no habit ----------
function habitYearCard(h, dates, today) {
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
}

// ---------- Overview: counters as day-by-day columns (30 days) or a line (90 days) ----------
const counterMode = {};
const niceTop = (v) => { const p = 10 ** Math.floor(Math.log10(Math.max(1, v))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v); };
function counterChartCard(h) {
  const st = countStats(h), today = habitsData.today, mode = counterMode[h.id] || "bars";
  const n = mode === "bars" ? 30 : 90;
  const days = Array.from({ length: n }, (_, i) => shiftDay(today, i - (n - 1)));
  const vals = days.map((d) => st.map.get(d) || 0);
  const avg7 = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  const W = 320, H = 132, L = 30, R = 6, T = 8, B = 20;
  const top = niceTop(Math.max(1, h.target || 0, ...vals));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const step = (W - L - R) / n, x = (i) => L + (i + 0.5) * step;
  const grid = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="cgrid"/>
    <text x="${L - 5}" y="${y(v) + 3.5}" class="clab" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`).join("");
  const target = h.target ? `<line x1="${L}" x2="${W - R}" y1="${y(h.target)}" y2="${y(h.target)}" class="ctarget"/>` : "";
  let marks;
  if (mode === "bars") {
    const bw = Math.max(2, step - 2);
    marks = vals.map((v, i) => v ? `<rect x="${x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="2"
      class="cbarr${h.target && v < h.target ? " under" : ""}${days[i] === today ? " today" : ""}"/>` : "").join("");
  } else {
    const pts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    marks = `<polyline points="${pts(vals)}" class="cdaily"/><polyline points="${pts(avg7)}" class="cavg"/>`;
  }
  const lab = (i, anchor) => `<text x="${x(i)}" y="${H - 5}" class="clab" text-anchor="${anchor}">${i === n - 1 ? "Today" : parseDay(days[i]).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>`;
  const hits = days.map((d, i) => `<rect x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}" class="chit" data-ci="${i}"/>`).join("");
  const legend = mode === "line"
    ? `<span class="clg"><i class="ld"></i>Daily</span><span class="clg"><i class="la"></i>7-day average</span>${h.target ? `<span class="clg"><i class="lt"></i>Target ${h.target}</span>` : ""}`
    : h.target ? `<span class="clg"><i class="lb"></i>Target reached</span><span class="clg"><i class="lu"></i>Below</span><span class="clg"><i class="lt"></i>Target ${h.target}</span>` : "";
  return `<section class="card counterchart" data-hold="${h.id}" data-counter="${h.id}" style="--c:${h.color}">
    <div class="hhead"><span class="hq"><i></i>${esc(h.name)} <span class="kindtag">${h.target ? `${h.target}/day` : "Count"}</span></span>
      <div class="seg small" role="tablist"><button data-cmode="bars" aria-selected="${mode === "bars"}">30 days</button><button data-cmode="line" aria-selected="${mode === "line"}">90 days</button></div></div>
    <div class="hstats num"><span>today <b>${st.today}</b></span><span>this week <b>${st.week}</b></span><span>7-day avg <b>${st.avg7}</b></span>
      <span>best day <b>${st.bestDay}</b></span><span><b>${st.current}</b> day streak</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="cchart" role="img" aria-label="${esc(h.name)}, last ${n} days">${grid}${target}${marks}
      <line class="ccross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>${lab(0, "start")}${lab(Math.floor(n / 2), "middle")}${lab(n - 1, "end")}${hits}</svg>
    <div class="hfoot"><span class="hinfo num cinfo">Tap a day to see it</span><span class="clegend">${legend}</span></div>
  </section>`;
}
function bindCounterCharts() {
  $$(".counterchart").forEach((card) => {
    const h = habitsData.habits.find((x) => x.id == card.dataset.counter);
    const mode = counterMode[h.id] || "bars", n = mode === "bars" ? 30 : 90, today = habitsData.today;
    const days = Array.from({ length: n }, (_, i) => shiftDay(today, i - (n - 1)));
    const st = countStats(h), vals = days.map((d) => st.map.get(d) || 0);
    $$("[data-cmode]", card).forEach((b) => b.onclick = () => { counterMode[h.id] = b.dataset.cmode; rerenderHabits(); });
    const info = $(".cinfo", card), cross = $(".ccross", card);
    const show = (i) => {
      const w = vals.slice(Math.max(0, i - 6), i + 1), avg = Math.round(w.reduce((a, b) => a + b, 0) / w.length);
      info.innerHTML = `${parseDay(days[i]).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: <b>${vals[i]}</b>${mode === "line" ? ` · 7-day avg ${avg}` : ""}
        <button class="linkbtn" data-cedit="${days[i]}">Change</button>`;
      const r = $(`[data-ci="${i}"]`, card);
      cross.setAttribute("x1", +r.getAttribute("x") + +r.getAttribute("width") / 2);
      cross.setAttribute("x2", cross.getAttribute("x1"));
      cross.style.display = "";
      $("[data-cedit]", info).onclick = () => openCountEdit(h, days[i]);
    };
    $$("[data-ci]", card).forEach((r) => {
      r.onclick = () => show(+r.dataset.ci);
      r.onpointerenter = (e) => { if (e.pointerType === "mouse") show(+r.dataset.ci); };
    });
  });
}
function bindHabitCards() {
  $$(".habitcard .hscroll").forEach((sc) => (sc.scrollLeft = sc.scrollWidth));
  // heatmap cells cycle: not logged → yes → no → not logged
  $$("[data-hday]").forEach((c) => c.onclick = () => {
    const id = Number(c.dataset.habit), d = c.dataset.hday, v = markOf(id, d);
    setMark(id, d, v === undefined ? true : v === true ? false : null, true);
  });
  $$("[data-edithabit]").forEach((b) => b.onclick = () => openHabit(habitsData.habits.find((h) => h.id == b.dataset.edithabit)));
  $$(".habitcard[data-hold], .counterchart[data-hold]").forEach((el) => onHold(el, () => openHabit(habitsData.habits.find((h) => h.id == el.dataset.hold))));
  bindCounterCharts();
}
function habitsOverviewHTML() {
  if (!habitsData?.habits.length) return "";
  const today = habitsData.today;
  const dates = Array.from({ length: 371 }, (_, i) => shiftDay(today, i - 370));
  const binary = habitsData.habits.filter((h) => h.kind !== "count"), counters = habitsData.habits.filter((h) => h.kind === "count");
  return `${binary.length ? `<h2 class="section"><span>Habits</span><span></span></h2>${binary.map((h) => habitYearCard(h, dates, today)).join("")}` : ""}
    ${counters.length ? `<h2 class="section"><span>Counters</span><span></span></h2>${counters.map(counterChartCard).join("")}` : ""}
    ${insightsHTML()}`;
}

const nextHabitColor = () => {
  const used = new Set((habitsData?.habits || []).map((h) => h.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[(habitsData?.habits.length || 0) % PALETTE.length];
};

// counters: optimistic too; the server's number wins
async function addCount(id, day, delta) {
  const c = habitsData.counts.find((x) => x.habit_id === id && x.day === day);
  const before = c?.count || 0;
  const next = Math.max(0, before + delta);
  if (c) c.count = next; else habitsData.counts.push({ habit_id: id, day, count: next });
  rerenderHabits();
  const h = habitsData.habits.find((x) => x.id === id);
  if (h.target && before < h.target && next >= h.target) toast(`${h.name}: target reached!`);
  try {
    const out = await api(`/habits/${id}/add`, { method: "POST", body: { day, delta } });
    const cc = habitsData.counts.find((x) => x.habit_id === id && x.day === day);
    // only the last of several quick taps syncs, so the number doesn't jump back mid-burst
    if (!out.queued && cc && cc.count !== out.count && pendingAdds === 1) { cc.count = out.count; rerenderHabits(); }
  } catch (e) { toast(e.message); habitsData = await api(`/habits?tz=${encodeURIComponent(tz)}`); rerenderHabits(); }
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
      rerenderHabits();
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
  rerenderHabits();
  if (announce) {
    const h = habitsData.habits.find((x) => x.id === id);
    toast(`${h.name}, ${parseDay(day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ${value === null ? "cleared" : value ? "yes" : "no"}`);
  }
  try { await api(`/habits/${id}/marks`, { method: "PUT", body: { day, value } }); }
  catch (e) { habitsData.marks = before; rerenderHabits(); toast(e.message); }
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
        rerenderHabits();
        openHabit(habitsData.habits.find((x) => x.id === h.id));
      } catch (e) { toast(e.message); }
    };
    $("#hup").onclick = () => move(-1);
    $("#hdown").onclick = () => move(1);
  }
  $("#hdel")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${h.name}" and every day you logged for it? It disappears from every summary. This can't be undone.`)) return;
    try { await api(`/habits/${h.id}`, { method: "DELETE" }); editSheet.close(); forgetSummaries(); await load(); toast(`Deleted ${h.name}`); } catch (e) { toast(e.message); }
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
