// Offline-Speicher: Die App öffnet sofort aus dem Speicher des iPads –
// auch ohne Internet und auch wenn der Server gerade „schläft“. Neue Versionen werden im Hintergrund geholt.
const CACHE = "notizheft-v4";
const SHELL = ["/", "/app.js", "/styles.css", "/icon.svg", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => fetch(url, { credentials: "same-origin" }).then((res) => res.ok && cache.put(url, res)).catch(() => {})))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  // Aufruf der App (auch mit ?…) → App-Startseite; andere Seiten wie gewohnt
  if (req.mode === "navigate" && url.pathname !== "/" && url.pathname !== "/index.html") return;
  const key = req.mode === "navigate" ? "/" : sameOrigin ? url.pathname : req.url;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const network = fetch(req)
        .then((res) => {
          // Nur echte Antworten merken – nie die Passwort-Seite
          if (res.ok || res.type === "opaque") cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response("Offline – bitte einmal mit Internet öffnen.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })
  );
});
