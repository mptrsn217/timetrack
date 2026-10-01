/* ---------- appearance ---------- */
const themePref = () => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } };
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function applyTheme(pref) {
  if (pref === "light" || pref === "dark") document.documentElement.dataset.theme = pref;
  else delete document.documentElement.dataset.theme;
  try { pref === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", pref); } catch {}
  // the browser bar colour follows the chosen theme too
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", isDark() ? "#0d1620" : "#f3f7fb"));
  $$("[data-theme-opt]").forEach((b) => b.setAttribute("aria-checked", b.dataset.themeOpt === pref));
  $$("[data-theme-opt]").forEach((b) => b.setAttribute("aria-selected", b.dataset.themeOpt === pref));
}
$$("[data-theme-opt]").forEach((b) => b.onclick = () => applyTheme(b.dataset.themeOpt));

// "When I start a timer, open": Nothing / Minimal / Details (kept per device)
function syncAutoScreen() { $$("[data-auto]").forEach((b) => b.setAttribute("aria-selected", b.dataset.auto === autoScreenPref())); }
$$("[data-auto]").forEach((b) => b.onclick = () => {
  try { localStorage.setItem("autoScreen", b.dataset.auto); localStorage.removeItem("liveAuto"); } catch {}
  syncAutoScreen();
});
syncAutoScreen();
applyTheme(themePref());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(themePref()));

/* ---------- add to Home Screen guide ---------- */
const UA = navigator.userAgent;
const isAndroid = /Android/i.test(UA);
const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|LinkedInApp|GSA\//i.test(UA);
const canInstall = () => !isStandalone && (isIOS || isAndroid);
let installEvent = null; // Chrome/Edge on Android offer their own install dialog
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("#installbtn")?.removeAttribute("hidden"); });
window.addEventListener("appinstalled", () => { installEvent = null; toast("Moonglare added to your Home Screen"); });
// once every script has run (isIOS / isStandalone live in push.js)
document.addEventListener("DOMContentLoaded", () => { if (canInstall()) $("#installbtn").hidden = false; });

function openInstallGuide() {
  sheet.close();
  const step = (ic, html) => `<li><span class="sico">${ic}</span><span>${html}</span></li>`;
  let body;
  if (inAppBrowser) {
    body = `<p class="hint" style="margin:0 4px">You're inside another app's browser, which can't add pages to your Home Screen.</p>
      <ol class="isteps">${step(icon("dots", 18), `Tap the menu (<b>⋯</b> or <b>⋮</b>) and choose <b>Open in ${isIOS ? "Safari" : "Chrome"}</b>`)}
      ${step(icon("home", 18), "Then open this guide again from there")}</ol>`;
  } else if (isIOS) {
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(UA);
    body = `<ol class="isteps">
      ${step(icon("share", 18), safari ? `Tap the <b>Share</b> button in Safari's toolbar (the square with an arrow, at the bottom of the screen, or next to the address on iPad)` : `Tap the <b>Share</b> button in the address bar (the URL bar at the top, the square with an arrow). In Chrome on iPhone, Add to Home Screen is also found under Share`)}
      ${step(icon("plus", 18), `Scroll down the list and tap <b>Add to Home Screen</b>`)}
      ${step(icon("check", 18), `Tap <b>Add</b> in the top-right corner`)}
      ${step(icon("home", 18), `Open <b>Moonglare</b> from your Home Screen and sign in there once more`)}
      </ol>
      <p class="hint" style="margin:0 4px">The Home Screen app opens full screen and can send notifications (iOS 16.4 or newer).</p>`;
  } else if (installEvent) {
    body = `<p class="hint" style="margin:0 4px">Add Moonglare as an app: it opens full screen, has its own icon and can send notifications.</p>
      <button type="button" class="btn" id="doinstall">${icon("home", 18)}Install Moonglare</button>`;
  } else if (isAndroid) {
    body = `<ol class="isteps">
      ${step(icon("dots", 18), `Tap the browser menu (<b>⋮</b> in Chrome, top right; <b>≡</b> in Samsung Internet, bottom right)`)}
      ${step(icon("home", 18), `Tap <b>Add to Home screen</b> or <b>Install app</b>`)}
      ${step(icon("check", 18), `Confirm with <b>Add</b> / <b>Install</b>`)}
      </ol>`;
  } else {
    body = `<p class="hint" style="margin:0 4px">Open this page on your phone to add it to your Home Screen. In Chrome or Edge on a computer, use the install icon at the right end of the address bar.</p>`;
  }
  $("#editsheet .sheet").innerHTML = `<div class="grab"></div><h3 tabindex="-1" autofocus>Add to Home Screen</h3>
    <div class="eform">
      <div class="ipreview"><img src="/icons/moonglare-192.png" alt="" width="56" height="56"><span><b>Moonglare</b><small>One tap to start and stop timers, right from your Home Screen.</small></span></div>
      <p class="ibenefit">Adding Moonglare to your Home Screen gives you the best experience and lets you use the app the way it's intended: full screen, with its own icon, and with notifications.</p>
      ${body}
      <div class="eactions"><span></span><span></span><span></span><button type="button" class="btn ghost" id="iclose">Got it</button></div>
    </div>`;
  $("#iclose").onclick = () => editSheet.close();
  $("#doinstall")?.addEventListener("click", async () => {
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    editSheet.close();
    if (outcome !== "accepted") toast("You can install it later from the menu");
  });
  if (!editSheet.open) editSheet.showModal();
}
$("#installbtn").onclick = openInstallGuide;

// shown once, a moment after the first sign-in on a phone that isn't using the Home Screen app yet
function maybeInstallGuide() {
  let seen = false;
  try { seen = !!localStorage.getItem("installGuideSeen"); localStorage.setItem("installGuideSeen", "1"); } catch {}
  if (seen || !canInstall()) return;
  setTimeout(() => { if (signedIn && !editSheet.open && !sheet.open) openInstallGuide(); }, 1500);
}


$("#signoutall").onclick = async () => {
  if (!confirm("Sign out on every device, including this one? This also turns off notifications everywhere.")) return;
  try { await api("/signout-all", { method: "POST" }); } catch (e) { return toast(e.message); }
  await stopNotify();
  try { (await currentSub())?.unsubscribe(); } catch {}
  window.google?.accounts?.id?.disableAutoSelect();
  signedOut();
  toast("Signed out everywhere");
};
