# Amatavida standalone PWA — first scaffold

This folder is a separate PWA under the existing GitHub Pages repository. It does not load the AIBOS dashboard, AIBOS login, merchant data, or the AIBOS `advisor` function.

## What is in this first scaffold
- Installable PWA manifest and standalone service worker.
- Mobile-first conversation interface and typed-message fallback.
- Browser speech recognition where supported and browser speech synthesis for spoken replies.
- Crisis-sensitive local response for a small set of explicit high-risk phrases.
- No chat transcript is written to local storage or cached by the service worker.

## Important current limitation
**The independent AI conversation backend is not connected yet.** Without a backend URL, Amatavida deliberately says so instead of pretending to understand or inventing an AI answer. The current browser speech recognition / speech synthesis capabilities vary by device and language; this is not yet verified as reliable Kinyarwanda voice-to-voice.

## Next engineering stage
1. Create a dedicated, secured Amatavida backend endpoint and its own model configuration. Never put an AI provider secret in this static PWA.
2. Implement server-side safety behavior and multilingual prompt policy, and return a small JSON response such as `{ "reply": "..." }`.
3. Configure `window.AMATAVIDA_CONFIG.apiUrl` before this app's inline script, pointing only to that independent endpoint.
4. Test Kinyarwanda STT/TTS providers and fallbacks on the target Android phone, including failures, interruptions, and low bandwidth.
5. Add a clear privacy notice and consent choices before storing any conversations; do not collect sensitive health details unnecessarily.

## Deploy on GitHub Pages
The app will be served at:
`https://jadookay.github.io/ai-merchant-os/amatavida/`

It is a prototype, not a clinical tool. It must not diagnose, replace healthcare professionals, or claim emergency response capability. For immediate danger, it should guide users to real human and local emergency support. The crisis response currently included in the frontend is only a temporary guardrail; it is not sufficient as a production safety system.
