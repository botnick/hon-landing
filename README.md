# HoN X — Web

Landing site for **HoN X** (Heroes of Newerth revival, Thai server) — a Closed Beta teaser at [hon-x.net](https://hon-x.net).

Built as a fast, ultra-smooth, game-flavoured landing: a four-act "ritual gate" flow with a first-paint portal animation, self-hosted gameplay highlight reel, and a no-hardcode content seam so copy can be hot-reloaded from KV in production.

## Stack

- **[Astro](https://astro.build) 4** — `output: 'hybrid'`, SSR landing per request
- **[@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)** — Cloudflare Pages/Workers adapter
- **React islands** — only the countdown + a couple of interactive bits hydrate; the rest is server-rendered HTML
- **IBM Plex Sans Thai** — Thai-native typography

## Structure

Four acts, each data-driven:

1. **The Gate** (`Hero`) — logo, headline, countdown gate-seal, Discord CTA, portal keyart
2. **The Server Oath** (`ServerOath`) — proof rows answering real Thai-player concerns (region-locked matchmaking, low-latency Thai route, CBT stability)
3. **The War** (`WarReel` = `Factions` + `VideoSpotlight`) — pick a side, then watch the highlight reel
4. **The Summon** (`Register`) — join the Closed Beta via Discord

### Content seam (no hardcode)

All copy lives in [`src/data/site.json`](src/data/site.json). Components read it through [`src/lib/content.ts`](src/lib/content.ts), which resolves live content from a Cloudflare **KV** binding (`SITE_KV`) when present and falls back to the bundled JSON otherwise — so `astro dev` and any KV-less host work unchanged. The `/api/publish` route writes a versioned snapshot to D1 + KV and purges the edge cache for instant admin hot-reload.

### i18n (th / en)

Thai is the base language at `/`; English lives at `/en/` with a TH/EN switch in the navbar (the switch preserves the current `#/…` view). English is a **text overlay**, not a second content tree: [`src/data/site.en.json`](src/data/site.en.json) holds only translated strings and `localizeContent()` deep-merges it over the resolved (bundled or live-KV) content — hrefs, dates, colors, `phase`, and section toggles stay shared, so an admin publish updates both languages at once. Chrome strings that don't belong to a section (countdown units, aria labels) live under the `ui` key and are translated the same way. Both pages emit `hreflang` alternates and language-correct `<html lang>` / OG locale tags.

To change English copy, edit `site.en.json` (keep array order/length matching `site.json` — arrays merge element-wise, and entries may be partial).

### Performance

- AVIF/WebP everywhere via `<picture>`, PNG fallback
- `content-visibility` + reserved dimensions below the fold (no CLS)
- Scroll-reveal, hero parallax, and all micro-interactions animate **only** `transform`/`opacity` (GPU-composited — no layout thrash)
- `prefers-reduced-motion` fully honored
- The highlight reel lazy-loads and plays only while on screen

## Develop

```bash
pnpm install
pnpm dev        # astro dev on :4330
pnpm build      # production build → dist/
pnpm preview    # preview the build
```

## Deploy (Cloudflare Pages)

The site runs on **Cloudflare Pages** with the `@astrojs/cloudflare` adapter. The landing works with **zero bindings** — it just renders the bundled `site.json`. Bindings are only needed for the optional admin hot-reload path (KV live content + D1 history + `/api/publish`).

There are two ways to deploy. **Option A (git-connected)** is recommended — every push to `main` auto-builds and deploys.

### Option A — Git-connected (recommended)

1. **Connect the repo.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick `botnick/hon-x-web`.
2. **Build settings:**
   | Field | Value |
   |---|---|
   | Framework preset | `Astro` |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
   | Root directory | *(leave blank)* |
3. Under **Environment variables**, add `PNPM_VERSION` = `9` (or set `NODE_VERSION` = `20`) so the build uses pnpm.
4. **Save and Deploy.** First build takes ~1–2 min. You get a `*.pages.dev` URL.
5. **Custom domain:** Pages project → **Custom domains** → add `hon-x.net` (and `www` if wanted). Cloudflare wires the DNS automatically when the domain is on the same account.

That's it for a static-content deploy. To enable admin hot-reload, do **Bindings** below.

### Option B — CLI (wrangler)

```bash
pnpm build
pnpm dlx wrangler pages deploy dist --project-name hon-x-web
```

First run creates the project and prompts for the production branch (`main`).

### Bindings (optional — admin hot-reload)

The `/api/publish` endpoint writes a versioned content snapshot to D1 + KV and flips the live pointer so edits show up within ~30s (or instantly if cache-purge is configured). Without these bindings the endpoint returns `501` and the site serves the bundled JSON — everything else works.

1. **Create the stores:**
   ```bash
   pnpm dlx wrangler kv namespace create SITE_KV     # → note the id
   pnpm dlx wrangler d1 create hon-x-db              # → note the database_id
   ```
2. **Run the D1 migration** (creates the `site_versions` table):
   ```bash
   pnpm dlx wrangler d1 execute hon-x-db --remote --file ./migrations/0001_site_versions.sql
   ```
3. **Wire the bindings** — either uncomment and fill the ids in [`wrangler.toml`](wrangler.toml), **or** add them in the dashboard: Pages project → **Settings → Functions → Bindings** →
   - KV namespace: variable `SITE_KV` → your namespace
   - D1 database: variable `SITE_DB` → `hon-x-db`
4. **Set the secrets** (never commit these):
   ```bash
   pnpm dlx wrangler pages secret put ADMIN_KEY --project-name hon-x-web
   # optional — enables instant cache purge on publish:
   pnpm dlx wrangler pages secret put CF_API_TOKEN --project-name hon-x-web
   ```
   `CF_ZONE_ID` is not secret and can go in `wrangler.toml` `[vars]` or the dashboard.
5. **Publish content:**
   ```bash
   curl -X POST https://hon-x.net/api/publish \
     -H "x-admin-key: $ADMIN_KEY" \
     -H "content-type: application/json" \
     --data @src/data/site.json
   ```

### Environment variables / bindings reference

| Name | Type | Required | Purpose |
|---|---|---|---|
| `SITE_KV` | KV namespace | for admin | Live content snapshot + active-version pointer |
| `SITE_DB` | D1 database | for admin | Version history (`site_versions` table) |
| `ADMIN_KEY` | secret | for admin | Auth for `POST /api/publish` (`x-admin-key` header) |
| `CF_ZONE_ID` | var | optional | Zone id for edge cache purge on publish |
| `CF_API_TOKEN` | secret | optional | Token (Cache Purge scope) for the purge call |

> Deploys are billed to whichever Cloudflare account the Pages project lives on. When wiring D1/KV, double-check you're on the intended account — a wrong-account database id is a common "deploy won't update" trap.
