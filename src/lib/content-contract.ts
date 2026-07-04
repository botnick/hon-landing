/**
 * THE CONTRACT between admin (writer) and landing (reader), via KV.
 *
 * grok's mandate: lock the KV payload as an explicit, versioned contract and validate
 * on BOTH sides so any landing repo (ours or Newa05's, old or new) consumes it identically.
 *
 * The landing's content.ts imports `validateSnapshot` + `SCHEMA_VERSION` from a copy of
 * this file so writer and reader share one definition. Bump SCHEMA_VERSION only on a
 * breaking shape change, and add a migrateSnapshot() step when you do.
 */

export const SCHEMA_VERSION = 1;

export type Locale = 'th' | 'en';
export const LOCALES: Locale[] = ['th', 'en'];
export const DEFAULT_LOCALE: Locale = 'th';

/** A field that carries both languages. Landing picks by active locale, falls back to th. */
export interface Localized {
  th: string;
  en: string;
}

export interface Cta {
  label: Localized;
  href: string;
}

export interface SeoBlock {
  title: Localized;
  description: Localized;
  ogImage: string;        // absolute or root-relative URL
  canonical: string;
  twitterCard: 'summary' | 'summary_large_image';
  jsonLd: string;         // raw JSON-LD string (validated as parseable, script-free)
  robots: string;         // e.g. 'index,follow'
}

export interface SectionFlags {
  [section: string]: boolean;
}

/** The full snapshot shape. Everything the landing renders comes from here. */
export interface ContentSnapshot {
  schemaVersion: number;
  phase: 'cbt' | 'obt' | 'launch';
  seo: SeoBlock;
  hero: {
    kicker: Localized;
    headline: Localized;
    headline2: Localized;
    subhead: Localized;
    ctaPrimary: Cta;
    ctaSecondary: Cta;
    countdownTo: string;   // ISO date
    countdownLabel: Localized;
  };
  sections: SectionFlags;
  faq: { q: Localized; a: Localized }[];
  roadmap: {
    activeStage: string;
    stages: { id: string; label: Localized }[];
  };
  register: {
    heading: Localized;
    body: Localized;
    cta: Cta;
  };
  footer: {
    note: Localized;
    links: { label: Localized; href: string }[];
  };
  /** The Server Oath block — eyebrow + intro + numbered proof rows. */
  serverOath: {
    eyebrow: string;          // short Latin tag, not localized
    title: Localized;
    intro: Localized;
    proofs: { no: string; title: Localized; body: Localized; metric: string }[];
  };
  /** The War act head + the two beat labels (factions / spotlight). */
  war: {
    eyebrow: string;
    title: Localized;
    subtitle: Localized;
    factionsLabel: Localized;
    spotlightLabel: Localized;
  };
  /** Two factions — text is localized; colours + crest are plain display data. */
  factions: {
    title: Localized;
    hint: Localized;
    legion: Faction;
    hellbourne: Faction;
  };
  /** Media reel + scene captions. Asset URLs are plain; headings/captions localized. */
  media: {
    title: Localized;
    subtitle: Localized;
    label: string;
    reel: { heading: Localized; caption: Localized };
    scenes: { image: string; heading: Localized; caption: Localized }[];
  };
  /** Top navigation (hon-landing single-HTML app). Labels localized; hrefs plain. */
  nav?: {
    links: { label: Localized; href: string }[];
    member: { label: Localized; href: string };
  };
  /** Download page (hon-landing #/download): client info + install steps + spec table. */
  download?: {
    seoTitle: Localized;
    seoDescription: Localized;
    eyebrow: string;
    title: Localized;
    subtitle: Localized;
    client: {
      name: string;
      platform: string;
      version: Localized;
      size: string;
      buttonLabel: Localized;
      href: string;
      preloadHours: number;
      lockedNote: Localized;
      lockedCountdownLabel: Localized;
      mirrorLabel: Localized;
      mirrors: { label: string; href: string }[];
    };
    steps: { title: Localized; items: { title: Localized; body: Localized }[] };
    specs: {
      title: Localized;
      minLabel: Localized;
      recLabel: Localized;
      rows: { part: Localized; min: Localized; rec: Localized }[];
    };
  };
  /** Member page (hon-landing #/member): portal links + coming-soon features. */
  member?: {
    seoTitle: Localized;
    seoDescription: Localized;
    eyebrow: string;
    title: Localized;
    subtitle: Localized;
    loginLabel: Localized;
    registerLabel: Localized;
    portalUrl: string;
    loginUrl: string;
    registerUrl: string;
    comingSoonNote: Localized;
    discordButtonLabel: Localized;
    features: { no: string; title: Localized; body: Localized; status: Localized }[];
  };
}

/** A faction side. `name`/`tagline` are short Latin display strings (kept plain);
 *  `lore` is localized. `accent`/`glow` are CSS colours, `crest` an asset URL. */
export interface Faction {
  name: string;
  tagline: string;
  crest: string;
  accent: string;
  glow: string;
  lore: Localized;
}

// ── Validation limits (carried from the hardened publish.ts) ──────────────────
const MAX_STRING = 8_000;
const MAX_ARRAY = 200;
const MAX_NODES = 4_000;
// C0 control chars or raw angle brackets — XSS / head-break vectors.
const UNSAFE_TEXT = new RegExp('[\u0000-\u001F<>]');
const UNSAFE_URI = /^\s*(javascript|data|vbscript):/i;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** True if `s` is a safe display string. */
function safeText(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_STRING && !UNSAFE_TEXT.test(s);
}
function safeHref(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 2_000 && !UNSAFE_URI.test(s) && !UNSAFE_TEXT.test(s);
}
function safeLocalized(v: unknown, path: string, errors: string[]): void {
  if (!v || typeof v !== 'object') return void errors.push(`${path}: not an object`);
  const o = v as Record<string, unknown>;
  for (const loc of LOCALES) {
    if (!safeText(o[loc])) errors.push(`${path}.${loc}: invalid or unsafe text`);
  }
}
function safeCta(v: unknown, path: string, errors: string[]): void {
  if (!v || typeof v !== 'object') return void errors.push(`${path}: not an object`);
  const o = v as Record<string, unknown>;
  safeLocalized(o.label, `${path}.label`, errors);
  if (!safeHref(o.href)) errors.push(`${path}.href: unsafe or invalid URL`);
}
// A CSS colour, tightly bounded (codex: reject typos/garbage, not just injection).
// Faction colours are brand constants (editor-locked), so this only guards the stored
// snapshot: hex (#rgb…#rrggbbaa), `transparent`, or rgb/rgba() with in-range channels.
function safeColor(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 64) return false;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  if (s === 'transparent') return true;
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return false;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length < 3 || parts.length > 4) return false;
  const chan = (p: string) => {
    if (p.endsWith('%')) { const n = Number(p.slice(0, -1)); return n >= 0 && n <= 100; }
    const n = Number(p); return Number.isFinite(n) && n >= 0 && n <= 255;
  };
  if (!parts.slice(0, 3).every(chan)) return false;
  if (parts.length === 4) { const a = Number(parts[3]); if (!(a >= 0 && a <= 1)) return false; }
  return true;
}

/** Recursively count nodes + reject dangerous strings anywhere (breadth/scheme DoS + XSS). */
function scanTree(v: unknown, budget: { n: number }, errors: string[], depth = 0): void {
  if (depth > 12) return void errors.push('payload nested too deep');
  if (--budget.n < 0) return void errors.push('payload has too many nodes');
  if (typeof v === 'string') {
    if (v.length > MAX_STRING) errors.push('string exceeds max length');
    if (UNSAFE_URI.test(v)) errors.push('dangerous URI scheme found in payload');
    return;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY) return void errors.push('array exceeds max length');
    for (const item of v) scanTree(item, budget, errors, depth + 1);
    return;
  }
  if (v && typeof v === 'object') {
    for (const val of Object.values(v)) scanTree(val, budget, errors, depth + 1);
  }
}

/**
 * Validate a snapshot before it may be written to KV/D1 (write side) or trusted after
 * reading from KV (read side). Returns collected errors — empty ⇒ safe to use.
 */
export function validateSnapshot(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['snapshot is not an object'] };
  }
  const s = input as Record<string, unknown>;

  if (s.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${String(s.schemaVersion)}`);
  }
  if (s.phase !== 'cbt' && s.phase !== 'obt' && s.phase !== 'launch') {
    errors.push('phase must be one of cbt|obt|launch');
  }

  // deep structural safety pass first (cheap guard before field-by-field)
  scanTree(s, { n: MAX_NODES }, errors);

  // SEO block
  const seo = s.seo as Record<string, unknown> | undefined;
  if (!seo) errors.push('seo missing');
  else {
    safeLocalized(seo.title, 'seo.title', errors);
    safeLocalized(seo.description, 'seo.description', errors);
    if (!safeHref(seo.ogImage)) errors.push('seo.ogImage: unsafe URL');
    if (!safeHref(seo.canonical)) errors.push('seo.canonical: unsafe URL');
    if (seo.twitterCard !== 'summary' && seo.twitterCard !== 'summary_large_image') {
      errors.push('seo.twitterCard invalid');
    }
    // jsonLd is OPTIONAL — empty/absent means "auto-derive from content" (landing derives it).
    // Only present-and-non-empty values are validated (an advanced override).
    if (seo.jsonLd != null && typeof seo.jsonLd !== 'string') {
      errors.push('seo.jsonLd invalid');
    } else if (typeof seo.jsonLd === 'string' && seo.jsonLd.length > MAX_STRING) {
      errors.push('seo.jsonLd too long');
    } else if (typeof seo.jsonLd === 'string' && seo.jsonLd.trim()) {
      try {
        JSON.parse(seo.jsonLd);
      } catch {
        errors.push('seo.jsonLd is not valid JSON');
      }
      if (/<\/?script/i.test(seo.jsonLd)) errors.push('seo.jsonLd contains a script tag');
    }
    if (!safeText(seo.robots)) errors.push('seo.robots invalid');
  }

  // Hero
  const hero = s.hero as Record<string, unknown> | undefined;
  if (!hero) errors.push('hero missing');
  else {
    for (const k of ['kicker', 'headline', 'headline2', 'subhead', 'countdownLabel']) {
      safeLocalized(hero[k], `hero.${k}`, errors);
    }
    safeCta(hero.ctaPrimary, 'hero.ctaPrimary', errors);
    safeCta(hero.ctaSecondary, 'hero.ctaSecondary', errors);
    if (typeof hero.countdownTo !== 'string' || Number.isNaN(Date.parse(hero.countdownTo as string))) {
      errors.push('hero.countdownTo is not a valid date');
    }
  }

  // Sections flags
  if (s.sections && typeof s.sections === 'object') {
    for (const [k, val] of Object.entries(s.sections)) {
      if (typeof val !== 'boolean') errors.push(`sections.${k} must be boolean`);
    }
  } else errors.push('sections missing');

  // FAQ
  if (!Array.isArray(s.faq)) errors.push('faq must be an array');
  else {
    if (s.faq.length > MAX_ARRAY) errors.push('faq too long');
    s.faq.forEach((item, i) => {
      const o = item as Record<string, unknown>;
      safeLocalized(o?.q, `faq[${i}].q`, errors);
      safeLocalized(o?.a, `faq[${i}].a`, errors);
    });
  }

  // Roadmap
  const rm = s.roadmap as Record<string, unknown> | undefined;
  if (!rm) errors.push('roadmap missing');
  else {
    if (!safeText(rm.activeStage)) errors.push('roadmap.activeStage invalid');
    if (!Array.isArray(rm.stages)) errors.push('roadmap.stages must be an array');
    else
      rm.stages.forEach((st, i) => {
        const o = st as Record<string, unknown>;
        if (!safeText(o?.id)) errors.push(`roadmap.stages[${i}].id invalid`);
        safeLocalized(o?.label, `roadmap.stages[${i}].label`, errors);
      });
  }

  // Register + footer
  const reg = s.register as Record<string, unknown> | undefined;
  if (!reg) errors.push('register missing');
  else {
    safeLocalized(reg.heading, 'register.heading', errors);
    safeLocalized(reg.body, 'register.body', errors);
    safeCta(reg.cta, 'register.cta', errors);
  }

  // Server Oath
  const oath = s.serverOath as Record<string, unknown> | undefined;
  if (!oath) errors.push('serverOath missing');
  else {
    if (!safeText(oath.eyebrow)) errors.push('serverOath.eyebrow invalid');
    safeLocalized(oath.title, 'serverOath.title', errors);
    safeLocalized(oath.intro, 'serverOath.intro', errors);
    if (!Array.isArray(oath.proofs)) errors.push('serverOath.proofs must be an array');
    else {
      if (oath.proofs.length > MAX_ARRAY) errors.push('serverOath.proofs too long');
      oath.proofs.forEach((pr, i) => {
        const o = pr as Record<string, unknown>;
        if (!safeText(o?.no)) errors.push(`serverOath.proofs[${i}].no invalid`);
        safeLocalized(o?.title, `serverOath.proofs[${i}].title`, errors);
        safeLocalized(o?.body, `serverOath.proofs[${i}].body`, errors);
        if (!safeText(o?.metric)) errors.push(`serverOath.proofs[${i}].metric invalid`);
      });
    }
  }

  // War
  const war = s.war as Record<string, unknown> | undefined;
  if (!war) errors.push('war missing');
  else {
    if (!safeText(war.eyebrow)) errors.push('war.eyebrow invalid');
    for (const k of ['title', 'subtitle', 'factionsLabel', 'spotlightLabel']) {
      safeLocalized(war[k], `war.${k}`, errors);
    }
  }

  // Factions
  const fac = s.factions as Record<string, unknown> | undefined;
  if (!fac) errors.push('factions missing');
  else {
    safeLocalized(fac.title, 'factions.title', errors);
    safeLocalized(fac.hint, 'factions.hint', errors);
    for (const side of ['legion', 'hellbourne']) {
      const f = fac[side] as Record<string, unknown> | undefined;
      if (!f) { errors.push(`factions.${side} missing`); continue; }
      if (!safeText(f.name)) errors.push(`factions.${side}.name invalid`);
      if (!safeText(f.tagline)) errors.push(`factions.${side}.tagline invalid`);
      if (!safeHref(f.crest)) errors.push(`factions.${side}.crest invalid`);
      if (!safeColor(f.accent)) errors.push(`factions.${side}.accent invalid colour`);
      if (!safeColor(f.glow)) errors.push(`factions.${side}.glow invalid colour`);
      safeLocalized(f.lore, `factions.${side}.lore`, errors);
    }
  }

  // Media
  const media = s.media as Record<string, unknown> | undefined;
  if (!media) errors.push('media missing');
  else {
    safeLocalized(media.title, 'media.title', errors);
    safeLocalized(media.subtitle, 'media.subtitle', errors);
    if (!safeText(media.label)) errors.push('media.label invalid');
    const reel = media.reel as Record<string, unknown> | undefined;
    if (!reel) errors.push('media.reel missing');
    else {
      safeLocalized(reel.heading, 'media.reel.heading', errors);
      safeLocalized(reel.caption, 'media.reel.caption', errors);
    }
    if (!Array.isArray(media.scenes)) errors.push('media.scenes must be an array');
    else {
      if (media.scenes.length > MAX_ARRAY) errors.push('media.scenes too long');
      media.scenes.forEach((sc, i) => {
        const o = sc as Record<string, unknown>;
        if (!safeHref(o?.image)) errors.push(`media.scenes[${i}].image invalid`);
        safeLocalized(o?.heading, `media.scenes[${i}].heading`, errors);
        safeLocalized(o?.caption, `media.scenes[${i}].caption`, errors);
      });
    }
  }

  // ── Optional blocks (hon-landing only): validate ONLY when present ────────────────
  // Nav
  const nav = s.nav as Record<string, unknown> | undefined;
  if (nav != null) {
    if (!Array.isArray(nav.links)) errors.push('nav.links must be an array');
    else nav.links.forEach((l, i) => {
      const o = l as Record<string, unknown>;
      safeLocalized(o?.label, `nav.links[${i}].label`, errors);
      if (!safeHref(o?.href)) errors.push(`nav.links[${i}].href invalid`);
    });
    const nm = nav.member as Record<string, unknown> | undefined;
    if (!nm) errors.push('nav.member missing');
    else { safeLocalized(nm.label, 'nav.member.label', errors); if (!safeHref(nm.href)) errors.push('nav.member.href invalid'); }
  }

  // Download
  const dl = s.download as Record<string, unknown> | undefined;
  if (dl != null) {
    safeLocalized(dl.seoTitle, 'download.seoTitle', errors);
    safeLocalized(dl.seoDescription, 'download.seoDescription', errors);
    if (!safeText(dl.eyebrow)) errors.push('download.eyebrow invalid');
    safeLocalized(dl.title, 'download.title', errors);
    safeLocalized(dl.subtitle, 'download.subtitle', errors);
    const c = dl.client as Record<string, unknown> | undefined;
    if (!c) errors.push('download.client missing');
    else {
      for (const k of ['name', 'platform', 'size']) if (!safeText(c[k])) errors.push(`download.client.${k} invalid`);
      safeLocalized(c.version, 'download.client.version', errors);
      safeLocalized(c.buttonLabel, 'download.client.buttonLabel', errors);
      if (!safeHref(c.href)) errors.push('download.client.href invalid');
      if (typeof c.preloadHours !== 'number') errors.push('download.client.preloadHours must be a number');
      safeLocalized(c.lockedNote, 'download.client.lockedNote', errors);
      safeLocalized(c.lockedCountdownLabel, 'download.client.lockedCountdownLabel', errors);
      safeLocalized(c.mirrorLabel, 'download.client.mirrorLabel', errors);
      if (!Array.isArray(c.mirrors)) errors.push('download.client.mirrors must be an array');
      else c.mirrors.forEach((m, i) => {
        const o = m as Record<string, unknown>;
        if (!safeText(o?.label)) errors.push(`download.client.mirrors[${i}].label invalid`);
        if (!safeHref(o?.href)) errors.push(`download.client.mirrors[${i}].href invalid`);
      });
    }
    const st = dl.steps as Record<string, unknown> | undefined;
    if (!st) errors.push('download.steps missing');
    else {
      safeLocalized(st.title, 'download.steps.title', errors);
      if (!Array.isArray(st.items)) errors.push('download.steps.items must be an array');
      else st.items.forEach((it, i) => {
        const o = it as Record<string, unknown>;
        safeLocalized(o?.title, `download.steps.items[${i}].title`, errors);
        safeLocalized(o?.body, `download.steps.items[${i}].body`, errors);
      });
    }
    const sp = dl.specs as Record<string, unknown> | undefined;
    if (!sp) errors.push('download.specs missing');
    else {
      safeLocalized(sp.title, 'download.specs.title', errors);
      safeLocalized(sp.minLabel, 'download.specs.minLabel', errors);
      safeLocalized(sp.recLabel, 'download.specs.recLabel', errors);
      if (!Array.isArray(sp.rows)) errors.push('download.specs.rows must be an array');
      else sp.rows.forEach((r, i) => {
        const o = r as Record<string, unknown>;
        safeLocalized(o?.part, `download.specs.rows[${i}].part`, errors);
        safeLocalized(o?.min, `download.specs.rows[${i}].min`, errors);
        safeLocalized(o?.rec, `download.specs.rows[${i}].rec`, errors);
      });
    }
  }

  // Member
  const mem = s.member as Record<string, unknown> | undefined;
  if (mem != null) {
    safeLocalized(mem.seoTitle, 'member.seoTitle', errors);
    safeLocalized(mem.seoDescription, 'member.seoDescription', errors);
    if (!safeText(mem.eyebrow)) errors.push('member.eyebrow invalid');
    safeLocalized(mem.title, 'member.title', errors);
    safeLocalized(mem.subtitle, 'member.subtitle', errors);
    safeLocalized(mem.loginLabel, 'member.loginLabel', errors);
    safeLocalized(mem.registerLabel, 'member.registerLabel', errors);
    for (const k of ['portalUrl', 'loginUrl', 'registerUrl']) {
      // these may be empty strings (allowed); only reject unsafe non-empty values
      const v = mem[k];
      if (v !== '' && !safeHref(v)) errors.push(`member.${k} invalid`);
    }
    safeLocalized(mem.comingSoonNote, 'member.comingSoonNote', errors);
    safeLocalized(mem.discordButtonLabel, 'member.discordButtonLabel', errors);
    if (!Array.isArray(mem.features)) errors.push('member.features must be an array');
    else mem.features.forEach((f, i) => {
      const o = f as Record<string, unknown>;
      if (!safeText(o?.no)) errors.push(`member.features[${i}].no invalid`);
      safeLocalized(o?.title, `member.features[${i}].title`, errors);
      safeLocalized(o?.body, `member.features[${i}].body`, errors);
      safeLocalized(o?.status, `member.features[${i}].status`, errors);
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Default blocks for snapshots published BEFORE serverOath/war/factions/media existed.
 * These are the real launch values (mirrors the seed) — used only to backfill an old
 * snapshot on read so rollback renders a complete page instead of falling to fallback.
 */
const DEFAULT_SERVER_OATH: ContentSnapshot['serverOath'] = {
  eyebrow: 'THE SERVER OATH',
  title: { th: 'คำสาบานของเซิร์ฟไทย', en: 'The Thai Server Oath' },
  intro: {
    th: 'เซิร์ฟที่สร้างเพื่อคนไทยจริง ๆ — นี่คือสิ่งที่เราสัญญา',
    en: 'A server built for Thai players — this is what we promise.',
  },
  proofs: [
    { no: '01', title: { th: 'จับคู่ผู้เล่นไทย', en: 'Matched with Thai Players' },
      body: { th: 'กดหาแมตช์ในไทย เจอคนไทย ระบบล็อกภูมิภาคจริง', en: 'Queue in Thailand, meet Thai players. Real region locking.' },
      metric: 'TH region-locked' },
    { no: '02', title: { th: 'ปิงต่ำ เส้นทางไทย', en: 'Low Ping, Thai Routing' },
      body: { th: 'เซิร์ฟและเส้นทางในไทย ดีเลย์ต่ำ ตอบสนองไว', en: 'Servers and routes in Thailand — low latency, snappy response.' },
      metric: 'Low-latency TH route' },
    { no: '03', title: { th: 'เสถียร ไม่หลุดกลางเกม', en: 'Stable, No Mid-Game Drops' },
      body: { th: 'เฝ้าความเสถียรตลอด CBT ไม่ค้าง ไม่หลุด', en: 'Stability watched throughout CBT — no freezes, no drops.' },
      metric: 'CBT stability watch' },
  ],
};
const DEFAULT_WAR: ContentSnapshot['war'] = {
  eyebrow: 'THE WAR',
  title: { th: 'สงครามที่ Newerth รอคุณอยู่', en: 'The War of Newerth Awaits' },
  subtitle: { th: 'สองขั้วอำนาจ หนึ่งสนามรบ', en: 'Two powers, one battlefield.' },
  factionsLabel: { th: 'เลือกฝ่าย', en: 'Choose your side' },
  spotlightLabel: { th: 'ชมสนามรบ', en: 'See the battlefield' },
};
const DEFAULT_FACTIONS: ContentSnapshot['factions'] = {
  title: { th: 'สองขั้วแห่งสงคราม', en: 'Two Poles of War' },
  hint: { th: 'เลือกฝ่ายของคุณ', en: 'Choose your side' },
  legion: {
    name: 'Legion', tagline: 'Order · Nature · Light',
    crest: '/art/crest-legion.png', accent: '#40cd3c', glow: 'rgba(64,205,60,0.45)',
    lore: { th: 'พันธมิตรของมนุษย์และ Beast Horde นำโดย King Jeraziah', en: 'An alliance of men and the Beast Horde, led by King Jeraziah.' },
  },
  hellbourne: {
    name: 'Hellbourne', tagline: 'Chaos · Blood · Demons',
    crest: '/art/crest-hellbourne.png', accent: '#dc0000', glow: 'rgba(220,0,0,0.45)',
    lore: { th: 'เหล่าปีศาจ นำโดย Maliken อดีตราชาแห่ง Legion', en: 'Demons led by Maliken, once a Legion king.' },
  },
};
const DEFAULT_MEDIA: ContentSnapshot['media'] = {
  title: { th: 'ชมสนามรบ', en: 'See the Battlefield' },
  subtitle: { th: 'ซีเนแมติกจากโลกแห่ง Newerth', en: 'Cinematics from the world of Newerth.' },
  label: 'Highlight',
  reel: {
    heading: { th: 'ช็อตเด็ดจากสนามรบ', en: 'Best Shots from the Battlefield' },
    caption: { th: 'รวมจังหวะพีค ๆ แบบ HoN แท้ ๆ', en: 'Peak moments — true HoN.' },
  },
  scenes: [
    { image: '/art/scene-bastion', heading: { th: 'ปราการแห่ง Legion', en: 'Bastion of the Legion' },
      caption: { th: 'แสงทองสาดส่องปราการสุดท้าย', en: 'Golden light on the last bastion.' } },
    { image: '/art/scene-hellbourne', heading: { th: 'การรุกของ Hellbourne', en: 'The Hellbourne Onslaught' },
      caption: { th: 'เหล่าปีศาจบุกทะลายแนวป้องกัน', en: 'Demons breach the line.' } },
    { image: '/art/scene-clash', heading: { th: 'การปะทะครั้งยิ่งใหญ่', en: 'The Great Clash' },
      caption: { th: 'สองขั้วปะทะกลาง Newerth', en: 'Two powers collide at the heart of Newerth.' } },
  ],
};

/**
 * Upgrade an older snapshot to the current shape by backfilling blocks added after it
 * was stored (codex: a valid old version must NOT silently degrade to fallback on read /
 * rollback). Only fills what is entirely absent — never overwrites authored content.
 * Returns a NEW object; the input is left untouched. Non-objects pass through unchanged
 * so validateSnapshot() still reports them as invalid.
 */
export function migrateSnapshot(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const s = input as Record<string, unknown>;
  const out: Record<string, unknown> = { ...s };
  if (out.serverOath == null) out.serverOath = DEFAULT_SERVER_OATH;
  if (out.war == null) out.war = DEFAULT_WAR;
  if (out.factions == null) out.factions = DEFAULT_FACTIONS;
  if (out.media == null) out.media = DEFAULT_MEDIA;
  return out;
}

/** Pick a localized value with fallback to the default locale then empty string. */
export function pick(v: Localized | undefined, locale: Locale): string {
  if (!v) return '';
  return v[locale] || v[DEFAULT_LOCALE] || '';
}
