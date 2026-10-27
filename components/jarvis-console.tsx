"use client";

import { GoogleGenAI, Modality } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  END_OF_SPEECH_SILENCE_MS,
  INPUT_SAMPLE_RATE,
  LIVE_MODEL,
  OUTPUT_SAMPLE_RATE,
} from "@/lib/live-config";

type ConsoleState = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "error";
type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;
type Transcript = { text?: string };

type IncomingMessage = {
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: Transcript;
    interimInputTranscription?: Transcript;
    outputTranscription?: Transcript;
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
  listening: "ඔබට සවන් දෙමින්",
  thinking: "පිළිතුර සකස් කරමින්",
  speaking: "කතා කරමින්",
  error: "සම්බන්ධතාවේ ගැටලුවක්",
};

const stateDescriptions: Record<ConsoleState, string> = {
  ready: "හඬ සංවාදය ආරම්භ කිරීමට සූදානම්",
  connecting: "මයික්‍රෆෝනය සහ සජීවී හඬ සම්බන්ධතාව සකසමින්",
  listening: "ඔබේ හඬට සවන් දෙමින් සිටී",
  thinking: "ඔබට පිළිතුර සකස් කරමින් සිටී",
  speaking: "JARVIS දැන් කතා කරමින් සිටී",
  error: "සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න",
};

function appendTranscriptChunk(current: string, incoming: string): string {
  const chunk = incoming.trim();
  if (!chunk) return current;
  if (!current) return chunk.slice(-1400);
  const extendsCurrent = chunk.length > current.length && chunk.startsWith(current) && /[\s.,!?;:…]/u.test(chunk[current.length]);
  if (extendsCurrent) return chunk.slice(-1400);

  const needsSpace = !/\s$/.test(current) && !/^[\s.,!?;:…]/u.test(chunk);
  return `${current}${needsSpace ? " " : ""}${chunk}`.slice(-1400);
}

function combineTranscripts(committed: string, interim: string): string {
  if (!committed) return interim;
  if (!interim || interim.startsWith(committed)) return interim || committed;
  if (committed.startsWith(interim)) return committed;
  const needsSpace = !/\s$/.test(committed) && !/^[\s.,!?;:…]/u.test(interim);
  return `${committed}${needsSpace ? " " : ""}${interim}`;
}

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
  const [heardText, setHeardText] = useState("");
  const [spokenText, setSpokenText] = useState("");
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
  const heardCommittedRef = useRef("");
  const heardInterimRef = useRef("");
  const userTranscriptFinalizedRef = useRef(false);
  const spokenTextRef = useRef("");

  const updateStatus = useCallback((next: ConsoleState) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const resetTranscripts = useCallback(() => {
    heardCommittedRef.current = "";
    heardInterimRef.current = "";
    userTranscriptFinalizedRef.current = false;
    spokenTextRef.current = "";
    setHeardText("");
    setSpokenText("");
  }, []);

  const clearPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      source.onended = null;
      try { source.stop(); } catch { /* ශබ්ද මූලාශ්‍රය දැනටමත් අවසන් වී තිබිය හැක. */ }
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
    reactorRef.current?.style.setProperty("--audio-level", "0.035");
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
    try { session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* සම්බන්ධතාව අවසන් වී තිබිය හැක. */ }
    try { session?.close(); } catch { /* සම්බන්ධතාව දැනටමත් වසා තිබිය හැක. */ }
    clearPlayback();
    releaseAudio();
    resetTranscripts();
  }, [clearPlayback, releaseAudio, resetTranscripts]);

  const startSession = useCallback(async () => {
    setErrorMessage("");
    resetTranscripts();
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
        throw new Error("මෙම බ්‍රවුසරයෙන් මයික්‍රෆෝනය භාවිත කළ නොහැක.");
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
        throw new Error(tokenData.error || "සජීවී හඬ සංවාදය ආරම්භ කළ නොහැකි විය.");
      }

      const ai = new GoogleGenAI({ apiKey: tokenData.token });
      const session = await ai.live.connect({
        model: tokenData.model || LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: tokenData.systemInstruction }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
            },
          },
        },
        callbacks: {
          onopen: () => updateStatus("listening"),
          onmessage: (rawMessage) => {
            const message = rawMessage as IncomingMessage;
            const content = message.serverContent;
            if (!content) return;

            const interimText = content.interimInputTranscription?.text;
            if (interimText && !userTranscriptFinalizedRef.current) {
              heardInterimRef.current = interimText.trim();
              setHeardText(combineTranscripts(heardCommittedRef.current, heardInterimRef.current));
            }
            const finalText = content.inputTranscription?.text;
            if (finalText) {
              heardCommittedRef.current = appendTranscriptChunk(heardCommittedRef.current, finalText);
              heardInterimRef.current = "";
              userTranscriptFinalizedRef.current = true;
              setHeardText(heardCommittedRef.current);
            }
            if (content.outputTranscription?.text) {
              spokenTextRef.current = appendTranscriptChunk(spokenTextRef.current, content.outputTranscription.text);
              setSpokenText(spokenTextRef.current);
            }

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
            setErrorMessage("සජීවී හඬ සම්බන්ධතාවයේ ගැටලුවක් ඇති විය. නැවත සම්බන්ධ කරන්න.");
            releaseSession();
            updateStatus("error");
          },
          onclose: () => {
            clearPlayback();
            releaseAudio();
            resetTranscripts();
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
          if (!userSpeakingRef.current) {
            heardCommittedRef.current = "";
            heardInterimRef.current = "";
            userTranscriptFinalizedRef.current = false;
            spokenTextRef.current = "";
            setHeardText("");
            setSpokenText("");
          }
          if (statusRef.current === "thinking") updateStatus("listening");
          userSpeakingRef.current = true;
          if (silenceTimerRef.current !== null) {
            window.clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (userSpeakingRef.current && silenceTimerRef.current === null) {
          silenceTimerRef.current = window.setTimeout(() => {
            silenceTimerRef.current = null;
            userSpeakingRef.current = false;
            if (statusRef.current === "listening") updateStatus("thinking");
          }, END_OF_SPEECH_SILENCE_MS);
        }

        const currentSession = sessionRef.current;
        if (currentSession) {
          try {
            currentSession.sendRealtimeInput({
              audio: { data: pcmToBase64(samples, micContext.sampleRate), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
            });
          } catch {
            setErrorMessage("මයික්‍රෆෝනයේ හඬ සජීවී සේවාව වෙත යැවිය නොහැකි විය.");
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
      const message = error instanceof Error ? error.message : "සම්බන්ධතාව ආරම්භ කළ නොහැකි විය.";
      setErrorMessage(message);
      releaseSession();
      updateStatus("error");
    }
  }, [playAudioChunk, preferredAddress, releaseAudio, releaseSession, resetTranscripts, updateStatus, clearPlayback]);

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
            setErrorMessage("බ්‍රවුසරයේ ශබ්දය නවතා ඇත. නැවත සම්බන්ධ කර බලන්න.");
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
      <div className="hud-corner hud-corner-top" aria-hidden="true" />
      <div className="hud-corner hud-corner-bottom" aria-hidden="true" />
      <header className="topbar">
        <div className="brand" aria-label="JARVIS">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <div>
            <span className="brand-name">JARVIS</span>
            <span className="brand-sub">සජීවී හඬ සහායක</span>
          </div>
        </div>
        <div className="phase-tag"><b>01</b><span>පළමු අදියර · සජීවී හඬ</span></div>
        <div className={`connection-badge ${connected ? "online" : busy ? "busy" : status === "error" ? "fault" : ""}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {stateLabels[status]}
        </div>
      </header>

      <section className="content">
        <div className="intro">
          <div className="kicker"><span className="kicker-line" /> පුද්ගලික හඬ පාලකය</div>
          <h1>ඔබ කතා කරන්න.<br /><span>JARVIS සවන් දෙයි.</span></h1>
          <p className="intro-copy">
            සිංහලෙන් හෝ ඉංග්‍රීසියෙන් කතා කරන්න. ඔබ කතා කරන අතරතුර අසාගත් දේත්, JARVIS පිළිතුරු දෙන විට එහි වචනත් මෙහි පෙන්වයි.
          </p>

          <div className="voice-card">
            <div className="voice-card-head">
              <span className="card-index">01 / හඬ සැකසුම</span>
              <span className="secure-tag"><i /> පුද්ගලික සැකසුම</span>
            </div>
            <label className="field-label" htmlFor="preferred-address">ඔබට අමතන්න කැමති නම</label>
            <div className="address-row">
              <input
                id="preferred-address"
                className="address-input"
                value={preferredAddress}
                onChange={(event) => setPreferredAddress(event.target.value.slice(0, 32))}
                maxLength={32}
                placeholder="උදාහරණය: සර්, නම"
                autoComplete="off"
                disabled={connected || busy}
              />
            </div>
            <p className="field-hint">මෙම නම මෙම බ්‍රවුසරයේ පමණක් සුරැකේ.</p>
            <div className="action-row">
              {!connected ? (
                <button className="primary-button" onClick={startSession} disabled={busy}>
                  <span className="button-icon" aria-hidden="true">{busy ? "···" : "◉"}</span>
                  {busy ? "සම්බන්ධ වෙමින්…" : status === "error" ? "නැවත සම්බන්ධ කරන්න" : "හඬ සංවාදය අරඹන්න"}
                </button>
              ) : (
                <button className="quiet-button" onClick={releaseSession}>සංවාදය අවසන් කරන්න</button>
              )}
              <span className="permission-hint">ආරම්භයේදී microphone අවසරය දෙන්න</span>
            </div>
            {errorMessage && <p className="error-note" role="alert">{errorMessage}</p>}
          </div>

          <div className="privacy-note">
            ඔබේ හඬ සජීවීව Google Gemini Live API වෙත යවයි. මෙම යෙදුම හඬ හෝ සංවාද පිටපත් ගබඩා නොකරයි. පිටපත් දිස්වන්නේ මෙම සජීවී සැසියේදී පමණි.
          </div>
        </div>

        <div className="reactor-column">
          <div className="reactor-topline"><span>ශබ්ද සබැඳිය</span><i /><span>{connected ? "සක්‍රීයයි" : "සූදානම්"}</span></div>
          <div ref={reactorRef} className={`reactor-shell ${visualState}`} aria-hidden="true">
            <div className="reactor-halo" />
            <div className="reactor-ring outer" />
            <div className="reactor-ring segmented" />
            <div className="reactor-ring mid" />
            <div className="reactor-ring inner" />
            <div className="reactor-tick" />
            <div className="reactor-cross reactor-cross-x" />
            <div className="reactor-cross reactor-cross-y" />
            <span className="orbit-label top">J · A · R · V · I · S</span>
            <div className="reactor-core"><span>J</span></div>
            <span className="orbit-label bottom">{connected ? "සජීවී සබැඳිය" : "සූදානම් තත්ත්වය"}</span>
          </div>
          <div className={`reactor-caption ${visualState}`} aria-live="polite">
            <span className="caption-marker" />
            <strong>{stateLabels[status]}</strong>
            <span>{stateDescriptions[status]}</span>
          </div>
          <div className={`sound-bars ${visualState}`} aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <i key={index} />)}</div>

          <section className="transcript-panel" aria-label="සජීවී සංවාද පිටපත">
            <div className="transcript-head"><span>සජීවී සංවාදය</span><span className="transcript-live"><i /> {connected ? "සැසිය ක්‍රියාත්මකයි" : "සැසිය ආරම්භ වී නැත"}</span></div>
            <div className="transcript-row user-row">
              <span className="transcript-role">ඔබ කියූ දේ</span>
              <p aria-live="polite">{heardText || "ඔබ කතා කළ විට ඔබේ වචන මෙහි දිස්වනු ඇත."}</p>
            </div>
            <div className="transcript-divider" />
            <div className="transcript-row assistant-row">
              <span className="transcript-role">JARVIS කියන දේ</span>
              <p aria-live="polite">{spokenText || "JARVIS පිළිතුරු දෙන විට කථන පිටපත මෙහි පෙන්වනු ඇත."}</p>
            </div>
          </section>

          <aside className="side-rail" aria-label="සංවාද විස්තර">
            <div className="rail-head"><span>සැසි විස්තර</span><span>01 / 01</span></div>
            <div className="rail-rule" />
            <div className="rail-row"><span>භාෂා</span><b>සිංහල / ඉංග්‍රීසි</b></div>
            <div className="rail-row"><span>හඬ ආකෘතිය</span><b>{LIVE_MODEL}</b></div>
            <div className="rail-row"><span>සම්බන්ධතාව</span><b className={connected ? "live-value" : ""}>{stateLabels[status]}</b></div>
          </aside>
        </div>
      </section>

      <footer className="footer">
        <span>JARVIS · සජීවී හඬ · පළමු අදියර</span>
        <span>Google <a href="https://ai.google.dev/gemini-api/docs/live-api" target="_blank" rel="noreferrer">Gemini Live API</a></span>
      </footer>
    </main>
  );
}
