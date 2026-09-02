const CACHE = 'shericeri-v12.8-language-tts-websearch-v1';
const APP = './index.html';

const STATIC_REMOTE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs'
];

const isSupabaseApi = url => {
  try {
    const u = new URL(url);
    return /(^|\.)supabase\.co$/i.test(u.hostname) &&
      (
        /\/functions\/v1\//.test(u.pathname) ||
        /\/rest\/v1\//.test(u.pathname) ||
        /\/auth\/v1\//.test(u.pathname) ||
        /\/storage\/v1\//.test(u.pathname)
      );
  } catch {
    return false;
  }
};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    try {
      await cache.add(APP);
    } catch (_) {}

    for (const url of STATIC_REMOTE) {
      try {
        await cache.add(url);
      } catch (_) {}
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key.startsWith('shericeri-v12') && key !== CACHE)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase API responses or authenticated requests.
  if (isSupabaseApi(req.url) || req.headers.has('Authorization')) {
    return;
  }

  // Navigation: network first so new GitHub deployments are seen.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE)
              .then(cache => cache.put(APP, response.clone()))
              .catch(() => {});
          }

          return response;
        })
        .catch(() => caches.match(APP))
    );

    return;
  }

  const isKnownRemote = STATIC_REMOTE.some(item => item === req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!(sameOrigin || isKnownRemote)) {
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(req)
        .then(response => {
          if (response && (response.ok || response.type === 'opaque')) {
            caches.open(CACHE)
              .then(cache => cache.put(req, response.clone()))
              .catch(() => {});
          }

          return response;
        })
        .catch(() => Response.error());
    })
  );
});
