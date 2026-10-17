/**
 * Serviço de OCR e IA do Gemini para leitura de etiquetas de encomendas.
 * SEGURO: Todas as chamadas ao modelo do Gemini são executadas exclusivamente
 * no backend (/api/ocr/*), mantendo a chave GEMINI_API_KEY protegida fora do navegador/bundle.
 */

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3, signal?: AbortSignal): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) {
      throw new Error("Operação cancelada pelo usuário");
    }
    try {
      return await fn();
    } catch (error: any) {
      if (signal?.aborted) {
        throw new Error("Operação cancelada pelo usuário");
      }
      lastError = error;
      const isRateLimit = error?.message?.includes("429") || 
                          error?.message?.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Tentando novamente em ${Math.round(delay / 1000)}s... (${i + 1}/${maxRetries})`);
        
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error("Operação cancelada pelo usuário"));
            }, { once: true });
          }
        });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function getRawTextFromImage(base64Image: string, signal?: AbortSignal): Promise<string | null> {
  return null;
}

export async function extractBasicText(base64Image: string, signal?: AbortSignal) {
  try {
    if (signal?.aborted) return null;
    return await callWithRetry(async () => {
      const res = await fetch('/api/ocr/extract-basic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
        signal
      });

      if (!res.ok) {
        console.warn(`[OCR Client] Servidor retornou HTTP ${res.status}`);
        return null;
      }

      const json = await res.json();
      return json?.data || null;
    }, 2, signal);
  } catch (e) {
    if (signal?.aborted) return null;
    console.warn("Aviso no OCR básico (falha tratada com segurança):", e);
    return null;
  }
}

export async function analyzePackageLabel(base64Image: string, residentList?: string[], signal?: AbortSignal) {
  try {
    if (signal?.aborted) return null;
    return await callWithRetry(async () => {
      const res = await fetch('/api/ocr/analyze-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, residentList }),
        signal
      });

      if (!res.ok) {
        console.warn(`[OCR Client] Servidor retornou HTTP ${res.status}`);
        return null;
      }

      const json = await res.json();
      return json?.data || null;
    }, 2, signal);
  } catch (e) {
    if (signal?.aborted) return null;
    console.warn("Aviso ao analisar etiqueta com Gemini (falha tratada com segurança):", e);
    return null;
  }
}
