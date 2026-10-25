import wasm from '@/assets/vision-wasm.asset.json';
import nosimd from '@/assets/vision-nosimd.asset.json';
import { PRESENCE_DEFAULTS } from './presence-policy';
/** Approximate head/iris attention, not identity recognition or proof of eye contact. Frames stay local. */
export async function startPresenceDetector(getVideo: () => HTMLVideoElement | null, report: (attention: boolean) => void) {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const simd = await FilesetResolver.isSimdSupported();
  const detector = await FaceLandmarker.createFromOptions({
    wasmLoaderPath: `/vision/vision_wasm_${simd ? '' : 'nosimd_'}internal.js`,
    wasmBinaryPath: simd ? wasm.url : nosimd.url,
  }, { baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 });
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const timer = window.setInterval(() => {
    const video = getVideo();
    if (!ctx || document.hidden || !video || video.readyState < 2) { report(false); return; }
    try {
      ctx.drawImage(video, 0, 0, 320, 180);
      const face = detector.detectForVideo(canvas, performance.now()).faceLandmarks[0];
      if (!face) { report(false); return; }
      const nose = face[1], left = face[33], right = face[263], irisL = face[468], irisR = face[473];
      if (!nose || !left || !right || !irisL || !irisR) { report(false); return; }
      const width = Math.abs(right.x - left.x);
      const centered = Math.abs(nose.x - (left.x + right.x) / 2) / Math.max(width, .001) < .2;
      const level = Math.abs(left.y - right.y) / Math.max(width, .001) < .22;
      const eyeL = face[133], eyeR = face[362];
      const irisCentered = eyeL && eyeR && Math.abs(irisL.x - (left.x + eyeL.x) / 2) < width * .09 && Math.abs(irisR.x - (right.x + eyeR.x) / 2) < width * .09;
      report(width > .08 && centered && level && Boolean(irisCentered));
    } catch { report(false); }
  }, PRESENCE_DEFAULTS.sampleMs);
  return () => { clearInterval(timer); detector.close(); canvas.width = canvas.height = 0; };
}
