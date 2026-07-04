/**
 * Derive JSON-LD structured data from content — so users never hand-author JSON.
 * Default: a single VideoGame entity built from the snapshot. Optional advanced overrides
 * (type/platform) let a power user tweak without touching raw JSON.
 */
import type { ContentSnapshot, Locale } from './content-contract';
import { pick } from './content-contract';

export interface JsonLdOptions {
  applicationCategory?: string; // default 'Game'
  operatingSystem?: string; // default 'Windows'
  gameType?: string; // schema.org @type, default 'VideoGame'
}

/** Build the JSON-LD object (not stringified) from content + options. */
export function deriveJsonLd(snap: ContentSnapshot, locale: Locale = 'th', opts: JsonLdOptions = {}): object {
  const name = pick(snap.seo?.title, locale) || 'Heroes of Newerth X';
  const description = pick(snap.seo?.description, locale);
  return {
    '@context': 'https://schema.org',
    '@type': opts.gameType || 'VideoGame',
    name: 'Heroes of Newerth X',
    alternateName: name,
    description,
    inLanguage: locale,
    url: snap.seo?.canonical || 'https://hon-x.net/',
    image: snap.seo?.ogImage || '/og.jpg',
    applicationCategory: opts.applicationCategory || 'Game',
    operatingSystem: opts.operatingSystem || 'Windows',
    genre: 'MOBA',
    gamePlatform: 'PC',
  };
}

/** Stringified, ready to embed in <script type="application/ld+json">. */
export function deriveJsonLdString(snap: ContentSnapshot, locale: Locale = 'th', opts: JsonLdOptions = {}): string {
  return JSON.stringify(deriveJsonLd(snap, locale, opts), null, 2);
}
