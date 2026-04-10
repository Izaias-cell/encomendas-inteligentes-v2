import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

// O Vite injeta o GEMINI_API_KEY via define no vite.config.ts
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function analyzePackageLabel(base64Image: string, residentList?: string[]) {
  const model = "gemini-3-flash-preview";
  
  const residentContext = residentList && residentList.length > 0 
    ? `\nCONTEXTO: Os seguintes moradores estão cadastrados neste condomínio. Use esta lista para priorizar o match de Nome e Unidade:\n${residentList.join('\n')}`
    : '';

  const prompt = `Extraia dados desta etiqueta de encomenda para o sistema "Portaria Inteligente".
  
  PRIORIDADE PARA CÓDIGO DE RASTREIO (trackingNumber):
  1. Procure códigos alfanuméricos longos (10-15+ caracteres).
  2. Padrões comuns: "BR...", "CR...", "FA...", ou sequências de 13 caracteres terminando em letras.
  3. IGNORE: Datas, pesos, números de unidade curtos (ex: 101, 22), ou palavras como "STOP".

  IDENTIFICAÇÃO DE UNIDADE (EXTREMAMENTE IMPORTANTE):
  - unitDetails.number: Procure o número da unidade ou casa. Se houver um endereço como "RUA MADRI 426", o número é "426".
  - unitDetails.type: Identifique se é "Apartamento", "Casa", "Lote", "Sala" ou "Bloco". 
  - Se a etiqueta diz "CASA AZUL" ou apenas "CASA", o type="Casa".
  - Se houver "AP", "APTO", "Apto", o type="Apartamento".
  - IGNORE nomes de ruas, cidades, CEPs e observações de entrega no campo 'number'. O campo 'number' deve conter APENAS o identificador da unidade (ex: "426", "101", "A-12").

  IDENTIFICAÇÃO DE DESTINATÁRIO:
  - recipientName: Nome da pessoa física (destinatário). 
  - REMOVA do nome qualquer informação de endereço (rua, número, cidade) que possa ter sido lida junto. O nome deve ser apenas o nome da pessoa.

  ${residentContext}

  Retorne JSON com 'value' e 'confidence' (0.0-1.0).`;

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
                value: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              }
            },
            trackingNumber: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              }
            }
          },
          required: ["recipientName", "unitDetails", "carrier"]
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
