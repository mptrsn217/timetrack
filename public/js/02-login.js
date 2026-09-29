/* ---------- login ---------- */
let googleClientId = null;
async function renderLogin() {
  app.innerHTML = `<div class="login">
    <span class="mark">${icon("clock", 34)}</span>
    <h1>Timetrack</h1>
    <p>One tap to start, one tap to stop. See where your hours actually go.</p>
    <div class="demo" aria-hidden="true">
      <div style="--c:#e9a23b"><i></i>Deep work<em class="num">3h 20m</em></div>
      <div style="--c:#3cad8c"><i></i>Exercise<em class="num">45m</em></div>
      <div style="--c:#5b8def"><i></i>Reading<em class="num">1h 05m</em></div>
    </div>
    <div id="gbtn"></div>
    ${canInstall() ? `<button class="linkbtn" id="howinstall">${icon("home", 16)}Add Timetrack to your Home Screen</button>` : ""}
    <p class="fine">Free. Your data is private to your account. <a href="/privacy.html">Privacy</a></p>
  </div>`;
  $("#howinstall")?.addEventListener("click", openInstallGuide);
  try {
    if (googleClientId === null) googleClientId = (await fetch("/config").then((r) => r.json())).googleClientId;
    if (!googleClientId) return toast("Sign-in is not configured on the server");
    await new Promise((ok) => (function wait() { window.google?.accounts?.id ? ok() : setTimeout(wait, 50); })());
    google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogle });
    google.accounts.id.renderButton($("#gbtn"), { theme: isDark() ? "filled_black" : "outline", size: "large", shape: "pill", text: "continue_with" });
  } catch { toast("Could not load Google sign-in"); }
}
async function onGoogle({ credential }) {
  const r = await fetch("/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "Sign-in failed");
  view = "track";
  await load();
  maybeInstallGuide();
}
