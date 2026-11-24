import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The content is baked into src/content/generated/ and public/ before `vite` and `vite build`
// run (the package's `dev` and `build` scripts call `pnpm run bake` first).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
