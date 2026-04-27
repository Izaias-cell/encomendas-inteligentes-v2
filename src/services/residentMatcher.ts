import { supabase } from '../lib/supabase';
import { Morador } from '../types';

export interface ScoredResident {
  resident: Morador;
  score: number;
}

const UNIT_SYNONYMS: Record<string, string> = {
  'APTO': 'AP',
  'APARTAMENTO': 'AP',
  'CS': 'CASA',
  'C': 'CASA',
  'BL': 'BLOCO',
  'TR': 'TORRE'
};

export const standardizeUnitText = (text: string) => {
  if (!text) return '';
  
  let normalized = text.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^A-Z0-9\s]/g, ' '); // Replace special chars with space

  // Insert spaces before/after keywords if joined
  const keywords = ['LOTE', 'CASA', 'AP', 'BLOCO', 'TORRE', 'APTO', 'APARTAMENTO'];
  keywords.forEach(kw => {
    // Keyword preceded by something that isn't a space
    const regex1 = new RegExp(`([^\\s])(${kw})`, 'gi');
    normalized = normalized.replace(regex1, '$1 $2');
    // Keyword followed by something that isn't a space or digit
    const regex2 = new RegExp(`(${kw})([^\\s\\d])`, 'gi');
    normalized = normalized.replace(regex2, '$1 $2');
  });

  normalized = normalized
    .replace(/([A-Z])(\d)/g, '$1 $2') // Separate letters from numbers: LOTE4 -> LOTE 4
    .replace(/(\d)([A-Z])/g, '$1 $2') // Separate numbers from letters: 101A -> 101 A
    .replace(/\s+/g, ' ') // Remove duplicate spaces
    .trim();

  // Replace synonyms
  Object.entries(UNIT_SYNONYMS).forEach(([syn, std]) => {
    const regex = new RegExp(`\\b${syn}\\b`, 'g');
    normalized = normalized.replace(regex, std);
  });

  return normalized;
};

export const normalizeUnit = (unit: string) => {
  if (!unit) return '';
  
  // Keywords to ignore in unit numbers (streets, etc.)
  const ignoreKeywords = ['RUA', 'AVENIDA', 'AV', 'TRAVESSA', 'QUADRA', 'QD', 'CONDOMINIO', 'RESIDENCIAL'];
  
  let normalized = unit.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^A-Z0-9\s]/g, ' ');

  ignoreKeywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'g');
    normalized = normalized.replace(regex, '');
  });

  return normalized.toLowerCase()
    .replace(/\bc\b/g, 'casa')
    .replace(/\s+/g, '')
    .replace(/apartamento|apto|ap/g, 'ap')
    .replace(/casa|cs/g, 'casa')
    .replace(/lote/g, 'lote')
    .replace(/bloco|bl/g, 'bloco')
    .replace(/torre|tr/g, 'torre');
};

export const normalizeName = (name: string) => {
  if (!name) return '';
  
  // Keywords to ignore in names (streets, cities, etc.)
  const ignoreKeywords = [
    'RUA', 'AVENIDA', 'AV', 'TRAVESSA', 'BLOCO', 'CASA', 'APTO', 'APARTAMENTO', 
    'LOTE', 'TORRE', 'QUADRA', 'QD', 'CONDOMINIO', 'RESIDENCIAL', 'EDIFICIO', 'ED',
    'SAO PAULO', 'SP', 'RIO DE JANEIRO', 'RJ', 'CEP', 'BRASIL'
  ];

  let normalized = name.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^A-Z0-9\s]/g, ' '); // Keep numbers for now to identify address parts

  // Remove street names and other irrelevant info
  ignoreKeywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'g');
    normalized = normalized.replace(regex, '');
  });

  return normalized
    .replace(/\d+/g, '') // Now remove numbers
    .replace(/\s+/g, ' ') // Single spaces
    .trim();
};

export const getLevenshteinDistance = (a: string, b: string): number => {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

/**
 * Extrai partes de um nome (removendo conectores como 'de', 'da', etc)
 */
const getNameParts = (name: string): string[] => {
  const connectors = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'];
  return normalizeName(name)
    .toUpperCase()
    .split(' ')
    .filter(p => p.length > 2 && !connectors.includes(p));
};

export const findMatchingResidents = async (
  condominiumId: string,
  unit: string,
  name: string,
  details?: any
): Promise<ScoredResident[]> => {
  if (!unit && !name && !details) {
    return [];
  }

  // 1. Fetch all active residents for the condominium
  const { data: allResidents } = await supabase
    .from('moradores')
    .select('*')
    .eq('condominium_id', condominiumId)
    .eq('ativo', true);

  if (!allResidents || allResidents.length === 0) return [];

  const rawOcrName = (name || '').toUpperCase();
  const normalizedOcrName = normalizeName(rawOcrName);
  const ocrParts = getNameParts(rawOcrName);
  const normalizedOcrUnit = normalizeUnit(unit || '').toLowerCase();
  
  // Se tivermos detalhes da unidade (número isolado), usamos também
  const ocrUnitNum = details?.number ? normalizeUnit(details.number).toLowerCase() : '';

  // Filtro de segurança para códigos falsos de casa (Ex: C 39 que é rastreio)
  const isLikelyFakeUnit = (u: string) => {
    const upperU = u.toUpperCase();
    const fakeKeywords = ['ROTA', 'PARADA', 'PACOTE', 'STOP', 'PEDIDO', 'TRACKING', 'PL1', 'CTCE', 'HUB'];
    
    const hasFakeKeyword = fakeKeywords.some(kw => upperU.includes(kw));
    const isTooLong = u.length > 6;
    const isSuspiciousC = upperU.includes('C') && u.length <= 3 && !ocrParts.length && !upperU.includes('CASA');

    return hasFakeKeyword || isTooLong || isSuspiciousC;
  };

  const scoredResidents = allResidents.map(r => {
    let score = 0;
    const resFullName = (r.nome || '').toUpperCase();
    const resParts = getNameParts(resFullName);
    const resUnit = normalizeUnit(r.unidade || '').toLowerCase();

    // 1. MATCH DE UNIDADE
    const unitMatches = resUnit && (normalizedOcrUnit === resUnit || normalizedOcrUnit.includes(resUnit) || (ocrUnitNum && ocrUnitNum === resUnit));
    
    // 2. MATCH DE NOME (FUZZY E PARTES)
    let nameScore = 0;
    
    // Match Exato (raro com OCR)
    if (resFullName === rawOcrName) {
      nameScore += 100;
    }

    // Match de partes
    if (ocrParts.length > 0 && resParts.length > 0) {
      let matchedParts = 0;
      ocrParts.forEach(op => {
        if (resParts.includes(op)) {
          matchedParts++;
        } else {
          // Fuzzy match para cada parte
          resParts.forEach(rp => {
            const dist = getLevenshteinDistance(op, rp);
            if (dist <= 1 && op.length > 3) matchedParts += 0.8;
            else if (dist <= 2 && op.length > 5) matchedParts += 0.5;
          });
        }
      });

      // Bônus por quantidade de partes batendo
      const matchRatio = matchedParts / Math.max(ocrParts.length, resParts.length);
      nameScore += (matchRatio * 80);

      // Bônus específico para Primeiro + Último nome (com tolerância a erros)
      if (ocrParts.length >= 2 && resParts.length >= 2) {
        const firstDist = getLevenshteinDistance(ocrParts[0], resParts[0]);
        const lastDist = getLevenshteinDistance(ocrParts[ocrParts.length - 1], resParts[resParts.length - 1]);
        
        if (firstDist <= 1 && lastDist <= 1) {
          nameScore += 50; // Match forte de Nome + Sobrenome
        } else if (firstDist <= 1) {
          nameScore += 20; // Match de primeiro nome
        }
      }
    }

    // 3. CÁLCULO DE SCORE COMBINADO
    
    // Unidade + Nome Forte
    if (unitMatches && nameScore >= 50) {
      score = 300 + nameScore;
    }
    // Unidade + Nome Fraco
    else if (unitMatches && nameScore > 0) {
      score = 200 + nameScore;
    }
    // Apenas Unidade (Cuidado com fake units)
    else if (unitMatches && !isLikelyFakeUnit(normalizedOcrUnit)) {
      score = 150;
    }
    // Apenas Nome Forte
    else if (nameScore >= 60) {
      score = 100 + nameScore;
    }
    // Apenas Nome Médio
    else if (nameScore >= 30) {
      score = 50 + nameScore;
    }

    // SEGURANÇA: Se a unidade foi detectada e NÃO bate, penaliza fortemente
    if (normalizedOcrUnit && resUnit && !unitMatches && !isLikelyFakeUnit(normalizedOcrUnit)) {
      score = Math.max(0, score - 200);
    }

    return { resident: r, score };
  });

  // Filtrar e ordenar
  const sortedMatches = scoredResidents
    .filter(sr => sr.score >= 50)
    .sort((a, b) => b.score - a.score);

  return sortedMatches;
};

