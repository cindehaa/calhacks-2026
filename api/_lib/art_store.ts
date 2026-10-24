// Where generated art is kept. Locally (no BLOB_READ_WRITE_TOKEN) that's disk: .cache/<dir>/, or
// the temp dir on Vercel. The temp dir only lives as long as one function instance, so on Vercel a
// GET that landed on another instance than the one that drew the art used to 404; with a Blob
// store connected to the project, art goes to Vercel Blob instead, under '<dir>/<name>', and every
// instance sees it. The api still serves it at /api/<kind>/<name> (routes.ts), reading it back
// from Blob, so the URL stays short and same-origin and the client needs no change.
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BlobNotFoundError, get, head, put } from '@vercel/blob';

export interface ArtStore {
  exists(name: string): Promise<boolean>;
  read(name: string): Promise<Buffer | null>;
  write(name: string, png: Buffer): Promise<void>;
}

export const cacheDir = (name: string) =>
  process.env.VERCEL ? pathToFileURL(join(tmpdir(), 'arena', name) + '/') : new URL(`../../.cache/${name}/`, import.meta.url);

export function diskStore(dir: URL): ArtStore {
  return {
    exists: async name => existsSync(new URL(name, dir)),
    async read(name) {
      try {
        return await readFile(new URL(name, dir));
      } catch {
        return null;
      }
    },
    async write(name, png) {
      mkdirSync(dir, { recursive: true });
      await writeFile(new URL(name, dir), png);
    },
  };
}

// The @vercel/blob calls used, passed in so the tests can stand in for them.
export interface BlobApi {
  put: typeof put;
  get: typeof get;
  head: typeof head;
}

// Names are hashes of the prompt, so a blob is never rewritten with different bytes. Two instances
// drawing the same art at once both write it, hence allowOverwrite.
export function blobStore(prefix: string, api: BlobApi = { put, get, head }): ArtStore {
  const path = (name: string) => `${prefix}/${name}`;
  const known = new Set<string>(); // names this instance has seen stored: no need to ask again
  return {
    // head() asks the store's API rather than its CDN, so the check before drawing can't leave a
    // cached 404 in front of the PNG about to be written.
    async exists(name) {
      if (known.has(name)) return true;
      try {
        await api.head(path(name));
      } catch (e) {
        if (e instanceof BlobNotFoundError) return false;
        throw e;
      }
      known.add(name);
      return true;
    },
    // Reads go through the CDN, by pathname (the URL comes from the store id in the token).
    async read(name) {
      const r = await api.get(path(name), { access: 'public' });
      if (r?.statusCode !== 200) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
    async write(name, png) {
      await api.put(path(name), png, {
        access: 'public',
        contentType: 'image/png',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31_536_000,
      });
      known.add(name);
    },
  };
}

export const hasBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN ?? '').trim();

// Blob when the project has a store (Vercel adds BLOB_READ_WRITE_TOKEN), disk otherwise. Picked on
// first use rather than at import, since api/_dev.ts loads .env after its imports have run.
export function artStore(name: string, api?: BlobApi): ArtStore {
  let store: ArtStore | undefined;
  const pick = () => (store ??= hasBlob() ? blobStore(name, api) : diskStore(cacheDir(name)));
  return {
    exists: n => pick().exists(n),
    read: n => pick().read(n),
    write: (n, png) => pick().write(n, png),
  };
}
