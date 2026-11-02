// Gameplay recordings (client/src/recorder.ts) go to the same Blob store as the art, and the Hobby
// plan suspends the whole store past its limits (1 GB stored, and monthly operations and transfer):
// the first store was suspended, and every sprite with it. So recordings are kept small:
// - a rolling budget: before a new upload is allowed, the oldest are deleted until the newest ones
//   plus the incoming one fit in it. The art (sprites/, poses/) is never touched.
// - at most RECORDINGS_PER_DAY uploads a day, since each one costs several store operations.
// - RECORDINGS=off on the api turns uploads off altogether.
import { del, list } from '@vercel/blob';

export const RECORDING_MAX_BYTES = 60 * 1024 * 1024; // one video: ~5 min at the recorder's 1.5 Mbps
export const RECORDINGS_BUDGET_BYTES = 150 * 1024 * 1024; // all of them, including the incoming one
export const RECORDINGS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export const recordingsOff = () => (process.env.RECORDINGS ?? '').trim().toLowerCase() === 'off';

// Thrown when today's uploads are used up; the route answers 429 and the match just isn't kept.
export class RecordingsFull extends Error {}

// The @vercel/blob calls used, passed in so the tests can stand in for them.
export interface RecordingsApi {
  list: typeof list;
  del: typeof del;
}

// Returns the pathnames it deleted.
export async function pruneRecordings(
  api: RecordingsApi = { list, del },
  budget = RECORDINGS_BUDGET_BYTES,
  incoming = RECORDING_MAX_BYTES,
  perDay = RECORDINGS_PER_DAY,
  now = Date.now()
): Promise<string[]> {
  const blobs: { url: string; pathname: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.list({ prefix: 'recordings/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const today = blobs.filter(b => now - b.uploadedAt.getTime() < DAY_MS).length;
  if (today >= perDay) throw new RecordingsFull(`${today} recordings in the last day, the most kept is ${perDay}`);

  blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()); // newest first
  let kept = incoming;
  let i = 0;
  while (i < blobs.length && kept + blobs[i].size <= budget) kept += blobs[i++].size;
  const drop = blobs.slice(i); // everything older than the first one that doesn't fit
  if (drop.length) await api.del(drop.map(b => b.url));
  return drop.map(b => b.pathname);
}
