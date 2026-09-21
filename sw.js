/* Sporv service worker — audit 2026-09-17 P2-4: the app opens with no network.
   Caches exactly one thing, the page itself (network-first, so a deploy is
   picked up on the next online open; cache-fallback, so a dead signal still
   opens the workspace — what it shows then is what the device holds, and the
   page says so). Never touches the API: every backend request goes to the
   network, and a failed one fails loudly in the page. Emitted by build.py
   with the build stamp so a new build retires the old cache. */
const STAMP = "68ad96ca5df66aa8";
const CACHE = "sporv-shell-" + STAMP;
const SHELL = ["/", "/index.html"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isShell = req.mode === "navigate" || (url.origin === self.location.origin && (url.pathname === "/" || url.pathname === "/index.html"));
  if (!isShell) return;                                   // API, fonts, everything else: straight to the network
  e.respondWith(fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {}); } return res; })
    .catch(() => caches.match("/index.html").then((hit) => hit || caches.match("/"))));
});
