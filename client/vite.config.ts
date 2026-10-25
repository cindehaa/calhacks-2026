import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    host: true, // reachable from the second laptop on the same network
    port: 5173,
    fs: { allow: [repoRoot] }, // client imports ../shared
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` }, // same API_PORT as api/_dev.ts
  },
  // The game, and the Pavilion's own page (/pavilion; vercel.json rewrites it to pavilion.html).
  build: { rollupOptions: { input: { main: page('index.html'), pavilion: page('pavilion.html') } } },
});
