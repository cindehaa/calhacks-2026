import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    host: true, // reachable from the second laptop on the same network
    port: 5173,
    fs: { allow: [repoRoot] }, // client imports ../shared
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` }, // same API_PORT as api/_dev.ts
  },
});
