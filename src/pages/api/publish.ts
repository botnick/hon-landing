import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Admin publish endpoint. Writes a content snapshot to D1 (history) + KV (live),
 * bumps the active-version pointer, and purges the edge cache so the change shows
 * up immediately. Returns 501 locally when bindings are absent (JSON fallback mode).
 *
 * Auth: requires `x-admin-key` matching env.ADMIN_KEY. Do NOT enable without it.
 * The snapshot becomes LIVE site content on every render, so it is size-capped,
 * shape-validated, and value-constrained before it is ever stored.
 */
interface Env {
  SITE_DB?: any; // D1Database
  SITE_KV?: any; // KVNamespace
  ADMIN_KEY?: string;
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
}

// site.json is ~10 KB; cap well above that but far below the KV 25 MB limit.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 12;             // reject pathologically nested payloads (DoS)
const VALID_PHASES = new Set(['cbt', 'obt', 'launch']);

// C0 control chars (U+0000-U+001F) or raw angle brackets — XSS / head-break vectors.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F<>]/;

/**
 * Compare via SHA-256 digests: both sides hash to a fixed 32-byte value, so the
 * byte-compare loop is length-independent and the raw key length never leaks.
 * Rejects when either side is empty — an unset ADMIN_KEY must NEVER authorize.
 * (True constant-time isn't achievable in JS; over a network this is sufficient.)
 */
async function keyMatches(provided: string | null, secret: string | undefined): Promise<boolean> {
  if (!provided || !secret) return false;
  const enc = new TextEncoder();
  const [pa, pb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ]);
  const a = new Uint8Array(pa), b = new Uint8Array(pb);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A head-safe string: string, trimmed length ≥ min, raw length ≤ max, no ctrl/angle chars. */
function isSafeText(v: unknown, min: number, max: number): boolean {
  if (typeof v !== 'string') return false;
  if (v.trim().length < min || v.length > max) return false;
  return !UNSAFE_TEXT.test(v);
}

/** Reject overly-deep JSON (a serialize/render DoS vector). */
function tooDeep(v: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return true;
  if (Array.isArray(v)) return v.some((x) => tooDeep(x, depth + 1));
  if (v && typeof v === 'object') return Object.values(v).some((x) => tooDeep(x, depth + 1));
  return false;
}

/**
 * Structural + value guard. Validates shape AND constrains the values that land in
 * `<head>`/HTML. Astro auto-escapes `{expr}` output; this is a defense-in-depth
 * second layer so a valid-key-but-hostile publish still can't deface or inject.
 */
function validateSnapshot(s: unknown): string | null {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return 'not an object';
  if (tooDeep(s)) return 'nesting too deep';
  const o = s as Record<string, unknown>;

  const brand = o.brand as Record<string, unknown> | undefined;
  if (!brand || !isSafeText(brand.name, 1, 80)) return 'brand.name invalid';
  if (typeof o.phase !== 'string' || !VALID_PHASES.has(o.phase)) return 'phase invalid';
  if (typeof o.sections !== 'object' || o.sections === null || Array.isArray(o.sections)) return 'sections invalid';

  const seo = o.seo as Record<string, unknown> | undefined;
  if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return 'seo missing';
  if (!isSafeText(seo.title, 1, 160)) return 'seo.title invalid';
  if (seo.description !== undefined && !isSafeText(seo.description, 0, 400)) return 'seo.description invalid';
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = ((locals as any)?.runtime?.env ?? {}) as Env;

  if (!env.SITE_DB || !env.SITE_KV) {
    return json({ ok: false, error: 'bindings missing — running in local/fallback mode' }, 501);
  }
  if (!(await keyMatches(request.headers.get('x-admin-key'), env.ADMIN_KEY))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Cap BEFORE reading the stream: a missing/oversized content-length is refused
  // outright, so we never buffer+parse a giant body (parse-before-cap = DoS).
  const clen = Number(request.headers.get('content-length'));
  if (!Number.isFinite(clen) || clen <= 0) {
    return json({ ok: false, error: 'content-length required' }, 411);
  }
  if (clen > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'payload too large' }, 413);
  }

  // Read the raw text with a hard cap (defends against a lying content-length).
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'payload too large' }, 413);
  }

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  const invalid = validateSnapshot(snapshot);
  if (invalid) {
    return json({ ok: false, error: `invalid snapshot: ${invalid}` }, 422);
  }

  const body = JSON.stringify(snapshot);

  // Version by counter for a monotonic, human-readable history. Guard a missing/
  // corrupt counter so we never overwrite v1 by accident. (Single-publisher admin;
  // KV isn't atomic, so concurrent publishes are out of scope — documented risk.)
  const prev = Number((await env.SITE_KV.get('site:counter')) ?? '0');
  const version = (Number.isFinite(prev) && prev >= 0 ? prev : 0) + 1;
  const snapKey = `site:v${version}`;
  const now = new Date().toISOString();

  // D1 is the durable history-of-record. If it fails, ABORT — do not silently fall
  // through to a KV write that would leave the pointer ahead of the history.
  try {
    await env.SITE_DB.prepare(
      'INSERT INTO site_versions (version, json, created_at) VALUES (?, ?, ?)'
    ).bind(version, body, now).run();
  } catch (e) {
    return json({ ok: false, error: 'history write failed', detail: String(e) }, 502);
  }

  // Order matters: write the snapshot + counter FIRST, then flip active_version LAST
  // so the live pointer never references a snapshot that isn't there yet.
  await env.SITE_KV.put(snapKey, body);
  await env.SITE_KV.put('site:counter', String(version));
  await env.SITE_KV.put('active_version', JSON.stringify({ key: snapKey, version }));

  const purged = await purgeHome(env, new URL(request.url).origin);

  return json({ ok: true, version, key: snapKey, purged });
};

/** Purge the cached home page. Returns whether the purge was issued+ok (non-fatal). */
async function purgeHome(env: Env, origin: string): Promise<boolean> {
  if (!env.CF_ZONE_ID || !env.CF_API_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: [`${origin}/`] }),
      }
    );
    return res.ok; // caller surfaces this; short s-maxage expires the cache anyway
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
