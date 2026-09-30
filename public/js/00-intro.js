// Startup intro: the animation itself is CSS (app.css, "intro"); this only removes it when its last step ends.
(function () {
  const el = document.getElementById("intro");
  if (!el) return;
  if (document.documentElement.classList.contains("nointro")) { el.remove(); return; }
  try { sessionStorage.setItem("introSeen", "1"); } catch {}
  el.addEventListener("animationend", (e) => { if (e.target === el) el.remove(); });
  // safety net if the animations are held back (e.g. the page opened in the background): the intro lasts
  // 4.8s from the first paint, so never keep it longer than ~5.6s after the page started loading
  setTimeout(() => el.isConnected && el.remove(), Math.max(0, 5600 - performance.now()));
})();
