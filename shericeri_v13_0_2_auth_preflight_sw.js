/* Shericeri V13.0.2 authentication/cache repair Service Worker.
   Download as .js.txt; deploy with the exact filename below:
   shericeri_v13_0_2_auth_preflight_sw.js
*/
const CACHE_NAME='shericeri-v13.0.2-auth-preflight-v1';
const APP='./index.html';
const APP_URL=new URL(APP,self.location.origin).href;
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{await cache.add(new Request(APP,{cache:'reload'}));}catch(e){console.warn('[Shericeri SW] shell pre-cache failed',e)}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(new Request(req,{cache:'no-store'}));
        if(fresh.ok){
          const cache=await caches.open(CACHE_NAME);
          await cache.put(APP_URL,fresh.clone());
          return fresh;
        }
      }catch(e){}
      const cached=await caches.match(APP_URL);
      return cached||caches.match(APP)||Response.error();
    })());
    return;
  }
  if(url.pathname.endsWith('/index.html')){
    event.respondWith((async()=>{
      try{const fresh=await fetch(new Request(req,{cache:'no-store'}));if(fresh.ok){const cache=await caches.open(CACHE_NAME);await cache.put(req,fresh.clone());return fresh}}catch(e){}
      return caches.match(req)||caches.match(APP_URL)||Response.error();
    })());
  }
});
