// Attack-pose frame (motion layer 2): one image-edit call redraws a troop's base sprite mid-attack,
// prompted by its flavor, then BiRefNet cuts it out like a sprite. The renderer swaps it in at each
// strike. Cached on disk by description + flavor and served at /api/pose/<id>.png, so a troop
// deployed twice, or by both players, pays once.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { BACKGROUND, REMOVE_TIMEOUT_MS, bytes, fal, normalise, spritePng } from './sprites';

const POSE_VERSION = 1; // bump to redraw every pose after a prompt or model change
const EDIT_TIMEOUT_MS = 25_000;

const DIR = new URL('../.cache/poses/', import.meta.url);

export interface Pose {
  url: string; // '/api/pose/<id>.png', plus '?key' when the background is still on
  removed: boolean;
  cached: boolean;
  ms: number;
}

const idOf = (description: string, flavor: string) =>
  createHash('sha1')
    .update(`${POSE_VERSION}|${normalise(description)}|${normalise(flavor)}`)
    .digest('hex')
    .slice(0, 20);

const urlOf = (id: string, removed: boolean) => (removed ? `/api/pose/${id}.png` : `/api/pose/${id}.key.png?key`);

export function posePrompt(description: string, flavor: string): string {
  const action = flavor.trim() ? flavor.trim().slice(0, 120) : 'mid-attack, dynamic pose';
  return (
    `Redraw this exact same character (${description.slice(0, 200)}) mid-attack: ${action}. ` +
    'Keep its design, colours, proportions and art style identical; only the pose changes, full body, centered, ' +
    `no text, ${BACKGROUND}`
  );
}

// The editing model sits behind this one function so it can be swapped (Gemini image edit, say).
// In: the base sprite PNG and a prompt. Out: the edited image as a data URI or hosted URL.
export async function editImage(png: Buffer, prompt: string): Promise<string> {
  const r = await fal<{ images?: { url: string }[] }>(
    'fal-ai/flux-pro/kontext',
    {
      prompt,
      image_url: `data:image/png;base64,${png.toString('base64')}`,
      aspect_ratio: '1:1',
      num_images: 1,
      output_format: 'png',
      sync_mode: true,
      safety_tolerance: '5', // "dragon breathing fire" and friends are the whole game
    },
    EDIT_TIMEOUT_MS
  );
  const url = r.images?.[0]?.url;
  if (!url) throw new Error('kontext: no image');
  return url;
}

const inFlight = new Map<string, Promise<Pose>>();

export async function pose(description: string, flavor: string): Promise<Pose> {
  const t0 = performance.now();
  const id = idOf(description, flavor);
  for (const [file, removed] of [[`${id}.png`, true], [`${id}.key.png`, false]] as const) {
    if (existsSync(new URL(file, DIR))) return { url: urlOf(id, removed), removed, cached: true, ms: 0 };
  }
  let p = inFlight.get(id);
  if (!p) {
    p = draw(id, description, flavor).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  const s = await p;
  return { ...s, ms: Math.round(performance.now() - t0) };
}

export async function poseFile(name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{20}(\.key)?\.png$/.test(name)) return null;
  try {
    return await readFile(new URL(name, DIR));
  } catch {
    return null;
  }
}

async function draw(id: string, description: string, flavor: string): Promise<Pose> {
  const t0 = performance.now();
  const base = await spritePng(description); // cached for any troop that already has art
  const raw = await editImage(base, posePrompt(description, flavor));
  let png: Buffer | null = null;
  try {
    const cut = await fal<{ image?: { url: string } }>(
      'fal-ai/birefnet/v2',
      { image_url: raw, model: 'General Use (Light)', output_format: 'png', sync_mode: true },
      REMOVE_TIMEOUT_MS
    );
    if (cut.image?.url) png = await bytes(cut.image.url);
  } catch (e) {
    console.warn('pose background removal failed, client will key it:', e instanceof Error ? e.message.slice(0, 160) : e);
  }
  const removed = !!png;
  png ??= await bytes(raw);
  mkdirSync(DIR, { recursive: true });
  await writeFile(new URL(removed ? `${id}.png` : `${id}.key.png`, DIR), png);
  return { url: urlOf(id, removed), removed, cached: false, ms: Math.round(performance.now() - t0) };
}
