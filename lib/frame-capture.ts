// Camera / screen frame sampler for the Live API.
// The Live API accepts video as JPEG frames, at most about one per second.
// Google's docs limit audio + video sessions to about 2 minutes, so capture stops itself before that.

export type FrameSource = "camera" | "screen";
export type FrameCaptureHandle = { stop: () => void };

type FrameCaptureOptions = {
  maxSeconds: number;
  intervalMs?: number;
  maxWidth?: number;
  quality?: number;
  onFrame: (base64Jpeg: string) => void;
  onTick?: (elapsedSeconds: number) => void;
  onEnded: (reason: "stopped" | "limit" | "source-ended") => void;
};

export function isScreenShareAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export async function startFrameCapture(source: FrameSource, options: FrameCaptureOptions): Promise<FrameCaptureHandle> {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media) throw new Error("This browser cannot access the camera or screen.");

  let stream: MediaStream;
  if (source === "screen") {
    if (typeof media.getDisplayMedia !== "function") {
      throw new Error("Screen sharing is not available in this browser. Use a desktop browser, or the camera on a phone.");
    }
    stream = await media.getDisplayMedia({ video: true, audio: false });
  } else {
    stream = await media.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Could not start the video preview needed to capture frames.");
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Could not prepare a video frame.");
  }

  const intervalMs = options.intervalMs ?? 1000;
  const maxWidth = options.maxWidth ?? 768;
  const quality = options.quality ?? 0.6;
  const startedAt = Date.now();
  let finished = false;
  let timer: number | null = null;

  const finish = (reason: "stopped" | "limit" | "source-ended") => {
    if (finished) return;
    finished = true;
    if (timer !== null) window.clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    options.onEnded(reason);
  };

  const capture = () => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    const scale = Math.min(1, maxWidth / width);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const comma = dataUrl.indexOf(",");
    if (comma > 0) options.onFrame(dataUrl.slice(comma + 1));
  };

  stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => finish("source-ended")));

  timer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    options.onTick?.(elapsed);
    if (elapsed >= options.maxSeconds) {
      finish("limit");
      return;
    }
    capture();
  }, intervalMs);
  capture();

  return { stop: () => finish("stopped") };
}
