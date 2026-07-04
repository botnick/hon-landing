/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { D1Database } from './lib/db';
import type { AuthedUser } from './lib/session';

type KVNamespace = {
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

// One merged app, one worker: the admin WRITES and the landing READS the SAME KV/D1.
// Bindings are unified as CMS_KV / CMS_DB. Translation provider config is optional.
interface AppEnv {
  CMS_DB?: D1Database;
  CMS_KV?: KVNamespace;
  SESSION_SECRET?: string;
  COOKIE_SECURE?: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  TRANSLATE_PROVIDER?: string;
  TRANSLATE_BASE_URL?: string;
  TRANSLATE_MODEL?: string;
  TRANSLATE_API_KEY?: string;
}

declare namespace App {
  interface Locals {
    runtime?: { env?: AppEnv };
    user?: AuthedUser | null;
    db?: D1Database;
  }
}
