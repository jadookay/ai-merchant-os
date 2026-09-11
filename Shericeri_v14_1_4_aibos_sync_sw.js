const CACHE_NAME='shericeri-v14.1.4-aibos-sync-v1';
const APP='./index.html';
const ASSETS=[APP];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{const r=event.request;if(r.method!=='GET')return;if(r.mode==='navigate'){event.respondWith(fetch(r,{cache:'no-store'}).then(res=>{const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(APP,copy)).catch(()=>{});return res}).catch(()=>caches.match(APP)))}else{event.respondWith(fetch(r,{cache:'no-store'}).then(res=>{if(new URL(r.url).origin===location.origin){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(r,copy)).catch(()=>{})}return res}).catch(()=>caches.match(r).then(x=>x||caches.match(APP))) )}});
