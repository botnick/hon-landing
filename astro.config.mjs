// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// MERGED app — public landing + admin CMS in ONE Astro app on Cloudflare Pages.
//
// - `output: 'hybrid'`: the landing pages SSR per request (they set `prerender = false`)
//   so admin edits (KV) show up instantly and stay SEO-crawlable; the admin pages + APIs
//   are all `prerender = false` too, so they run per-request behind the auth middleware.
//   Nothing sensitive is statically prerendered.
// - `platformProxy` wires the real D1/KV bindings into `astro dev` from wrangler.toml,
//   using the SAME local state dir that `wrangler d1 execute --local` writes to — the DB
//   we migrate + seed is the exact one dev serves against (no dual-DB drift).
// - `security.checkOrigin`: Astro's built-in CSRF origin check on non-GET requests, on top
//   of the __Host- same-site session cookie. Important now that the admin shares an origin
//   with the public landing.
export default defineConfig({
  site: 'https://hon-x.net',
  output: 'hybrid',
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: { enabled: true, persist: { path: './.wrangler/state/v3' } },
  }),
  integrations: [react()],
  security: {
    checkOrigin: true,
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
