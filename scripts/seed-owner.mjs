/**
 * Seed the first owner user into D1.
 *
 *   node scripts/seed-owner.mjs <email> <password> [name]     # local (default)
 *   D1_REMOTE=1 node scripts/seed-owner.mjs <email> <password> [name]   # remote (deploy)
 *
 * Hashes the password with the SAME PBKDF2 scheme the app uses (src/lib/crypto.ts),
 * then runs an idempotent SQL INSERT via wrangler d1 execute. Targets the local dev
 * DB by default; set D1_REMOTE=1 to seed the deployed (remote) database instead.
 * Run once to bootstrap; afterwards manage users from the admin UI.
 */
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const [, , email, password, name = 'Owner'] = process.argv;
if (!email || !password) {
  console.error('usage: node scripts/seed-owner.mjs <email> <password> [name]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('refusing to seed: password must be at least 10 characters');
  process.exit(1);
}

const ITER = 100_000;
function b64(u8) {
  return Buffer.from(u8).toString('base64');
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
function randomId(bytes = 16) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex');
}

const now = Date.now();
const id = randomId(16);
const hash = await hashPassword(password);
const em = email.toLowerCase().replace(/'/g, "''");
const nm = name.replace(/'/g, "''");

// ON CONFLICT(email): update role→owner + reset password + re-enable. Idempotent bootstrap.
const sql = `INSERT INTO users (id,email,name,role,pass_hash,disabled,created_at,updated_at)
VALUES ('${id}','${em}','${nm}','owner','${hash}',0,${now},${now})
ON CONFLICT(email) DO UPDATE SET role='owner', pass_hash='${hash}', disabled=0, updated_at=${now};`;

const target = process.env.D1_REMOTE === '1' ? '--remote' : '--local';
console.log(`Seeding owner (${target}):`, email);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'hon-x-cms', target, '--command', sql], {
  stdio: 'inherit',
  cwd: process.cwd(),
});
console.log('Done. Login with the email + password you passed.');
