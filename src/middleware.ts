/**
 * Request guard for the MERGED app (public landing + admin CMS in one Astro app).
 * Runs on EVERY request:
 *  1. Resolves the session cookie → Astro.locals.user (or null) and exposes db on locals.
 *  2. Protects ONLY /admin/** and /api/** — no valid session ⇒ redirect to /login (pages)
 *     or 401 (api). Everything else — the PUBLIC LANDING (/, /en, assets) — passes untouched
 *     and never requires auth (it renders from KV or the bundled fallback).
 *
 * Role checks for specific ACTIONS live at each endpoint (via CAN.*), not here — this
 * only enforces "authenticated". Defence in depth: never trust the client.
 */
import { defineMiddleware } from 'astro:middleware';
import { resolveSession, COOKIE_NAME } from './lib/session';
import type { D1Database } from './lib/db';

// Public API endpoints anyone may hit (the login form posts here before a session exists).
const PUBLIC_PATHS = new Set(['/login', '/api/login', '/favicon.ico', '/robots.txt']);

function isProtected(pathname: string): boolean {
  // ONLY the admin surface is guarded. /api/login is carved out as public above.
  return pathname.startsWith('/admin') || pathname.startsWith('/api');
}
function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/assets/')) return true;
  return false;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, request, url, redirect } = context;
  const env = (locals as any).runtime?.env as { CMS_DB?: D1Database } | undefined;
  const db = env?.CMS_DB;

  // Resolve session (best-effort; never throws the request)
  let user = null;
  if (db) {
    const cookie = context.cookies.get(COOKIE_NAME)?.value;
    try {
      user = await resolveSession(db, cookie);
    } catch {
      user = null;
    }
  }

  // DEV-ONLY preview bypass. import.meta.env.DEV is statically `false` in any production
  // build, so this branch is dead-code-eliminated from the deployed bundle — it can never
  // be a prod auth hole. Used only for local `astro dev` screenshots / quick preview.
  if (import.meta.env.DEV && !user && url.searchParams.get('__devpreview') === '1') {
    user = { id: 'dev', email: 'dev@local', name: 'Dev Preview', role: 'owner' as const };
  }
  (locals as any).user = user;
  (locals as any).db = db;

  const path = url.pathname;

  // Redirect an authed user away from /login into the admin.
  if (path === '/login' && user) return redirect('/admin', 302);

  // Public landing + public paths: never gated.
  if (isPublic(path) || !isProtected(path)) return next();

  // Admin surface (/admin/**, /api/** except /api/login): require a session.
  if (!user) {
    if (path.startsWith('/api')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return redirect(`/login?next=${encodeURIComponent(path)}`, 302);
  }

  return next();
});
