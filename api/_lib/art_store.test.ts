import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BlobNotFoundError, type GetBlobResult, type HeadBlobResult, type PutBlobResult } from '@vercel/blob';
import { artStore, blobStore, diskStore, type ArtStore, type BlobApi } from './art_store.js';
import { artFile, cachedArt } from './sprites.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const ID = 'abcdef0123456789abcd';

// An in-memory Blob store behind the three @vercel/blob calls the store uses, logging each call.
function fakeBlob() {
  const blobs = new Map<string, Buffer>();
  const calls: { op: string; path: string; options?: unknown }[] = [];
  const api: BlobApi = {
    put: (async (path: string, body: unknown, options: unknown) => {
      calls.push({ op: 'put', path, options });
      blobs.set(path, Buffer.from(body as Buffer));
      return { url: `https://store.public.blob.vercel-storage.com/${path}`, pathname: path } as PutBlobResult;
    }) as BlobApi['put'],
    head: (async (path: string) => {
      calls.push({ op: 'head', path });
      if (!blobs.has(path)) throw new BlobNotFoundError();
      return { pathname: path } as HeadBlobResult;
    }) as BlobApi['head'],
    get: (async (path: string, options: unknown) => {
      calls.push({ op: 'get', path, options });
      const b = blobs.get(path);
      if (!b) return null;
      return { statusCode: 200, stream: new Blob([new Uint8Array(b)]).stream(), headers: new Headers() } as GetBlobResult;
    }) as BlobApi['get'],
  };
  return { api, blobs, calls };
}

test('blob store: put is public, at a fixed pathname, and reads back the same bytes', async () => {
  const { api, blobs, calls } = fakeBlob();
  const store = blobStore('sprites', api);
  assert.equal(await store.exists(`${ID}.png`), false);
  assert.equal(await store.read(`${ID}.png`), null);
  await store.write(`${ID}.png`, PNG);
  assert.deepEqual([...blobs.keys()], [`sprites/${ID}.png`]);
  const put = calls.find(c => c.op === 'put')!;
  assert.deepEqual(put.options, { access: 'public', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31_536_000 });
  assert.equal(await store.exists(`${ID}.png`), true);
  assert.deepEqual(await store.read(`${ID}.png`), PNG);
  assert.deepEqual((calls.find(c => c.op === 'get')!.options as { access: string }).access, 'public');
});

test('blob store: a second instance finds what the first wrote (the Vercel 404 this fixes)', async () => {
  const { api } = fakeBlob();
  await blobStore('poses', api).write(`${ID}.key.png`, PNG);
  const other = blobStore('poses', api);
  assert.equal(await other.exists(`${ID}.key.png`), true);
  assert.deepEqual(await other.read(`${ID}.key.png`), PNG);
  assert.equal(await other.exists(`${ID}.png`), false);
});

test('blob store: errors other than not-found are not taken as a miss', async () => {
  const { api } = fakeBlob();
  api.head = (async () => {
    throw new Error('store suspended');
  }) as BlobApi['head'];
  await assert.rejects(blobStore('sprites', api).exists(`${ID}.png`), /store suspended/);
});

// cachedArt tries BiRefNet on fal; with fetch refusing, that fails and the raw image is kept to key.
async function withoutNetwork<T>(f: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline in tests');
  }) as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await f();
  } finally {
    globalThis.fetch = real;
    console.warn = warn;
  }
}

const dataUri = `data:image/png;base64,${PNG.toString('base64')}`;

async function drawTwice(store: ArtStore) {
  let draws = 0;
  const draw = async () => (draws++, dataUri);
  const first = await withoutNetwork(() => cachedArt('sprite', store, ID, draw));
  const second = await withoutNetwork(() => cachedArt('sprite', store, ID, draw));
  return { first, second, draws };
}

test('cachedArt on Blob: draws once, serves the short same-origin URL, and the GET finds the PNG', async () => {
  const { api, blobs } = fakeBlob();
  const store = blobStore('sprites', api);
  const { first, second, draws } = await drawTwice(store);
  assert.equal(draws, 1);
  assert.equal(first.url, `/api/sprite/${ID}.key.png?key`);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(blobs.get(`sprites/${ID}.key.png`), PNG);
  // A different instance (fresh store object) serving the GET.
  assert.deepEqual(await artFile(blobStore('sprites', api), `${ID}.key.png`), PNG);
  assert.equal(await artFile(store, '../secret.png'), null);
});

test('cachedArt on disk: unchanged behaviour', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-art-'));
  try {
    const store = diskStore(pathToFileURL(dir + '/'));
    const { first, second, draws } = await drawTwice(store);
    assert.equal(draws, 1);
    assert.equal(first.url, `/api/sprite/${ID}.key.png?key`);
    assert.equal(second.cached, true);
    assert.deepEqual(await artFile(store, `${ID}.key.png`), PNG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artStore picks Blob only when BLOB_READ_WRITE_TOKEN is set, at first use', async () => {
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const { api, calls } = fakeBlob();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const local = artStore('sprites', api);
    assert.equal(await local.read('0000000000000000000a.png'), null); // disk: a missing file
    assert.equal(calls.length, 0);
    const deployed = artStore('sprites', api); // created before the token, like a module-level store before .env loads
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_fake_fake';
    assert.equal(await deployed.read('0000000000000000000a.png'), null);
    assert.deepEqual(calls.map(c => `${c.op} ${c.path}`), ['get sprites/0000000000000000000a.png']);
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});
