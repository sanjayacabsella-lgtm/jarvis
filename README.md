# JARVIS — Phase 1

Sinhala-first, voice-first JARVIS prototype using Google's Gemini Live API. This repository contains **Phase 1 only**: a direct browser WebSocket voice session, server-issued ephemeral tokens, interruption-aware audio playback, a compact persona, and an audio-reactive HUD.

## Local setup

Use Node.js 22 and pnpm 11.25.0 (pinned in `package.json`). Copy `.env.example` to `.env.local`, add a Google Gemini API key to `GEMINI_API_KEY`, then run:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000` in a modern browser and allow microphone access. The API key is read only by `app/api/live-token/route.ts`; never rename it to a `NEXT_PUBLIC_` variable, commit `.env.local`, or put it in browser code.

## Vercel

Import this repository as a Next.js project in Vercel. Add `GEMINI_API_KEY` in Vercel's server-side Environment Variables for the environments you use, then deploy. Do not add the key to GitHub or to a `NEXT_PUBLIC_` variable. A Vercel account is not connected by this project, so account linking and deployment remain to be done there.

The token endpoint constrains tokens to the configured Live model and audio session, gives each token one use, validates same-origin requests, and applies a best-effort in-memory limit of six requests per minute keyed by `x-real-ip`. Deploy only behind an ingress that overwrites this header with a trusted client IP; otherwise callers may spoof the limit key. Vercel serverless instances do not share memory, and same-origin validation is not authentication: any visitor can request a token. Before broad public use, add a durable rate limiter and decide how token issuance should be restricted. Do not treat the in-memory limiter as an account-level security control.

## Phase 1 boundaries

The JARVIS app itself has no GitHub/Vercel automation, Groq bridge, memory, local computer agent, wake-word listener, PWA install flow, or fallback STT/TTS. The app does not save voice recordings or transcripts. The preferred form of address is stored in browser local storage and sent to the token endpoint when a session starts; it is not persisted by the server.

Gemini Live supports Sinhala (`si`) among its documented supported languages and supports barge-in. Audio-only sessions have a 15-minute session limit; an individual WebSocket connection can end around 10 minutes, and this phase does not implement session resumption. Plan for reconnect/session lifecycle work in a later phase. Audio is sent to Google's service, so review its current privacy terms and check your account's current quota before use.

## References

- [Gemini Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Gemini Live model: `gemini-3.8-live`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
- [Live API capabilities, VAD and languages](https://ai.google.dev/gemini-api/docs/live-guide)
- [Live session management](https://ai.google.dev/gemini-api/docs/live-session)
