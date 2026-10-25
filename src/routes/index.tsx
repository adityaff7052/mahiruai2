import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Mic, MoreVertical, RotateCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasRequiredMedia } from "@/lib/video-pipeline";
import { ENTRY_CODE_LENGTH, isEntryCodeValid } from "@/lib/entry-gate";
import { MahiruAvatar } from "@/components/MahiruAvatar";
import { useMahiruLive } from "@/hooks/use-mahiru-live";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mahiru — Voice Companion" },
      { name: "description", content: "Talk with Mahiru, a calm, helpful anime-style voice assistant. Voice only." },
      { property: "og:title", content: "Mahiru — Voice Companion" },
      { property: "og:description", content: "Talk with Mahiru, a calm, helpful anime-style voice assistant. Voice only." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Phase = "locked" | "gate" | "requesting" | "denied" | "main";
type CameraMode = "preview" | "hidden" | "off";

function EntryGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shown, setShown] = useState(false);
  const submit = (value: string) => {
    if (isEntryCodeValid(value)) onUnlock();
    else { setWrong(true); setCode(""); }
  };
  return (
    <main className="stage">
      <form className="gate" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
        <p className="gate-text">Enter the code to open this website</p>
        <div className="entry-field">
          <input
            type={shown ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" maxLength={ENTRY_CODE_LENGTH}
            autoComplete="off" autoFocus value={code} aria-label="Website entry code" className="entry-input"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, ENTRY_CODE_LENGTH);
              setCode(v); setWrong(false);
              if (v.length === ENTRY_CODE_LENGTH) submit(v);
            }}
          />
          <button type="button" className="entry-toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide code" : "Show code"}>
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="gate-hint" role="alert">{wrong ? "Wrong code. Please try again." : "\u00a0"}</p>
      </form>
    </main>
  );
}

function Index() {
  const [phase, setPhase] = useState<Phase>("locked");
  const live = useMahiruLive();
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("preview");
  const [cameraError, setCameraError] = useState(false);
  const requesting = useRef(false);
  const grantedStream = useRef<MediaStream | null>(null);
  useEffect(() => () => {
    grantedStream.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    const video = live.videoRef.current;
    if (!video || !videoStream) return;
    video.srcObject = videoStream;
    void video.play().catch((error: unknown) => console.warn("[mahiru] Preview playback", error));
    return () => { video.srcObject = null; };
  }, [videoStream, live.videoRef, phase]);

  // Mic + camera are requested only here, from a user gesture (also unlocks audio playback).
  const requestMedia = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setPhase("requesting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } },
      });
      if (!hasRequiredMedia(media)) {
        media.getTracks().forEach((track) => track.stop());
        throw new Error("Both microphone and camera are required.");
      }
    } catch {
      requesting.current = false;
      setPhase("denied");
      return;
    }
    grantedStream.current = media;
    setVideoStream(new MediaStream(media.getVideoTracks()));
    setPhase("main");
    requesting.current = false;
    await live.start(media);
  }, [live.start]);

  const changeCamera = useCallback(async (mode: CameraMode) => {
    const media = grantedStream.current;
    if (!media) return;
    setCameraError(false);

    // Mode 3: actually stop and detach all video tracks. Audio remains in `media`.
    if (mode === "off") {
      media.getVideoTracks().forEach((track) => {
        track.stop();
        media.removeTrack(track);
      });
      const video = live.videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      setVideoStream(null);
      live.setCameraActive(false);
      setCameraMode("off");
      return;
    }

    // Modes 1 and 2 both keep the physical camera active and send frames to Gemini.
    // They differ only in whether the local preview is visible.
    let tracks = media.getVideoTracks().filter((track) => track.readyState === "live");
    if (tracks.length === 0) {
      let cameraStream: MediaStream;
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } },
        });
      } catch {
        setCameraError(true);
        return; // Stay in camera-off mode; voice conversation continues.
      }
      cameraStream.getVideoTracks().forEach((track) => media.addTrack(track));
      tracks = media.getVideoTracks().filter((track) => track.readyState === "live");
    }

    if (tracks.length === 0) {
      setCameraError(true);
      return;
    }

    // Rebuild the preview stream after OFF -> ON to avoid stale ended tracks on mobile.
    const previewStream = new MediaStream(tracks);
    const video = live.videoRef.current;
    if (video) {
      video.srcObject = previewStream;
      try { await video.play(); } catch { /* Some browsers wait for the next user gesture. */ }
    }
    setVideoStream(previewStream);
    live.setCameraActive(true);
    setCameraMode(mode);
  }, [live.setCameraActive, live.videoRef]);

  if (phase === "locked") return <EntryGate onUnlock={() => setPhase("gate")} />;

  if (phase !== "main") {
    return (
      <main className="stage">
        <div className="gate">
          {phase === "denied" ? (
            <>
              <p className="gate-text">Microphone and camera access are needed to talk with Mahiru.</p>
              <Button variant="ghost" className="gate-btn" onClick={requestMedia}>
                <RotateCw className="size-4" /> Try again
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="gate-mic" onClick={requestMedia} disabled={phase === "requesting"} aria-label="Enable microphone and camera">
              <Mic className="size-7" />
            </Button>
          )}
          {phase !== "denied" && <p className="gate-hint">Tap to enable microphone and camera</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="stage">
      {/* Shown only on portrait phones (CSS); the voice session keeps running underneath. */}
      <div className="rotate-prompt" role="status" aria-label="Rotate your phone to landscape">
        <Smartphone className="rotate-icon" strokeWidth={1.25} />
      </div>
      <MahiruAvatar
        state={live.state}
        emotion={live.emotion}
        getOutputLevel={live.getOutputLevel}
        getInputLevel={live.getInputLevel}
      />
      <video
        ref={live.videoRef} className="camera-preview" data-visible={cameraMode === "preview"}
        autoPlay muted playsInline aria-label="Your live camera preview" aria-hidden={cameraMode !== "preview"}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="camera-menu" aria-label="Camera options" data-error={cameraError}>
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="camera-menu-content">
          <DropdownMenuRadioGroup value={cameraMode} onValueChange={(v) => void changeCamera(v as CameraMode)}>
            <DropdownMenuRadioItem value="hidden">Camera on, preview hidden</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="preview">Camera on, preview visible</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="off">Camera off</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {cameraError && <p className="camera-menu-error">Camera access was blocked.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {live.state === "error" ? (
        <Button variant="ghost" className="status-retry" onClick={live.retry} aria-label="Reconnect" title={live.error}>
          <RotateCw className="size-4" />
        </Button>
      ) : (
        <span className="status-dot" data-state={live.state} role="status" aria-label={live.state} />
      )}
    </main>
  );
}
