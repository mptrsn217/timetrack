// Offline: the app's own files are kept in a cache so it opens without a connection.
// Always network first (you get the newest version when online), the cache is the fallback.
const CACHE = "moonglare-v20";
const SHELL = [
  "/", "/app.css", "/theme.js", "/manifest.json", "/icon-192.png", "/icon-512.png", "/icon.svg", "/logo.svg", "/apple-touch-icon.png", "/favicon-32.png", "/privacy.html",
  "/js/00-intro.js", "/js/01-core.js", "/js/02-login.js", "/js/03-track-status.js", "/js/04-habits.js", "/js/05-live.js", 
  "/js/07-starter.js", "/js/08-track.js", "/js/09-history.js", "/js/10-entries.js", "/js/11-goals.js", "/js/12-activities.js",
  "/js/13-account.js", "/js/14-appearance.js", "/js/15-push.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  // data and sign-in always go to the network (the app keeps its own offline copy of your data)
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy)); }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/" : req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});

const refreshOpenApps = () => self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage("reload")));

// Web Push from the server: running timer, forgotten timer, goals/limits, weekly review, habit reminder.
// Every push must show a notification (iPhone revokes the subscription otherwise).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  const options = {
    body: d.body || "",
    tag: d.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/" },
    renotify: d.tag === "goal" || d.tag === "forgot",
    requireInteraction: !!d.sticky,
    silent: d.tag === "running",
  };
  if (d.actions) options.actions = d.actions;
  e.waitUntil(self.registration.showNotification(d.title || "Moonglare", options).then(refreshOpenApps));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "stop") {
    e.waitUntil(fetch("/api/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(refreshOpenApps));
    return;
  }
  const url = e.notification.data?.url || "/";
  // an open app is focused and told which screen to show; otherwise open the app at that URL
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    if (!cs[0]) return self.clients.openWindow(url);
    if (url !== "/") cs[0].postMessage({ type: "open", url });
    return cs[0].focus();
  }));
});
