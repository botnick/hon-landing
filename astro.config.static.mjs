// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static build for Cloudflare Pages (plain asset upload — no Functions/KV).
// The main astro.config.mjs stays hybrid/SSR; this config forces every route to
// prerender so the landing renders from the bundled site.json at build time.
// Usage: pnpm build:static  →  upload `dist/` to CF Pages.
const forcePrerender = {
  name: 'force-prerender',
  hooks: {
    // Overrides `export const prerender = false` in index.astro and api/publish.ts.
    'astro:route:setup': ({ route }) => {
      route.prerender = true;
    },
  },
};

export default defineConfig({
  site: 'https://hon-x.net',
  output: 'static',
  integrations: [react(), forcePrerender],
  build: {
    inlineStylesheets: 'auto',
  },
});
