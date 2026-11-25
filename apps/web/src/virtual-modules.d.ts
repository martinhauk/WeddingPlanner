// Modules provided by the site-content plugin in vite.config.ts.

declare module 'virtual:site-content' {
  import type { SiteContent } from '@weddingplanner/content';

  /** The instance's `site-content.json`, validated at build time (without `$schema`). */
  export const content: SiteContent;
}

// `virtual:site-theme.css` (theme fonts and CSS custom properties) is a side-effect CSS import,
// typed by `vite/client`'s `*.css` declaration.
