const CACHE='shericeri-v12.3-voice-loop-v1';
const APP='./index.html';
const STATIC_REMOTE=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs'
];

const isSupabaseApi = url => {
  try {
    const u=new URL(url);
    return /(^|\.)supabase\.co$/i.test(u.hostname) &&
      (/\/functions\/v1\//.test(u.pathname) || /\/rest\/v1\//.test(u.pathname) || /\/auth\/v1\//.test(u.pathname) || /\/storage\/v1\//.test(u.pathname));
  } catch { return false; }
};

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    try { await cache.add(APP); } catch (_) {}
    for(const url of STATIC_REMOTE){
      try { await cache.add(url); } catch (_) { /* optional dependency */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('shericeri-v12')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);

  // Never cache authenticated/backend responses. These can contain private
  // merchant data and must always be fetched from the network when online.
  if(isSupabaseApi(req.url) || req.headers.has('Authorization')) return;

  // Navigation: cache-first app shell, then network fallback.
  if(req.mode==='navigate'){
    event.respondWith(
      caches.match(APP).then(cached => cached || fetch(req).catch(()=>caches.match(APP)))
    );
    return;
  }

  // Cache-first only for same-origin static assets and the explicit public
  // dependency allowlist above. Everything else is network-only and is never
  // written into the offline cache.
  const isKnownRemote=STATIC_REMOTE.some(x=>x===req.url);
  const sameOrigin=url.origin===self.location.origin;
  if(!(sameOrigin||isKnownRemote)) return;

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp=>{
      if(resp && (resp.ok || resp.type==='opaque')){
        caches.open(CACHE).then(c=>c.put(req,resp.clone())).catch(()=>{});
      }
      return resp;
    }).catch(()=>cached || Response.error()))
  );
});
