// Attack-pose frame (motion layer 2): one image-edit call redraws a troop's base sprite mid-attack,
// prompted by its flavor, then BiRefNet cuts it out like a sprite. The renderer swaps it in at each
// strike. Cached (disk or Vercel Blob, art_store.ts) by description + flavor and served at /api/pose/<id>.png, so a troop
// deployed twice, or by both players, pays once.
import { createHash } from 'node:crypto';
import { normalise } from '../../shared/troop.js';
import { artStore } from './art_store.js';
import { BACKGROUND, artFile, cachedArt, fal, spritePng, type Art } from './sprites.js';

const POSE_VERSION = 1; // bump to redraw every pose after a prompt or model change
const EDIT_TIMEOUT_MS = 25_000;

const STORE = artStore('poses');

const idOf = (description: string, flavor: string) =>
  createHash('sha1')
    .update(`${POSE_VERSION}|${normalise(description)}|${normalise(flavor)}`)
    .digest('hex')
    .slice(0, 20);

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

// The base sprite (cached for any troop that already has art), edited into the pose.
export function pose(description: string, flavor: string): Promise<Art> {
  return cachedArt('pose', STORE, idOf(description, flavor), async () => editImage(await spritePng(description), posePrompt(description, flavor)));
}

export const poseFile = (name: string) => artFile(STORE, name);
