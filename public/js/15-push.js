/* ---------- push notifications ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64ToBytes = (s) => {
  const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
// don't wait on serviceWorker.ready here: it never settles if the worker failed to install
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function activeRegistration() {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js");
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, no) => setTimeout(() => no(new Error("The app's background service couldn't start. Reload and try again.")), 10e3)),
  ]);
}
// a browser keeps its subscription across sign-outs; make sure the server files it under whoever is signed in now
async function syncSub() {
  try {
    const sub = await currentSub();
    if (sub && Notification.permission === "granted") await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
  } catch {}
}
const PUSH_PREFS = [
  ["running", "Timer started and stopped", "Shows what you're tracking on the lock screen"],
  ["forgot", "Forgotten timer", "When a timer runs much longer than usual"],
  ["goals", "Goals and limits", "When you reach a goal, or get close to or pass a limit"],
  ["review", "Weekly review", "Sunday evening: your week in numbers"],
  ["habits", "Habit check-in reminder", "In the evening, if some habits aren't logged yet"],
];
async function openNotifications() {
  sheet.close();
  let info = null, sub = null;
  if (pushSupported()) {
    try { [info, sub] = await Promise.all([api("/push"), currentSub()]); } catch (e) { return toast(e.message); }
  }
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  let body;
  if (!pushSupported()) {
    body = isIOS && !isStandalone
      ? `<p class="hint" style="margin:0 4px">On iPhone, notifications only work in the Home Screen app (iOS 16.4 or newer):</p>
         <ol class="steps"><li>In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>.</li><li>Open <b>Timetrack</b> from your Home Screen and sign in.</li><li>Come back here and tap <b>Turn on</b>.</li></ol>`
      : `<p class="hint" style="margin:0 4px">This browser can't show notifications. Try Chrome on Android, or the Home Screen app on iPhone.</p>`;
  } else {
    const on = !!sub;
    body = `
      <div class="nstatus ${on ? "on" : ""}">${on ? "On for this device" : perm === "denied" ? "Blocked for this site" : "Off for this device"}</div>
      ${perm === "denied" ? `<p class="hint" style="margin:0 4px">Notifications are blocked. Allow them in your phone's settings (iPhone: Settings → Notifications → Timetrack), then come back.</p>` : ""}
      <div class="nprefs">${PUSH_PREFS.map(([k, t, d]) => `
        <button type="button" class="nrow" data-pref="${k}" aria-pressed="${info.prefs[k]}"><span class="box" aria-hidden="true"></span>
          <span><b>${t}</b><small>${d}</small></span></button>`).join("")}
        <label class="ntime">Remind me at<input class="field num" type="time" id="habitsat" value="${info.prefs.habitsAt || "21:00"}"></label></div>
      <p class="hint" style="margin:0 4px">These settings apply to all your devices${info.devices > 1 ? ` (${info.devices} have notifications on)` : ""}.</p>
      <div class="eactions">
        ${on ? `<button type="button" class="btn ghost" id="ntest">Send test</button>` : "<span></span>"}
        <span></span><span></span>
        <button type="button" class="btn${on ? " ghost" : ""}" id="ntoggle" ${perm === "denied" ? "disabled" : ""}>${on ? "Turn off" : "Turn on"}</button>
      </div>`;
  }
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>Notifications</h3><div class="eform">${body}</div>`;
  $$("[data-pref]").forEach((b) => b.onclick = async () => {
    const val = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", val);
    try { await api("/push/prefs", { method: "PUT", body: { [b.dataset.pref]: val } }); }
    catch (e) { b.setAttribute("aria-pressed", !val); toast(e.message); }
  });
  $("#habitsat")?.addEventListener("change", async (e) => {
    try { await api("/push/prefs", { method: "PUT", body: { habitsAt: e.target.value } }); toast(`Habit reminder at ${e.target.value}`); }
    catch (err) { toast(err.message); }
  });
  $("#ntest")?.addEventListener("click", async () => {
    try {
      const r = await api("/push/test", { method: "POST" });
      toast(r.sent ? "Test sent. It should appear in a few seconds" : "No device received it. Try turning notifications off and on");
    } catch (e) { toast(e.message); }
  });
  $("#ntoggle")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
        toast("Notifications off for this device");
      } else {
        // must be the first await inside the tap, or iPhone refuses to ask
        const p = await Notification.requestPermission();
        if (p !== "granted") { toast("Notifications weren't allowed"); return openNotifications(); }
        const reg = await activeRegistration();
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(info.publicKey) });
        await api("/push/subscribe", { method: "POST", body: { subscription: s.toJSON() } });
        await stopNotify();
        toast("Notifications on");
      }
    } catch (e) { toast(e.message || "Couldn't change notifications"); }
    openNotifications();
  });
  editSheet.showModal();
}
$("#notif").onclick = openNotifications;
async function stopNotify() {
  if (!swReg) return;
  (await swReg.getNotifications({ tag: "running" })).forEach((n) => n.close());
}
async function notify() {
  if (!swReg || !("Notification" in window) || Notification.permission !== "granted") return;
  if (await currentSub()) return; // the server sends it as a push instead
  await stopNotify();
  if (!state.running) return;
  swReg.showNotification(state.running.name, {
    tag: "running", body: "Running since " + clock(state.running.started_at),
    silent: true, requireInteraction: true, icon: "/icon-192.png",
    actions: [{ action: "stop", title: "Stop" }],
  });
}
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data === "reload") load();
  else if (e.data?.type === "open") openFromUrl(e.data.url);
});
// a notification can point at a screen, e.g. /?review=2026-09-28
function openFromUrl(url) {
  const review = new URL(url, location.origin).searchParams.get("review");
  if (review && signedIn) openReview(/^\d{4}-\d{2}-\d{2}$/.test(review) ? review : undefined);
  const v = new URL(url, location.origin).searchParams.get("view");
  if (signedIn && ["track", "habits", "overview", "history"].includes(v)) go(v);
}

flushOutbox();
load().then(() => {
  if (!signedIn) return;
  syncSub();
  if (location.search) { openFromUrl(location.href); history.replaceState(null, "", "/"); }
  else maybeInstallGuide();
});
