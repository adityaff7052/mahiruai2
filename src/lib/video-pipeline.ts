import type { Session } from "@google/genai";

export const CAMERA_FRAME_INTERVAL_MS = 1000;
export const CAMERA_FRAME_WIDTH = 640;
export const CAMERA_FRAME_HEIGHT = 360;

/** The SDK's Blob is a base64 data object, not a browser Blob. Never persisted. */
export function captureVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  // Preserve the source aspect ratio while keeping the longest edge at 640px.
  // Portrait phone feeds receive a portrait canvas instead of being shrunk into
  // a wide letterboxed frame, so Gemini gets more usable facial/object detail.
  const aspect = video.videoWidth / video.videoHeight;
  if (aspect >= 1) {
    canvas.width = CAMERA_FRAME_WIDTH;
    canvas.height = Math.max(1, Math.round(CAMERA_FRAME_WIDTH / aspect));
  } else {
    canvas.height = Math.max(CAMERA_FRAME_HEIGHT, CAMERA_FRAME_WIDTH);
    canvas.width = Math.max(1, Math.round(canvas.height * aspect));
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  return data ? { data, mimeType: "image/jpeg" } : null;
}

export function startVideoFrames(
  session: Pick<Session, "sendRealtimeInput">,
  getVideo: () => HTMLVideoElement | null,
  onError: (error: unknown) => void,
) {
  const canvas = document.createElement("canvas");
  const timer = window.setInterval(() => {
    const video = getVideo();
    if (!video) return;
    try {
      const frame = captureVideoFrame(video, canvas);
      if (frame) session.sendRealtimeInput({ video: frame });
    } catch (error) {
      window.clearInterval(timer);
      onError(error);
    }
  }, CAMERA_FRAME_INTERVAL_MS);
  return () => {
    window.clearInterval(timer);
    canvas.width = canvas.height = 0;
  };
}

export function hasRequiredMedia(stream: MediaStream) {
  return stream.getAudioTracks().some((track) => track.readyState === "live") &&
    stream.getVideoTracks().some((track) => track.readyState === "live");
}