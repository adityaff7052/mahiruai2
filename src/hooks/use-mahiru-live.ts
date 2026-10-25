/** Owns voice/camera transport. Transcripts remain internal; media is never stored. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveServerMessage, Session } from "@google/genai";
import { MicCapture, PcmPlayer, base64ToFloat32, int16ToBase64, synthSpeech } from "@/lib/audio/pipeline";
import { LIVE_MODEL, LIVE_API_VERSION, buildLiveConfig, inferEmotion, type MahiruEmotion } from "@/lib/mahiru-config";
import { mintLiveToken, mintLiveTokenBackup } from "@/lib/live-token.functions";
import { startVideoFrames } from "@/lib/video-pipeline";
import { appendMemory, emptyMemory, restoreMemory, saveMemory, resetConversationMemory } from '@/lib/conversation-memory';
import { StopCommandListener } from '@/lib/stop-command';

export type MahiruState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";
const MOCK = import.meta.env["VITE_MAHIRU_MOCK"] === "true";

function isBackupWorthyLiveError(message: string): boolean {
  return /quota|resource[_ -]?exhausted|rate[ -]?limit|too many requests|\b429\b|\b401\b|\b403\b|invalid api key|api key.{0,32}(invalid|denied|expired|rejected)|permission[_ -]?denied|unauthorized|billing/i.test(message);
}

export function useMahiruLive() {
  const [state, setState] = useState<MahiruState>("idle");
  const [emotion, setEmotion] = useState<MahiruEmotion>("neutral");
  const [error, setError] = useState("");
  const stateRef = useRef<MahiruState>("idle");
  const ctxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const handleRef = useRef<string | undefined>(undefined);
  const retriesRef = useRef(0);
  const closingRef = useRef(true);
  const generationRef = useRef(0);
  const turnDoneRef = useRef(true);
  const suppressOutputRef = useRef(false);
  const transcriptRef = useRef("");
  const userTranscriptRef = useRef("");
  const memoryRef = useRef(emptyMemory());
  const mutedRef = useRef(false);
  const stopCommandListenerRef = useRef<StopCommandListener | null>(null);
  const micPauseUntilRef = useRef(0);
  const readyRef = useRef(false);
  const readyCallbackRef = useRef<(() => void) | null>(null);
  const cameraOnRef = useRef(true);
  const commitMemory = useCallback(() => {
    memoryRef.current = appendMemory(memoryRef.current, 'user', userTranscriptRef.current);
    memoryRef.current = appendMemory(memoryRef.current, 'model', transcriptRef.current);
    userTranscriptRef.current = ''; transcriptRef.current = '';
    try { saveMemory(localStorage, memoryRef.current); } catch { /* Local storage blocked. */ }
  }, []);
  const timersRef = useRef<number[]>([]);
  const stopFramesRef = useRef<(() => void) | null>(null);

  const set = useCallback((s: MahiruState) => { stateRef.current = s; setState(s); }, []);
  const fail = useCallback((boundary: string, reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(`[mahiru] ${boundary}: ${message}`);
    setError(`${boundary}: ${message}`);
    generationRef.current++; // Ignore late callbacks from the failed session.
    stopFramesRef.current?.(); stopFramesRef.current = null;
    playerRef.current?.flush();
    stopCommandListenerRef.current?.stop();
    readyRef.current = false;
    try { sessionRef.current?.close(); } catch { /* Already closed. */ }
    sessionRef.current = null;
    set("error");
  }, [set]);
  const interrupt = useCallback(() => {
    playerRef.current?.flush();
    stopCommandListenerRef.current?.stop();
    suppressOutputRef.current = true;
    commitMemory();
    setEmotion('neutral');
    set("interrupted");
  }, [commitMemory, set]);

  const stopFromVoiceCommand = useCallback(() => {
    // Give the last syllable of the command time to finish before audio is
    // forwarded to Gemini again. This prevents "ruko" itself causing a reply.
    micPauseUntilRef.current = Date.now() + 1400;
    const serverStillGenerating = !turnDoneRef.current;
    interrupt();
    // If Live already completed its turn, only local audio was queued. In that
    // case no server chunks remain to suppress, and the next answer must play.
    if (!serverStillGenerating) suppressOutputRef.current = false;
    set("listening");
  }, [interrupt, set]);

  const handleMessage = useCallback((msg: LiveServerMessage, keySource: "primary" | "backup") => {
    // Do not reuse a backup-session handle with the primary key (or vice versa).
    if (keySource === "primary" && msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      handleRef.current = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) { sessionRef.current?.close(); return; }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      interrupt();
      // The server has acknowledged the interruption; subsequent audio belongs to the new turn.
      suppressOutputRef.current = false;
      turnDoneRef.current = true;
      set("listening");
      return;
    }
    if (sc.inputTranscription?.text) {
      userTranscriptRef.current = (userTranscriptRef.current + sc.inputTranscription.text).slice(-1200);
      if (!playerRef.current?.playing && stateRef.current !== "speaking") set("thinking");
    }
    if (sc.outputTranscription?.text) {
      transcriptRef.current = (transcriptRef.current + sc.outputTranscription.text).slice(-1200);
      const inferred = inferEmotion(transcriptRef.current);
      if (inferred) setEmotion(inferred);
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      const audio = part.inlineData;
      if (audio?.data && audio.mimeType?.startsWith("audio/") && !suppressOutputRef.current) {
        try {
          turnDoneRef.current = false;
          playerRef.current?.enqueue(base64ToFloat32(audio.data));
          set("speaking");
          stopCommandListenerRef.current?.start();
        } catch (reason) { fail("Audio playback", reason); }
      }
    }
    if (sc.turnComplete) {
      turnDoneRef.current = true;
      suppressOutputRef.current = false;
      commitMemory();
      if (!playerRef.current?.playing) {
        stopCommandListenerRef.current?.stop();
        set("listening");
      }
    }
  }, [commitMemory, fail, interrupt, set]);

  const connect = useCallback(async function openSession(useBackup = false) {
    const generation = ++generationRef.current;
    setError(""); set("connecting");
    stopFramesRef.current?.(); stopFramesRef.current = null;
    sessionRef.current = null;
    commitMemory();
    const resuming = Boolean(handleRef.current);
    // Gemini Live only supports client-supplied text as initial context history
    // when explicitly enabled. Avoid leaving a session waiting for a history
    // terminator on starts that have no saved turns.
    let includeHistory = !resuming && memoryRef.current.turns.length > 0;
    let opened = false;
    let ready = false;
    let ended = false;
    let tokenMinted = false;
    let currentKeySource: "primary" | "backup" = useBackup ? "backup" : "primary";
    let readyHandled = false;
    readyRef.current = false; readyCallbackRef.current = null;
    try {
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const tokenRequest = { data: { includeHistory } };
      let minted = useBackup ? await mintLiveTokenBackup(tokenRequest) : await mintLiveToken(tokenRequest);
      tokenMinted = true;
      currentKeySource = minted.keyDiagnostics?.selected ?? currentKeySource;
      // A backup token can't be assumed to resume the primary session's handle.
      // If primary token minting fell back while reconnecting, mint a matching
      // backup token constrained for the locally saved history instead.
      if (resuming && currentKeySource === "backup" && memoryRef.current.turns.length > 0) {
        includeHistory = true;
        minted = await mintLiveTokenBackup({ data: { includeHistory: true } });
        currentKeySource = minted.keyDiagnostics?.selected ?? "backup";
      }
      const token = minted.token;
      if (minted.keyDiagnostics) {
        // Status-only diagnostics are safe to log; no key values are returned.
        console.info("[mahiru] Gemini key check", minted.keyDiagnostics);
        if (minted.keyDiagnostics.backup === "failed") console.warn("[mahiru] Backup key could not mint a temporary token.");
        if (minted.keyDiagnostics.backup === "same_as_primary") console.warn("[mahiru] Backup key equals the primary key; failover will not provide redundancy.");
      }
      const shouldResume = currentKeySource === "primary" && Boolean(handleRef.current);
      if (!shouldResume) handleRef.current = undefined;
      if (closingRef.current || generation !== generationRef.current) return;
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: LIVE_API_VERSION } });
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: { ...buildLiveConfig(Modality, includeHistory), sessionResumption: shouldResume ? { handle: handleRef.current! } : {} },
        callbacks: {
          onopen: () => { opened = true; },
          onmessage: (message) => {
            if (generation === generationRef.current && !closingRef.current) {
              if (message.setupComplete) { ready = true; readyCallbackRef.current?.(); }
              handleMessage(message, currentKeySource);
            }
          },
          onerror: (event) => {
            if (generation !== generationRef.current || closingRef.current) return;
            ended = true;
            stopFramesRef.current?.(); stopFramesRef.current = null;
            sessionRef.current?.close(); sessionRef.current = null;
            playerRef.current?.flush();
            const failure = event.message || "Connection failed";
            stopCommandListenerRef.current?.stop();
            if (currentKeySource === "primary") {
              // This is a one-time alternate-key attempt; it can recover from
              // either a provider/key error or a primary websocket setup failure.
              handleRef.current = undefined;
              timersRef.current.push(window.setTimeout(() => void openSession(true), 0));
              return;
            }
            fail("Live connection", failure);
          },
          onclose: (event) => {
            if (generation !== generationRef.current || closingRef.current) return;
            sessionRef.current = null;
            stopFramesRef.current?.(); stopFramesRef.current = null;
            playerRef.current?.flush();
            if (ended) return;
            ended = true;
            const closeFailure = `${event.code}: ${event.reason || ""}`;
            stopCommandListenerRef.current?.stop();
            if (currentKeySource === "primary" && isBackupWorthyLiveError(closeFailure)) {
              handleRef.current = undefined;
              timersRef.current.push(window.setTimeout(() => void openSession(true), 0));
              return;
            }
            console.warn(`[mahiru] Live closed (${event.code}): ${event.reason || "No reason supplied"}`);
            // Retry transport loss / scheduled session expiry; do not loop on the backup.
            if (opened && [1000, 1001, 1006, 1011, 1012, 1013].includes(event.code) && retriesRef.current < 3) {
              const delay = 1000 * 2 ** retriesRef.current++;
              set("connecting");
              timersRef.current.push(window.setTimeout(() => void openSession(), delay));
            } else fail("Live closed", `${event.code}: ${event.reason || "Start a new connection"}`);
          },
        },
      });
      if (closingRef.current || generation !== generationRef.current || ended) { session.close(); return; }
      // Keep the session immediately; setupComplete may arrive after connect() resolves.
      sessionRef.current = session;
      suppressOutputRef.current = false;
      const onReady = () => {
        if (readyHandled || generation !== generationRef.current || closingRef.current) return;
        readyHandled = true;
        // Seed saved history before opening the mic gate. On Gemini Live this
        // special first-history exchange must end with turnComplete: true; false
        // can leave the model waiting and make later voice requests appear silent.
        try {
          if (includeHistory) session.sendClientContent({
            turns: memoryRef.current.turns.map(turn => ({ role: turn.role, parts: [{ text: turn.text }] })), turnComplete: true,
          });
        } catch (reason) {
          fail("Conversation history", reason);
          return;
        }
        readyRef.current = true;
        retriesRef.current = 0;
        if (cameraOnRef.current) stopFramesRef.current = startVideoFrames(session, () => videoRef.current, (reason) => fail("Camera frame", reason));
        set("listening");
      };
      readyCallbackRef.current = onReady;
      if (ready) onReady();
      else timersRef.current.push(window.setTimeout(() => {
        if (!readyHandled && generation === generationRef.current && !closingRef.current) {
          // A primary session that never completes setup gets one backup-key
          // attempt before the UI reports a startup failure.
          generationRef.current++;
          try { session.close(); } catch { /* closed */ }
          sessionRef.current = null;
          if (currentKeySource === "primary") {
            handleRef.current = undefined;
            timersRef.current.push(window.setTimeout(() => void openSession(true), 0));
          } else {
            fail("Live startup", "Session setup timed out");
          }
        }
      }, 12000));
    } catch (reason) {
      // onerror/onclose may already have queued a backup attempt. Avoid a second
      // concurrent fallback if the connect promise rejects after its callback.
      if (closingRef.current || generation !== generationRef.current || ended) return;
      if (tokenMinted && currentKeySource === "primary") {
        handleRef.current = undefined;
        timersRef.current.push(window.setTimeout(() => void openSession(true), 0));
        return;
      }
      fail("Live startup", reason);
    }
  }, [commitMemory, fail, handleMessage, set]);

  const stop = useCallback(() => {
    commitMemory();
    stopCommandListenerRef.current?.stop(); stopCommandListenerRef.current = null;
    closingRef.current = true; generationRef.current++;
    timersRef.current.forEach((timer) => { clearTimeout(timer); clearInterval(timer); }); timersRef.current = [];
    stopFramesRef.current?.(); stopFramesRef.current = null;
    try { sessionRef.current?.close(); } catch { /* Already closed. */ }
    sessionRef.current = null; readyRef.current = false; readyCallbackRef.current = null;
    micRef.current?.stop(); micRef.current = null;
    mutedRef.current = false; micPauseUntilRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    playerRef.current?.dispose(); playerRef.current = null;
    void ctxRef.current?.close().catch(() => {}); ctxRef.current = null;
    transcriptRef.current = ""; handleRef.current = undefined;
  }, [commitMemory]);

  const start = useCallback(async (stream: MediaStream) => {
    stop(); closingRef.current = false; streamRef.current = stream;
    try { memoryRef.current = restoreMemory(localStorage); } catch { /* Storage disabled. */ }
    // Camera frames are supplied for visual question answering. The camera alone
    // does not trigger unsolicited narration.
    setError(""); set("connecting");
    stopCommandListenerRef.current = new StopCommandListener(
      stopFromVoiceCommand,
      () => console.warn("[mahiru] Browser speech recognition is unavailable; voice stop commands may not work in this browser."),
    );
    retriesRef.current = 0; turnDoneRef.current = true; suppressOutputRef.current = false;
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" }); ctxRef.current = ctx;
      await ctx.resume();
      if (closingRef.current) return;
      const player = new PcmPlayer(ctx, 24000); playerRef.current = player;
      player.onDrain = () => {
        if (turnDoneRef.current && stateRef.current === "speaking") {
          stopCommandListenerRef.current?.stop();
          set("listening");
        }
      };
      const mic = new MicCapture(ctx, stream); micRef.current = mic;
      await mic.start((pcm) => {
        if (closingRef.current || stateRef.current === "error" || mutedRef.current) return;
        // Stop-command speech is recognized locally while the model speaks. Other
        // voices are deliberately not forwarded to Gemini during playback.
        if (Date.now() < micPauseUntilRef.current) return;
        if (stateRef.current === "speaking" || Boolean(playerRef.current?.playing)) return;
        // Capture chunks are dropped until connect resolves with an open session.
        const session = sessionRef.current;
        if ((!session || !readyRef.current) && !MOCK) return;
        if (MOCK) return;
        try { session?.sendRealtimeInput({ audio: { data: int16ToBase64(pcm), mimeType: "audio/pcm;rate=16000" } }); }
        catch (reason) { fail("Microphone send", reason); }
      });
      if (closingRef.current) { mic.stop(); return; }
      if (MOCK) {
        set("listening");
        timersRef.current.push(window.setInterval(() => {
          if (stateRef.current === "listening" && mic.level > 0.04) {
            setEmotion("happy"); turnDoneRef.current = true;
            player.enqueue(synthSpeech(2)); set("speaking");
          } else if (stateRef.current === "interrupted" && mic.level < 0.02) set("listening");
        }, 100));
      } else await connect();
    } catch (reason) { fail("Media startup", reason); }
  }, [connect, fail, set, stop, stopFromVoiceCommand]);

  const retry = useCallback(() => {
    if (!micRef.current || closingRef.current) return;
    retriesRef.current = 0;
    const previous = sessionRef.current;
    generationRef.current++;
    sessionRef.current = null;
    previous?.close();
    timersRef.current.forEach((timer) => clearTimeout(timer)); timersRef.current = [];
    void connect();
  }, [connect]);
  useEffect(() => stop, [stop]);
  const getOutputLevel = useCallback(() => playerRef.current?.level() ?? 0, []);
  const getInputLevel = useCallback(() => micRef.current?.level ?? 0, []);
  const clearMemory = useCallback(() => {
    userTranscriptRef.current = ''; transcriptRef.current = '';
    try { memoryRef.current = resetConversationMemory(localStorage); } catch { memoryRef.current = emptyMemory(); }
  }, []);
  const setMuted = useCallback((muted: boolean) => { mutedRef.current = muted; if (muted) interrupt(); }, [interrupt]);
  /** Camera off stops frame streaming; audio conversation continues. */
  const setCameraActive = useCallback((active: boolean) => {
    cameraOnRef.current = active;
    stopFramesRef.current?.(); stopFramesRef.current = null;
    const session = sessionRef.current;
    if (active && session && readyRef.current) stopFramesRef.current = startVideoFrames(session, () => videoRef.current, (reason) => fail("Camera frame", reason));
  }, [fail]);
  return { setCameraActive, state, emotion, error, videoRef, start, stop, retry, getOutputLevel, getInputLevel, clearMemory, setMuted, mock: MOCK };
}
