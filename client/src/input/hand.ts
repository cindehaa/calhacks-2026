// Camera + MediaPipe hand landmarks. The wasm and model are ~17 MB, so they start downloading
// while the menu is up (preloadHandModel) and the camera status counts the bytes in.
import type { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { sideFromLabel, type Side } from './handpick';
import type { Landmark } from './pose';

const VERSION = '0.10.14'; // keep in step with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

interface HandAssets {
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
  model: Uint8Array<ArrayBuffer>;
}

// Bytes in and expected, per file. jsdelivr sends the wasm compressed, so its Content-Length is
// the compressed size while the stream gives the full one: the hints cover that.
const parts = new Map<string, { loaded: number; total: number }>();
const progressListeners = new Set<(pct: number) => void>();
let assets: Promise<HandAssets> | null = null;
let shownPct = -1;

function percent(): number {
  let loaded = 0, total = 0;
  for (const p of parts.values()) {
    loaded += p.loaded;
    total += Math.max(p.total, p.loaded);
  }
  return total ? Math.min(99, Math.floor((loaded / total) * 100)) : 0;
}

async function download(url: string, sizeHint: number): Promise<Uint8Array<ArrayBuffer>> {
  const part = { loaded: 0, total: sizeHint };
  parts.set(url, part);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`hand model download failed (${res.status})`);
  const len = Number(res.headers.get('content-length'));
  if (len && !res.headers.get('content-encoding')) part.total = len;
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    part.loaded += value.length;
    const pct = percent();
    if (pct !== shownPct) progressListeners.forEach(f => f(pct));
    shownPct = pct;
  }
  const out = new Uint8Array(part.loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// Starts the download once; later calls (and HandTracker.start) share it. A failed download is
// forgotten so the next try starts over.
export function preloadHandModel(): Promise<HandAssets> {
  assets ??= (async () => {
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const simd = !fileset.wasmBinaryPath.includes('nosimd');
    const [wasm, model] = await Promise.all([
      download(fileset.wasmBinaryPath, simd ? 9_423_986 : 9_294_247),
      download(MODEL_URL, 7_819_105),
    ]);
    const wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    return { fileset: { ...fileset, wasmBinaryPath }, model };
  })();
  assets.catch(() => {
    assets = null;
    parts.clear();
  });
  return assets;
}

export interface HandFrame {
  lm: Landmark[]; // 0..1 of the (unmirrored) frame
  world: Landmark[]; // metres, hand-centred
  vw: number;
  vh: number;
  side: Side | null; // the player's own hand, labels already unmirrored
}

// Wrist, thumb, four fingers, palm: the usual 21-landmark skeleton, for the preview.
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export { pointerOf } from './pose';

export class HandTracker {
  readonly video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastTs = 0;
  private stopped = false;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  get ready(): boolean {
    return !!this.landmarker;
  }

  async start(onStatus: (s: string) => void): Promise<void> {
    this.stopped = false;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    });
    this.video.srcObject = stream;
    await this.video.play();
    const show = (pct: number) => onStatus(`loading hand model… ${pct}%`);
    show(percent());
    progressListeners.add(show);
    let loaded: HandAssets;
    try {
      loaded = await preloadHandModel();
    } finally {
      progressListeners.delete(show);
    }
    onStatus('starting hand model…');
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetBuffer: loaded.model, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 2, // the mic hand is seen too, so the pointing hand can be chosen over it (handpick.ts)
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    let lmk: HandLandmarker;
    try {
      lmk = await HandLandmarker.createFromOptions(loaded.fileset, opts('GPU'));
    } catch {
      lmk = await HandLandmarker.createFromOptions(loaded.fileset, opts('CPU'));
    }
    if (this.stopped) return lmk.close(); // turned off while loading
    this.landmarker = lmk;
  }

  // Undefined when there's no new video frame yet, else every hand in view (up to two).
  detect(now: number): HandFrame[] | undefined {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return undefined;
    this.lastVideoTime = v.currentTime;
    this.lastTs = Math.max(now, this.lastTs + 1); // MediaPipe needs strictly rising timestamps
    const res = this.landmarker.detectForVideo(v, this.lastTs);
    return (res.landmarks ?? []).map((lm, i) => ({
      lm, world: res.worldLandmarks[i], vw: v.videoWidth || 1, vh: v.videoHeight || 1,
      side: sideFromLabel(res.handedness?.[i]?.[0]?.categoryName),
    }));
  }

  stop(): void {
    this.stopped = true;
    (this.video.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.lastVideoTime = -1;
  }
}
