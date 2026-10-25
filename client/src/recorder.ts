// Gameplay recording: every match is recorded from its first frame and uploaded to the Blob store
// (recordings/<date>/...) when it ends. Only the two board canvases and the game's own audio go in,
// so the browser asks for no permission; the HTML HUD on top (clock, embers, dock) isn't in it.
// Each frame the 3D scene and the 2D overlay are drawn into one smaller canvas, which is what
// MediaRecorder sees. Off in local dev, where there's no store to send to.
import { upload } from '@vercel/blob/client';
import { sfx } from './sfx';

const MAX_SIDE = 1280; // longest side of the video, px
const FPS = 30;
const BITRATE = 1_500_000; // ~11 MB a minute
const LINGER_MS = 3000; // keep rolling on the result board for a moment
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

interface Take {
  rec: MediaRecorder;
  chunks: Blob[];
  name: string;
  endAt: number; // 0 while the match is live
}

export class Recorder {
  private take: Take | null = null;
  private out = document.createElement('canvas');
  private g = this.out.getContext('2d')!;
  private readonly on: boolean;

  constructor(private gl: HTMLCanvasElement, private overlay: HTMLCanvasElement) {
    this.on = !import.meta.env.DEV && typeof MediaRecorder !== 'undefined' && 'captureStream' in this.out;
  }

  // Called once a frame, right after the board is drawn (the WebGL buffer is only readable then).
  // live: a match is being played; done: it just ended and its board is still up.
  update(live: boolean, done: boolean): void {
    if (!this.on) return;
    const t = this.take;
    if (live && t?.endAt) this.stop(); // a new round began during the linger
    if (live && !this.take) this.start();
    if (!this.take) return;
    this.draw();
    if (!live) {
      const now = performance.now();
      if (!this.take.endAt) this.take.endAt = now + (done ? LINGER_MS : 0);
      if (now >= this.take.endAt) this.stop();
    }
  }

  private start(): void {
    const k = Math.min(1, MAX_SIDE / Math.max(innerWidth, innerHeight));
    this.out.width = Math.round((innerWidth * k) / 2) * 2; // encoders want even sizes
    this.out.height = Math.round((innerHeight * k) / 2) * 2;
    this.draw();
    const stream = this.out.captureStream(FPS);
    const audio = sfx.tap();
    audio?.getAudioTracks().forEach(tr => stream.addTrack(tr));
    const mimeType = TYPES.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
    try {
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.start(1000);
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const iso = new Date().toISOString();
      this.take = { rec, chunks, name: `recordings/${iso.slice(0, 10)}/${iso.slice(11, 19).replace(/:/g, '')}.${ext}`, endAt: 0 };
    } catch (e) {
      console.warn('recording unavailable:', e);
      stream.getVideoTracks().forEach(tr => tr.stop());
    }
  }

  private stop(): void {
    const t = this.take;
    if (!t) return;
    this.take = null;
    t.rec.onstop = () => {
      t.rec.stream.getVideoTracks().forEach(tr => tr.stop()); // the audio track is sfx's, kept
      const type = t.rec.mimeType.split(';')[0] || 'video/webm';
      const body = new Blob(t.chunks, { type });
      if (body.size) save(t.name, body);
    };
    t.rec.stop();
  }

  private draw(): void {
    const { g, out } = this;
    g.drawImage(this.gl, 0, 0, out.width, out.height);
    g.drawImage(this.overlay, 0, 0, out.width, out.height);
  }
}

function save(name: string, body: Blob) {
  upload(name, body, { access: 'public', handleUploadUrl: '/api/recording', contentType: body.type, multipart: body.size > 8e6 })
    .then(r => console.info(`recording saved (${(body.size / 1e6).toFixed(1)} MB):`, r.url))
    .catch(e => console.warn('recording upload failed:', e instanceof Error ? e.message : e));
}
