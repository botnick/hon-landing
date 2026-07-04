/**
 * Contract validator unit tests. Run: node test/contract.test.mjs
 * Mirrors the validation rules in src/lib/content-contract.ts (kept in sync by hand;
 * the real module is TS with import.meta so we re-declare the guards here for a fast check).
 */
import assert from 'node:assert';

const UNSAFE_TEXT = new RegExp('[\\u0000-\\u001F<>]');
const UNSAFE_URI = /^\s*(javascript|data|vbscript):/i;

const NL = String.fromCharCode(10), NUL = String.fromCharCode(0), TAB = String.fromCharCode(9);
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// UNSAFE_TEXT
check('thai ok', !UNSAFE_TEXT.test('สวัสดีชาวโลก'));
check('english ok', !UNSAFE_TEXT.test('The Legend Returns'));
check('angle bracket blocked', UNSAFE_TEXT.test('<script>'));
check('newline blocked', UNSAFE_TEXT.test('a' + NL + 'b'));
check('null blocked', UNSAFE_TEXT.test('a' + NUL + 'b'));
check('tab blocked', UNSAFE_TEXT.test('a' + TAB + 'b'));

// UNSAFE_URI
check('https ok', !UNSAFE_URI.test('https://hon-x.net'));
check('anchor ok', !UNSAFE_URI.test('#war'));
check('discord ok', !UNSAFE_URI.test('https://discord.gg/abc'));
check('javascript: blocked', UNSAFE_URI.test('javascript:alert(1)'));
check('data: blocked', UNSAFE_URI.test('data:text/html,x'));
check('vbscript: blocked', UNSAFE_URI.test('vbscript:msgbox'));

// URL normalization (mirror of editor logic)
function normalizeUrl(v) {
  let s = String(v).trim();
  if (!s) return s;
  if (s.startsWith('#') || s.startsWith('/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
  return s;
}
check('normalize bare domain', normalizeUrl('hon-x.net') === 'https://hon-x.net');
check('normalize keeps https', normalizeUrl('https://x.com') === 'https://x.com');
check('normalize keeps anchor', normalizeUrl('#war') === '#war');
check('normalize keeps path', normalizeUrl('/download') === '/download');

// safeColor — mirror of the tightened validator in content-contract.ts.
// Brand-locked faction colours: hex, transparent, or in-range rgb/rgba only.
function safeColor(v) {
  if (typeof v !== 'string' || v.length > 64) return false;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  if (s === 'transparent') return true;
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return false;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length < 3 || parts.length > 4) return false;
  const chan = (p) => {
    if (p.endsWith('%')) { const n = Number(p.slice(0, -1)); return n >= 0 && n <= 100; }
    const n = Number(p); return Number.isFinite(n) && n >= 0 && n <= 255;
  };
  if (!parts.slice(0, 3).every(chan)) return false;
  if (parts.length === 4) { const a = Number(parts[3]); if (!(a >= 0 && a <= 1)) return false; }
  return true;
}
check('color hex6 ok', safeColor('#40cd3c'));
check('color hex3 ok', safeColor('#abc'));
check('color hex8 ok', safeColor('#40cd3cff'));
check('color rgba ok', safeColor('rgba(64,205,60,0.45)'));
check('color rgb ok', safeColor('rgb(220, 0, 0)'));
check('color transparent ok', safeColor('transparent'));
check('color keyword garbage blocked', !safeColor('javascript'));
check('color typo blocked', !safeColor('notacolor'));
check('color out-of-range blocked', !safeColor('rgb(999,0,0)'));
check('color bad alpha blocked', !safeColor('rgba(0,0,0,5)'));
check('color url() blocked', !safeColor('url(x)'));
check('color empty blocked', !safeColor(''));

// migrateSnapshot — mirror: backfill absent blocks only, never overwrite authored ones.
function migrateSnapshot(input) {
  if (!input || typeof input !== 'object') return input;
  const out = { ...input };
  if (out.serverOath == null) out.serverOath = { _default: 'oath' };
  if (out.war == null) out.war = { _default: 'war' };
  if (out.factions == null) out.factions = { _default: 'factions' };
  if (out.media == null) out.media = { _default: 'media' };
  return out;
}
const oldSnap = { schemaVersion: 1, phase: 'cbt', hero: {} };
const migrated = migrateSnapshot(oldSnap);
check('migrate adds serverOath', migrated.serverOath != null);
check('migrate adds war', migrated.war != null);
check('migrate adds factions', migrated.factions != null);
check('migrate adds media', migrated.media != null);
check('migrate leaves input untouched', oldSnap.serverOath === undefined);
const authored = { serverOath: { eyebrow: 'MINE' }, war: null };
const m2 = migrateSnapshot(authored);
check('migrate keeps authored block', m2.serverOath.eyebrow === 'MINE');
check('migrate fills null block', m2.war && m2.war._default === 'war');
check('migrate passes through non-object', migrateSnapshot(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
