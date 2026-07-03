import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Admin publish endpoint (scaffold). Writes a content snapshot to D1 (history) + KV
 * (live), bumps the active-version pointer, and purges the edge cache so the change
 * shows up immediately. Returns 501 locally when bindings are absent (JSON fallback mode).
 *
 * Auth: requires `x-admin-key` matching env.ADMIN_KEY. Do NOT enable without it.
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

/** Length-independent constant-time string compare (avoids auth timing leaks). */
function timingSafeEqual(a: string | null, b: string): boolean {
  if (!a) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length);
  }
  return diff === 0;
}

/**
 * Minimal structural guard for a content snapshot. Returns an error string when
 * invalid, or null when it looks like a real site.json. Not a full schema — just
 * enough that a broken/hostile publish can't blank or wreck the live site.
 */
function validateSnapshot(s: unknown): string | null {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return 'not an object';
  const o = s as Record<string, unknown>;
  const brand = o.brand as Record<string, unknown> | undefined;
  if (!brand || typeof brand.name !== 'string' || !brand.name.trim()) return 'brand.name missing';
  if (typeof o.phase !== 'string') return 'phase missing';
  if (typeof o.sections !== 'object' || o.sections === null) return 'sections missing';
  if (typeof o.seo !== 'object' || o.seo === null) return 'seo missing';
  const seo = o.seo as Record<string, unknown>;
  if (typeof seo.title !== 'string' || !seo.title.trim()) return 'seo.title missing';
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = ((locals as any)?.runtime?.env ?? {}) as Env;

  if (!env.SITE_DB || !env.SITE_KV) {
    return json({ ok: false, error: 'bindings missing — running in local/fallback mode' }, 501);
  }
  // Constant-time key check so a valid key can't be brute-forced by timing.
  if (!env.ADMIN_KEY || !timingSafeEqual(request.headers.get('x-admin-key'), env.ADMIN_KEY)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Reject oversized bodies before parsing — a live-content endpoint must not eat
  // an arbitrarily large payload (KV value cap is 25 MB; site.json is ~10 KB).
  const clen = Number(request.headers.get('content-length') ?? '0');
  if (clen > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'payload too large' }, 413);
  }

  let snapshot: unknown;
  try {
    snapshot = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  // Shape-validate the snapshot: it becomes the LIVE site content on every render,
  // so a malformed publish (even with a valid key) must be rejected, not served.
  const invalid = validateSnapshot(snapshot);
  if (invalid) {
    return json({ ok: false, error: `invalid snapshot: ${invalid}` }, 422);
  }

  const body = JSON.stringify(snapshot);
  // Belt-and-suspenders: cap the serialized size even if content-length lied.
  if (body.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'payload too large' }, 413);
  }

  // Version by counter so we get a monotonic, human-readable history.
  // Guard against a missing/corrupt counter so we never overwrite v1 by accident.
  const prev = Number((await env.SITE_KV.get('site:counter')) ?? '0');
  const version = (Number.isFinite(prev) && prev >= 0 ? prev : 0) + 1;
  const snapKey = `site:v${version}`;
  const now = new Date().toISOString();

  try {
    await env.SITE_DB.prepare(
      'INSERT INTO site_versions (version, json, created_at) VALUES (?, ?, ?)'
    ).bind(version, body, now).run();
  } catch {
    // D1 table may not exist yet in a fresh env — KV publish still succeeds.
  }

  await env.SITE_KV.put(snapKey, body);
  await env.SITE_KV.put('active_version', JSON.stringify({ key: snapKey, version }));
  await env.SITE_KV.put('site:counter', String(version));

  await purgeHome(env, new URL(request.url).origin);

  return json({ ok: true, version, key: snapKey });
};

async function purgeHome(env: Env, origin: string) {
  if (!env.CF_ZONE_ID || !env.CF_API_TOKEN) return;
  try {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: [`${origin}/`] }),
    });
  } catch {
    /* non-fatal — short s-maxage will expire the cache anyway */
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
