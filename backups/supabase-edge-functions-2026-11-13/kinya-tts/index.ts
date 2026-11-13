import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const token = Deno.env.get("PINDO_API_TOKEN");
    if (!token) {
      console.error("kinya-tts: PINDO_API_TOKEN secret is missing.");
      return json({ error: "Kinyarwanda voice is not configured on the server." }, 503);
    }

    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const lang = typeof body?.lang === "string" ? body.lang.toLowerCase() : "rw";

    if (!text) return json({ error: "Missing TTS text." }, 400);
    if (text.length > 1200) return json({ error: "Speech text is too long." }, 413);
    if (lang !== "rw") return json({ error: "This endpoint supports Kinyarwanda (rw) only." }, 400);

    const callPindo = async () => {
      const response = await fetch("https://api.pindo.io/ai/tts/rw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ text, lang: "rw", speech_rate: 1.06 }),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await response.text();
      let payload: any = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
      if (!response.ok) {
        // Log only a bounded provider response body; never log the bearer token.
        console.warn("kinya-tts: Pindo returned HTTP", response.status, "body:", raw.slice(0, 500));
        return { response, payload, raw };
      }
      const audioPath = payload?.data?.generated_audio_url ?? payload?.generated_audio_url;
      if (typeof audioPath !== "string" || !audioPath.trim()) {
        console.warn("kinya-tts: Pindo response did not contain generated_audio_url.");
        return { response, payload, raw };
      }
      return { response, payload, raw, audioUrl: new URL(audioPath, "https://api.pindo.io/").toString() };
    };

    let result = await callPindo();
    if (result.response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await callPindo();
    }

    if (!result.response.ok) {
      const status = result.response.status;
      const providerMessage =
        (typeof result.payload?.message === "string" && result.payload.message) ||
        (typeof result.payload?.error === "string" && result.payload.error) ||
        (typeof result.payload?.details === "string" && result.payload.details) ||
        (typeof result.payload?.detail === "string" && result.payload.detail) ||
        (typeof result.payload?.description === "string" && result.payload.description) ||
        (status === 409
          ? "Pindo returned HTTP 409 Conflict. Check the provider detail below; this is not the browser playback error."
          : status === 429
            ? "Pindo rate limit or quota reached."
            : "Pindo TTS request failed.");
      const rawDetail = !result.payload && result.raw ? result.raw.slice(0, 350) : undefined;
      return json({
        error: providerMessage,
        provider: "Pindo VoiceAI",
        provider_status: status,
        ...(rawDetail ? { provider_detail: rawDetail } : {}),
      }, status === 429 || status === 409 ? status : 502);
    }
    if (!result.audioUrl) return json({ error: "Pindo did not return an audio URL.", provider: "Pindo VoiceAI" }, 502);

    const audioResponse = await fetch(result.audioUrl, { signal: AbortSignal.timeout(20000) });
    if (!audioResponse.ok) {
      console.warn("kinya-tts: audio download returned HTTP", audioResponse.status);
      return json({ error: "Could not retrieve generated speech audio.", provider_status: audioResponse.status }, 502);
    }
    const audioBytes = new Uint8Array(await audioResponse.arrayBuffer());
    if (!audioBytes.length || audioBytes.length > 12_000_000) {
      return json({ error: "Generated speech audio was empty or unexpectedly large." }, 502);
    }

    let binary = "";
    for (let i = 0; i < audioBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + 0x8000));
    }

    return json({
      provider: "Pindo VoiceAI (authenticated)",
      language: "rw",
      mime_type: audioResponse.headers.get("content-type") || "audio/wav",
      audio_base64: btoa(binary),
      audio_bytes: audioBytes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("kinya-tts failed:", message);
    return json({ error: message.includes("timed out") ? "Pindo voice request timed out." : "Kinyarwanda speech generation failed." }, 502);
  }
});