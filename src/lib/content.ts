import {
  validateSnapshot,
  migrateSnapshot,
  pick as pickLoc,
  type ContentSnapshot,
  type Locale,
} from './content-contract';
import fallbackSnapshot from '../data/fallback-snapshot.json';

/**
 * Content seam. The landing reads its live content from the CMS (hon-x-admin) via KV, in
 * the localized `ContentSnapshot` contract. Mirrors hon-x-web, plus the hon-landing-only
 * blocks: nav, download (#/download), member (#/member).
 *
 *   1. `resolveContent(locals)` — read the atomic `site:live` KV key once per request,
 *      migrate + validate, else the bundled fallback-snapshot.json. Never throws.
 *   2. `localize(snapshot, locale, url)` — flatten the bilingual snapshot + a static
 *      SITE_CONFIG (deploy-time assets) into the plain shape the components render.
 */

export type { Locale };
export type Phase = ContentSnapshot['phase'];

export const fallbackContent: ContentSnapshot = fallbackSnapshot as ContentSnapshot;

/* ── Static, non-editorial site config (assets + brand + fixed SEO chrome) ───────── */
export const SITE_CONFIG = {
  brand: {
    name: 'HoN X',
    domain: 'hon-x.net',
    logo: '/brand/logo.png',
    logo2x: '/brand/logo-2x.png',
    logoWebp: '/brand/logo.webp',
    logo2xWebp: '/brand/logo-2x.webp',
    keyart: '/brand/keyart-portal.png',
    keyartBase: '/brand/keyart-portal',
  },
  social: { discord: 'https://discord.gg/Tf7bP8xHmA', facebook: '', youtube: '', x: '' },
  seo: {
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: 'HoN X — Heroes of Newerth เซิร์ฟไทยแท้',
    themeColor: '#ffc600',
  },
  media: {
    autoplayMs: 5200,
    reel: { mp4: '/art/reel.mp4', webm: '/art/reel.webm', poster: '/art/reel-poster' },
  },
} as const;

interface RuntimeLocals {
  runtime?: { env?: Record<string, unknown> };
  __content?: ContentSnapshot;
}

export async function resolveContent(locals?: RuntimeLocals): Promise<ContentSnapshot> {
  if (!locals) return fallbackContent;
  if (locals.__content) return locals.__content;
  // Merged app: the landing reads the SAME KV the admin writes (binding CMS_KV).
  const env = locals.runtime?.env as
    | { CMS_KV?: { get(key: string, type: 'json'): Promise<unknown> } }
    | undefined;
  const kv = env?.CMS_KV;
  if (!kv) { locals.__content = fallbackContent; return fallbackContent; }
  try {
    const raw = await kv.get('site:live', 'json');
    const migrated = migrateSnapshot(raw);
    const resolved = validateSnapshot(migrated).ok ? (migrated as ContentSnapshot) : fallbackContent;
    locals.__content = resolved;
    return resolved;
  } catch {
    locals.__content = fallbackContent;
    return fallbackContent;
  }
}

/* ── Locale (path-based: `/` = th default, `/en` = en) ───────────────────────────── */
export const LOCALES: Locale[] = ['th', 'en'];
export const DEFAULT_LOCALE: Locale = 'th';
export function localeFromPath(pathname: string): Locale {
  return /^\/en(\/|$)/.test(pathname) ? 'en' : 'th';
}
export function pathForLocale(pathname: string, locale: Locale): string {
  const bare = pathname.replace(/^\/en(?=\/|$)/, '') || '/';
  return locale === 'en' ? (bare === '/' ? '/en' : '/en' + bare) : bare;
}

/* ── Flatten snapshot + config into the plain shape components render ─────────────── */

type L = { th: string; en: string } | undefined;

export interface LocalizedContent {
  locale: Locale;
  phase: Phase;
  brand: typeof SITE_CONFIG.brand;
  social: typeof SITE_CONFIG.social;
  sections: Record<string, boolean>;
  seo: {
    title: string; description: string; ogImage: string;
    ogImageWidth: number; ogImageHeight: number; ogImageAlt: string;
    themeColor: string; canonical: string; robots: string; twitterCard: string; jsonLd: string;
  };
  phaseContent: {
    kicker: string; headline: string; headline2: string; subhead: string; body: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    countdownTo: string; countdownLabel: string;
  };
  serverOath: { eyebrow: string; title: string; intro: string; proofs: { no: string; title: string; body: string; metric: string }[] };
  war: { eyebrow: string; title: string; subtitle: string; factionsLabel: string; spotlightLabel: string };
  factions: { title: string; hint: string; legion: FactionView; hellbourne: FactionView };
  media: {
    title: string; subtitle: string; label: string; autoplayMs: number;
    reel: { mp4: string; webm: string; poster: string; heading: string; caption: string };
    scenes: { image: string; heading: string; caption: string }[];
  };
  register: { eyebrow: string; title: string; subtitle: string; buttonLabel: string; note: string };
  nav: { links: { label: string; href: string }[]; member: { label: string; href: string } };
  download: DownloadView;
  member: MemberView;
}

interface FactionView { name: string; tagline: string; crest: string; accent: string; glow: string; lore: string }
interface DownloadView {
  seoTitle: string; seoDescription: string; eyebrow: string; title: string; subtitle: string;
  client: {
    name: string; platform: string; version: string; size: string; buttonLabel: string; href: string;
    preloadHours: number; lockedNote: string; lockedCountdownLabel: string; mirrorLabel: string;
    mirrors: { label: string; href: string }[];
  };
  steps: { title: string; items: { title: string; body: string }[] };
  specs: { title: string; minLabel: string; recLabel: string; rows: { part: string; min: string; rec: string }[] };
}
interface MemberView {
  seoTitle: string; seoDescription: string; eyebrow: string; title: string; subtitle: string;
  loginLabel: string; registerLabel: string; portalUrl: string; loginUrl: string; registerUrl: string;
  comingSoonNote: string; discordButtonLabel: string;
  features: { no: string; title: string; body: string; status: string }[];
}

export function localize(snap: ContentSnapshot, locale: Locale, canonicalHref?: string): LocalizedContent {
  const P = (v: L) => pickLoc(v, locale);
  const cfg = SITE_CONFIG;
  const dl = snap.download;
  const mem = snap.member;
  const nav = snap.nav;

  return {
    locale,
    phase: snap.phase,
    brand: cfg.brand,
    social: cfg.social,
    sections: snap.sections as Record<string, boolean>,
    seo: {
      title: P(snap.seo.title), description: P(snap.seo.description),
      ogImage: snap.seo.ogImage, ogImageWidth: cfg.seo.ogImageWidth, ogImageHeight: cfg.seo.ogImageHeight,
      ogImageAlt: cfg.seo.ogImageAlt, themeColor: cfg.seo.themeColor,
      canonical: canonicalHref ?? snap.seo.canonical, robots: snap.seo.robots,
      twitterCard: snap.seo.twitterCard, jsonLd: snap.seo.jsonLd ?? '',
    },
    phaseContent: {
      kicker: P(snap.hero.kicker), headline: P(snap.hero.headline), headline2: P(snap.hero.headline2),
      subhead: P(snap.hero.subhead), body: '',
      ctaPrimary: { label: P(snap.hero.ctaPrimary.label), href: snap.hero.ctaPrimary.href },
      ctaSecondary: { label: P(snap.hero.ctaSecondary.label), href: snap.hero.ctaSecondary.href },
      countdownTo: snap.hero.countdownTo, countdownLabel: P(snap.hero.countdownLabel),
    },
    serverOath: {
      eyebrow: snap.serverOath.eyebrow, title: P(snap.serverOath.title), intro: P(snap.serverOath.intro),
      proofs: snap.serverOath.proofs.map((pr) => ({ no: pr.no, title: P(pr.title), body: P(pr.body), metric: pr.metric })),
    },
    war: {
      eyebrow: snap.war.eyebrow, title: P(snap.war.title), subtitle: P(snap.war.subtitle),
      factionsLabel: P(snap.war.factionsLabel), spotlightLabel: P(snap.war.spotlightLabel),
    },
    factions: {
      title: P(snap.factions.title), hint: P(snap.factions.hint),
      legion: faction(snap.factions.legion, P), hellbourne: faction(snap.factions.hellbourne, P),
    },
    media: {
      title: P(snap.media.title), subtitle: P(snap.media.subtitle), label: snap.media.label, autoplayMs: cfg.media.autoplayMs,
      reel: { ...cfg.media.reel, heading: P(snap.media.reel.heading), caption: P(snap.media.reel.caption) },
      scenes: snap.media.scenes.map((s) => ({ image: s.image, heading: P(s.heading), caption: P(s.caption) })),
    },
    register: {
      eyebrow: 'THE SUMMON', title: P(snap.register.heading), subtitle: P(snap.register.body),
      buttonLabel: P(snap.register.cta.label), note: P(snap.footer.note),
    },
    nav: nav
      ? { links: nav.links.map((l) => ({ label: P(l.label), href: l.href })), member: { label: P(nav.member.label), href: nav.member.href } }
      : { links: [], member: { label: '', href: '#/member' } },
    download: dl ? {
      seoTitle: P(dl.seoTitle), seoDescription: P(dl.seoDescription), eyebrow: dl.eyebrow,
      title: P(dl.title), subtitle: P(dl.subtitle),
      client: {
        name: dl.client.name, platform: dl.client.platform, version: P(dl.client.version), size: dl.client.size,
        buttonLabel: P(dl.client.buttonLabel), href: dl.client.href, preloadHours: dl.client.preloadHours,
        lockedNote: P(dl.client.lockedNote), lockedCountdownLabel: P(dl.client.lockedCountdownLabel),
        mirrorLabel: P(dl.client.mirrorLabel), mirrors: dl.client.mirrors.map((m) => ({ label: m.label, href: m.href })),
      },
      steps: { title: P(dl.steps.title), items: dl.steps.items.map((it) => ({ title: P(it.title), body: P(it.body) })) },
      specs: {
        title: P(dl.specs.title), minLabel: P(dl.specs.minLabel), recLabel: P(dl.specs.recLabel),
        rows: dl.specs.rows.map((r) => ({ part: P(r.part), min: P(r.min), rec: P(r.rec) })),
      },
    } : emptyDownload(),
    member: mem ? {
      seoTitle: P(mem.seoTitle), seoDescription: P(mem.seoDescription), eyebrow: mem.eyebrow,
      title: P(mem.title), subtitle: P(mem.subtitle), loginLabel: P(mem.loginLabel), registerLabel: P(mem.registerLabel),
      portalUrl: mem.portalUrl, loginUrl: mem.loginUrl, registerUrl: mem.registerUrl,
      comingSoonNote: P(mem.comingSoonNote), discordButtonLabel: P(mem.discordButtonLabel),
      features: mem.features.map((f) => ({ no: f.no, title: P(f.title), body: P(f.body), status: P(f.status) })),
    } : emptyMember(),
  };
}

function faction(f: ContentSnapshot['factions']['legion'], P: (v: any) => string): FactionView {
  return { name: f.name, tagline: f.tagline, crest: f.crest, accent: f.accent, glow: f.glow, lore: P(f.lore) };
}
function emptyDownload(): DownloadView {
  return { seoTitle: '', seoDescription: '', eyebrow: '', title: '', subtitle: '',
    client: { name: '', platform: '', version: '', size: '', buttonLabel: '', href: '', preloadHours: 0, lockedNote: '', lockedCountdownLabel: '', mirrorLabel: '', mirrors: [] },
    steps: { title: '', items: [] }, specs: { title: '', minLabel: '', recLabel: '', rows: [] } };
}
function emptyMember(): MemberView {
  return { seoTitle: '', seoDescription: '', eyebrow: '', title: '', subtitle: '', loginLabel: '', registerLabel: '',
    portalUrl: '', loginUrl: '', registerUrl: '', comingSoonNote: '', discordButtonLabel: '', features: [] };
}

/* ── Sync accessors (components import these; each takes the localized content) ───── */
export function getContent(c: LocalizedContent): LocalizedContent { return c; }
export function getPhase(c: LocalizedContent): Phase { return c.phase; }
export function getPhaseContent(c: LocalizedContent) { return c.phaseContent; }
export function sectionEnabled(key: string, c: LocalizedContent): boolean { return Boolean(c.sections?.[key]); }
export function getServerOath(c: LocalizedContent) { return c.serverOath; }
export function getWar(c: LocalizedContent) { return c.war; }
export function getFactions(c: LocalizedContent) { return c.factions; }
export function getMedia(c: LocalizedContent) { return c.media; }
export function getRegister(c: LocalizedContent) { return c.register; }
export function getSocial(c: LocalizedContent) { return c.social; }
export function getNav(c: LocalizedContent) { return c.nav; }
export function getDownload(c: LocalizedContent) { return c.download; }
export function getMember(c: LocalizedContent) { return c.member; }
