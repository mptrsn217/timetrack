// Startup intro: the animation itself is CSS (app.css, "intro"); this only takes it away
// when its last step ends, or right away on a tap.
(function () {
  const el = document.getElementById("intro");
  if (!el) return;
  if (document.documentElement.classList.contains("nointro")) { el.remove(); return; }
  try { sessionStorage.setItem("introSeen", "1"); } catch {}
  const done = () => el.remove();
  el.addEventListener("animationend", (e) => { if (e.target === el) done(); });
  el.addEventListener("click", () => { el.classList.add("skip"); setTimeout(() => el.isConnected && done(), 450); }); // quick fade, then gone
  setTimeout(() => el.isConnected && done(), 9000); // safety net if animations never run
})();
