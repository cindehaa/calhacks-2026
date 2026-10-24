// Camera + MediaPipe hand landmarks. The library is loaded on first use, so players who never
// turn the camera on don't download it.
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { Pt2 } from './homography';
import type { Landmark } from './pinch';

const VERSION = '0.10.14'; // keep in step with package.json
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface HandFrame {
  lm: Landmark[]; // 0..1 of the (unmirrored) frame
  world: Landmark[]; // metres, hand-centred
  vw: number;
  vh: number;
}

// Wrist, thumb, four fingers, palm: the usual 21-landmark skeleton, for the preview.
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// Which part of the hand aims. The knuckle is steadier than the fingertip and barely moves in a
// pinch; the palm centre (wrist and the four knuckles) moves least of all when fingers do things.
export type AimPoint = 'knuckle' | 'tip' | 'palm';
const AIM_LANDMARKS: Record<AimPoint, number[]> = { knuckle: [5], tip: [8], palm: [0, 5, 9, 13, 17] };

// Mirrored so moving your hand right moves the cursor right.
export function pointerOf(lm: Landmark[], aim: AimPoint = 'knuckle'): Pt2 {
  const ids = AIM_LANDMARKS[aim];
  const x = ids.reduce((s, i) => s + lm[i].x, 0) / ids.length;
  const y = ids.reduce((s, i) => s + lm[i].y, 0) / ids.length;
  return [1 - x, y];
}

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
    onStatus('loading hand model…');
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    let lmk: HandLandmarker;
    try {
      lmk = await HandLandmarker.createFromOptions(vision, opts('GPU'));
    } catch {
      lmk = await HandLandmarker.createFromOptions(vision, opts('CPU'));
    }
    if (this.stopped) return lmk.close(); // turned off while loading
    this.landmarker = lmk;
  }

  // Undefined when there's no new video frame yet, null when no hand is in view.
  detect(now: number): HandFrame | null | undefined {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return undefined;
    this.lastVideoTime = v.currentTime;
    this.lastTs = Math.max(now, this.lastTs + 1); // MediaPipe needs strictly rising timestamps
    const res = this.landmarker.detectForVideo(v, this.lastTs);
    if (!res.landmarks?.length) return null;
    return { lm: res.landmarks[0], world: res.worldLandmarks[0], vw: v.videoWidth || 1, vh: v.videoHeight || 1 };
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
