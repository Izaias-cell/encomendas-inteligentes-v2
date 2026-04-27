import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function getRawTextFromImage(base64Image: string): Promise<string | null> {
  const model = "gemini-3-flash-preview";
  
  const prompt = "Identifique e extraia o NOME DO DESTINATÁRIO, a UNIDADE (CASA/APTO), TRANSPORTADORA e CÓDIGO DE RASTREIO desta etiqueta. Dê atenção ESPECIAL a anotações MANUAIS grandes (ex: 'C 123', 'Ap 101'). Se houver anotação manual da unidade, ela tem prioridade. Retorne as informações de forma clara.";

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
  
  const prompt = `Extrair informações de uma etiqueta de encomenda.

Retorne apenas:
- nome do destinatário (parcial ou completo)
- número da casa/unidade (se identificado claramente)

Regras:
- Ignorar completamente: códigos de rastreio, códigos de barras, transportadora, CEP, cidade, endereço completo
- Não interpretar nem validar dados
- Não tentar decidir quem é o morador
- Não retornar explicações

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
            nome: { type: Type.STRING, description: "Nome do destinatário" },
            casa: { type: Type.STRING, description: "Número da casa ou unidade" },
            confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"], description: "Nível de confiança" }
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
