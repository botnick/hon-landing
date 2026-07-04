// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// Hybrid rendering (peer consensus — Codex + Gemini):
// - Landing SSRs per request so admin edits (KV) show up instantly AND stay SEO-crawlable.
// - content.ts reads KV via Astro.locals.runtime.env when present, else falls back to the
//   bundled site.json — so `astro dev` and any KV-less environment still work unchanged.
// - Only tiny bits hydrate (countdown/register). Everything else is server-rendered HTML.
export default defineConfig({
  site: 'https://hon-x.net',
  output: 'hybrid',
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Single-page teaser is SSR (prerender:false), so @astrojs/sitemap has no static
  // routes to enumerate — a hand-written public/sitemap.xml (one URL) is used instead.
  integrations: [react()],
  build: {
    inlineStylesheets: 'auto',
  },
});
