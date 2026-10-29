# JARVIS — Phase One

JARVIS is a voice-first personal assistant created for Hasith Heshan. It listens, responds in real time, and keeps the experience focused on a calm, useful conversational flow.

## Local run

Use Node.js 22 and the package manager version in `package.json`.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000` in a browser, allow microphone access, and begin the live session.

## Environment

Create a local environment file from `.env.example` and add your private server-side key.

```bash
cp .env.example .env.local
```

## Safety and privacy

- The app keeps the voice interface focused on the live session only.
- No audio or transcripts are stored by the app after the session ends.
- The system is designed to avoid exposing backend implementation details to the user.
- The assistant identity is kept as JARVIS, without exposing the underlying engine or vendor branding in the user experience.

## Current scope

This phase focuses on:
- live voice session
- speech recognition and interruption handling
- instant voice response playback
- clean HUD and session state flow
- private server-side key handling

## Notes

The public experience is intentionally minimal and product-first: JARVIS speaks naturally, answers clearly, and keeps the system hidden behind the assistant persona.
