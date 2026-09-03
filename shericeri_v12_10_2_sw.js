// Shericeri Service Worker — V12.10.2
// V12.10.2 changes (from V12.10.1 baseline):
//   1. Cache name bumped so the V12.10.1 shell is invalidated on next install.
//   2. Navigation and generic-asset fetch handlers no longer resolve with
//      Response.error() / undefined as a last resort. Both cases previously
//      caused the browser to log "The FetchEvent for <URL> resulted in a
//      network error response" — which is not just console noise: it means
//      the request genuinely fails with nothing rendered, instead of failing
//      gracefully. Now, when both the network and the cache come up empty,
//      a real (if minimal) Response is always returned.
//   Navigation strategy remains network-first with cached index.html as the
//   offline fallback (already correct in V12.10.1 — unchanged here).

const CACHE = 'shericeri-v12.10.2-v1';
const APP = './index.html';
const STATIC_REMOTE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs'
];

const OFFLINE_FALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Shericeri — Offline</title></head>' +
  '<body style="font-family:sans-serif;padding:24px;color:#111">' +
  '<h1>You are offline</h1>' +
  '<p>Shericeri could not reach the network and no cached copy of the app was found yet on this device.</p>' +
  '<p>Check your connection and reload. Once it loads successfully once, it will be available offline afterward.</p>' +
  '</body></html>';

const isSupabaseApi = url => {
  try {
    const u = new URL(url);
    return /(^|\.)supabase\.co$/i.test(u.hostname) &&
      (/\/functions\/v1\//.test(u.pathname) ||
       /\/rest\/v1\//.test(u.pathname) ||
       /\/auth\/v1\//.test(u.pathname) ||
       /\/storage\/v1\//.test(u.pathname));
  } catch {
    return false;
  }
};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Retry the app-shell cache a few times — the navigate handler's offline
    // fallback depends on this having succeeded, so a single silent failure
    // here shouldn't be allowed to leave the shell permanently uncached.
    let cached = false;
    for (let attempt = 0; attempt < 3 && !cached; attempt++) {
      try { await cache.add(APP); cached = true; } catch (_) { /* retry */ }
    }
    for (const url of STATIC_REMOTE) {
      try { await cache.add(url); } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('shericeri-v12') && k !== CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isSupabaseApi(req.url) || req.headers.has('Authorization')) return;

  if (req.mode === 'navigate') {
    // Network-first: always try to get the freshest deploy. On success, also
    // refresh the cached shell so the offline fallback stays current. Only
    // fall back to the cached shell if the network genuinely fails, and only
    // fall back to an inline offline page if there's no cached shell either —
    // never resolve with Response.error() or undefined.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(APP, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match(APP);
        if (cached) return cached;
        return new Response(OFFLINE_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  const isKnownRemote = STATIC_REMOTE.some(x => x === req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!(sameOrigin || isKnownRemote)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp && (resp.ok || resp.type === 'opaque')) {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    } catch (_) {
      // Never hand the browser Response.error() for a plain asset request —
      // an empty, clearly-failed response is harmless and avoids the
      // "network error response" console spam (this is what was happening
      // for favicon.ico and, on a flaky connection, the root page itself).
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
