// Standby wake word using the browser's built-in speech recognition (Chrome / Edge).
//
// Honest limits:
// - Works only while this page is open and the screen is on. Browsers suspend microphones for locked or backgrounded pages.
// - Chrome's recognizer sends standby audio to Google's speech service. Gemini quota is NOT used while waiting.
// - A future on-device engine (for example an openWakeWord "hey jarvis" model) can replace this behind the same interface.

export type WakeWordHandle = { stop: () => void };

type WakeWordOptions = {
  onWake: (heard: string) => void;
  onProblem?: (message: string, fatal: boolean) => void;
  lang?: string;
};

type RecognitionResultLike = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResultLike> };
type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => RecognitionLike;

const WAKE_PATTERN = /\b(?:jarvis|jarvas|jervis|harvis|charvis|javis)\b|ජාවිස්|ජාර්විස්/i;

function getConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function isWakeWordSupported(): boolean {
  return getConstructor() !== null;
}

export function startWakeWord(options: WakeWordOptions): WakeWordHandle {
  const Recognition = getConstructor();
  if (!Recognition) {
    options.onProblem?.("Standby needs Chrome or Edge, because this browser has no speech recognition.", true);
    return { stop: () => undefined };
  }

  let stopped = false;
  let recognition: RecognitionLike | null = null;
  let restartTimer: number | null = null;
  let failures = 0;

  const scheduleRestart = (delayMs: number) => {
    if (stopped) return;
    if (restartTimer !== null) window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(launch, delayMs);
  };

  function launch() {
    if (stopped) return;
    restartTimer = null;
    const instance = new Recognition!();
    recognition = instance;
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = options.lang ?? "en-US";
    instance.maxAlternatives = 3;

    instance.onresult = (event) => {
      if (stopped) return;
      failures = 0;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        for (let alt = 0; alt < result.length; alt += 1) {
          const heard = result[alt].transcript;
          if (WAKE_PATTERN.test(heard)) {
            stopped = true;
            try { instance.abort(); } catch { /* already stopped */ }
            options.onWake(heard);
            return;
          }
        }
      }
    };

    instance.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "not-allowed" || code === "service-not-allowed") {
        stopped = true;
        options.onProblem?.("Microphone or speech recognition permission was denied, so standby cannot listen.", true);
      } else if (code === "audio-capture") {
        stopped = true;
        options.onProblem?.("No microphone was found for standby.", true);
      } else if (code === "network") {
        failures += 1;
      }
    };

    instance.onend = () => {
      recognition = null;
      if (stopped) return;
      scheduleRestart(failures > 0 ? Math.min(8000, 800 * 2 ** failures) : 250);
    };

    try {
      instance.start();
    } catch {
      scheduleRestart(1000);
    }
  }

  launch();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      restartTimer = null;
      try { recognition?.abort(); } catch { /* already stopped */ }
      recognition = null;
    },
  };
}
