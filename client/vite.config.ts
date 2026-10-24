import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    host: true, // reachable from the second laptop on the same network
    port: 5173,
    fs: { allow: [repoRoot] }, // client imports ../shared
    proxy: { '/api': 'http://localhost:8787' },
  },
});
