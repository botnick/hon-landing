import siteData from '../data/site.json';
import enOverrides from '../data/site.en.json';

/**
 * Content seam. Every component reads content through here — nothing is hardcoded.
 *
 * Two layers:
 *  1. `resolveContent(locals)` — call once per request in a page/layout. If a KV binding
 *     (`SITE_KV`) is present it reads the published snapshot (admin hot-reload path); if not
 *     (local `astro dev`, KV miss, or a KV-less host) it falls back to the bundled site.json.
 *  2. The sync accessors below take an optional `content` arg (defaulting to the bundled
 *     JSON) so components can render from whatever `resolveContent` returned — no other change.
 *
 * Publishing (admin) writes the same shape to KV under `active_version` → `site:v<n>`.
 */
export type Phase = 'cbt' | 'obt' | 'launch';
export type Lang = 'th' | 'en';

export interface PhaseContent {
  badge: string;
  badgeIcon: string;
  kicker: string;
  headline: string;
  /** Authored second headline line (Hero). Optional — only CBT phase uses it. */
  headline2?: string;
  subhead: string;
  body: string;
  ctaPrimary: { label: string; href: string };
  ctaSecondary: { label: string; href: string };
  countdownTo: string;
  countdownLabel: string;
}

export type SiteContent = typeof siteData;

/** The bundled build-time content — the always-available fallback. */
export const fallbackContent: SiteContent = siteData;

interface RuntimeLocals {
  runtime?: { env?: Record<string, unknown> };
  __content?: SiteContent;
}

/**
 * Resolve the live content for this request. Reads KV when the binding exists,
 * else returns the bundled JSON. Result is memoised on `locals` so multiple
 * components in one render don't re-fetch. Never throws — falls back on any error.
 */
export async function resolveContent(locals?: RuntimeLocals): Promise<SiteContent> {
  if (!locals) return fallbackContent;
  if (locals.__content) return locals.__content;

  const env = locals.runtime?.env as
    | { SITE_KV?: { get(key: string, type: 'json'): Promise<unknown> } }
    | undefined;
  const kv = env?.SITE_KV;
  if (!kv) {
    locals.__content = fallbackContent;
    return fallbackContent;
  }

  try {
    const pointer = (await kv.get('active_version', 'json')) as { key?: string } | null;
    const snapKey = pointer?.key ?? 'site:current';
    const snap = (await kv.get(snapKey, 'json')) as SiteContent | null;
    const resolved = snap ?? fallbackContent;
    locals.__content = resolved;
    return resolved;
  } catch {
    locals.__content = fallbackContent;
    return fallbackContent;
  }
}

/* ---- Localization ------------------------------------------------------------- */
/*
 * English is a TEXT overlay, not a second content tree: site.en.json holds only the
 * translated strings and localizeContent() deep-merges it over whatever resolveContent
 * returned (bundled or live KV). Hrefs, dates, colors, phase and section toggles are
 * therefore shared — an admin publish changes both languages at once.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Objects merge per key, arrays merge element-wise (so override entries may be partial). */
function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (Array.isArray(base) && Array.isArray(over)) {
    const len = Math.max(base.length, over.length);
    return Array.from({ length: len }, (_, i) => deepMerge(base[i], over[i]));
  }
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;
}

/** Overlay the requested language's text onto the resolved content. 'th' is the base. */
export function localizeContent(content: SiteContent, lang: Lang): SiteContent {
  if (lang !== 'en') return content;
  return deepMerge(content, enOverrides) as SiteContent;
}

export function getLang(content: SiteContent = fallbackContent): Lang {
  return content.lang === 'en' ? 'en' : 'th';
}

/** Chrome strings (countdown units, aria labels, language switcher). */
export function getUi(content: SiteContent = fallbackContent) {
  return content.ui;
}

/* ---- Sync accessors — default to bundled JSON, or pass in resolved content. ---- */

export function getContent(content: SiteContent = fallbackContent): SiteContent {
  return content;
}

export function getPhase(content: SiteContent = fallbackContent): Phase {
  return (content.phase as Phase) ?? 'cbt';
}

export function getPhaseContent(content: SiteContent = fallbackContent): PhaseContent {
  const p = getPhase(content);
  return content.phases[p] as PhaseContent;
}

export function sectionEnabled(
  key: keyof SiteContent['sections'],
  content: SiteContent = fallbackContent
): boolean {
  return Boolean(content.sections[key]?.enabled);
}

/** Section content accessors — one seam per block, mirrors getContent(). */
export function getServerOath(content: SiteContent = fallbackContent) { return content.serverOath; }
export function getWar(content: SiteContent = fallbackContent) { return content.war; }
export function getFactions(content: SiteContent = fallbackContent) { return content.factions; }
export function getMedia(content: SiteContent = fallbackContent) { return content.media; }
export function getRegister(content: SiteContent = fallbackContent) { return content.register; }
export function getSocial(content: SiteContent = fallbackContent) { return content.social; }
export function getNav(content: SiteContent = fallbackContent) { return content.nav; }
export function getDownload(content: SiteContent = fallbackContent) { return content.download; }
export function getMember(content: SiteContent = fallbackContent) { return content.member; }
export function getRoadmap(content: SiteContent = fallbackContent) { return content.roadmap; }
export function getFaq(content: SiteContent = fallbackContent) { return content.faq; }
export function getPatchNotes(content: SiteContent = fallbackContent) { return content.patchNotes; }
