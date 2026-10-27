import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import {
  buildSystemInstruction,
  END_OF_SPEECH_SILENCE_MS,
  LIVE_MODEL,
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
  if (typeof value !== "string") return "සර්";
  const normalized = value.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 32) return "සර්";
  if (!/^[\p{L}\p{M}\p{N} .'’_-]+$/u.test(normalized)) return "සර්";
  return normalized;
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return jsonError("මෙම ඉල්ලීම පිළිගත නොහැක.", 403);
  }

  if (!allowTokenRequest(request)) {
    return jsonError("ඉල්ලීම් සීමාව ඉක්මවා ඇත. මිනිත්තුවකින් නැවත උත්සාහ කරන්න.", 429);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonError("Server එකේ Gemini API key එක සකසා නැත.", 503);
  }

  let preferredAddress = "සර්";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "preferredAddress" in body) {
      preferredAddress = safeAddress((body as { preferredAddress?: unknown }).preferredAddress);
    }
  } catch {
    return jsonError("ඉල්ලීමේ දත්ත කියවිය නොහැක.", 400);
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
        systemInstruction,
        expiresAt: token.expireTime,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return jsonError("Gemini Live token එක ලබාගත නොහැකි වුණා. API key සහ quota පරීක්ෂා කරන්න.", 502);
  }
}
