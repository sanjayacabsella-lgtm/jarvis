import { createHash, timingSafeEqual } from "node:crypto";

export type AccessResult = { ok: true } | { ok: false; status: number; message: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Personal access gate. Set JARVIS_ACCESS_CODE on the server.
// In development with no code set, requests are allowed. In production with no code set, they are refused (fail closed).
export function checkAccess(request: Request): AccessResult {
  const expected = process.env.JARVIS_ACCESS_CODE?.trim();

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 503, message: "Set JARVIS_ACCESS_CODE on the server before using JARVIS in production." };
    }
    return { ok: true };
  }

  const provided = request.headers.get("x-jarvis-code") ?? "";
  if (timingSafeEqual(digest(provided), digest(expected))) return { ok: true };
  return { ok: false, status: 401, message: "Access code required or incorrect." };
}
