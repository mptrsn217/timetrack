/* ---------- activities: add from Track, press and hold a tile to edit ---------- */
function pickColor() {
  if (newColor) return newColor;
  const used = new Set(state.activities.map((a) => a.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[state.activities.length % PALETTE.length];
}

// Press and hold (about half a second) runs `fn` instead of the normal tap. Moving the finger cancels,
// so scrolling over a tile never opens anything; the tap that ends a hold is swallowed.
function onHold(el, fn) {
  let timer = null, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove("holding"); };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    x0 = e.clientX; y0 = e.clientY;
    el.classList.add("holding");
    timer = setTimeout(() => {
      timer = null;
      el.classList.remove("holding");
      el.dataset.held = "1";
      setTimeout(() => delete el.dataset.held, 600);
      navigator.vibrate?.(15);
      fn();
    }, 480);
  });
  el.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press menus on phones
  // capture phase: runs before the element's own click handler
  el.addEventListener("click", (e) => { if (el.dataset.held) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

// swap an item with its neighbour and save everyone's position
async function moveInList(list, id, dir, path) {
  const order = list.map((x) => x.id);
  const i = order.indexOf(id), j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await Promise.all(order.map((oid, k) => api(`${path}/${oid}`, { method: "PUT", body: { sort: k } })));
}

function openActivity(a) {
  const isNew = !a;
  let color = a?.color || pickColor(), kind = a?.kind || "good", mastery = !!a?.mastery;
  const acts = state.activities, idx = a ? acts.findIndex((x) => x.id === a.id) : -1;
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>${isNew ? "New activity" : "Edit activity"}</h3>
    <form class="eform" id="actform" autocomplete="off">
      <label>Name<input class="field" name="name" maxlength="60" placeholder="e.g. Deep work" value="${esc(a?.name || "")}" enterkeyhint="done"></label>
      <div class="swatches" role="radiogroup" aria-label="Color">${PALETTE.map((c) =>
        `<button type="button" class="sw" style="--c:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join("")}</div>
      <button type="button" class="chip" id="actkind"><span class="box" aria-hidden="true"></span>Habit to cut back</button>
      <button type="button" class="chip" id="actmastery"><span class="box" aria-hidden="true"></span>10,000-hour mastery</button>
      <label id="actbase">Hours already practised before Moonglare
        <input class="field num" type="number" name="base" min="0" max="9999" inputmode="numeric" placeholder="0" value="${a?.mastery_base_hours || ""}"></label>
      ${isNew ? "" : `<div class="actmore">
        <button type="button" class="btn ghost" id="actgoal">${icon("flag", 16)}${goalLabel(a)}</button>
        <span class="movebtns">
          <button type="button" class="icon-btn" id="actup" aria-label="Move up" ${idx <= 0 ? "disabled" : ""}>${icon("up")}</button>
          <button type="button" class="icon-btn" id="actdown" aria-label="Move down" ${idx >= acts.length - 1 ? "disabled" : ""}>${icon("down")}</button>
        </span></div>`}
      <div class="eactions">
        ${isNew ? "<span></span>" : `<button type="button" class="btn ghost danger" id="actdel">${icon("trash", 18)}Delete</button>`}
        <span></span><button type="button" class="btn ghost" id="actcancel">Cancel</button>
        <button type="submit" class="btn">${isNew ? "Add" : "Save"}</button></div>
    </form>`;
  const f = $("#actform");
  const sync = () => {
    $$(".sw", f).forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === color));
    $("#actkind").setAttribute("aria-pressed", kind === "limit");
    // mastery is for skills you're building, not habits you're cutting back
    $("#actmastery").hidden = kind === "limit";
    $("#actmastery").setAttribute("aria-pressed", mastery);
    $("#actbase").hidden = kind === "limit" || !mastery;
  };
  $$(".sw", f).forEach((b) => b.onclick = () => { color = b.dataset.c; sync(); });
  $("#actkind").onclick = () => { kind = kind === "limit" ? "good" : "limit"; if (kind === "limit") mastery = false; sync(); };
  $("#actmastery").onclick = () => { mastery = !mastery; sync(); };
  sync();
  $("#actcancel").onclick = () => editSheet.close();
  $("#actgoal")?.addEventListener("click", () => openGoal(a));
  const move = async (dir) => {
    try { await moveInList(acts, a.id, dir, "/activities"); await load(); openActivity(state.activities.find((x) => x.id === a.id)); }
    catch (e) { toast(e.message); }
  };
  $("#actup")?.addEventListener("click", () => move(-1));
  $("#actdown")?.addEventListener("click", () => move(1));
  $("#actdel")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${a.name}" and all its tracked time? It disappears from History and every summary. This can't be undone.`)) return;
    try { await api(`/activities/${a.id}`, { method: "DELETE" }); editSheet.close(); forgetSummaries(); await load(); toast(`Deleted ${a.name}`); }
    catch (e) { toast(e.message); }
  });
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const name = f.name.value.trim();
    if (!name) return f.name.focus();
    const base = Math.round(Number(f.base.value) || 0);
    if (mastery && (base < 0 || base > 9999)) { toast("Earlier hours must be 0 to 9,999"); return f.base.focus(); }
    try {
      const body = { name, color, kind, mastery };
      if (mastery) body.mastery_base_hours = base;
      await api(isNew ? "/activities" : `/activities/${a.id}`, { method: isNew ? "POST" : "PUT", body });
      newColor = null;
      editSheet.close();
      await load();
      toast(isNew ? `Added ${name}. Tap it to start` : "Saved");
    } catch (e) { toast(e.message); }
  };
  if (!editSheet.open) editSheet.showModal();
}
