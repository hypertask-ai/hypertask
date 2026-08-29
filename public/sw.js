/*
 * Self-destructing service worker.
 *
 * The app used to ship a next-pwa / Workbox worker that precached the app
 * shell + JS bundles. That caching is now DISABLED (`withPWA(...)` is commented
 * out in next.config.js), but devices that visited while it was enabled still
 * have the old worker registered — and it keeps serving a stale bundle, so new
 * deploys never reach those users ("is it even live?" / stuck on old code).
 *
 * This stub replaces the old worker. On its next update check the browser
 * fetches this file, we unregister ourselves, drop every Cache Storage entry,
 * and reload open tabs so they load fresh code straight from the network.
 * It intentionally has NO fetch handler, so it stops intercepting requests.
 *
 * Firebase push messaging uses a SEPARATE worker (firebase-messaging-sw.js)
 * and is unaffected — this only removes the app-cache worker.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (err) {
        // Cache Storage may be unavailable; unregister regardless.
      }
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => {
        // Reload each open tab once so it picks up the latest deploy.
        if ("navigate" in client) client.navigate(client.url);
      });
    })()
  );
});
