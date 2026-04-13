import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function extractBasicText(base64Image: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Extraia APENAS o nome do destinatário (nome e sobrenome) e o número da unidade (casa/apto) desta etiqueta de encomenda. 
  Ignore completamente CEP, cidade, estado, endereço completo, códigos de rastreio e transportadora.
  Seja extremamente rápido. Retorne apenas o JSON.`;

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
            recipientName: { type: Type.STRING },
            unitNumber: { type: Type.STRING }
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
    ? `\nCONTEXTO: Os seguintes moradores estão cadastrados neste condomínio. Use esta lista para priorizar o match de Nome e Unidade:\n${residentList.join('\n')}`
    : '';

  const prompt = `Extraia os dados essenciais desta etiqueta de encomenda para o sistema "Portaria Inteligente":
  - recipientName: Nome e sobrenome do morador (destinatário).
  - unitDetails: Número da unidade/casa e tipo (Apartamento, Casa, etc).
  
  Ignore completamente CEP, cidade, estado, endereço completo, códigos de rastreio e transportadora.
  ${residentContext}
  Retorne apenas o JSON conforme o esquema definido.`;

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
            }
          },
          required: ["recipientName", "unitDetails"]
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
