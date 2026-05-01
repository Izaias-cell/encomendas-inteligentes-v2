import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error?.message?.includes("429") || 
                          error?.message?.includes("RESOURCE_EXHAUSTED") ||
                          JSON.stringify(error)?.includes("429") ||
                          JSON.stringify(error)?.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.warn(`Gemini quota atingida (429). Tentando novamente em ${Math.round(delay / 1000)}s... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function getRawTextFromImage(base64Image: string): Promise<string | null> {
  const model = "gemini-3-flash-preview";
  
  const prompt = "Analise esta imagem de etiqueta de encomenda. IGNORE códigos de barras, QR codes e textos muito pequenos. PRIORIZE: 1. Números grandes escritos à mão (geralmente o número da casa). 2. Nome do destinatário em destaque. 3. Unidade/Casa. Procure por anotações manuais em destaque, elas são a prioridade absoluta. Retorne o texto estruturado.";

  try {
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
    }));

    return response.text || null;
  } catch (e) {
    console.error("Erro no OCR bruto:", e);
    throw e;
  }
}

export async function extractBasicText(base64Image: string) {
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
    }));

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error("Erro no OCR básico:", e);
    throw e;
  }
}

export async function analyzePackageLabel(base64Image: string, residentList?: string[]) {
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
    }));

    const text = response.text;
    if (!text) return null;
    
    const data = JSON.parse(text);
    
    // Normalização básica no lado do cliente também
    if (data.recipientName?.value) {
      data.recipientName.value = data.recipientName.value.replace(/\s+/g, ' ').trim();
    }
    
    return data;
  } catch (e) {
    console.error("Erro ao analisar etiqueta com Gemini:", e);
    throw e;
  }
}
