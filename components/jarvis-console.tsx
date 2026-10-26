"use client";

import { GoogleGenAI, Modality } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  INPUT_SAMPLE_RATE,
  LIVE_MODEL,
  OUTPUT_SAMPLE_RATE,
} from "@/lib/live-config";

type ConsoleState = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "error";
type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;

type IncomingMessage = {
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  };
};

type TokenResponse = {
  token?: string;
  model?: string;
  systemInstruction?: string;
  error?: string;
};

const stateLabels: Record<ConsoleState, string> = {
  ready: "සූදානම්",
  connecting: "සම්බන්ධ වෙමින්",
  listening: "අසාගෙන සිටී",
  thinking: "සිතමින්",
  speaking: "පිළිතුරු දෙමින්",
  error: "සම්බන්ධතාවේ ගැටලුවක්",
};

function pcmToBase64(samples: Float32Array, sourceRate: number): string {
  const ratio = sourceRate / INPUT_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const mix = sourceIndex - left;
    const sample = Math.max(-1, Math.min(1, samples[left] * (1 - mix) + samples[right] * mix));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return window.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export default function JarvisConsole() {
  const [status, setStatus] = useState<ConsoleState>("ready");
  const [preferredAddress, setPreferredAddress] = useState("සර්");
  const [errorMessage, setErrorMessage] = useState("");
  const sessionRef = useRef<LiveSession | null>(null);
  const statusRef = useRef<ConsoleState>("ready");
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackCursorRef = useRef(0);
  const userSpeakingRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const reactorRef = useRef<HTMLDivElement | null>(null);

  const updateStatus = useCallback((next: ConsoleState) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      source.onended = null;
      try { source.stop(); } catch { /* A source may already have ended. */ }
      source.disconnect();
    }
    activeSourcesRef.current = [];
    playbackCursorRef.current = outputContextRef.current?.currentTime ?? 0;
  }, []);

  const releaseAudio = useCallback(() => {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    userSpeakingRef.current = false;
    micNodeRef.current?.port.close();
    micNodeRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    const micContext = micContextRef.current;
    const outputContext = outputContextRef.current;
    micStreamRef.current = null;
    micNodeRef.current = null;
    micSourceRef.current = null;
    micContextRef.current = null;
    outputContextRef.current = null;
    analyserRef.current = null;
    reactorRef.current?.style.setProperty("--audio-level", "0.04");
    if (micContext && micContext.state !== "closed") void micContext.close();
    if (outputContext && outputContext.state !== "closed") void outputContext.close();
  }, []);

  const playAudioChunk = useCallback((encodedAudio: string) => {
    const context = outputContextRef.current;
    const analyser = analyserRef.current;
    if (!context || !analyser) return;

    const bytes = decodeBase64(encodedAudio);
    const sampleCount = Math.floor(bytes.length / 2);
    if (sampleCount === 0) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    const buffer = context.createBuffer(1, sampleCount, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const startAt = Math.max(context.currentTime + 0.015, playbackCursorRef.current);
    source.start(startAt);
    playbackCursorRef.current = startAt + buffer.duration;
    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((item) => item !== source);
      source.disconnect();
      if (activeSourcesRef.current.length === 0 && statusRef.current === "speaking") {
        updateStatus("listening");
      }
    };
    updateStatus("speaking");
  }, [updateStatus]);

  const releaseSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    try { session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* Session may already be closed. */ }
    try { session?.close(); } catch { /* Session may already be closed. */ }
    clearPlayback();
    releaseAudio();
  }, [clearPlayback, releaseAudio]);

  const startSession = useCallback(async () => {
    setErrorMessage("");
    updateStatus("connecting");

    try {
      const outputContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      outputContextRef.current = outputContext;
      const micContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      micContextRef.current = micContext;
      await Promise.all([outputContext.resume(), micContext.resume()]);
      await micContext.audioWorklet.addModule("/audio-processor.js");
      const analyser = outputContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(outputContext.destination);
      analyserRef.current = analyser;

      const oscillator = outputContext.createOscillator();
      const chimeGain = outputContext.createGain();
      chimeGain.gain.setValueAtTime(0.0001, outputContext.currentTime);
      chimeGain.gain.exponentialRampToValueAtTime(0.035, outputContext.currentTime + 0.06);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, outputContext.currentTime + 0.55);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, outputContext.currentTime);
      oscillator.frequency.setValueAtTime(783.99, outputContext.currentTime + 0.16);
      oscillator.connect(chimeGain);
      chimeGain.connect(outputContext.destination);
      oscillator.start();
      oscillator.stop(outputContext.currentTime + 0.58);
      oscillator.onended = () => {
        oscillator.disconnect();
        chimeGain.disconnect();
      };

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("මෙම browser එක microphone භාවිතයට සහාය නොදක්වයි.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;

      const tokenResponse = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ preferredAddress: preferredAddress.trim() || "සර්" }),
      });
      const tokenData = (await tokenResponse.json()) as TokenResponse;
      if (!tokenResponse.ok || !tokenData.token || !tokenData.systemInstruction) {
        throw new Error(tokenData.error || "Live session එක ආරම්භ කළ නොහැකි වුණා.");
      }

      const ai = new GoogleGenAI({ apiKey: tokenData.token });
      const session = await ai.live.connect({
        model: tokenData.model || LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: tokenData.systemInstruction }] },
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: 650,
            },
          },
        },
        callbacks: {
          onopen: () => updateStatus("listening"),
          onmessage: (rawMessage) => {
            const message = rawMessage as IncomingMessage;
            const content = message.serverContent;
            if (!content) return;

            if (content.interrupted) {
              clearPlayback();
              updateStatus("listening");
              return;
            }

            for (const part of content.modelTurn?.parts ?? []) {
              const audio = part.inlineData;
              if (audio?.data && (!audio.mimeType || audio.mimeType.startsWith("audio/pcm"))) {
                playAudioChunk(audio.data);
              }
            }

            if (content.turnComplete && activeSourcesRef.current.length === 0) {
              updateStatus("listening");
            }
          },
          onerror: () => {
            setErrorMessage("සජීවී හඬ සම්බන්ධතාවේ ගැටලුවක් ඇති වුණා. නැවත සම්බන්ධ කරන්න.");
            releaseSession();
            updateStatus("error");
          },
          onclose: () => {
            clearPlayback();
            releaseAudio();
            sessionRef.current = null;
            if (statusRef.current !== "error") updateStatus("ready");
          },
        },
      });
      sessionRef.current = session;

      const source = micContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(micContext, "jarvis-mic-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      micSourceRef.current = source;
      micNodeRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const samples = event.data;
        let sumSquares = 0;
        for (let index = 0; index < samples.length; index += 1) sumSquares += samples[index] * samples[index];
        const rms = Math.sqrt(sumSquares / samples.length);
        reactorRef.current?.style.setProperty("--audio-level", String(Math.min(1, rms * 7)));

        if (rms > 0.025) {
          if (statusRef.current === "thinking") updateStatus("listening");
          userSpeakingRef.current = true;
          if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
        } else if (userSpeakingRef.current) {
          if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            userSpeakingRef.current = false;
            if (statusRef.current === "listening") updateStatus("thinking");
          }, 650);
        }

        const currentSession = sessionRef.current;
        if (currentSession) {
          try {
            currentSession.sendRealtimeInput({
              audio: { data: pcmToBase64(samples, micContext.sampleRate), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
            });
          } catch {
            setErrorMessage("Microphone audio එක Live API වෙත යැවිය නොහැකි වුණා.");
            releaseSession();
            updateStatus("error");
          }
        }
      };

      source.connect(worklet);
      await micContext.resume();
      updateStatus("listening");
      window.localStorage.setItem("jarvis-preferred-address", preferredAddress.trim() || "සර්");
    } catch (error) {
      const message = error instanceof Error ? error.message : "සම්බන්ධතාව ආරම්භ කළ නොහැකි වුණා.";
      setErrorMessage(message);
      releaseSession();
      updateStatus("error");
    }
  }, [clearPlayback, playAudioChunk, preferredAddress, releaseAudio, releaseSession, updateStatus]);

  useEffect(() => {
    const savedAddress = window.localStorage.getItem("jarvis-preferred-address");
    if (savedAddress) setPreferredAddress(savedAddress);
  }, []);

  useEffect(() => {
    const resumeAudioWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const context of [micContextRef.current, outputContextRef.current]) {
        if (context?.state === "suspended") {
          void context.resume().catch(() => {
            setErrorMessage("Browser audio එක නවතා ඇත. නැවත සම්බන්ධ කර බලන්න.");
            releaseSession();
            updateStatus("error");
          });
        }
      }
    };
    document.addEventListener("visibilitychange", resumeAudioWhenVisible);
    return () => document.removeEventListener("visibilitychange", resumeAudioWhenVisible);
  }, [releaseSession, updateStatus]);

  useEffect(() => {
    let frame = 0;
    const data = new Uint8Array(256);
    const animate = () => {
      const analyser = analyserRef.current;
      if (analyser && statusRef.current === "speaking") {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const sample of data) {
          const centered = (sample - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        reactorRef.current?.style.setProperty("--audio-level", String(Math.min(1, rms * 5)));
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => releaseSession(), [releaseSession]);

  const connected = status === "listening" || status === "thinking" || status === "speaking";
  const busy = status === "connecting";
  const visualState = status === "error" ? "ready" : status;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand" aria-label="JARVIS">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <span className="brand-name">JARVIS</span>
            <span className="brand-sub">VOICE INTERFACE / 01</span>
          </div>
        </div>
        <div className="phase-tag"><b>PHASE 01</b><span>LIVE AUDIO</span></div>
        <div className={`connection-badge ${connected ? "online" : busy ? "busy" : ""}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {stateLabels[status]}
        </div>
      </header>

      <section className="content">
        <div className="intro">
          <div className="kicker">PERSONAL VOICE INTERFACE · GEMINI LIVE</div>
          <h1>කතා කරන්න.<br /><span>මම අහගෙන.</span></h1>
          <p className="intro-copy">
            Sinhala හෝ English—ඔබ කතා කරන භාෂාවෙන්ම පිළිතුරු දෙන්නම්. මේ පළමු අදියරේදී JARVIS සජීවී හඬ සංවාදයට සූදානම්.
          </p>

          <div className="voice-card">
            <label className="field-label" htmlFor="preferred-address">ඔබට අමතන්න කැමති විදිහ</label>
            <div className="address-row">
              <input
                id="preferred-address"
                className="address-input"
                value={preferredAddress}
                onChange={(event) => setPreferredAddress(event.target.value.slice(0, 32))}
                maxLength={32}
                placeholder="උදා: සර්, නම"
                autoComplete="off"
                disabled={connected || busy}
              />
            </div>
            <p className="field-hint">මෙම තේරීම මෙම browser එකේ පමණක් සුරැකේ.</p>
            <div className="action-row">
              {!connected ? (
                <button className="primary-button" onClick={startSession} disabled={busy}>
                  <span className="button-icon" aria-hidden="true">{busy ? "···" : "◉"}</span>
                  {busy ? "සම්බන්ධ වෙමින්…" : status === "error" ? "නැවත සම්බන්ධ කරන්න" : "හඬ සංවාදය අරඹන්න"}
                </button>
              ) : (
                <button className="quiet-button" onClick={releaseSession}>සංවාදය අවසන් කරන්න</button>
              )}
            </div>
            {errorMessage && <p className="error-note" role="alert">{errorMessage}</p>}
          </div>

          <p className="privacy-note">
            ඔබේ හඬ සජීවීව Google Gemini Live API වෙත යවයි. මෙම app එක හඬ හෝ පිටපතක් ගබඩා නොකරයි. ඔබ තෝරාගත් ආමන්ත්‍රණය browser එකේ සුරැකෙන අතර session එක ආරම්භයේදී යවයි. Google සේවාවේ වත්මන් පෞද්ගලිකත්ව කොන්දේසි සහ quota සීමා පරීක්ෂා කරන්න.
          </p>
        </div>

        <div className="reactor-column">
          <div ref={reactorRef} className={`reactor-shell ${visualState}`} aria-hidden="true">
            <div className="reactor-ring outer" />
            <div className="reactor-ring mid" />
            <div className="reactor-ring inner" />
            <div className="reactor-tick" />
            <span className="orbit-label top">J·A·R·V·I·S / LIVE</span>
            <div className="reactor-core" />
            <span className="orbit-label bottom">AUDIO LINK · {status === "ready" || status === "error" ? "STANDBY" : "ACTIVE"}</span>
          </div>
          <div className="reactor-caption"><strong>{stateLabels[status]}</strong> · {connected ? "හඬ සබැඳිය සක්‍රීයයි" : "සබැඳිය විවෘත කිරීමට සූදානම්"}</div>
          <div className="sound-bars" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>

          <aside className="side-rail" aria-label="සංවාද තත්ත්වය">
            <div className="rail-head"><span>SESSION TELEMETRY</span><span>01 / 01</span></div>
            <div className="rail-rule" />
            <div className="rail-row"><span>භාෂා</span><b>SINHALA + ENGLISH</b></div>
            <div className="rail-row"><span>Live model</span><b>{LIVE_MODEL}</b></div>
            <div className="rail-row"><span>සම්බන්ධතාව</span><b className={connected ? "live-value" : ""}>{stateLabels[status]}</b></div>
          </aside>
        </div>
      </section>

      <footer className="footer">
        <span>JARVIS · LIVE VOICE · PHASE 01</span>
        <span>සජීවී සංවාදය · <a href="https://ai.google.dev/gemini-api/docs/live-api" target="_blank" rel="noreferrer">Gemini Live API</a></span>
      </footer>
    </main>
  );
}
