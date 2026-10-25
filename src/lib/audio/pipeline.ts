/**
 * Web Audio pipeline for Mahiru.
 *
 *  Mic ──► MediaStreamSource ──► AudioWorklet (downsample → Int16 PCM 16 kHz, 40 ms chunks) ──► onChunk
 *  Model PCM 24 kHz ──► AudioBufferSource queue ──► Gain ──► Analyser (mouth amplitude) ──► speakers
 */

const WORKLET_SRC = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.size = 640; // 40 ms @ 16 kHz
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.t = 0;
    this.energy = 0;
    this.count = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const len = ch.length;
    while (this.t < len) {
      const i = Math.floor(this.t);
      const f = this.t - i;
      const a = ch[i], b = i + 1 < len ? ch[i + 1] : a;
      let s = a + (b - a) * f;
      s = Math.max(-1, Math.min(1, s));
      this.energy += s * s; this.count++;
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        const out = this.buf.buffer;
        this.port.postMessage({ pcm: out, level: Math.sqrt(this.energy / this.count) }, [out]);
        this.buf = new Int16Array(this.size);
        this.n = 0; this.energy = 0; this.count = 0;
      }
      this.t += this.ratio;
    }
    this.t -= len;
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export function int16ToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] ?? 0) / 0x8000;
  return out;
}

/** Microphone capture → 16 kHz PCM chunks. */
export class MicCapture {
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  level = 0;

  constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
  ) {}

  async start(onChunk: (pcm: ArrayBuffer) => void) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e) => {
      this.level = this.level * 0.6 + e.data.level * 0.4;
      onChunk(e.data.pcm);
    };
    // Worklets only run when connected to the graph; route through a muted gain.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.src.connect(this.node).connect(this.sink).connect(this.ctx.destination);
  }

  stop() {
    this.node?.port.close();
    this.src?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    this.node = this.src = this.sink = null;
  }
}

/** Gapless playback queue for model audio with instant flush on interruption. */
export class PcmPlayer {
  private gain: GainNode;
  readonly analyser: AnalyserNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private data: Float32Array<ArrayBuffer>;
  onDrain: (() => void) | null = null;

  constructor(
    private ctx: AudioContext,
    private sampleRate = 24000,
  ) {
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.data = new Float32Array(this.analyser.fftSize);
    this.gain.connect(this.analyser).connect(ctx.destination);
  }

  get playing() {
    return this.sources.size > 0;
  }

  enqueue(samples: Float32Array) {
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.02) this.nextTime = now + 0.02;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      src.disconnect();
      if (this.sources.size === 0) this.onDrain?.();
    };
  }

  /** Interruption: drop everything buffered immediately. */
  flush() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  /** RMS of what is audible right now (0..~1). */
  level() {
    if (!this.playing) return 0;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (const sample of this.data) sum += sample * sample;
    return Math.sqrt(sum / this.data.length);
  }

  dispose() {
    this.flush();
    this.gain.disconnect();
    this.analyser.disconnect();
  }
}

/** Synthetic speech-like audio for mock mode (24 kHz). */
export function synthSpeech(seconds: number, sr = 24000): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0 = 210 + 30 * Math.sin(t * 2.3) + 15 * Math.sin(t * 7.1);
    phase += (2 * Math.PI * f0) / sr;
    const syl = Math.max(0, Math.sin(t * Math.PI * 4.2)) ** 0.6;
    const pause = Math.sin(t * 1.1) > -0.7 ? 1 : 0;
    const v = Math.sin(phase) * 0.5 + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.12;
    out[i] = v * syl * pause * 0.25;
  }
  return out;
}
