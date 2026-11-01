// Small synthesized sound cues and haptics. No audio files needed.
// Cues are intentionally quiet; they run on their own AudioContext so they also work in standby mode.

export type Cue = "wake" | "standby" | "think" | "done" | "error" | "share";

type Tone = { freq: number; at: number; dur: number; gain: number; type?: OscillatorType; slideTo?: number };

const CUES: Record<Cue, Tone[]> = {
  wake: [
    { freq: 659.25, at: 0, dur: 0.14, gain: 0.05 },
    { freq: 987.77, at: 0.09, dur: 0.22, gain: 0.05 },
    { freq: 1318.51, at: 0.2, dur: 0.32, gain: 0.03 },
  ],
  standby: [{ freq: 392, at: 0, dur: 0.38, gain: 0.03 }],
  think: [
    { freq: 880, at: 0, dur: 0.07, gain: 0.02 },
    { freq: 880, at: 0.12, dur: 0.07, gain: 0.015 },
  ],
  done: [
    { freq: 783.99, at: 0, dur: 0.16, gain: 0.04 },
    { freq: 523.25, at: 0.12, dur: 0.32, gain: 0.035 },
  ],
  error: [
    { freq: 220, at: 0, dur: 0.2, gain: 0.05, type: "triangle" },
    { freq: 174.61, at: 0.16, dur: 0.36, gain: 0.05, type: "triangle" },
  ],
  share: [
    { freq: 1046.5, at: 0, dur: 0.08, gain: 0.03 },
    { freq: 1568, at: 0.07, dur: 0.14, gain: 0.025 },
  ],
};

let cueContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!cueContext || cueContext.state === "closed") cueContext = new AudioContext();
    if (cueContext.state === "suspended") void cueContext.resume();
    return cueContext;
  } catch {
    return null;
  }
}

export function playCue(cue: Cue): void {
  const context = getContext();
  if (!context) return;
  const base = context.currentTime + 0.01;

  for (const tone of CUES[cue]) {
    const start = base + tone.at;
    const end = start + tone.dur;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type ?? "sine";
    oscillator.frequency.setValueAtTime(tone.freq, start);
    if (tone.slideTo) oscillator.frequency.exponentialRampToValueAtTime(tone.slideTo, end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}

// Haptics work on Android Chrome. iOS Safari ignores vibration, which is fine.
export function haptic(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* vibration is optional */
  }
}
