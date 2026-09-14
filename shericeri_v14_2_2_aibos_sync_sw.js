/* Shericeri V14.2.2 — inheritance-safe offline application shell + sync wake-up worker */
const CACHE_NAME='shericeri-v14.2.2-aibos-sync-v3';
const APP='./index.html';
const RELEASE='V14.2.2';

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache=>{
        try{
          const response=await fetch(APP,{cache:'no-store'});
          if(response.ok)await cache.put(APP,response);
        }catch(_){}
      })
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(k=>k.startsWith('shericeri-')&&k!==CACHE_NAME)
          .map(k=>caches.delete(k))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(type==='SKIP_WAITING')self.skipWaiting();
  if(type==='CLIENT_READY' && event.source?.postMessage){
    event.source.postMessage({type:'SHERICERI_SW_READY',version:RELEASE,cache:CACHE_NAME});
  }
});

self.addEventListener('sync',event=>{
  if(event.tag!=='shericeri-outbox-sync')return;
  event.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true})
      .then(clients=>clients.forEach(client=>client.postMessage({type:'SHERICERI_SYNC_REQUEST'})))
  );
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .then(response=>{
          if(response && response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(APP,copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match(APP))
    );
    return;
  }

  // Cache successful same-origin GETs. Cross-origin requests are intentionally
  // network-only; this prevents stale third-party scripts and avoids turning
  // Cloudflare/other external challenges into the app shell.
  const url=new URL(request.url);
  if(url.origin===location.origin){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .then(response=>{
          if(response && response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match(request).then(cached=>cached||caches.match(APP)))
    );
  }
});
