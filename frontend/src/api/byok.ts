// Bring-your-own-key (BYOK) credential store and the localStorage -> request-header
// projection. This module is the SINGLE owner of the four credential keys, their
// form defaults, and the D17 wire contract (X-Provider-LLM / X-API-Key-LLM /
// X-Provider-Image / X-API-Key-Image). No other module reads or writes these
// localStorage keys or rebuilds these headers. See CONTEXT.md (Decision 17).

const STORAGE_KEYS = {
  llm_provider: 'llm_provider',
  llm_api_key: 'llm_api_key',
  image_provider: 'image_provider',
  image_api_key: 'image_api_key',
} as const;

export interface Credentials {
  llm_provider: string;
  llm_api_key: string;
  image_provider: string;
  image_api_key: string;
}

// Form defaults, consolidated here from the old SettingsPage.loadSettings. These
// seed the Settings form's initial state ONLY: getCredentials()/providerHeaders()
// never inject them, so the 'google' default reaches the wire only after the user
// saves Settings — exactly as before (Decision 17).
export const DEFAULTS: Credentials = {
  llm_provider: 'google',
  llm_api_key: '',
  image_provider: 'google',
  image_api_key: '',
};

// Raw read: getItem(k) || '' with NO defaults baked in. Feeds providerHeaders,
// hasLlmKey, and redacted.
export function getCredentials(): Credentials {
  return {
    llm_provider: localStorage.getItem(STORAGE_KEYS.llm_provider) || '',
    llm_api_key: localStorage.getItem(STORAGE_KEYS.llm_api_key) || '',
    image_provider: localStorage.getItem(STORAGE_KEYS.image_provider) || '',
    image_api_key: localStorage.getItem(STORAGE_KEYS.image_api_key) || '',
  };
}

export function saveCredentials(c: Credentials): void {
  localStorage.setItem(STORAGE_KEYS.llm_provider, c.llm_provider);
  localStorage.setItem(STORAGE_KEYS.llm_api_key, c.llm_api_key);
  localStorage.setItem(STORAGE_KEYS.image_provider, c.image_provider);
  localStorage.setItem(STORAGE_KEYS.image_api_key, c.image_api_key);
}

export function hasLlmKey(): boolean {
  return !!getCredentials().llm_api_key;
}

// Project stored credentials to request headers. A header is emitted ONLY when its
// stored value is truthy, and the 'google' default is never injected — byte-identical
// to the previous client.ts:providerHeaders (Decision 17).
export function providerHeaders(): Record<string, string> {
  const c = getCredentials();
  const headers: Record<string, string> = {};
  if (c.llm_provider) headers['X-Provider-LLM'] = c.llm_provider;
  if (c.llm_api_key) headers['X-API-Key-LLM'] = c.llm_api_key;
  if (c.image_provider) headers['X-Provider-Image'] = c.image_provider;
  if (c.image_api_key) headers['X-API-Key-Image'] = c.image_api_key;
  return headers;
}

// Reveal at most the last 4 chars, and only when a hidden prefix remains — the full
// raw key is never reconstructable from this string.
function maskKey(key: string): string {
  if (!key) return 'unset';
  return key.length > 4 ? `set ****${key.slice(-4)}` : 'set';
}

// Debug-safe view of the stored credentials: providers in clear, key values masked.
// Establishes the D17 "never serialize raw keys" rule as a real seam so no caller
// ever stringifies a raw key.
export function redacted(): Record<string, string> {
  const c = getCredentials();
  return {
    llm_provider: c.llm_provider,
    llm_api_key: maskKey(c.llm_api_key),
    image_provider: c.image_provider,
    image_api_key: maskKey(c.image_api_key),
  };
}
