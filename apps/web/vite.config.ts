import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  localSwaConfigDir,
  SWA_CONFIG_FILE_NAME,
  type SwaConfigOptions,
  swaConfigOptionsFromEnv,
  writeSwaConfigFiles,
} from './swa-config/build-swa-config.ts';

/**
 * Writes staticwebapp.config.json into the build output (deployed) and into .swa/ (local SWA CLI).
 * The generator in swa-config/ is its only source; `API_LOCKDOWN` switches the edge lockdown on.
 */
function swaConfig(): Plugin {
  let webRoot = '';
  let options: SwaConfigOptions = { apiLockdown: false };
  return {
    name: 'weddingplanner:swa-config',
    apply: 'build',
    configResolved(config) {
      webRoot = config.root;
      // Parse before bundling, so an invalid API_LOCKDOWN fails the build before dist/ is written.
      options = swaConfigOptionsFromEnv(process.env);
    },
    writeBundle(output) {
      if (output.dir === undefined) {
        throw new Error(`${SWA_CONFIG_FILE_NAME}: the build has no output directory.`);
      }
      writeSwaConfigFiles([output.dir, localSwaConfigDir(webRoot)], options);
      this.info(`wrote ${SWA_CONFIG_FILE_NAME} (apiLockdown=${options.apiLockdown})`);
    },
  };
}

// The content is baked into src/content/generated/ and public/ before `vite` and `vite build`
// run (the package's `dev` and `build` scripts call `pnpm run bake` first).
export default defineConfig({
  plugins: [react(), swaConfig()],
  build: {
    rolldownOptions: {
      // Two HTML entries: the public one-pager and the admin area (dist/admin/index.html), so
      // public pages never download admin code.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
