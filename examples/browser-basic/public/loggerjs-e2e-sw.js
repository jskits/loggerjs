self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const payload = event.data;
  const events =
    payload?.type === "loggerjs.batch"
      ? (payload.events ?? [])
      : payload?.type === "loggerjs.event"
        ? [payload.event]
        : [];

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      for (const logEvent of events) {
        for (const client of clients) {
          const message = {
            message: logEvent?.message,
            source: payload?.source,
            type: "loggerjs.e2e.seen",
          };
          // oxlint-disable-next-line require-post-message-target-origin -- ServiceWorker Client.postMessage has no targetOrigin parameter.
          client.postMessage(message);
        }
      }
    }),
  );
});
