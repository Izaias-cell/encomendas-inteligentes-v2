/**
 * Service to parse raw OCR text from package labels and extract recipient name and unit number.
 */

const IGNORE_WORDS = [
  'RUA', 'AVENIDA', 'AV', 'CEP', 'CIDADE', 'ESTADO', 'BRASIL', 'LOGRADOURO',
  'BAIRRO', 'NUMERO', 'Nº', 'DESTINATARIO', 'REMETENTE', 'ENDERECO',
  'TELEFONE', 'TEL', 'CPF', 'RG', 'DATA', 'ENTREGA', 'PEDIDO', 'RASTREIO',
  'CODIGO', 'TRANSPORTADORA', 'LOGISTICA', 'HUB', 'ROTA', 'STOP', 'PARADA'
];

const UNIT_KEYWORDS = ['CASA', 'AP', 'APTO', 'APARTAMENTO', 'UNIDADE', 'UNID', 'BLOCO', 'BL', 'LOTE'];

export interface ParsedLabel {
  recipientName: string;
  unitNumber: string;
}

export function parseLabelText(rawText: string): ParsedLabel {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let recipientName = '';
  let unitNumber = '';

  // 1. Identify Unit Number
  // Look for numbers near keywords or isolated numbers
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    
    // Check for keywords like "CASA 123" or "APTO 45"
    for (const keyword of UNIT_KEYWORDS) {
      const regex = new RegExp(`${keyword}\\s*[:\\-]?\\s*(\\d+[A-Z]?)`, 'i');
      const match = line.match(regex);
      if (match && match[1]) {
        unitNumber = match[1];
        break;
      }
    }
    if (unitNumber) break;
  }

  // If no unit found with keywords, look for isolated numbers (usually at the end of a line or alone)
  if (!unitNumber) {
    for (const line of lines) {
      // Look for a line that is just a number or ends with a number (common for units)
      const isolatedNumMatch = line.match(/^(\d{1,4}[A-Z]?)$/) || line.match(/(\d{1,4}[A-Z]?)$/);
      if (isolatedNumMatch) {
        const num = isolatedNumMatch[1];
        // Avoid common logistical numbers (like house numbers in addresses if they are too long)
        if (num.length <= 4) {
          unitNumber = num;
          break;
        }
      }
    }
  }

  // 2. Identify Recipient Name
  // Look for lines that look like a name (2-4 words, capitalized, no numbers, not in ignore list)
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    
    // Skip lines that contain ignore words
    if (IGNORE_WORDS.some(word => upperLine.includes(word))) continue;
    
    // Skip lines that are too short or too long
    if (line.length < 3 || line.length > 50) continue;

    // Clean line from unit number if it was already found on this line
    let cleanLine = line;
    if (unitNumber && line.includes(unitNumber)) {
      cleanLine = line.replace(unitNumber, '').replace(/\s+/g, ' ').trim();
    }

    // Remove common non-name characters but keep letters
    const nameCandidate = cleanLine.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
    const words = nameCandidate.split(/\s+/).filter(w => w.length >= 2);

    if (words.length >= 2 && words.length <= 6) {
      // If we haven't found a name yet, or this one looks better (longer)
      if (!recipientName || nameCandidate.length > recipientName.length) {
        recipientName = nameCandidate;
      }
    }
  }

  return {
    recipientName: recipientName.trim(),
    unitNumber: unitNumber.trim()
  };
}
