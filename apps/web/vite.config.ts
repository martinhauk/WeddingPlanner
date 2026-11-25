import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import {
  fontStylesheets,
  formatDiagnostic,
  instanceDirFromEnv,
  loadSiteContent,
  MEDIA_TYPES,
  publishedMedia,
  publishedSiteContent,
  SITE_CONTENT_FILE,
  SITE_MEDIA_URL_PREFIX,
  type SiteContentLoad,
  themeCss,
} from '@weddingplanner/content/node';
import { type Connect, defineConfig, type Logger, type Plugin } from 'vite';
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

/** `export const content`: the validated `site-content.json` of the instance, without drafts. */
const CONTENT_MODULE = 'virtual:site-content';
/** The theme's self-hosted fonts and CSS custom properties. */
const THEME_MODULE = 'virtual:site-theme.css';

type LoadedContent = SiteContentLoad & { content: NonNullable<SiteContentLoad['content']> };

/**
 * Reads `$INSTANCE_DIR/site-content.json` (default `samples/instance`, relative to the repository
 * root like the bake) and validates it with the `@weddingplanner/content` schema: invalid content
 * fails `vite build` and shows the error overlay in `vite`. Serves `$INSTANCE_DIR/media/**` under
 * `/media/` (dev middleware) and emits the images the published content uses to `dist/media/`
 * (build). Hidden sections (`visible: false`) and images only they use never reach the bundle.
 *
 * Diagnostics name a code and a JSON path, never content: build logs are public.
 */
function siteContent(): Plugin {
  const instanceDir = instanceDirFromEnv(process.env.INSTANCE_DIR);
  const contentFile = path.join(instanceDir, SITE_CONTENT_FILE);
  const mediaDir = path.join(instanceDir, 'media');
  let webRoot = '';
  let command: 'build' | 'serve' = 'serve';
  let logger: Logger | undefined;
  let loading: Promise<LoadedContent> | undefined;

  const load = (): Promise<LoadedContent> => {
    loading ??= loadSiteContent(instanceDir).then((result) => {
      const findings = result.diagnostics.map(formatDiagnostic);
      if (!result.ok || result.content === undefined) {
        throw new Error(
          [`${SITE_CONTENT_FILE} of INSTANCE_DIR is invalid:`, ...findings].join('\n'),
        );
      }
      for (const finding of findings) {
        logger?.warn(`${SITE_CONTENT_FILE}: ${finding}`);
      }
      return { ...result, content: result.content };
    });
    return loading;
  };

  return {
    name: 'weddingplanner:site-content',
    configResolved(config) {
      webRoot = config.root;
      command = config.command;
      logger = config.logger;
    },
    async buildStart() {
      // Fail early in `vite build`; the dev server loads on first request.
      if (command === 'build') {
        await load();
      }
    },
    resolveId(id) {
      return id === CONTENT_MODULE || id === THEME_MODULE ? `\0${id}` : undefined;
    },
    async load(id) {
      if (id === `\0${CONTENT_MODULE}`) {
        const content = publishedSiteContent((await load()).content);
        return `export const content = ${JSON.stringify(content)};\n`;
      }
      if (id === `\0${THEME_MODULE}`) {
        const { theme } = (await load()).content;
        const resolve = createRequire(path.join(webRoot, 'package.json')).resolve;
        const fonts = fontStylesheets(theme).map((s) => `@import ${JSON.stringify(resolve(s))};`);
        return `${fonts.join('\n')}\n${themeCss(theme)}`;
      }
      return undefined;
    },
    transformIndexHtml(html, context) {
      if (path.resolve(context.filename) !== path.join(webRoot, 'index.html')) {
        return html;
      }
      return load().then(({ content }) =>
        html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(content.couple.de)}</title>`),
      );
    },
    configureServer(server) {
      server.watcher.add([contentFile, mediaDir]);
      server.watcher.on('all', (_event, file) => {
        if (file !== contentFile && !file.startsWith(`${mediaDir}${path.sep}`)) {
          return;
        }
        loading = undefined;
        const graph = server.environments.client.moduleGraph;
        for (const id of [CONTENT_MODULE, THEME_MODULE]) {
          const module = graph.getModuleById(`\0${id}`);
          if (module !== undefined) {
            graph.invalidateModule(module);
          }
        }
        server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use(SITE_MEDIA_URL_PREFIX, serveMedia(mediaDir));
    },
    async generateBundle() {
      const { content, media: all } = await load();
      for (const media of publishedMedia(publishedSiteContent(content), all)) {
        this.emitFile({
          type: 'asset',
          fileName: `${SITE_MEDIA_URL_PREFIX.slice(1)}${media.id}`,
          source: await readFile(media.file),
        });
      }
    },
  };
}

/** Dev middleware: `/media/<id>` from the instance's media folder (images only, no dot files). */
function serveMedia(mediaDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    let id: string;
    try {
      id = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
    } catch {
      next();
      return;
    }
    const extension = path.extname(id).toLowerCase();
    const type = Object.hasOwn(MEDIA_TYPES, extension)
      ? MEDIA_TYPES[extension as keyof typeof MEDIA_TYPES]
      : undefined;
    const file = path.resolve(mediaDir, id);
    const hidden = id.split('/').some((segment) => segment.startsWith('.'));
    if (type === undefined || hidden || !file.startsWith(`${mediaDir}${path.sep}`)) {
      next();
      return;
    }
    readFile(file).then(
      (bytes) => {
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(bytes);
      },
      () => next(),
    );
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// The bake writes build.json (feature flags, RSVP deadline) into src/content/generated/ and
// version.json into public/ before `vite` and `vite build` run (the package's `dev` and `build`
// scripts call `pnpm run bake` first). The page content comes from the siteContent plugin.
export default defineConfig({
  plugins: [react(), siteContent(), swaConfig()],
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
