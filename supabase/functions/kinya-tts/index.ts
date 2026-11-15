import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(body: unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
function encodeAudio(bytes:Uint8Array):string{let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
async function downloadProviderAudio(audioUrl:string,allowedHost:string):Promise<{base64:string;mime:string;bytes:number}>{
 const url=new URL(audioUrl,allowedHost==="api.pindo.io"?"https://api.pindo.io/":"https://ijwilab.com/");
 if(url.protocol!=="https:"||(url.hostname!==allowedHost&&!url.hostname.endsWith("."+allowedHost)))throw new Error("TTS provider returned an untrusted audio URL.");
 const response=await fetch(url.toString(),{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`Generated audio download failed: HTTP ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(!bytes.length||bytes.length>12000000)throw new Error("Generated speech audio was empty or too large.");
 return {base64:encodeAudio(bytes),mime:response.headers.get("content-type")||"audio/wav",bytes:bytes.length};
}
async function synthesizePindo(text:string,authenticated:boolean):Promise<{base64:string;mime:string;bytes:number}>{
 const token=Deno.env.get("PINDO_API_TOKEN");
 if(authenticated&&!token)throw new Error("Pindo authenticated fallback is not configured.");
 const response=await fetch(authenticated?"https://api.pindo.io/ai/tts/rw":"https://api.pindo.io/ai/tts/rw/public",{
  method:"POST",headers:{"Content-Type":"application/json",...(authenticated&&token?{"Authorization":`Bearer ${token}`}:{})},
  body:JSON.stringify({text,lang:"rw",speech_rate:1.0}),signal:AbortSignal.timeout(15000)});
 const raw=await response.text();let payload:any=null;try{payload=raw?JSON.parse(raw):null}catch{}
 if(!response.ok)throw new Error(`Pindo ${authenticated?"authenticated":"public"} TTS HTTP ${response.status}: ${raw.slice(0,240)}`);
 const audioPath=payload?.data?.generated_audio_url??payload?.generated_audio_url;
 if(typeof audioPath!=="string"||!audioPath.trim())throw new Error("Pindo did not return an audio URL.");
 return downloadProviderAudio(audioPath,"api.pindo.io");
}
async function synthesizeIjwi(text:string):Promise<{base64:string;mime:string;bytes:number}>{
 const key=Deno.env.get("IJWILAB_API_KEY");
 if(!key)throw new Error("IjwiLab API key is not configured; its free Studio is not an API endpoint.");
 const response=await fetch("https://ijwilab.com/api/v1/tts.php",{
  method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
  body:JSON.stringify({input:text,language:"rw",speaker_id:19}),signal:AbortSignal.timeout(15000)});
 const raw=await response.text();let payload:any=null;try{payload=raw?JSON.parse(raw):null}catch{}
 if(!response.ok)throw new Error(`IjwiLab TTS HTTP ${response.status}: ${raw.slice(0,240)}`);
 const outputUrl=payload?.output_url;if(typeof outputUrl!=="string"||!outputUrl.trim())throw new Error("IjwiLab did not return an output URL.");
 return downloadProviderAudio(outputUrl,"ijwilab.com");
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  const body=await req.json().catch(()=>null);const text=typeof body?.text==="string"?body.text.trim():"";const lang=typeof body?.lang==="string"?body.lang.toLowerCase():"rw";
  if(!text)return json({error:"Missing TTS text."},400);if(text.length>1200)return json({error:"Speech text is too long."},413);if(lang!=="rw")return json({error:"This endpoint supports Kinyarwanda (rw) only."},400);
  const attempts:string[]=[];
  const providers:Array<{name:string;run:()=>Promise<{base64:string;mime:string;bytes:number}>}>=[
   {name:"Pindo VoiceAI public",run:()=>synthesizePindo(text,false)},
   {name:"IjwiLab Keza",run:()=>synthesizeIjwi(text)},
   {name:"Pindo VoiceAI authenticated",run:()=>synthesizePindo(text,true)},
  ];
  for(const provider of providers){try{
   const audio=await provider.run();
   return json({provider:provider.name,language:"rw",mime_type:audio.mime,audio_base64:audio.base64,audio_bytes:audio.bytes,fallback_used:attempts.length>0,attempts:attempts.map(x=>x.slice(0,180))});
  }catch(error){const message=error instanceof Error?error.message:String(error);attempts.push(`${provider.name}: ${message}`);console.warn("kinya-tts provider attempt failed:",provider.name,message.slice(0,220));}}
  const limited=attempts.some(a=>/HTTP 429|rate limit|quota/i.test(a));
  return json({error:"Kinyarwanda speech is temporarily unavailable. The written reply is still available.",provider:"none",attempts:attempts.map(x=>x.slice(0,180)),rate_limited:limited},502);
 }catch(error){console.error("kinya-tts failed:",error instanceof Error?error.message:String(error));return json({error:"Kinyarwanda speech generation failed. The written reply is still available."},502);}
});