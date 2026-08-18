const CACHE_NAME = "fuwa-shell-v110";
const RELEASE_MARKER_CACHE = "fuwa-release-state";
const RELEASE_MARKER_REQUEST = "./__fuwa_release_marker__";
const RELEASE_KEY = "fuwa-v1.0-2026-08-15";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./smart-fuwa.css",
  "./smart-fuwa-life.css",
  "./smart-fuwa-memory.css",
  "./features/memory-garden.css",
  "./features/missed-days.css",
  "./features/cloud-backup-safety.js",
  "./app.js",
  "./smart-fuwa.js",
  "./smart-fuwa-life.js",
  "./smart-fuwa-memory.js",
  "./features/memory-garden.js",
  "./features/missed-days.js",
  "./firebase-fuwa.js",
  "./manifest.json"
];

const STATIC_ASSETS = [
  "./icon/icon-192.png",
  "./icon/icon-512.png",
  "./icon/apple-touch-icon.png",
  "./icon/favicon-32.png"
];

const OPTIONAL_ASSETS = [
  "./data/scrapbook-data.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const existingKeys = await caches.keys();
    const isUpgrade = existingKeys.some(key =>
      /^fuwa-shell-v\d+$/.test(key) && key !== CACHE_NAME
    );

    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...CORE_ASSETS, ...STATIC_ASSETS]);
    await Promise.all(OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(() => null)));

    if (isUpgrade) {
      const markerCache = await caches.open(RELEASE_MARKER_CACHE);
      await markerCache.put(
        RELEASE_MARKER_REQUEST,
        new Response(RELEASE_KEY, { headers: { "content-type": "text/plain" } })
      );
    }
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => /^fuwa-shell-v\d+$/.test(key) && key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

function isSleepAudioRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.includes("/audio/sleep/");
}

function isCoreRequest(request) {
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return false;

  return (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/smart-fuwa.css") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/smart-fuwa.js") ||
    url.pathname.endsWith("/smart-fuwa-life.js") ||
    url.pathname.endsWith("/smart-fuwa-memory.js") ||
    url.pathname.endsWith("/smart-fuwa-memory.css") ||
    url.pathname.endsWith("/features/memory-garden.css") ||
    url.pathname.endsWith("/features/memory-garden.js") ||
    url.pathname.endsWith("/features/cloud-backup-safety.js") ||
    url.pathname.endsWith("/firebase-fuwa.js") ||
    url.pathname.endsWith("/data/scrapbook-data.js") ||
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

  if (isSleepAudioRequest(event.request)) {
    // Large immutable ambience tracks are fetched only when requested, then kept offline.
    event.respondWith(cacheFirst(event.request).catch(() => Response.error()));
    return;
  }

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
