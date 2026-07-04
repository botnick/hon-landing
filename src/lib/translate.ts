/**
 * AI translation (Thai → English) for the content editor.
 *
 * Provider-agnostic over the OpenAI-compatible chat-completions shape, which covers:
 *  - OpenRouter        (https://openrouter.ai/api/v1)
 *  - MaxPlus / Steam   (a custom base URL + key; treated as a custom OpenAI-compatible host)
 *  - Custom endpoint   (any OpenAI-compatible /chat/completions server)
 *
 * The API key never reaches the browser — this runs server-side only, called by
 * /api/translate. Config comes from env (or the app_settings table, see getTranslateConfig).
 */

export type TranslateProvider = 'openrouter' | 'maxplus' | 'custom';

export interface TranslateConfig {
  provider: TranslateProvider;
  baseUrl: string;   // e.g. https://openrouter.ai/api/v1
  apiKey: string;
  model: string;     // e.g. google/gemini-2.0-flash-001
}

const DEFAULTS: Record<TranslateProvider, { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-001' },
  // MaxPlus AI (https://maxplus-ai.cc) — OpenAI-compatible. Single base URL /v1 uses the
  // pool bound to the key; gpt-5.4-mini is a cheap, capable default for translation. For a
  // free key, set base URL to https://api.maxplus-ai.cc/free/v1 and model deepseek-v4-flash.
  maxplus: { baseUrl: 'https://api.maxplus-ai.cc/v1', model: 'gpt-5.4-mini' },
  custom: { baseUrl: '', model: 'gpt-4o-mini' },
};

/**
 * Resolve config from env. Non-secret bits (provider/baseUrl/model) may also come from
 * settings passed in; the KEY is always an env secret. Returns null if not configured.
 */
export function resolveTranslateConfig(
  env: Record<string, string | undefined> | undefined,
  override?: Partial<TranslateConfig>,
): TranslateConfig | null {
  const provider = (override?.provider || env?.TRANSLATE_PROVIDER || 'openrouter') as TranslateProvider;
  const d = DEFAULTS[provider] ?? DEFAULTS.custom;
  const baseUrl = (override?.baseUrl || env?.TRANSLATE_BASE_URL || d.baseUrl || '').replace(/\/$/, '');
  const apiKey = override?.apiKey || env?.TRANSLATE_API_KEY || '';
  const model = override?.model || env?.TRANSLATE_MODEL || d.model;
  if (!baseUrl || !apiKey) return null;
  return { provider, baseUrl, apiKey, model };
}

export interface TranslateResult {
  ok: boolean;
  translations?: string[];
  error?: string;
}

/**
 * Translate an array of Thai strings to natural, game-appropriate English. Returns an
 * array aligned 1:1 with the input. Uses a single JSON round-trip to keep it cheap and
 * to preserve ordering. Empty inputs pass through as empty strings.
 */
export async function translateBatch(
  cfg: TranslateConfig,
  texts: string[],
  opts?: { context?: string },
): Promise<TranslateResult> {
  const indexed = texts.map((t, i) => ({ i, t }));
  const nonEmpty = indexed.filter((x) => x.t && x.t.trim());
  if (nonEmpty.length === 0) return { ok: true, translations: texts.map(() => '') };

  const sys =
    'You are a professional game-localization translator. Translate Thai UI/marketing copy ' +
    'to natural, punchy English for a MOBA game landing page (Heroes of Newerth). Keep brand ' +
    'names, product names, and Latin words as-is (e.g. HoN X, Discord, Legion, Hellbourne, CBT). ' +
    'Match the tone: confident, gaming, concise. Do NOT add quotes or explanations. ' +
    'Return ONLY a JSON array of strings, same length and order as the input array.' +
    (opts?.context ? ` Context: ${opts.context}` : '');
  const userMsg = JSON.stringify(nonEmpty.map((x) => x.t));

  let resp: Response;
  try {
    resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        // OpenRouter recommends these; harmless for other hosts.
        'HTTP-Referer': 'https://hon-x.net',
        'X-Title': 'HoN X CMS',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, error: 'เชื่อมต่อผู้ให้บริการแปลไม่ได้' };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { ok: false, error: `ผู้ให้บริการแปลตอบกลับผิดพลาด (${resp.status})${body ? ': ' + body.slice(0, 200) : ''}` };
  }

  let data: any;
  try { data = await resp.json(); } catch { return { ok: false, error: 'ผลลัพธ์จากผู้ให้บริการแปลอ่านไม่ได้' }; }
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  const arr = parseJsonArray(content);
  if (!arr || arr.length !== nonEmpty.length) {
    return { ok: false, error: 'แปลไม่สำเร็จ (รูปแบบผลลัพธ์ไม่ตรง) ลองใหม่อีกครั้ง' };
  }

  // Re-scatter translations back into the original positions; keep empties empty.
  const out = texts.map(() => '');
  nonEmpty.forEach((x, k) => { out[x.i] = String(arr[k] ?? ''); });
  return { ok: true, translations: out };
}

/** Pull a JSON string array out of a model reply, tolerating ```json fences / stray prose. */
function parseJsonArray(s: string): string[] | null {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('['), end = t.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))) : null;
  } catch {
    return null;
  }
}
