self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// network-first; app shell is tiny, no offline data needed
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || e.request.url.includes("/api/")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "stop") {
    e.waitUntil(
      fetch("/api/stop", { method: "POST", headers: { "content-type": "application/json" } })
        .then(() => self.clients.matchAll({ type: "window" }))
        .then((cs) => cs.forEach((c) => c.postMessage("reload")))
    );
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("/"))));
});
