/**
 * Service to parse raw OCR text from package labels and extract recipient name and unit number.
 */

const IGNORE_WORDS = [
  'RUA', 'AVENIDA', 'AV', 'CEP', 'CIDADE', 'ESTADO', 'BRASIL', 'LOGRADOURO',
  'BAIRRO', 'NUMERO', 'Nº', 'DESTINATARIO', 'REMETENTE', 'ENDERECO',
  'TELEFONE', 'TEL', 'CPF', 'RG', 'DATA', 'ENTREGA', 'PEDIDO', 'RASTREIO',
  'CODIGO', 'TRANSPORTADORA', 'LOGISTICA', 'HUB', 'ROTA', 'STOP', 'PARADA',
  'NF', 'NOTA FISCAL', 'COMPLEMENTO', 'REFERENCIA', 'REF', 'PED', 'ORDER',
  'VALOR', 'DECLARADO', 'PESO', 'VOLUME', 'CHAVE', 'ACESSO', 'DANFE',
  'CTCE', 'PL1'
];

const UNIT_KEYWORDS = ['CASA', 'AP', 'APTO', 'APT', 'APARTAMENTO', 'UNIDADE', 'UNID', 'BLOCO', 'BL', 'LOTE', 'TORRE', 'TR', 'SALA', 'C', 'CS', 'Nº', 'NUM'];
const UNIT_REGEX = new RegExp(`\\b(?:${UNIT_KEYWORDS.join('|')})\\s*[:\\-]?\\s*(\\d+[A-Z]?)\\b`, 'i');

// Regex específico para anotações manuais comuns: C123, C 123, AP101, AP 101, Casa 123, CS 45, Nº 10
const MANUAL_UNIT_REGEX = /\b(C|AP|CS|APTO|CASA|N[º°]|NUM)\s*(\d+[A-Z]?)\b/i;

export interface ParsedLabel {
  recipientName: string;
  unitNumber: string;
  trackingCode?: string;
  carrier?: string;
  manualNotes?: string;
}

export function parseLabelText(rawText: string): ParsedLabel {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let recipientName = '';
  let unitNumber = '';
  let trackingCode = '';
  let carrier = '';
  let manualNotes = '';

  const CARRIER_KEYWORDS = ['CORREIOS', 'LOGGI', 'MERCADO LIVRE', 'MELI', 'ML', 'AMAZON', 'SHOOPEE', 'FEDEX', 'DHL', 'TOTAL EXPRESS', 'JADLOG'];

  // 1. EXTRAÇÃO DE UNIDADE (CASA/AP), TRACKING E CARRIER
  for (const line of lines) {
    const upperLine = line.toUpperCase();

    // Tracking (padrão comum de códigos de rastreio)
    if (!trackingCode) {
      const trackingMatch = line.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/i) || line.match(/\b(\d{11,})\b/);
      if (trackingMatch) {
        trackingCode = trackingMatch[1];
      }
    }

    // Carrier
    if (!carrier) {
      for (const kw of CARRIER_KEYWORDS) {
        if (upperLine.includes(kw)) {
          carrier = kw;
          break;
        }
      }
    }

    // Unidade
    if (!unitNumber) {
      // Primeiro tenta com o regex de manual (mais específico para C123)
      const manualMatch = line.match(MANUAL_UNIT_REGEX);
      if (manualMatch && manualMatch[2]) {
        unitNumber = manualMatch[2];
      } else {
        // Depois tenta com palavras-chave gerais
        const match = line.match(UNIT_REGEX);
        if (match && match[1]) {
          unitNumber = match[1];
        } else {
          // Se não encontrou com palavra-chave, mas a linha é apenas um número curto (1-4 dígitos)
          const isolatedNum = line.match(/^(\d{1,4}[A-Z]?)$/);
          if (isolatedNum) {
            unitNumber = isolatedNum[1];
          }
        }
      }
    }
  }

  // 2. EXTRAÇÃO DE NOME
  // Pega a primeira linha que não foi identificada como unidade/tracking/carrier e que parece um nome
  for (const line of lines) {
    if (line === unitNumber || line === trackingCode || line === carrier) continue;
    
    const upperLine = line.toUpperCase();
    if (IGNORE_WORDS.some(word => upperLine.includes(word))) continue;
    
    const cleanLine = line.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
    const words = cleanLine.split(' ').filter(w => w.length >= 2);

    if (words.length >= 2 && words.length <= 5) {
      recipientName = cleanLine;
      break; 
    }
  }

  return {
    recipientName: recipientName.trim(),
    unitNumber: unitNumber.trim(),
    trackingCode: trackingCode.trim(),
    carrier: carrier.trim()
  };
}
