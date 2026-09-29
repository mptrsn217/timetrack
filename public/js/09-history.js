/* ---------- history ---------- */
const DAYS = 14;
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const entryEnd = (e) => (e.stopped_at ? new Date(e.stopped_at).getTime() : now());
const dur = (e) => (entryEnd(e) - new Date(e.started_at)) / 1000;
const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

let summary = { week: null, month: null };
let searchQ = "", searchResults = null;
const CHART_MODES = [["days", "Days"], ["weeks", "Weeks"], ["months", "Months"], ["timeline", "Timeline"]];
let chartMode = "days";
try {
  const saved = localStorage.getItem("chartMode") || (localStorage.getItem("dailyMode") === "timeline" ? "timeline" : "");
  if (CHART_MODES.some(([m]) => m === saved)) chartMode = saved;
} catch {}

let dayLoadedAt = 0;
async function loadHistoryData() {
  // the year of days for the heatmap changes slowly; refresh it at most every 5 minutes
  if (Date.now() - dayLoadedAt > 5 * 60e3) {
    dayLoadedAt = Date.now();
    api(`/summary?bucket=day&count=371&tz=${encodeURIComponent(tz)}`).then((d) => { summary.day = d; if (view === "overview" && !editing()) renderOverview(); })
      .catch(() => (dayLoadedAt = 0));
  }
  const jobs = [api("/entries?days=14"), api(`/summary?bucket=week&count=12&tz=${encodeURIComponent(tz)}`)];
  if (chartMode === "months") jobs.push(api(`/summary?bucket=month&count=12&tz=${encodeURIComponent(tz)}`));
  const [e, w, m] = await Promise.all(jobs);
  entries = e; summary.week = w; if (m) summary.month = m;
}

// seconds per activity per calendar day, splitting entries that cross midnight
function dailyTotals() {
  const first = addDays(dayStart(new Date()), -(DAYS - 1));
  const days = Array.from({ length: DAYS }, (_, i) => ({ date: addDays(first, i), by: new Map(), total: 0 }));
  for (const e of entries) {
    const s = new Date(e.started_at).getTime(), end = entryEnd(e);
    for (const d of days) {
      const a = d.date.getTime(), b = addDays(d.date, 1).getTime();
      const v = (Math.min(end, b) - Math.max(s, a)) / 1000;
      if (v > 0) { d.by.set(e.activity_id, (d.by.get(e.activity_id) || 0) + v); d.total += v; }
    }
  }
  return days;
}

// activities in the user's own order (archived ones last), limited to those with data
function orderSeries(list) {
  const order = state.activities.map((a) => a.id);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : 1e6 + id);
  return list.map((s) => ({ ...s, ...(state.activities.find((a) => a.id === s.id) || {}) })).sort((a, b) => rank(a.id) - rank(b.id));
}
function chartSeries() {
  const seen = new Map();
  for (const e of entries) if (!seen.has(e.activity_id)) seen.set(e.activity_id, { id: e.activity_id, name: e.name, color: e.color });
  return orderSeries([...seen.values()]);
}

// columns for the bar chart: { by, total, current, top, bottom, title }
function chartData(mode) {
  if (mode === "days") {
    const todayKey = dayStart(new Date()).getTime();
    return {
      unit: "day", series: chartSeries(),
      cols: dailyTotals().map((d) => ({
        ...d, current: d.date.getTime() === todayKey,
        top: d.date.toLocaleDateString(undefined, { weekday: "narrow" }), bottom: d.date.getDate(),
        title: d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      })),
    };
  }
  const sm = summary[mode === "weeks" ? "week" : "month"];
  if (!sm) return null;
  const cols = sm.buckets.map((b, i) => {
    const date = parseDay(b), prev = i ? parseDay(sm.buckets[i - 1]) : null;
    const newMonth = !prev || prev.getMonth() !== date.getMonth();
    return mode === "weeks"
      ? { key: b, by: new Map(), total: 0, current: i === sm.buckets.length - 1,
          top: newMonth ? date.toLocaleDateString(undefined, { month: "short" }) : "", bottom: date.getDate(),
          title: `Week of ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}` }
      : { key: b, by: new Map(), total: 0, current: i === sm.buckets.length - 1,
          top: date.toLocaleDateString(undefined, { month: "narrow" }),
          bottom: !prev || date.getMonth() === 0 ? String(date.getFullYear()).slice(2) : "",
          title: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  });
  const idx = new Map(sm.buckets.map((b, i) => [b, i]));
  const seen = new Set();
  for (const r of sm.rows) {
    const c = cols[idx.get(r.bucket)];
    if (!c) continue;
    c.by.set(r.activity_id, (c.by.get(r.activity_id) || 0) + r.seconds);
    c.total += r.seconds;
    seen.add(r.activity_id);
  }
  const series = orderSeries(sm.activities.filter((a) => seen.has(a.id)).map((a) => ({ id: a.id, name: a.name, color: a.color })));
  return { unit: mode === "weeks" ? "week" : "month", series, cols };
}

function niceStepHours(maxH) {
  for (const s of [0.5, 1, 2, 3, 4, 6, 8, 12, 24, 48, 96, 168, 336]) if (maxH / s <= 4) return s;
  return 720;
}

let chartCols = [], chartSeriesList = [];
function renderBars({ cols, series }) {
  const maxH = Math.max(1, ...cols.map((d) => d.total / 3600));
  const step = niceStepHours(maxH);
  const top = Math.ceil(maxH / step) * step;
  const H = 150;
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  chartCols = cols; chartSeriesList = series;
  const bars = cols.map((d, i) => {
    const segs = series.filter((s) => d.by.get(s.id) > 0)
      .map((s) => `<span style="--c:${s.color};height:${(d.by.get(s.id) / 3600 / top) * H}px"></span>`).join("");
    return `<button class="col${d.current ? " today" : ""}" data-col="${i}" aria-label="${esc(d.title)}: ${fmtShort(d.total)}">
      <span class="stack" style="height:${H}px">${segs ? `<span class="segs">${segs}</span>` : ""}</span>
      <span class="xl"><b>${d.top || "&nbsp;"}</b>${d.bottom || "&nbsp;"}</span></button>`;
  }).join("");
  const grid = ticks.map((t) => `<div class="gl" style="bottom:${(t / top) * H}px"><span>${t ? (t % 1 ? `${t * 60}m` : `${t}h`) : ""}</span></div>`).join("");
  return `<div class="plot" style="height:${H}px">${grid}<div class="cols" style="grid-template-columns:repeat(${cols.length},1fr)">${bars}</div></div>`;
}

function renderChartCard() {
  const toggle = `<div class="seg" role="tablist" aria-label="Chart view">${CHART_MODES.map(([m, label]) =>
    `<button role="tab" data-mode="${m}" aria-selected="${chartMode === m}">${label}</button>`).join("")}</div>`;
  const data = chartData(chartMode === "timeline" ? "days" : chartMode);
  let body, avgText = "";
  if (!data) {
    body = `<div class="empty" style="box-shadow:none">Loading…</div>`;
  } else {
    const active = data.cols.filter((c) => c.total > 0);
    const avg = active.length ? active.reduce((s, c) => s + c.total, 0) / active.length : 0;
    if (avg) avgText = `avg ${fmtShort(avg)} / ${data.unit}`;
    body = chartMode === "timeline" ? renderTimeline(data.cols) : renderBars(data);
  }
  const legend = (data?.series || []).map((s) => `<span class="lg" style="--c:${s.color}"><i></i>${esc(s.name)}</span>`).join("");
  return `<h2 class="section"><span>Overview</span><span class="num">${avgText}</span></h2>
    <div class="card chart">${toggle}${body}${legend ? `<div class="legend">${legend}</div>` : ""}<div class="tip" id="tip" hidden></div></div>`;
}

// one row per day, 00:00 on the left to 24:00 on the right, so the same clock time lines up across days
function renderTimeline(days) {
  const todayKey = dayStart(new Date()).getTime();
  const rows = [...days].reverse().map((d) => {
    const a = d.date.getTime(), b = addDays(d.date, 1).getTime(), span = b - a;
    const blocks = entries.map((e) => {
      const s = Math.max(new Date(e.started_at).getTime(), a), t = Math.min(entryEnd(e), b);
      if (t <= s) return "";
      const title = `${e.name} ${clock(e.started_at)}–${e.stopped_at ? clock(e.stopped_at) : "now"} (${fmtShort(dur(e))})${e.note ? " · " + e.note : ""}`;
      return `<button class="blk" data-entry="${e.id}" style="--c:${e.color};left:${((s - a) / span) * 100}%;width:${((t - s) / span) * 100}%" title="${esc(title)}" aria-label="${esc(title)}"></button>`;
    }).join("");
    const isToday = a === todayKey;
    const nowMark = isToday ? `<span class="tl-now" style="left:${((now() - a) / span) * 100}%"></span>` : "";
    return `<div class="tl-row${isToday ? " today" : ""}">
      <span class="tl-d num">${d.date.toLocaleDateString(undefined, { weekday: "short" })} ${d.date.getDate()}</span>
      <div class="tl-track">${blocks}${nowMark}</div></div>`;
  }).join("");
  const axis = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, "0")}</span>`).join("");
  return `<div class="tl">${rows}<div class="tl-row axis"><span class="tl-d"></span><div class="tl-axis num">${axis}</div></div></div>`;
}

function bindChart() {
  $$(".seg button").forEach((b) => b.onclick = async () => {
    chartMode = b.dataset.mode;
    try { localStorage.setItem("chartMode", chartMode); } catch {}
    renderOverview();
    if (chartMode === "months" && !summary.month) {
      try { summary.month = await api(`/summary?bucket=month&count=12&tz=${encodeURIComponent(tz)}`); renderOverview(); }
      catch (e) { toast(e.message); }
    }
  });
  const tip = $("#tip"), chart = $(".chart");
  if (!tip || chartMode === "timeline") return;
  let pinned = null;
  const show = (btn) => {
    const d = chartCols[btn.dataset.col];
    const rows = chartSeriesList.filter((s) => d.by.get(s.id) > 0).reverse()
      .map((s) => `<div class="tr" style="--c:${s.color}"><i></i><span>${esc(s.name)}</span><b class="num">${fmtShort(d.by.get(s.id))}</b></div>`).join("");
    tip.innerHTML = `<div class="th"><span>${esc(d.title)}</span><b class="num">${fmtShort(d.total)}</b></div>${rows || `<div class="tr muted">Nothing tracked</div>`}`;
    tip.hidden = false;
    $$(".col", chart).forEach((c) => c.classList.toggle("sel", c === btn));
    const cr = chart.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(br.left - cr.left + br.width / 2 - w / 2, 8), cr.width - w - 8)}px`;
  };
  const hide = () => { tip.hidden = true; $$(".col", chart).forEach((c) => c.classList.remove("sel")); };
  $$(".col", chart).forEach((btn) => {
    btn.onpointerenter = (e) => { if (e.pointerType === "mouse" && !pinned) show(btn); };
    btn.onpointerleave = (e) => { if (e.pointerType === "mouse" && !pinned) hide(); };
    btn.onclick = () => { if (pinned === btn) { pinned = null; hide(); } else { pinned = btn; show(btn); } };
  });
}

// this week per activity, with the change from last week; "better" depends on whether it's a habit to cut back
function renderCompare() {
  const sm = summary.week;
  if (!sm || sm.buckets.length < 2) return "";
  const [prevKey, curKey] = sm.buckets.slice(-2);
  const cur = new Map(), prev = new Map();
  for (const r of sm.rows) {
    if (r.bucket === curKey) cur.set(r.activity_id, (cur.get(r.activity_id) || 0) + r.seconds);
    if (r.bucket === prevKey) prev.set(r.activity_id, (prev.get(r.activity_id) || 0) + r.seconds);
  }
  const acts = sm.activities.filter((a) => (cur.get(a.id) || 0) > 0 || (!a.archived && (prev.get(a.id) || 0) > 0))
    .map((a) => ({ ...a, v: cur.get(a.id) || 0, p: prev.get(a.id) || 0 })).sort((a, b) => b.v - a.v || b.p - a.p);
  const totalCur = [...cur.values()].reduce((s, v) => s + v, 0);
  const max = Math.max(1, ...acts.map((a) => Math.max(a.v, a.p)));
  const rows = acts.map((a) => {
    const diff = a.v - a.p;
    let delta, cls = "";
    if (Math.abs(diff) < 60) delta = "same as last week";
    else if (!a.p) delta = "new this week";
    else {
      const up = diff > 0;
      cls = (up === (a.kind !== "limit")) ? "better" : "worse";
      delta = `${up ? "▲" : "▼"} ${fmtShort(Math.abs(diff))} vs last week`;
    }
    return `<div style="--c:${a.color}">
      <div class="l"><span>${esc(a.name)}${a.kind === "limit" ? ` <span class="kindtag">Cut back</span>` : ""}</span><span class="num">${fmtShort(a.v)}</span></div>
      <div class="track"><div class="fill" style="width:${(a.v / max) * 100}%"></div><div class="prev" style="left:${(a.p / max) * 100}%" title="Last week"></div></div>
      <div class="delta num ${cls}">${delta}</div></div>`;
  }).join("");
  return `<h2 class="section"><span>This week vs last</span><span class="num">${fmtShort(totalCur)}</span></h2>
    ${acts.length ? `<div class="card wk">${rows}</div><p class="hint">The thin mark on each bar is last week's total.</p>` : `<div class="empty">Nothing tracked this week or last.</div>`}`;
}

function reviewCard() {
  const sm = summary.week;
  const cur = sm ? sm.rows.filter((r) => r.bucket === sm.buckets[sm.buckets.length - 1]).reduce((x, r) => x + r.seconds, 0) : 0;
  return `<button class="reviewcard" id="openreview">${icon("chart", 20)}<span><b>Weekly review</b>
    <small>${cur ? `This week so far · ${fmtShort(cur)}` : "Your week in numbers"}</small></span><span class="chev">›</span></button>`;
}

// ---------- calendar heatmap: a year of days, darker = more time ----------
let heatFilter = "all";
function renderHeatmap() {
  const sm = summary.day;
  if (!sm) return `<h2 class="section"><span>Year</span></h2><div class="empty">Loading…</div>`;
  const seen = new Set(sm.rows.map((r) => r.activity_id));
  const acts = sm.activities.filter((a) => seen.has(a.id));
  if (heatFilter !== "all" && !acts.some((a) => a.id == heatFilter)) heatFilter = "all";
  const act = acts.find((a) => a.id == heatFilter);
  const byDay = new Map();
  for (const r of sm.rows) if (heatFilter === "all" || r.activity_id == heatFilter) byDay.set(r.bucket, (byDay.get(r.bucket) || 0) + r.seconds);
  const max = Math.max(1, ...byDay.values());
  const level = (v) => (v < 60 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const dates = sm.buckets;
  const pad = (parseDay(dates[0]).getDay() + 6) % 7; // weeks start on Monday
  const cells = [...Array(pad).fill(null), ...dates];
  const weeks = Math.ceil(cells.length / 7);
  let months = "", prevMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const d = cells.slice(w * 7, w * 7 + 7).find(Boolean);
    const m = d ? parseDay(d).getMonth() : prevMonth;
    months += `<span>${m !== prevMonth && w < weeks - 1 ? parseDay(d).toLocaleDateString(undefined, { month: "short" }) : ""}</span>`;
    prevMonth = m;
  }
  const grid = cells.map((d) => d
    ? `<i class="l${level(byDay.get(d) || 0)}" data-d="${d}" title="${esc(parseDay(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }))}: ${fmtShort(byDay.get(d) || 0)}"></i>`
    : "<i class=\"pad\"></i>").join("");
  // days tracked and longest run of consecutive tracked days
  let tracked = 0, run = 0, best = 0;
  for (const d of dates) { if ((byDay.get(d) || 0) >= 60) { tracked++; run++; best = Math.max(best, run); } else run = 0; }
  const chips = [`<button type="button" class="hchip" data-h="all" aria-pressed="${heatFilter === "all"}">All</button>`,
    ...acts.map((a) => `<button type="button" class="hchip" data-h="${a.id}" style="--c:${a.color}" aria-pressed="${heatFilter == a.id}"><i></i>${esc(a.name)}</button>`)].join("");
  return `<h2 class="section"><span>Time, year</span><span class="num">${tracked} days tracked</span></h2>
    <div class="card heat" style="--c:${act ? act.color : "var(--accent)"}">
      <div class="hchips">${chips}</div>
      <div class="hscroll" id="hscroll"><div class="hwrap">
        <div class="hdays"><span></span><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span></div>
        <div><div class="hmonths" style="grid-template-columns:repeat(${weeks}, var(--cell))">${months}</div>
        <div class="hgrid">${grid}</div></div></div></div>
      <div class="hfoot"><span id="hinfo" class="num">${best >= 2 ? `Longest streak: ${best} days` : "Tap a day for its total"}</span>
        <span class="hlegend">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</span></div>
    </div>`;
}
function bindHeatmap() {
  const sc = $("#hscroll");
  if (sc) sc.scrollLeft = sc.scrollWidth; // most recent weeks first in view
  $$(".hchip").forEach((b) => b.onclick = () => { heatFilter = b.dataset.h; renderOverview(); });
  $$(".hgrid i[data-d]").forEach((c) => c.onclick = () => {
    $$(".hgrid i.sel").forEach((x) => x.classList.remove("sel"));
    c.classList.add("sel");
    $("#hinfo").textContent = c.title;
  });
}

// ---------- weekly review ----------
async function openReview(start) {
  sheet.close();
  let r;
  try { r = await api(`/review?tz=${encodeURIComponent(tz)}${start ? `&start=${start}` : ""}`); } catch (e) { return toast(e.message); }
  const shift = (d, n) => { const x = parseDay(d); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const fmtD = (d, o) => parseDay(d).toLocaleDateString(undefined, o);
  const diff = r.total - r.prevTotal;
  const delta = (v, p, limit) => {
    if (!p && !v) return "";
    if (!p) return `<span class="delta">new</span>`;
    const d = v - p;
    if (Math.abs(d) < 60) return `<span class="delta">same</span>`;
    return `<span class="delta ${(d > 0) === !limit ? "better" : "worse"}">${d > 0 ? "▲" : "▼"} ${fmtShort(Math.abs(d))}</span>`;
  };
  const maxDay = Math.max(1, ...r.days.map((d) => d.seconds));
  const goals = r.activities.filter((a) => a.goal);
  const goalRow = (a) => {
    const g = a.goal, limit = a.kind === "limit";
    const target = `${limit ? "limit" : "goal"} ${fmtShort(g.minutes * 60)} / ${g.period}`;
    const ok = g.period === "week" ? g.met : g.daysMet === g.days;
    const text = g.period === "week" ? (g.met ? (limit ? "Stayed under" : "Reached") : (limit ? "Went over" : "Not reached")) : `${g.daysMet} of ${g.days} days`;
    return `<div class="rvrow" style="--c:${a.color}"><span class="rvname"><i></i>${esc(a.name)}<small>${target}</small></span>
      <span class="rvval ${ok ? "better" : g.period === "day" && g.daysMet ? "" : "worse"}">${ok ? icon("check", 14) : ""}${text}</span></div>`;
  };
  const topStreak = Object.entries(state.streaks || {}).map(([id, s]) => ({ a: state.activities.find((x) => x.id == id), ...s }))
    .filter((x) => x.a && x.current >= 2).sort((a, b) => b.current - a.current)[0];
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div>
    <div class="rvhead"><button type="button" class="icon-btn" id="rvprev" aria-label="Previous week">${icon("up", 18)}</button>
      <h3 tabindex="-1" autofocus>${r.current ? "This week" : "Week of " + fmtD(r.start, { day: "numeric", month: "short" })}<small>${fmtD(r.start, { day: "numeric", month: "short" })} – ${fmtD(r.end, { day: "numeric", month: "short" })}</small></h3>
      <button type="button" class="icon-btn" id="rvnext" aria-label="Next week" ${r.current ? "disabled" : ""}>${icon("down", 18)}</button></div>
    <div class="eform review">
      <div class="rvtotal"><b class="num">${fmtShort(r.total)}</b>${r.prevTotal ? `<span class="delta ${diff >= 0 ? "better" : ""}">${diff >= 0 ? "▲" : "▼"} ${fmtShort(Math.abs(diff))} vs the week before</span>` : "<span class=\"delta\">tracked</span>"}</div>
      <div class="rvdays">${r.days.map((d) => `<span title="${fmtShort(d.seconds)}"><i style="height:${Math.max(d.seconds ? 4 : 0, (d.seconds / maxDay) * 56)}px"></i>
        <small>${fmtD(d.date, { weekday: "narrow" })}</small></span>`).join("")}</div>
      <div class="rvfacts">
        <span><b class="num">${r.daysTracked}</b> of ${r.daysElapsed} days tracked</span>
        ${r.bestDay ? `<span>Best day <b>${fmtD(r.bestDay.date, { weekday: "long" })}</b> · ${fmtShort(r.bestDay.seconds)}</span>` : ""}
        ${topStreak ? `<span>Streak going: <b>${esc(topStreak.a.name)}</b> ${topStreak.current} days${topStreak.a.kind === "limit" ? " under limit" : ""}</span>` : ""}
      </div>
      ${r.activities.some((a) => a.seconds) ? `<div class="label">Activities</div>${r.activities.filter((a) => a.seconds || a.prev).map((a) => `
        <div class="rvrow" style="--c:${a.color}"><span class="rvname"><i></i>${esc(a.name)}</span>
        <span class="rvval num">${fmtShort(a.seconds)} ${delta(a.seconds, a.prev, a.kind === "limit")}</span></div>`).join("")}` : `<p class="hint">Nothing tracked this week.</p>`}
      ${goals.length ? `<div class="label">Goals</div>${goals.map(goalRow).join("")}` : ""}
      <div class="eactions"><span></span><span></span><span></span><button type="button" class="btn ghost" id="rvclose">Close</button></div>
    </div>`;
  $("#rvprev").onclick = () => openReview(shift(r.start, -7));
  $("#rvnext").onclick = () => openReview(shift(r.start, 7));
  $("#rvclose").onclick = () => editSheet.close();
  if (!editSheet.open) editSheet.showModal();
}

// Overview: everything for looking back (time, habits, counters, connections)
function renderOverview() {
  app.innerHTML = reviewCard() + renderChartCard() + renderCompare() + renderHeatmap() + habitsOverviewHTML();
  bindChart();
  bindHeatmap();
  bindHabitCards();
  $("#openreview").onclick = () => openReview();
  $$(".blk").forEach((b) => b.onclick = () => openEntry(findEntry(b.dataset.entry)));
}

// History: the list of tracked entries
function renderHistory() {
  const html = `
    <h2 class="section"><span>Entries</span><button class="linkbtn" id="addentry">${icon("plus", 16)}Add entry</button></h2>
    <div class="search">${icon("search", 18)}<input class="field" id="search" type="search" placeholder="Search notes and activities" value="${esc(searchQ)}" enterkeyhint="search"></div>
    <div id="entrylist"></div>`;
  app.innerHTML = html;
  renderEntryList();
  $("#addentry").onclick = () => openEntry(null);
  let t;
  $("#search").oninput = (ev) => {
    clearTimeout(t);
    const v = ev.target.value.trim();
    t = setTimeout(async () => {
      searchQ = v;
      if (v.length < 2) { searchResults = null; return renderEntryList(); }
      try { searchResults = await api(`/entries?q=${encodeURIComponent(v)}`); } catch (e) { return toast(e.message); }
      if (searchQ === v) renderEntryList();
    }, 250);
  };
}

const findEntry = (id) => (searchResults || []).concat(entries).find((e) => e.id == id);

function renderEntryList() {
  const list = searchResults ?? entries;
  const box = $("#entrylist");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="empty">${searchResults ? "No entries match." : "No entries in the last 14 days."}</div>`;
    return;
  }
  const days = new Map();
  for (const e of list) {
    const key = new Date(e.started_at).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(e);
  }
  const todayKey = new Date().toDateString(), yKey = addDays(new Date(), -1).toDateString();
  let html = searchResults ? `<p class="hint" style="margin-top:0">${plural(list.length, "match")}${list.length === 200 ? " (showing the latest 200)" : ""}</p>` : "";
  for (const [key, items] of days) {
    const d = new Date(key);
    const label = key === todayKey ? "Today" : key === yKey ? "Yesterday"
      : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
    html += `<div class="day"><b>${label}</b><span class="num">${fmtShort(items.reduce((s, e) => s + dur(e), 0))}</span></div><div class="card">`;
    html += items.map((e) => `<div class="swipe">${e.stopped_at ? `<div class="swipe-bg" aria-hidden="true"><span>${icon("trash", 16)}Delete</span><span>Delete${icon("trash", 16)}</span></div>` : ""}
        <button class="rowi entry" data-entry="${e.id}" style="--c:${e.color}" aria-label="Edit ${esc(e.name)} entry">
        <span class="bar"></span>
        <span><div>${esc(e.name)}</div><div class="t num">${clock(e.started_at)} – ${e.stopped_at ? clock(e.stopped_at) : "now"}</div>
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}</span>
        <span class="right"><span class="d num">${fmtShort(dur(e))}</span><span class="chev">${icon("edit", 16)}</span></span></button></div>`).join("");
    html += `</div>`;
  }
  if (!searchResults) html += `<p class="hint">Tap an entry to change its times, activity or note. Swipe it left or right to delete.</p>`;
  box.innerHTML = html;
  $$("[data-entry]", box).forEach((b) => {
    b.onclick = () => { if (!b.dataset.swiped) openEntry(findEntry(b.dataset.entry)); };
    const e = findEntry(b.dataset.entry);
    if (e?.stopped_at) enableSwipe(b, () => deleteWithUndo(e));
  });
}

// Horizontal drag on a row; past ~35% of its width it deletes, otherwise it springs back.
// Vertical movement is left to the browser (touch-action: pan-y) so the list still scrolls.
function enableSwipe(row, onDelete) {
  const bg = row.previousElementSibling;
  let x0 = 0, y0 = 0, dx = 0, id = null, dragging = false;
  const set = (x, cls) => {
    row.className = row.className.replace(/ ?(moving|settle)/g, "") + (cls ? " " + cls : "");
    row.style.transform = x ? `translateX(${x}px)` : "";
    row.parentElement.classList.toggle("swiping", !!x);
  };
  row.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    id = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; dx = 0; dragging = false;
    delete row.dataset.swiped;
  });
  row.addEventListener("pointermove", (ev) => {
    if (ev.pointerId !== id) return;
    const mx = ev.clientX - x0, my = ev.clientY - y0;
    if (!dragging) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { id = null; return; } // it's a scroll
      if (Math.abs(mx) < 10) return;
      dragging = true;
      try { row.setPointerCapture(id); } catch {}
    }
    dx = mx;
    set(dx, "moving");
    bg?.classList.toggle("ready", Math.abs(dx) > row.offsetWidth * 0.35);
  });
  const end = (ev) => {
    if (ev.pointerId !== id) return;
    id = null;
    if (!dragging) return;
    row.dataset.swiped = "1"; // swallow the click that follows the drag
    setTimeout(() => delete row.dataset.swiped, 50);
    if (Math.abs(dx) > row.offsetWidth * 0.35) {
      set(Math.sign(dx) * row.offsetWidth * 1.1, "settle");
      setTimeout(onDelete, 180);
    } else {
      set(0, "settle");
      bg?.classList.remove("ready");
    }
  };
  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
}

async function deleteWithUndo(e) {
  try { await api(`/entries/${e.id}`, { method: "DELETE" }); }
  catch (err) { toast(err.message); return renderEntryList(); }
  entries = entries.filter((x) => x.id !== e.id);
  if (searchResults) searchResults = searchResults.filter((x) => x.id !== e.id);
  renderHistory();
  toast(`Deleted ${e.name} ${fmtShort(dur(e))}`, {
    label: "Undo",
    run: async () => {
      try {
        await api("/entries", { method: "POST", body: { activity_id: e.activity_id, started_at: e.started_at, stopped_at: e.stopped_at, note: e.note } });
        await refreshAfterEdit();
        toast("Entry restored");
      } catch (err) { toast(err.message); }
    },
  });
  load({ background: true });
}
