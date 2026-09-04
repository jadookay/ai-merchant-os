/* Shericeri V12.12 Kinyarwanda Voice Service Worker */
const CACHE = 'shericeri-v12.12-best-v1';
const APP = './index.html';

const STATIC_REMOTE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs'
];

const isSupabaseApi = (requestUrl) => {
  try {
    const u = new URL(requestUrl);
    return /(^|\.)supabase\.co$/i.test(u.hostname) &&
      (/\/functions\/v1\//.test(u.pathname) ||
       /\/rest\/v1\//.test(u.pathname) ||
       /\/auth\/v1\//.test(u.pathname) ||
       /\/storage\/v1\//.test(u.pathname));
  } catch {
    return false;
  }
};

const isKnownRemote = (requestUrl) => STATIC_REMOTE.includes(requestUrl);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.add(APP); } catch (_) {}
    for (const url of STATIC_REMOTE) {
      try { await cache.add(url); } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('shericeri-v12') && key !== CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase APIs or authenticated requests.
  if (isSupabaseApi(request.url) || request.headers.has('Authorization')) return;

  // App-shell navigation: cache-first, network fallback, then cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(APP).then((cached) =>
        cached || fetch(request).catch(() => caches.match(APP))
      )
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const knownRemote = isKnownRemote(request.url);
  if (!(sameOrigin || knownRemote)) return;

  // CDN libraries: network-first so versionless CDN URLs do not remain stale
  // forever; fall back to the cached copy when offline.
  if (knownRemote) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          event.waitUntil(
            caches.open(CACHE)
              .then((cache) => cache.put(request, response.clone()))
              .catch(() => {})
          );
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Same-origin static assets: cache-first with network fallback.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          event.waitUntil(
            caches.open(CACHE)
              .then((cache) => cache.put(request, response.clone()))
              .catch(() => {})
          );
        }
        return response;
      }).catch(() => Response.error())
    )
  );
});
