import { supabase } from './supabase';

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  skipAuth?: boolean;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  hasDependencies?: boolean;
}

/**
 * Gets a valid authentication bearer token from Supabase session,
 * falling back to MOCK_TOKEN if unauthenticated or offline.
 */
export async function getValidAuthToken(): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.access_token) {
      return session.access_token;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: { session: refreshed } } = await supabase.auth.getSession();
      if (refreshed?.access_token) return refreshed.access_token;
    }

    return 'MOCK_TOKEN';
  } catch (err) {
    console.warn('[ApiClient] Erro ao obter token Supabase, utilizando fallback MOCK_TOKEN:', err);
    return 'MOCK_TOKEN';
  }
}

/**
 * Robust API Client with:
 * 1. Automatic Content-Type verification (prevents Unexpected token '<' errors).
 * 2. Timeout handling via AbortController.
 * 3. Automatic retry for transient network/server failures.
 * 4. Automatic Auth token injection.
 * 5. Friendly Portuguese error messages.
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<ApiResponse<T>> {
  const {
    timeoutMs = 15000,
    retries = 2,
    skipAuth = false,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  let attempt = 0;
  let lastError: string = 'Erro desconhecido na comunicação com a API';

  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Build Headers
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        ...(customHeaders as Record<string, string>)
      };

      if (!skipAuth) {
        const token = await getValidAuthToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (fetchOptions.body && typeof fetchOptions.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      console.log(`[ApiClient] [Tentativa ${attempt}/${retries + 1}] ${fetchOptions.method || 'GET'} ${endpoint}`);

      const fullUrl = (endpoint.startsWith('http://') || endpoint.startsWith('https://'))
        ? endpoint
        : (typeof window !== 'undefined' && window.location?.origin
            ? `${window.location.origin}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
            : `http://localhost:3000${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

      const response = await fetch(fullUrl, {
        ...fetchOptions,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      
      // Check if response is non-JSON or HTML
      if (!contentType.includes('application/json')) {
        const rawText = await response.text().catch(() => '');
        console.error(`[ApiClient] Resposta não-JSON recebida da API [${response.status}]:`, rawText.slice(0, 300));
        
        const isHtml = rawText.includes('<!DOCTYPE') || rawText.includes('<html');
        const errorMessage = isHtml
          ? `O servidor retornou uma página HTML em vez de JSON (HTTP ${response.status}). Verifique a rota da API.`
          : `Formato de resposta inválido retornado pelo servidor (HTTP ${response.status}).`;

        // Don't retry client-side 4xx errors unless it's a 408/429
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          return {
            ok: false,
            status: response.status,
            data: null,
            error: errorMessage
          };
        }

        lastError = errorMessage;
        if (attempt <= retries) {
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
        return { ok: false, status: response.status, data: null, error: errorMessage };
      }

      // Parse JSON safely
      let parsedData: any = null;
      try {
        parsedData = await response.json();
      } catch (jsonErr: any) {
        console.error('[ApiClient] Falha ao decodificar JSON:', jsonErr);
        return {
          ok: false,
          status: response.status,
          data: null,
          error: 'Falha ao processar os dados recebidos do servidor.'
        };
      }

      if (!response.ok) {
        const serverError = parsedData?.error || `Erro de servidor (HTTP ${response.status})`;
        
        // Retry only on 5xx server errors
        if (response.status >= 500 && attempt <= retries) {
          console.warn(`[ApiClient] Erro 5xx (${response.status}), tentando novamente...`);
          lastError = serverError;
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }

        return {
          ok: false,
          status: response.status,
          data: parsedData,
          error: serverError,
          hasDependencies: parsedData?.hasDependencies
        };
      }

      return {
        ok: true,
        status: response.status,
        data: parsedData
      };

    } catch (err: any) {
      clearTimeout(timeoutId);
      
      if (err.name === 'AbortError') {
        lastError = `Tempo limite esgotado (${timeoutMs / 1000}s) ao aguardar resposta do servidor.`;
        console.warn(`[ApiClient] Timeout na requisição para ${endpoint}`);
      } else {
        lastError = `Erro de conexão com o servidor: ${err.message || 'Sem conexão com a internet'}`;
        console.error(`[ApiClient] Erro de rede para ${endpoint}:`, err);
      }

      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, attempt * 500));
        continue;
      }

      return {
        ok: false,
        status: 0,
        data: null,
        error: lastError
      };
    }
  }

  return {
    ok: false,
    status: 0,
    data: null,
    error: lastError
  };
}

export const api = {
  get: <T = any>(endpoint: string, options?: ApiFetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(endpoint: string, body?: any, options?: ApiFetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),

  put: <T = any>(endpoint: string, body?: any, options?: ApiFetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }),

  patch: <T = any>(endpoint: string, body?: any, options?: ApiFetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T = any>(endpoint: string, options?: ApiFetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' })
};
