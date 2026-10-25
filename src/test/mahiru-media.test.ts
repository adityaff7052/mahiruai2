import { afterEach, describe, expect, it, vi } from "vitest";
import { Modality } from "@google/genai";
import { buildLiveConfig, LIVE_API_VERSION, LIVE_MODEL } from "@/lib/mahiru-config";
import { base64ToFloat32, int16ToBase64, PcmPlayer } from "@/lib/audio/pipeline";
import { captureVideoFrame, hasRequiredMedia, startVideoFrames } from "@/lib/video-pipeline";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Mahiru media rules", () => {
  it("locks the exact Gemini model and audio-only response modality", () => {
    expect(LIVE_MODEL).toBe("gemini-3.8-live");
    expect(buildLiveConfig(Modality).responseModalities).toEqual([Modality.AUDIO]);
    expect(LIVE_API_VERSION).toBe("v1alpha");
  });

  it("only enables initial history seeding when saved turns exist", () => {
    expect(buildLiveConfig(Modality).historyConfig).toBeUndefined();
    expect(buildLiveConfig(Modality, true).historyConfig?.initialHistoryInClientContent).toBe(true);
  });

  it("requires both live microphone and camera tracks", () => {
    const media = (audio: MediaStreamTrack[], video: MediaStreamTrack[]) => ({
      getAudioTracks: () => audio, getVideoTracks: () => video,
    }) as MediaStream;
    const live = { readyState: "live" } as MediaStreamTrack;
    const ended = { readyState: "ended" } as MediaStreamTrack;
    expect(hasRequiredMedia(media([live], [live]))).toBe(true);
    expect(hasRequiredMedia(media([live], []))).toBe(false);
    expect(hasRequiredMedia(media([], [live]))).toBe(false);
    expect(hasRequiredMedia(media([live], [ended]))).toBe(false);
  });

  it("sends 640x360 JPEG camera frames no more than once per second and stops on cleanup", () => {
    vi.useFakeTimers();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,ZmFrZQ==");
    const video = { readyState: 2, videoWidth: 640, videoHeight: 360 } as HTMLVideoElement;
    const session = { sendRealtimeInput: vi.fn() };
    const stop = startVideoFrames(session, () => video, vi.fn());
    vi.advanceTimersByTime(999);
    expect(session.sendRealtimeInput).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(session.sendRealtimeInput).toHaveBeenCalledExactlyOnceWith({ video: { data: "ZmFrZQ==", mimeType: "image/jpeg" } });
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 360);
    vi.advanceTimersByTime(1000);
    expect(session.sendRealtimeInput).toHaveBeenCalledTimes(2);
    stop(); vi.advanceTimersByTime(3000);
    expect(session.sendRealtimeInput).toHaveBeenCalledTimes(2);
  });

  it("preserves portrait camera detail rather than letterboxing it into a landscape frame", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,ZmFrZQ==");
    const canvas = document.createElement("canvas");
    const video = { readyState: 2, videoWidth: 360, videoHeight: 640 } as HTMLVideoElement;
    expect(captureVideoFrame(video, canvas)).not.toBeNull();
    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(640);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 360, 640);
  });

  it("does not encode video before enough camera data exists", () => {
    const canvas = document.createElement("canvas");
    expect(captureVideoFrame({ readyState: 1 } as HTMLVideoElement, canvas)).toBeNull();
  });

  it("decodes signed 16-bit PCM for playback", () => {
    const samples = new Int16Array([-32768, 0, 16384, 32767]);
    expect(Array.from(base64ToFloat32(int16ToBase64(samples.buffer)))).toEqual([-1, 0, 0.5, 32767 / 32768]);
  });

  it("barge-in stops every active and queued audio source immediately", () => {
    const sources: { stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const ctx = {
      currentTime: 0, destination: {},
      createGain: () => ({ connect: vi.fn((target) => target), disconnect: vi.fn() }),
      createAnalyser: () => ({ fftSize: 512, connect: vi.fn(), disconnect: vi.fn() }),
      createBuffer: () => ({ copyToChannel: vi.fn(), duration: 1 }),
      createBufferSource: () => {
        const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null };
        sources.push(source); return source;
      },
    } as unknown as AudioContext;
    const player = new PcmPlayer(ctx);
    player.enqueue(new Float32Array(24000)); player.enqueue(new Float32Array(24000));
    expect(player.playing).toBe(true);
    player.flush();
    expect(player.playing).toBe(false);
    expect(player.level()).toBe(0);
    sources.forEach((source) => {
      expect(source.stop).toHaveBeenCalledTimes(1);
      expect(source.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});