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
  const model = "gemini-3.1-flash-lite-preview";
  
  const prompt = "Identifique e extraia o NOME DO DESTINATÁRIO, a UNIDADE (CASA/APTO), TRANSPORTADORA e CÓDIGO DE RASTREIO desta etiqueta. Dê atenção ESPECIAL a anotações MANUAIS grandes (ex: 'C 123', 'Ap 101'). Se houver anotação manual da unidade, ela tem prioridade. Retorne as informações de forma clara.";

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
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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
  const model = "gemini-3.1-flash-lite-preview";
  
  const prompt = `Analise a etiqueta de encomenda nesta imagem e extraia as informações seguindo estas etapas:

1. TEXTO BRUTO: Extraia TODO o texto visível na imagem de forma literal.
2. DESTINATÁRIO: Identifique o nome do destinatário. 
   - DICA: Geralmente está próximo à palavra "DESTINATÁRIO", "Destinatário" ou "NOME".
3. UNIDADE/CASA: Identifique o número da casa ou unidade.
   - Procure por termos como "Casa", "C.", "UN", "Unidade", "Lote" seguidos de um número.
   - Exemplo: "Casa 241", "C241", "C-241".

Regras de Saída:
- Se encontrar qualquer texto, não retorne erro.
- Se identificar nome ou casa, retorne-os nos campos correspondentes.

Retorne APENAS o JSON conforme o esquema:
{
  "texto_bruto": "todo o texto extraído da imagem",
  "nome_detectado": "nome identificado",
  "casa_detectada": "número da casa",
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
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            texto_bruto: { type: Type.STRING, description: "Todo o texto extraído da imagem" },
            nome_detectado: { type: Type.STRING, description: "Nome do destinatário identificado" },
            casa_detectada: { type: Type.STRING, description: "Número da casa ou unidade identificado" },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"], description: "Nível de confiança da extração" }
          },
          required: ["texto_bruto", "nome_detectado", "casa_detectada", "confianca"]
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
  const model = "gemini-3.1-flash-lite-preview";
  
  const residentContext = residentList && residentList.length > 0 
    ? `\nCONTEXTO: Os seguintes moradores estão cadastrados neste condomínio. Use esta lista para tentar encontrar o melhor match, mesmo que o nome na etiqueta esteja abreviado ou com pequenos erros:\n${residentList.join('\n')}`
    : '';

  const prompt = `Analise esta etiqueta de encomenda e identifique o morador destinatário.
  
  OBJETIVO:
  - Identificar o nome do morador (mesmo que parcial ou aproximado).
  - Identificar a unidade (casa/apto).
  - Identificar a transportadora (Carrier).
  - Identificar o código de rastreio (Tracking Number).
  
  PRIORIDADE DE UNIDADE:
  - Procure por marcações MANUAIS grandes (escritas a caneta/marcador) como "C 123", "C123", "Casa 45", "Ap 202", "Apto 101".
  - Se encontrar "C" seguido de número, interprete 'C' como 'Casa'.
  
  REGRAS:
  - Seja tolerante com erros de OCR ou abreviações.
  - Se houver uma lista de moradores no contexto, tente associar a etiqueta a um deles.
  - Extraia o que for possível, mesmo que incompleto.
  
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
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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
