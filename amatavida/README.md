# Amatavida standalone PWA

Amatavida is a separate voice-first companion PWA at `/amatavida/`. It does not load the AIBOS dashboard, AIBOS login, merchant data, or the AIBOS `advisor` function.

## Implemented in this iteration
- Mobile-first PWA UI with typed chat fallback and language selector (Kinyarwanda, English, French, follow-language).
- Tap-to-record voice input using `MediaRecorder`; tapping again stops recording, transcribes it, and sends the text to the assistant.
- Dedicated Supabase Edge Function named `amatavida` for conversation, transcription, and Kinyarwanda speech generation.
- Kinyarwanda speech-to-text tries Pindo VoiceAI public STT first, then Groq Whisper when configured. English/French selections use Groq Whisper first.
- Kinyarwanda speech replies try Pindo VoiceAI TTS; if audio is unavailable, the UI falls back to browser speech synthesis. English/French use browser speech synthesis.
- Conversation requests use the server-side `GROQ_API_KEY`; no model-provider secret is included in the PWA.
- Short conversational persona, language mirroring, bounded inputs, best-effort request throttling, and a basic high-risk phrase response.
- The app does not save transcripts to local storage or cache chat/API responses in its service worker.

## Important limitations
- The backend deployment and static GitHub Pages commit have been made, but **real device end-to-end voice testing is still required**. Provider access, quota, CORS, speech quality, and playback can vary.
- Pindo and Groq are external services. Their free access, rate limits, privacy terms, and availability can change; this implementation does not guarantee unlimited free usage.
- The public edge endpoint uses best-effort per-runtime throttling, which is not a durable global quota or strong abuse prevention. Add durable rate limits/abuse controls before wider public launch.
- Browser speech synthesis quality and voice availability vary by browser and operating system.
- Crisis phrase detection is only a limited safety aid. Amatavida is not a clinical tool, cannot contact emergency services, and must not diagnose or replace professionals.

## Privacy
Voice recordings are sent to the configured transcription provider (Pindo VoiceAI and/or Groq Whisper). Chat text is sent to Groq for a response. Kinyarwanda reply text may be sent to Pindo for speech synthesis. Amatavida does not intentionally persist chat history on the server or in browser storage, but providers may process requests under their own terms. Do not submit passwords, payment details, or identifying medical records.

## Deploy on GitHub Pages
`https://jadookay.github.io/ai-merchant-os/amatavida/`

## Test checklist
1. Open the page on Android Chrome over HTTPS.
2. Allow microphone access.
3. Select **Kinyarwanda**, tap the microphone, say a full sentence, then tap again to stop.
4. Confirm the recognized text is sent automatically and a reply is spoken.
5. Repeat with English and French; confirm text transcription and browser speech work.
6. Test slow network, provider failure, empty recording, deny microphone, and text-only chat.
7. Confirm no secrets are present in the frontend and no chat transcript is persisted.
