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

export const POST: APIRoute = async ({ request, locals }) => {
  const env = ((locals as any)?.runtime?.env ?? {}) as Env;

  if (!env.SITE_DB || !env.SITE_KV) {
    return json({ ok: false, error: 'bindings missing — running in local/fallback mode' }, 501);
  }
  if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let snapshot: unknown;
  try {
    snapshot = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  // Version by counter so we get a monotonic, human-readable history.
  const prev = Number((await env.SITE_KV.get('site:counter')) ?? '0');
  const version = prev + 1;
  const snapKey = `site:v${version}`;
  const body = JSON.stringify(snapshot);
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
