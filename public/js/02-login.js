/* ---------- login ---------- */
let googleClientId = null;
async function renderLogin() {
  // the landing page: what Moonglare is for, what it looks like, and one button to start
  const phone = (src, alt, lazy = true) =>
    `<figure class="phone"><img src="/shots/${src}.webp" alt="${alt}" width="280" height="606"${lazy ? ' loading="lazy"' : ""}></figure>`;
  const feature = (title, text, shots, flip) => `<section class="lfeat${flip ? " flip" : ""}">
      <div class="lftext"><h3>${title}</h3><p>${text}</p></div>
      <div class="lfshots">${shots}</div></section>`;
  app.innerHTML = `<div class="landing">
    <section class="lhero">
      <div class="lhtext">
        <img class="mark" src="/icon.svg" alt="" width="88" height="88">
        <h1>Moonglare</h1>
        <p class="lead">See where your time really goes. Then do more of what matters, and less of what doesn't.</p>
        <div id="gbtn" class="gbtn"></div>
        <p class="fine">Free · private to your account · works offline</p>
      </div>
      <div class="lhshot">${phone("track", "Moonglare's Track screen with a timer running", false)}</div>
    </section>

    <section class="lwhy">
      <p class="kicker">The idea</p>
      <h2>If you feel unproductive, the first step is to understand what you're actually doing.</h2>
      <div class="pillars">
        <div class="pillar"><b>1</b><h3>Reduce bad habits</h3>
          <p>Mark things like social media or gaming as habits to cut back. Set a limit, watch the time add up, and count the days you stay under it.</p></div>
        <div class="pillar"><b>2</b><h3>Reinforce good habits</h3>
          <p>Daily and weekly goals, streaks, yes/no check-ins and counters. Small wins, made visible, so they keep happening.</p></div>
        <div class="pillar"><b>3</b><h3>Understand where the time goes</h3>
          <p>Charts, a weekly review and year-long heatmaps show what your days are really made of, and what you could do better.</p></div>
      </div>
    </section>

    ${feature("One tap to start, one tap to stop",
      "Every activity is a tile. Tap it and the clock runs; tap again and it's saved. Moonglare tells you how this session compares with your usual and your record.",
      phone("idle", "Activities, goals and a one-tap way back in"))}
    ${feature("A calm screen while you work",
      "When a timer starts, a minimal screen takes over: just the time and one line on how you're doing. Open the live view for goals, streaks and today's totals.",
      phone("mini", "The minimal timer screen") + phone("live", "The live screen with goals and streaks"), true)}
    ${feature("Habits, day by day",
      "Check in with a tap: did you work out, did you skip the sugar? Count push-ups or glasses of water. Heatmaps show the pattern over weeks and months.",
      phone("habits", "Yes/no habits and counters"))}
    ${feature("The whole picture",
      "Days, weeks and months side by side, this week against last, and a heatmap of every hour you've tracked this year. The honest overview you need to change something.",
      phone("overview", "Daily charts of where the time went") + phone("overview2", "Week comparison and year heatmap"), true)}
    ${feature("Your 10,000 hours",
      "Mark a skill for mastery and follow every hour toward 10,000, with the next milestone and when you'll get there at your current pace.",
      phone("mastery", "Progress toward 10,000 hours"))}

    <section class="lend">
      <p class="quote">"I hope Moonglare helps you understand where your time goes, and what to do with it."</p>
      <div id="gbtn2" class="gbtn"></div>
      ${canInstall() ? `<button class="linkbtn" id="howinstall">${icon("home", 16)}Add Moonglare to your Home Screen</button>` : ""}
      <p class="fine">Free. Your data is private to your account. <a href="/privacy.html">Privacy</a></p>
    </section>
  </div>`;
  $("#howinstall")?.addEventListener("click", openInstallGuide);
  try {
    if (googleClientId === null) googleClientId = (await fetch("/config").then((r) => r.json())).googleClientId;
    if (!googleClientId) return toast("Sign-in is not configured on the server");
    await new Promise((ok) => (function wait() { window.google?.accounts?.id ? ok() : setTimeout(wait, 50); })());
    google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogle });
    for (const el of [$("#gbtn"), $("#gbtn2")]) {
      if (el) google.accounts.id.renderButton(el, { theme: isDark() ? "filled_black" : "outline", size: "large", shape: "pill", text: "continue_with" });
    }
  } catch { toast("Could not load Google sign-in"); }
}
async function onGoogle({ credential }) {
  const r = await fetch("/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || "Sign-in failed");
  view = "track";
  await load();
  maybeInstallGuide();
}
