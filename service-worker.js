const CACHE_NAME = "fuwa-shell-v58";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-fuwa.js",
  "./manifest.json"
];

const STATIC_ASSETS = [
  "./icon/icon-192.png",
  "./icon/icon-512.png",
  "./icon/apple-touch-icon.png",
  "./icon/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([...CORE_ASSETS, ...STATIC_ASSETS]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

function isCoreRequest(request) {
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return false;

  return (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/firebase-fuwa.js") ||
    url.pathname.endsWith("/manifest.json")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = new Request(request, { cache: "no-store" });
    const response = await fetch(fresh);

    if (response?.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      return cache.match("./index.html");
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  if (response?.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const refresh = fetch(new Request(request, { cache: "no-store" }))
    .then(async response => {
      if (response?.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    refresh.catch(() => null);
    return cached;
  }

  const fresh = await refresh;
  if (fresh) return fresh;

  if (request.mode === "navigate") {
    const fallback = await cache.match("./index.html");
    if (fallback) return fallback;
  }

  return Response.error();
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (isCoreRequest(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  event.respondWith(
    cacheFirst(event.request).catch(() => Response.error())
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "./?view=life";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) {
          try { client.navigate(targetUrl); } catch (_) {}
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});