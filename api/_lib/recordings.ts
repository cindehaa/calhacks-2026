// Gameplay recordings (client/src/recorder.ts) go to the same Blob store as the art, and the Hobby
// plan suspends the whole store past 1 GB. So recordings get a rolling budget: before a new upload
// is allowed, the oldest are deleted until the newest ones plus the incoming one fit in it. The art
// (sprites/, poses/) is never touched.
import { del, list } from '@vercel/blob';

export const RECORDING_MAX_BYTES = 100 * 1024 * 1024; // one video
export const RECORDINGS_BUDGET_BYTES = 400 * 1024 * 1024; // all of them, including the incoming one

// The @vercel/blob calls used, passed in so the tests can stand in for them.
export interface RecordingsApi {
  list: typeof list;
  del: typeof del;
}

// Returns the pathnames it deleted.
export async function pruneRecordings(api: RecordingsApi = { list, del }, budget = RECORDINGS_BUDGET_BYTES, incoming = RECORDING_MAX_BYTES): Promise<string[]> {
  const blobs: { url: string; pathname: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.list({ prefix: 'recordings/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()); // newest first
  let kept = incoming;
  let i = 0;
  while (i < blobs.length && kept + blobs[i].size <= budget) kept += blobs[i++].size;
  const drop = blobs.slice(i); // everything older than the first one that doesn't fit
  if (drop.length) await api.del(drop.map(b => b.url));
  return drop.map(b => b.pathname);
}
