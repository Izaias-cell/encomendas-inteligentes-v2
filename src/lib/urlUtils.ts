/**
 * Universal URL resolver for Encomendas Inteligentes.
 * Ensures all generated shareable links (Demo, Referral, WhatsApp)
 * use the canonical public origin, regardless of what device (PC, Mobile, Tablet)
 * the user is currently using.
 */

export function getAppPublicOrigin(): string {
  // 1. In browser runtime (Window exists)
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const origin = window.location.origin;
    if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin.replace(/\/+$/, '');
    }
  }

  // 2. Check environment variable
  const envUrl = (import.meta as any).env?.VITE_APP_URL || (import.meta as any).env?.VITE_PUBLIC_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() && !envUrl.includes('localhost')) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 3. Fallback to current window.location.origin (e.g. in local dev)
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  return 'http://localhost:3000';
}

/**
 * Builds a clean, universal public demonstration URL.
 * Never outputs localhost in production/remote contexts.
 */
export function buildPublicDemoUrl(
  paramValue: string, 
  type: 'token' | 'ref' = 'token', 
  serverUrl?: string
): string {
  const cleanValue = encodeURIComponent((paramValue || '').trim());
  const origin = getAppPublicOrigin();

  // If server provided a valid non-localhost URL and we don't have a public browser origin
  if (serverUrl && !serverUrl.includes('localhost') && !serverUrl.includes('127.0.0.1')) {
    try {
      const u = new URL(serverUrl);
      if (!u.hostname.includes('localhost') && !u.hostname.includes('127.0.0.1')) {
        return serverUrl;
      }
    } catch {}
  }

  return `${origin}/demonstracao?${type}=${cleanValue}`;
}
