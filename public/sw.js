self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.title !== "string") return;
  const url = safeUrl(payload.url);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: url,
    data: { url },
  }));
});

function safeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && /^\/t\/[A-Za-z0-9]+$/.test(url.pathname)) return url.href;
  } catch { /* Fall back to the lobby for malformed payloads. */ }
  return new URL("/", self.location.origin).href;
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = tabs.find(tab => tab.url === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
