/* Shericeri V14.4 — inheritance-safe offline application shell + sync wake-up worker */
const CACHE_NAME='shericeri-v14.4-aibos-sync-v2';
const APP='./index.html';
const RELEASE='V14.4.1';

async function patchAppResponse(response){
  if(!response||!response.ok)return response;
  try{
    let html=await response.text();

    // V14.4 compatibility bridge always exposes a .speak() function, even when
    // no native TTS engine exists. The old truthiness checks therefore treated
    // the compatibility shim as a real local bridge and produced the misleading
    // "No native/local TTS bridge installed" error after an online TTS failure.
    html=html.replace(
      "if(/^rw/i.test(queuedLang) && !window.SHERICERI_VOICE_BRIDGE?.speak && !navigator.onLine){setSheriStatus('Kinyarwanda offline voice is not installed on this device.');sheriDiagSet('TTS','Kinyarwanda native bridge NOT INSTALLED');return;}",
      "if(/^rw/i.test(queuedLang) && !navigator.onLine){const localTtsReady=!!(window.SHERICERI_VOICE_BRIDGE?.capabilities?.tts || window.SHERICERI_VOICE_BRIDGE?.isReady&&await window.SHERICERI_VOICE_BRIDGE.isReady(queuedLang));if(!localTtsReady){setSheriStatus('Kinyarwanda offline voice is not installed on this device.');sheriDiagSet('TTS','Kinyarwanda native bridge NOT INSTALLED');return;}}"
    );

    // Use a Blob URL instead of a large data: URL for Pindo-generated audio.
    // Also preserve the real browser playback error in diagnostics.
    html=html.replace(
      "const audio=new Audio(`data:${body.mime_type||'audio/wav'};base64,${body.audio_base64}`);audio.preload='auto';await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=()=>reject(new Error('Kinyarwanda TTS audio playback failed'));audio.play().catch(reject)});finish('online-kinya-tts');return true;",
      "const bin=atob(body.audio_base64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const blob=new Blob([bytes],{type:body.mime_type||'audio/wav'});const objectUrl=URL.createObjectURL(blob);const audio=new Audio();audio.preload='auto';audio.src=objectUrl;await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=()=>reject(new Error(`Kinyarwanda TTS audio playback failed (${audio.error?.code||'MEDIA_ERR_UNKNOWN'})`));audio.play().catch(reject)});URL.revokeObjectURL(objectUrl);finish('online-kinya-tts');return true;"
    );

    // Only use a local bridge when it is genuinely installed. The compatibility
    // shim's .speak() method intentionally exists even when capabilities.tts=false.
    html=html.replace(
      "if(window.SHERICERI_VOICE_BRIDGE?.speak){sheriDiagSet('Kinyarwanda TTS fallback','LOCAL NATIVE BRIDGE');await window.SHERICERI_VOICE_BRIDGE.speak(next,lang);finish('local-bridge-fallback');return;}",
      "const localTtsReady=!!(window.SHERICERI_VOICE_BRIDGE?.capabilities?.tts || window.SHERICERI_VOICE_BRIDGE?.isReady&&await window.SHERICERI_VOICE_BRIDGE.isReady(lang));if(localTtsReady){sheriDiagSet('Kinyarwanda TTS fallback','LOCAL NATIVE BRIDGE');await window.SHERICERI_VOICE_BRIDGE.speak(next,lang);finish('local-bridge-fallback');return;}"
    );

    // Same correction for the generic local-TTS path.
    html=html.replace(
      "if(window.SHERICERI_VOICE_BRIDGE?.speak){await window.SHERICERI_VOICE_BRIDGE.speak(next,lang);finish('local-bridge-complete');return;}",
      "const localTtsReady=!!(window.SHERICERI_VOICE_BRIDGE?.capabilities?.tts || window.SHERICERI_VOICE_BRIDGE?.isReady&&await window.SHERICERI_VOICE_BRIDGE.isReady(lang));if(localTtsReady){await window.SHERICERI_VOICE_BRIDGE.speak(next,lang);finish('local-bridge-complete');return;}"
    );

    return new Response(html,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(_){return response;}
}

async function fetchAndPatch(request){
  const response=await fetch(request,{cache:'no-store'});
  return patchAppResponse(response);
}

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache=>{
        try{
          const response=await fetch(APP,{cache:'no-store'});
          const patched=await patchAppResponse(response);
          if(patched&&patched.ok)await cache.put(APP,patched);
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
      fetchAndPatch(request)
        .then(response=>{
          if(response&&response.ok){
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
          if(response&&response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match(request).then(cached=>cached||caches.match(APP)))
    );
  }
});