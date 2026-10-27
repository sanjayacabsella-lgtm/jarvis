import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import {
  buildSystemInstruction,
  END_OF_SPEECH_SILENCE_MS,
  LIVE_MODEL,
  normalizeVoicePreference,
  VOICE_PRESETS,
} from "@/lib/live-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function allowTokenRequest(request: Request): boolean {
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  const now = Date.now();
  if (requestWindows.size > 1000) {
    for (const [key, entry] of requestWindows) {
      if (now - entry.startedAt >= RATE_WINDOW_MS) requestWindows.delete(key);
    }
  }
  const current = requestWindows.get(ip);

  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    requestWindows.set(ip, { count: 1, startedAt: now });
    return true;
  }

  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

function safeAddress(value: unknown): string {
  if (typeof value !== "string") return "Sir";
  const normalized = value.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 32) return "Sir";
  if (!/^[A-Za-z0-9 .'’_-]+$/.test(normalized)) return "Sir";
  return normalized;
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return jsonError("This request is not allowed.", 403);
  }

  if (!allowTokenRequest(request)) {
    return jsonError("Request limit reached. Try again in one minute.", 429);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonError("The Gemini API key is not configured on the server.", 503);
  }

  let preferredAddress = "Sir";
  let assistantVoice: keyof typeof VOICE_PRESETS = "male";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      if ("preferredAddress" in body) {
        preferredAddress = safeAddress((body as { preferredAddress?: unknown }).preferredAddress);
      }
      if ("assistantVoice" in body) {
        assistantVoice = normalizeVoicePreference((body as { assistantVoice?: unknown }).assistantVoice);
      }
    }
  } catch {
    return jsonError("The request body could not be read.", 400);
  }

  const systemInstruction = buildSystemInstruction(preferredAddress);
  const now = Date.now();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICE_PRESETS[assistantVoice] },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(
      {
        token: token.name,
        model: LIVE_MODEL,
        assistantVoice,
        systemInstruction,
        expiresAt: token.expireTime,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return jsonError("Could not create a Gemini Live token. Check the API key and quota.", 502);
  }
}
