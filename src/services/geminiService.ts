import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

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
                          error?.message?.includes("RESOURCE_EXHAUSTED") ||
                          JSON.stringify(error)?.includes("429") ||
                          JSON.stringify(error)?.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Gemini quota atingida (429). Tentando novamente em ${Math.round(delay / 1000)}s... (${i + 1}/${maxRetries})`);
        
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
  const model = "gemini-3-flash-preview";
  
  const prompt = "Analise esta imagem de etiqueta de encomenda. IGNORE códigos de barras, QR codes e textos muito pequenos. PRIORIZE: 1. Números grandes escritos à mão (geralmente o número da casa). 2. Nome do destinatário em destaque. 3. Unidade/Casa. Procure por anotações manuais em destaque, elas são a prioridade absoluta. Retorne o texto estruturado.";

  try {
    if (signal?.aborted) return null;
    const response = await callWithRetry(() => ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(',')[1] || base64Image
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 400,
      },
    }), 3, signal);

    return response.text || null;
  } catch (e) {
    console.error("Erro no OCR bruto:", e);
    throw e;
  }
}

function cleanAndParseJson(text: string | null | undefined): any {
  if (!text) return null;
  let cleaned = text.trim();
  
  // Strip markdown codeblock backticks if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // If text contains conversational prefix or trailing text, find first '{' and last '}'
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const jsonSub = cleaned.substring(start, end + 1);
      try {
        return JSON.parse(jsonSub);
      } catch (innerErr) {
        console.warn("Falha ao analisar sub-string JSON:", innerErr);
      }
    }
    console.warn("JSON.parse falhou no texto retornado pela IA:", cleaned.substring(0, 100));
    return null;
  }
}

export async function extractBasicText(base64Image: string, signal?: AbortSignal) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Analise esta etiqueta ou marcação manual. 

REGRAS CRÍTICAS:
1. FOCO NO NÚMERO DA CASA: Procure por números GRANDES e isolados.
2. IGNORE: Códigos de barras, endereços da transportadora, textos minúsculos de termos e condições.
3. MARCAÇÃO MANUAL: Se houver algo escrito à caneta/pincel, use isso como verdade absoluta.

MODO A (Transportadora): Extraia destinatário e número da casa.
MODO B (Manual): Extraia o número GRANDE (casa) e inicial isolada.

Retorne APENAS o JSON:
{
  "casa": "número identificado ou vazio",
  "inicial": "letra maiúscula identificada ou vazio",
  "destinatario": "nome completo identificado ou vazio",
  "confianca": "alta | media | baixa"
}`;

  try {
    if (signal?.aborted) return null;
    const response = await callWithRetry(() => ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(',')[1] || base64Image
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 150,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            casa: { type: Type.STRING },
            inicial: { type: Type.STRING },
            destinatario: { type: Type.STRING },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] }
          },
          required: ["casa", "inicial", "destinatario", "confianca"]
        }
      },
    }), 3, signal);

    const text = response.text;
    if (!text) return null;
    return cleanAndParseJson(text);
  } catch (e) {
    console.warn("Aviso no OCR básico (falha tratada com segurança):", e);
    return null;
  }
}

export async function analyzePackageLabel(base64Image: string, residentList?: string[], signal?: AbortSignal) {
  const model = "gemini-3-flash-preview";
  
  const residentContext = residentList && residentList.length > 0 
    ? `\nCONTEXTO: Os seguintes moradores estão cadastrados neste condomínio. Use esta lista para tentar encontrar o melhor match, mesmo que o nome na etiqueta esteja abreviado ou com pequenos erros:\n${residentList.join('\n')}`
    : '';

  const prompt = `Analise esta etiqueta de encomenda e identifique o morador destinatário.
  
  OBJETIVO PRINCIPAL: ENCONTRAR O NÚMERO DA CASA/UNIDADE.
  
  REGRAS DE PRIORIDADE:
  1. MARCAÇÕES MANUAIS: Procure por números GRANDES escritos à mão. Se houver "C123" ou "123" isolado e grande, considere como a casa.
  2. NOME DO DESTINATÁRIO: Identifique o nome principal.
  3. IGNORE TOTALMENTE: Códigos de barras, logos de transportadoras (Amazon, Mercado Livre), textos legais minúsculos.
  
  ${residentContext}
  
  Retorne o JSON conforme o esquema.`;

  try {
    if (signal?.aborted) return null;
    const response = await callWithRetry(() => ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(',')[1] || base64Image
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipientName: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              }
            },
            unitDetails: {
              type: Type.OBJECT,
              properties: {
                full_string: { type: Type.STRING },
                type: { type: Type.STRING },
                number: { type: Type.STRING },
                block: { type: Type.STRING },
                tower: { type: Type.STRING },
                complement: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              }
            },
            carrier: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING }
              }
            },
            trackingNumber: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING }
              }
            }
          }
        }
      },
    }), 3, signal);

    const text = response.text;
    if (!text) return null;
    
    const data = cleanAndParseJson(text);
    if (!data) return null;
    
    // Normalização básica no lado do cliente também
    if (data.recipientName?.value) {
      data.recipientName.value = data.recipientName.value.replace(/\s+/g, ' ').trim();
    }
    
    return data;
  } catch (e) {
    console.warn("Aviso ao analisar etiqueta com Gemini (falha tratada com segurança):", e);
    return null;
  }
}
