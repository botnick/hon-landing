# HoN X — Landing + Admin CMS (one app)

A single Astro app on Cloudflare Pages that serves **both**:

- the public **landing** for [hon-x.net](https://hon-x.net) — a bilingual (Thai / English)
  single-HTML game site with a hash router (`#/`, `#/download`, `#/member`); and
- the **admin CMS** under `/admin` — a form-only, fully-Thai content manager (RBAC, drafts,
  versioned publish + rollback, AI translation) that writes what the landing reads.

They share **one KV** (`CMS_KV` — the admin writes `site:live`, the landing reads it) and
**one D1** (`CMS_DB` — users, sessions, version history, settings). No second service, no
cross-app plumbing.

## How it fits together

```
  admin (/admin, /api)  ──writes──▶  KV site:live  ──reads──▶  landing (/, /en)
        │                                                          │
        └── D1: users · sessions · content_versions · audit · app_settings
```

- **Content contract** — `src/lib/content-contract.ts` is the single source of truth for the
  snapshot shape; it validates on **both** write (publish) and read (landing), so a bad
  snapshot can never break the live site (the landing falls back to the bundled
  `src/data/fallback-snapshot.json`). Every field is bilingual (`{ th, en }`).
- **i18n** — path-based: `/` = Thai (default), `/en` = English. `hreflang` th/en/x-default,
  per-locale `<title>`/`<html lang>`/JSON-LD, and a TH/EN switch in the footer.
- **Auth boundary** — `src/middleware.ts` guards **only** `/admin/**` and `/api/**`
  (except `/api/login`). The public landing (`/`, `/en`, assets) is never gated.

## Develop

```bash
pnpm install

# 1. create the local D1 schema (users, sessions, content_versions, audit, app_settings)
pnpm db:migrate            # runs migrations/0001_init.sql + 0002_app_settings.sql (--local)

# 2. seed the first owner account (choose your own email + password, ≥ 10 chars)
node scripts/seed-owner.mjs admin@hon-x.net 'YourStrongPassword' 'Site Owner'

# 3. seed initial content (v1) into D1 + KV
pnpm seed:content

# 4. run the app
pnpm dev                   # → http://localhost:4330  (landing) · /admin (sign in) · /login

# tests
pnpm test                  # contract validator unit tests
```

`astro.config.mjs` wires the D1/KV bindings into `astro dev` via `platformProxy`, pointed at
the **same** `.wrangler/state` dir that `wrangler d1 execute --local` writes to — so the DB
you migrate/seed is the exact one dev serves against (no dual-DB drift).

## AI translation (optional)

The admin's content editor has a **"✦ แปลอัตโนมัติ ไทย→อังกฤษ"** button (OpenAI-compatible:
OpenRouter / MaxPlus / any custom endpoint). Configure it in **/admin → ตั้งค่า**: pick a
provider (base URL + model auto-fill) and paste an API key. The key is stored **write-only**
in KV (`translate:key`) — never in D1, never returned to the browser. It can also be set as
the env secret `TRANSLATE_API_KEY`.

## Deploy (Cloudflare Pages)

1. **Create the stores** (once):
   ```bash
   export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
   pnpm exec wrangler d1 create hon-x-cms        # note the database_id
   pnpm exec wrangler kv namespace create CMS_KV # note the id
   ```
2. **Put the ids in `wrangler.toml`** (`CMS_DB` database_id, `CMS_KV` id).
3. **Apply migrations + seed the owner on the REMOTE db**:
   ```bash
   pnpm exec wrangler d1 execute hon-x-cms --remote --file=./migrations/0001_init.sql
   pnpm exec wrangler d1 execute hon-x-cms --remote --file=./migrations/0002_app_settings.sql
   # seed owner: run the INSERT that scripts/seed-owner.mjs prints, against --remote
   ```
4. **Secrets** (never commit):
   ```bash
   pnpm exec wrangler pages secret put SESSION_SECRET     # required — any long random string
   pnpm exec wrangler pages secret put TRANSLATE_API_KEY  # optional — AI translation key
   pnpm exec wrangler pages secret put CF_API_TOKEN       # optional — edge cache purge on publish
   ```
   Set `COOKIE_SECURE=true` (and optionally `CF_ZONE_ID`) as Pages vars.
5. **Build + deploy**:
   ```bash
   pnpm build
   pnpm exec wrangler pages deploy ./dist --project-name hon-landing
   ```
   Bind `CMS_DB` + `CMS_KV` in Pages → Settings → Functions → Bindings (or keep them in
   `wrangler.toml`). Add the custom domain `hon-x.net`.

## Layout

```
migrations/            0001_init.sql (RBAC + content history) · 0002_app_settings.sql
scripts/               seed-owner.mjs · seed-content.mjs (th real + en translated)
test/                  contract.test.mjs
src/lib/
  content-contract.ts  THE shared snapshot shape + validateSnapshot + migrateSnapshot (write & read)
  content.ts           landing seam: resolveContent (reads site:live) + localize(snapshot, locale)
  content-store.ts     publish / rollback / drafts / readLive
  session.ts crypto.ts db.ts ratelimit.ts   auth + RBAC (CAN.*) + PBKDF2 + D1 + login rate-limit
  translate.ts settings-store.ts seo-derive.ts
src/pages/
  index.astro · en/index.astro     public landing (th / en), render <Landing/>
  admin/*.astro                     dashboard · content · seo · versions · users · audit · settings
  api/*.ts                          login · logout · content · draft · publish · rollback · users · account · translate(-settings)
  login.astro
src/components/         Landing (hash router) · Navbar · Hero · ServerOath · WarReel · Factions ·
                        VideoSpotlight · Register · Footer · DownloadSection · MemberSection · Countdown
src/layouts/           Base.astro (landing) · Admin.astro (CMS shell)
src/middleware.ts      auth guard — protects /admin + /api only
```
