/* IndieStack Web Push worker (v0.6.0 B02).
 * Keep lifecycle deterministic: install/activate never force an update of open tabs;
 * push payloads are displayed only when a valid notification title is present.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: event.data.text() }; }
  const title = typeof payload?.title === "string" && payload.title.trim() ? payload.title : null;
  if (!title) return;
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    data: typeof payload.url === "string" ? { url: payload.url } : undefined,
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (typeof url !== "string") return;
  event.waitUntil(self.clients.openWindow(url));
});
