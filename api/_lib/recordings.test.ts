import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneRecordings, type RecordingsApi } from './recordings.js';

const MB = 1024 * 1024;

// An in-memory store of recordings, listed two to a page so the cursor loop is exercised.
function fakeStore(sizes: number[]) {
  let blobs = sizes.map((size, i) => ({
    url: `https://store/recordings/${i}.webm`,
    pathname: `recordings/${i}.webm`,
    size: size * MB,
    uploadedAt: new Date(2026, 10, 1, 0, i), // higher index = newer
  }));
  const api = {
    list: (async ({ cursor }: { cursor?: string }) => {
      const at = Number(cursor ?? 0);
      const page = blobs.slice(at, at + 2);
      const hasMore = at + 2 < blobs.length;
      return { blobs: page, hasMore, cursor: hasMore ? String(at + 2) : undefined };
    }) as unknown as RecordingsApi['list'],
    del: (async (urls: string[]) => {
      blobs = blobs.filter(b => !urls.includes(b.url));
    }) as unknown as RecordingsApi['del'],
  };
  return { api, left: () => blobs.map(b => b.pathname) };
}

test('deletes the oldest recordings until the newest plus the incoming one fit', async () => {
  const s = fakeStore([30, 30, 30, 30, 30]); // 0 is oldest
  const gone = await pruneRecordings(s.api, 110 * MB, 20 * MB);
  assert.deepEqual(gone.sort(), ['recordings/0.webm', 'recordings/1.webm']);
  assert.deepEqual(s.left().sort(), ['recordings/2.webm', 'recordings/3.webm', 'recordings/4.webm']);
});

test('keeps no older recording once a newer one had to go', async () => {
  const s = fakeStore([1, 90, 5]); // the 90 MB one doesn't fit; the tiny older one goes with it
  const gone = await pruneRecordings(s.api, 100 * MB, 20 * MB);
  assert.deepEqual(gone.sort(), ['recordings/0.webm', 'recordings/1.webm']);
});

test('deletes nothing when everything fits', async () => {
  const s = fakeStore([10, 10]);
  assert.deepEqual(await pruneRecordings(s.api, 100 * MB, 20 * MB), []);
  assert.equal(s.left().length, 2);
});
