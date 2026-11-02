// Cuts a few seconds out of a round's recording (recorder.ts) into a video of its own, in the
// browser: the recording plays in a hidden <video> from the window's start, each frame is drawn
// onto a canvas that a MediaRecorder records, and its sound goes in through Web Audio without
// reaching the speakers. That takes as long as the clip itself, so the clips are cut while the
// result screen comes up. MP4 where the browser can record it, since X only takes MP4 and MOV.
import type { Window } from './highlights';

export interface Clip { label: string; blob: Blob; url: string; ext: string; secs: number }

const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const BITRATE = 2_500_000;

let audio: AudioContext | null = null;

// `from` and `to` are seconds into the recording.
export async function cutClip(src: Blob, from: number, to: number): Promise<Blob> {
  const video = document.createElement('video');
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(src);
  video.src = url;
  try {
    await once(video, 'loadedmetadata');
    await seek(video, from);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const g = canvas.getContext('2d')!;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(30);
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') await audio.resume();
      const sink = audio.createMediaStreamDestination();
      audio.createMediaElementSource(video).connect(sink); // not to audio.destination: silent here
      sink.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch {
      video.muted = true; // no Web Audio: a silent clip
    }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = once(rec, 'stop');
    rec.start();
    await video.play();
    await new Promise<void>(resolve => {
      const tick = () => {
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (video.currentTime >= to || video.ended) return resolve();
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(tick);
        else requestAnimationFrame(tick);
      };
      tick();
    });
    video.pause();
    rec.stop();
    await stopped;
    stream.getTracks().forEach(t => t.stop());
    return new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'video/webm' });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Cuts each window (ms on performance.now()'s clock) out of a recording that began at `t0`, two at
// a time, handing each clip over as soon as it's done (null for one that couldn't be cut).
export async function cutClips(src: Blob, t0: number, windows: Window[], onClip: (c: Clip | null, i: number) => void): Promise<void> {
  const next = windows.map((w, i) => ({ w, i }));
  const worker = async () => {
    for (let job = next.shift(); job; job = next.shift()) {
      const { w, i } = job;
      try {
        const blob = await cutClip(src, (w.from - t0) / 1000, (w.to - t0) / 1000);
        if (!blob.size) throw new Error('empty clip');
        onClip({ label: w.label, blob, url: URL.createObjectURL(blob), ext: blob.type.includes('mp4') ? 'mp4' : 'webm', secs: (w.to - w.from) / 1000 }, i);
      } catch (e) {
        console.warn('clip failed:', e instanceof Error ? e.message : e);
        onClip(null, i);
      }
    }
  };
  await Promise.all([worker(), worker()]);
}

// A MediaRecorder file has no index, so its duration reads as Infinity and a seek can land short;
// jumping past the end once makes the browser scan it, after which seeks are exact.
async function seek(video: HTMLVideoElement, t: number): Promise<void> {
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e9;
    await once(video, 'seeked');
  }
  video.currentTime = t;
  await once(video, 'seeked');
}

function once(target: EventTarget, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(type, () => resolve(), { once: true });
    target.addEventListener('error', () => reject(new Error(`${type}: media error`)), { once: true });
  });
}
