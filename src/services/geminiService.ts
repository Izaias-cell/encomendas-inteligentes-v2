import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function getRawTextFromImage(base64Image: string): Promise<string | null> {
  const model = "gemini-3-flash-preview";
  
  const prompt = "Identifique e extraia APENAS o NOME DO DESTINATÁRIO e o NÚMERO DA CASA/APTO desta etiqueta. Ignore qualquer outro texto (rua, CEP, códigos, transportadora). Retorne o nome na primeira linha e a unidade na segunda linha.";

  try {
    const response = await ai.models.generateContent({
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
    });

    return response.text || null;
  } catch (e) {
    console.error("Erro no OCR bruto:", e);
    return null;
  }
}

export async function extractBasicText(base64Image: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Extraia o nome do destinatário e o número da unidade (casa/apto) desta etiqueta de encomenda.
  
  DIRETRIZES:
  1. Priorize velocidade e precisão básica.
  2. Se o nome não estiver claro, extraia o que parecer ser o nome do destinatário.
  3. Se a unidade não estiver clara, extraia qualquer número que pareça ser a casa ou apartamento (ex: "Casa 12", "Apto 101", "142").
  4. Ignore CEP, cidade, estado, endereço completo, códigos de rastreio e transportadora, A MENOS que ajudem a identificar o morador.
  5. Se encontrar apenas um dos dados (só nome ou só unidade), retorne o que encontrou.
  
  Retorne APENAS o JSON.`;

  try {
    const response = await ai.models.generateContent({
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
            recipientName: { type: Type.STRING, description: "Nome aproximado ou exato do destinatário" },
            unitNumber: { type: Type.STRING, description: "Número da casa ou apartamento encontrado" },
            carrier: { type: Type.STRING, description: "Nome da transportadora (opcional)" },
            trackingNumber: { type: Type.STRING, description: "Código de rastreio (opcional)" }
          }
        }
      },
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error("Erro no OCR básico:", e);
    return null;
  }
}

export async function analyzePackageLabel(base64Image: string, residentList?: string[]) {
  const model = "gemini-3-flash-preview";
  
  const residentContext = residentList && residentList.length > 0 
    ? `\nCONTEXTO: Os seguintes moradores estão cadastrados neste condomínio. Use esta lista para tentar encontrar o melhor match, mesmo que o nome na etiqueta esteja abreviado ou com pequenos erros:\n${residentList.join('\n')}`
    : '';

  const prompt = `Analise esta etiqueta de encomenda e identifique o morador destinatário.
  
  OBJETIVO:
  - Identificar o nome do morador (mesmo que parcial ou aproximado).
  - Identificar a unidade (casa/apto).
  
  REGRAS:
  - Seja tolerante com erros de OCR ou abreviações.
  - Se houver uma lista de moradores no contexto, tente associar a etiqueta a um deles.
  - Extraia o que for possível, mesmo que incompleto.
  
  ${residentContext}
  
  Retorne o JSON conforme o esquema.`;

  try {
    const response = await ai.models.generateContent({
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
    });

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
    return null;
  }
}
