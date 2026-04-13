/**
 * Service to parse raw OCR text from package labels and extract recipient name and unit number.
 */

const IGNORE_WORDS = [
  'RUA', 'AVENIDA', 'AV', 'CEP', 'CIDADE', 'ESTADO', 'BRASIL', 'LOGRADOURO',
  'BAIRRO', 'NUMERO', 'Nº', 'DESTINATARIO', 'REMETENTE', 'ENDERECO',
  'TELEFONE', 'TEL', 'CPF', 'RG', 'DATA', 'ENTREGA', 'PEDIDO', 'RASTREIO',
  'CODIGO', 'TRANSPORTADORA', 'LOGISTICA', 'HUB', 'ROTA', 'STOP', 'PARADA',
  'NF', 'NOTA FISCAL', 'COMPLEMENTO', 'REFERENCIA', 'REF', 'PED', 'ORDER',
  'VALOR', 'DECLARADO', 'PESO', 'VOLUME', 'CHAVE', 'ACESSO', 'DANFE'
];

const UNIT_KEYWORDS = ['CASA', 'AP', 'APTO', 'APARTAMENTO', 'UNIDADE', 'UNID', 'BLOCO', 'BL', 'LOTE', 'TORRE', 'TR', 'SALA'];
const UNIT_REGEX = new RegExp(`\\b(?:${UNIT_KEYWORDS.join('|')})\\s*[:\\-]?\\s*(\\d+[A-Z]?)\\b`, 'i');

export interface ParsedLabel {
  recipientName: string;
  unitNumber: string;
}

export function parseLabelText(rawText: string): ParsedLabel {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let recipientName = '';
  let unitNumber = '';

  // 1. EXTRAÇÃO DE UNIDADE (CASA/AP)
  // Tenta encontrar um número que pareça uma unidade em qualquer linha
  for (const line of lines) {
    // Primeiro tenta com palavras-chave
    const match = line.match(UNIT_REGEX);
    if (match && match[1]) {
      unitNumber = match[1];
      break;
    }
    
    // Se não encontrou com palavra-chave, mas a linha é apenas um número curto (1-4 dígitos)
    const isolatedNum = line.match(/^(\d{1,4}[A-Z]?)$/);
    if (isolatedNum) {
      unitNumber = isolatedNum[1];
      break;
    }
  }

  // 2. EXTRAÇÃO DE NOME
  // Pega a primeira linha que não foi identificada como unidade e que parece um nome
  for (const line of lines) {
    if (line === unitNumber) continue;
    
    const upperLine = line.toUpperCase();
    if (IGNORE_WORDS.some(word => upperLine.includes(word))) continue;
    
    const cleanLine = line.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
    const words = cleanLine.split(' ').filter(w => w.length >= 2);

    if (words.length >= 2) {
      recipientName = cleanLine;
      break; 
    }
  }

  return {
    recipientName: recipientName.trim(),
    unitNumber: unitNumber.trim()
  };
}
