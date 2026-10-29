"use client";

import { GoogleGenAI, Modality } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  END_OF_SPEECH_SILENCE_MS,
  INPUT_SAMPLE_RATE,
  LIVE_MODEL,
  OUTPUT_SAMPLE_RATE,
  normalizeVoicePreference,
  VOICE_PRESETS,
  type VoiceGender,
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
  assistantVoice?: VoiceGender;
  systemInstruction?: string;
  error?: string;
};

type RepoStatusState = {
  text: string;
  loading: boolean;
  error: string | null;
};

const stateLabels: Record<ConsoleState, string> = {
  ready: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Connection issue",
};

const stateDescriptions: Record<ConsoleState, string> = {
  ready: "Ready to start a voice session",
  connecting: "Setting up your microphone and live connection",
  listening: "Listening to your voice",
  thinking: "Preparing a response",
  speaking: "JARVIS is speaking",
  error: "Check your connection and try again",
};

function cleanPreferredAddress(value: string): string {
  return value.replace(/[^A-Za-z0-9 .'’_-]/g, "").slice(0, 32);
}

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
  const [preferredAddress, setPreferredAddress] = useState("Sir");
  const [assistantVoice, setAssistantVoice] = useState<VoiceGender>("male");
  const [errorMessage, setErrorMessage] = useState("");
  const [heardText, setHeardText] = useState("");
  const [spokenText, setSpokenText] = useState("");
  const [repoStatus, setRepoStatus] = useState<RepoStatusState>({ text: "Repository status will appear here.", loading: false, error: null });
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
      try { source.stop(); } catch { /* audio source may already be closed */ }
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
    try { session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* session may already be closed */ }
    try { session?.close(); } catch { /* session may already be closed */ }
    clearPlayback();
    releaseAudio();
    resetTranscripts();
  }, [clearPlayback, releaseAudio, resetTranscripts]);

  const checkRepoStatus = useCallback(async () => {
    try {
      setRepoStatus({ text: "Checking repository status...", loading: true, error: null });
      const response = await fetch("/api/github-read?repo=sanjayacabsella-lgtm/jarvis&readme=0&actions=0", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Repository status check failed.");
      }

      const summary = payload.summary || "Repository is available.";
      setRepoStatus({ text: summary, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository status check failed.";
      setRepoStatus({ text: "Repository status unavailable.", loading: false, error: message });
    }
  }, []);

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
        throw new Error("This browser cannot access a microphone.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;

      const tokenResponse = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ preferredAddress: preferredAddress.trim() || "Sir", assistantVoice }),
      });
      const tokenData = (await tokenResponse.json()) as TokenResponse;
      if (!tokenResponse.ok || !tokenData.token || !tokenData.systemInstruction) {
        throw new Error(tokenData.error || "Could not start the live voice session.");
      }

      const ai = new GoogleGenAI({ apiKey: tokenData.token });
      const activeVoice = normalizeVoicePreference(tokenData.assistantVoice ?? assistantVoice);
      const session = await ai.live.connect({
        model: tokenData.model || LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: { parts: [{ text: tokenData.systemInstruction }] },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: VOICE_PRESETS[activeVoice] },
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
            setErrorMessage("A live voice connection problem occurred. Please reconnect.");
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
            setErrorMessage("Could not send microphone audio to the live service.");
            releaseSession();
            updateStatus("error");
          }
        }
      };

      source.connect(worklet);
      await micContext.resume();
      updateStatus("listening");
      window.localStorage.setItem("jarvis-preferred-address", preferredAddress.trim() || "Sir");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the connection.";
      setErrorMessage(message);
      releaseSession();
      updateStatus("error");
    }
  }, [playAudioChunk, preferredAddress, releaseAudio, releaseSession, resetTranscripts, updateStatus, clearPlayback]);

  useEffect(() => {
    const savedAddress = window.localStorage.getItem("jarvis-preferred-address");
    if (savedAddress) setPreferredAddress(cleanPreferredAddress(savedAddress) || "Sir");
    const savedVoice = window.localStorage.getItem("jarvis-assistant-voice");
    if (savedVoice) setAssistantVoice(normalizeVoicePreference(savedVoice));
  }, []);

  useEffect(() => {
    const resumeAudioWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const context of [micContextRef.current, outputContextRef.current]) {
        if (context?.state === "suspended") {
          void context.resume().catch(() => {
            setErrorMessage("Browser audio was suspended. Reconnect and try again.");
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
            <span className="brand-sub">LIVE VOICE ASSISTANT</span>
          </div>
        </div>
        <div className="phase-tag"><b>01</b><span>PHASE ONE · LIVE VOICE</span></div>
        <div className={`connection-badge ${connected ? "online" : busy ? "busy" : status === "error" ? "fault" : ""}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {stateLabels[status]}
        </div>
      </header>

      <section className="content">
        <div className="intro">
          <div className="kicker"><span className="kicker-line" /> PERSONAL VOICE CONSOLE</div>
          <h1>Speak naturally.<br /><span>JARVIS is listening.</span></h1>
          <p className="intro-copy">
            Speak in English or Sinhala. See what you say and follow JARVIS’s spoken reply as it happens.
          </p>

          <div className="voice-card">
            <div className="voice-card-head">
              <span className="card-index">01 / VOICE SETTINGS</span>
              <span className="secure-tag"><i /> STORED ON THIS DEVICE</span>
            </div>
            <label className="field-label" htmlFor="preferred-address">Preferred name</label>
            <div className="address-row">
              <input
                id="preferred-address"
                className="address-input"
                value={preferredAddress}
                onChange={(event) => setPreferredAddress(cleanPreferredAddress(event.target.value))}
                maxLength={32}
                placeholder="For example: Sir, Alex"
                autoComplete="off"
                disabled={connected || busy}
              />
            </div>
            <p className="field-hint">This name is saved only in this browser.</p>
            <div className="voice-choice">
              <label className="field-label" htmlFor="assistant-voice">Assistant voice</label>
              <select
                id="assistant-voice"
                className="address-input voice-select"
                value={assistantVoice}
                onChange={(event) => {
                  const voice = normalizeVoicePreference(event.target.value);
                  setAssistantVoice(voice);
                  window.localStorage.setItem("jarvis-assistant-voice", voice);
                }}
                disabled={connected || busy}
              >
                <option value="male">Warm voice</option>
                <option value="female">Soft voice</option>
              </select>
            </div>
            <div className="action-row">
              {!connected ? (
                <button className="primary-button" onClick={startSession} disabled={busy}>
                  <span className="button-icon" aria-hidden="true">{busy ? "···" : "◉"}</span>
                  {busy ? "Connecting…" : status === "error" ? "Reconnect" : "Start voice session"}
                </button>
              ) : (
                <button className="quiet-button" onClick={releaseSession}>End session</button>
              )}
              <button className="quiet-button" onClick={checkRepoStatus} disabled={busy || status === "connecting"}>
                Check repo status
              </button>
              <span className="permission-hint">Allow microphone access when prompted.</span>
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.78 }}>
                {repoStatus.loading ? "Checking repository status..." : repoStatus.error ? repoStatus.error : repoStatus.text}
              </p>
            </div>
            {errorMessage && <p className="error-note" role="alert">{errorMessage}</p>}
          </div>

          <div className="privacy-note">
            Your voice is streamed through the live assistant core. This app does not store audio or transcripts; transcripts appear only during this live session.
          </div>
        </div>

        <div className="reactor-column">
          <div className="reactor-topline"><span>AUDIO LINK</span><i /><span>{connected ? "ACTIVE" : "STANDBY"}</span></div>
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
            <span className="orbit-label bottom">{connected ? "LIVE LINK" : "STANDBY"}</span>
          </div>
          <div className={`reactor-caption ${visualState}`} aria-live="polite">
            <span className="caption-marker" />
            <strong>{stateLabels[status]}</strong>
            <span>{stateDescriptions[status]}</span>
          </div>
          <div className={`sound-bars ${visualState}`} aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <i key={index} />)}</div>

          <section className="transcript-panel" aria-label="Live conversation transcript">
            <div className="transcript-head"><span>LIVE CONVERSATION</span><span className="transcript-live"><i /> {connected ? "SESSION ACTIVE" : "SESSION NOT STARTED"}</span></div>
            <div className="transcript-row user-row">
              <span className="transcript-role">YOU SAID</span>
              <p aria-live="polite">{heardText || "Your words will appear here when you speak."}</p>
            </div>
            <div className="transcript-divider" />
            <div className="transcript-row assistant-row">
              <span className="transcript-role">JARVIS SAYS</span>
              <p aria-live="polite">{spokenText || "JARVIS’s spoken reply will appear here."}</p>
            </div>
          </section>

          <aside className="side-rail" aria-label="Session details">
            <div className="rail-head"><span>SESSION DETAILS</span><span>01 / 01</span></div>
            <div className="rail-rule" />
            <div className="rail-row"><span>Languages</span><b>English / Sinhala</b></div>
            <div className="rail-row"><span>Assistant voice</span><b>{assistantVoice === "male" ? "Warm" : "Soft"}</b></div>
            <div className="rail-row"><span>Core</span><b>JARVIS Core</b></div>
            <div className="rail-row"><span>Connection</span><b className={connected ? "live-value" : ""}>{stateLabels[status]}</b></div>
          </aside>
        </div>
      </section>

      <footer className="footer">
        <span>JARVIS · LIVE VOICE · PHASE ONE</span>
        <span>Secure voice core</span>
      </footer>
    </main>
  );
}
