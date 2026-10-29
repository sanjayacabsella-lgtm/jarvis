# Phase Two Architecture

## Mission

Bring JARVIS from a live voice prototype into a practical personal assistant that can quickly answer local operational questions, review repository health, and keep safe, read-only access to project context.

## Core design

### 1. Browser console
- Handles microphone capture, live session state, and audio playback.
- Shows the assistant persona, transcript, and a minimal set of controls.
- Sends repo health requests to the server layer when the user asks for project context.

### 2. Secure runtime API layer
- Central place for all authenticated or sensitive server work.
- Keeps private keys and runtime configuration off the client.
- Exposes a small number of read-only endpoints that return sanitized summaries instead of raw data.

### 3. Repository read gateway
- Fetches basic repository metadata.
- Returns latest commit, open pull requests, open issues, and status summary.
- Keeps the output concise and easy to speak aloud.
- Avoids write or destructive actions.

### 4. Local task and memory layer
- Tracks personal facts, reminders, and short-term memory.
- Stores only the small set of user-specific facts that are useful during a conversation.
- Keeps memory retrieval lightweight and bounded.

### 5. Local device and system bridge
- Reads safe system health information such as CPU, memory, and disk usage when the user requests it.
- Enables commands only when they are explicitly allowed and validated.
- Requires confirmation before any action that could make a system change.

### 6. Observation and monitoring
- Logs usage, session summaries, and operational health.
- Keeps the reporting concise so the assistant remains fast and conversational.
- Stores only minimal telemetry needed for reliability and quality.

## Security rules

- No direct write actions without explicit confirmation.
- No secret data in client requests.
- No raw repository code or token values exposed to the browser.
- No destructive system actions without confirmation.
- Keep conversation data focused on user context and brief summaries.

## Phase Two plan

1. Live voice stays as the primary interface.
2. Add repository status checks as read-only queries.
3. Add polished one-shot task summaries for the user.
4. Add concise memory retrieval and save flow.
5. Add device health checks behind a safe allowlist.
6. Add alerting and resumable session flow after the core system is stable.

## User-facing promise

JARVIS remains a calm, personal assistant. The product experience is designed around trust, clarity, and control, with system internals hidden behind a consistent user interface.
