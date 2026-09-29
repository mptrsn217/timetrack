self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// network-first; app shell is tiny, no offline data needed
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || e.request.url.includes("/api/")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

const refreshOpenApps = () => self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage("reload")));

// Web Push from the server: running timer, forgotten timer, goals/limits.
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
  e.waitUntil(self.registration.showNotification(d.title || "Timetrack", options).then(refreshOpenApps));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "stop") {
    e.waitUntil(fetch("/api/stop", { method: "POST", headers: { "content-type": "application/json" } }).then(refreshOpenApps));
    return;
  }
  const url = e.notification.data?.url || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(url))));
});
