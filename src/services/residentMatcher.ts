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

// Pre-compiled regular expressions for maximum performance
const RE_ACCENTS = /[\u0300-\u036f]/g;
const RE_SPECIAL_CHARS = /[^A-Z0-9\s]/g;
const RE_SPACES = /\s+/g;
const RE_DIGITS = /\d+/g;
const RE_LETTER_DIGIT = /([A-Z])(\d)/g;
const RE_DIGIT_LETTER = /(\d)([A-Z])/g;

const UNIT_KEYWORDS = ['LOTE', 'CASA', 'AP', 'BLOCO', 'TORRE', 'APTO', 'APARTAMENTO'];
const UNIT_KEYWORD_REGEXES = UNIT_KEYWORDS.map(kw => ({
  before: new RegExp(`([^\\s])(${kw})`, 'gi'),
  after: new RegExp(`(${kw})([^\\s\\d])`, 'gi'),
  kw
}));

const UNIT_SYNONYM_REGEXES = Object.entries(UNIT_SYNONYMS).map(([syn, std]) => ({
  regex: new RegExp(`\\b${syn}\\b`, 'g'),
  std
}));

const UNIT_IGNORE_KEYWORDS = ['RUA', 'AVENIDA', 'AV', 'TRAVESSA', 'QUADRA', 'QD', 'CONDOMINIO', 'RESIDENCIAL'];
const UNIT_IGNORE_REGEXES = UNIT_IGNORE_KEYWORDS.map(kw => new RegExp(`\\b${kw}\\b`, 'g'));

const NAME_IGNORE_KEYWORDS = [
  'RUA', 'AVENIDA', 'AV', 'TRAVESSA', 'BLOCO', 'CASA', 'APTO', 'APARTAMENTO', 
  'LOTE', 'TORRE', 'QUADRA', 'QD', 'CONDOMINIO', 'RESIDENCIAL', 'EDIFICIO', 'ED',
  'SAO PAULO', 'SP', 'RIO DE JANEIRO', 'RJ', 'CEP', 'BRASIL'
];
const NAME_IGNORE_REGEXES = NAME_IGNORE_KEYWORDS.map(kw => new RegExp(`\\b${kw}\\b`, 'g'));

const RE_C_WORD = /\bc\b/g;
const RE_AP_WORDS = /apartamento|apto|ap/g;
const RE_CASA_WORDS = /casa|cs/g;
const RE_LOTE_WORDS = /lote/g;
const RE_BLOCO_WORDS = /bloco|bl/g;
const RE_TORRE_WORDS = /torre|tr/g;

// Fast LRU / Memory caches for repeated normalization
const unitNormCache = new Map<string, string>();
const nameNormCache = new Map<string, string>();
const namePartsCache = new Map<string, string[]>();

export const standardizeUnitText = (text: any): string => {
  if (text === null || text === undefined || text === '') return '';
  const str = String(text);
  try {
    let normalized = str.toUpperCase()
      .normalize("NFD").replace(RE_ACCENTS, "")
      .replace(RE_SPECIAL_CHARS, ' ');

    for (let i = 0; i < UNIT_KEYWORD_REGEXES.length; i++) {
      const { before, after } = UNIT_KEYWORD_REGEXES[i];
      normalized = normalized.replace(before, '$1 $2').replace(after, '$1 $2');
    }

    normalized = normalized
      .replace(RE_LETTER_DIGIT, '$1 $2')
      .replace(RE_DIGIT_LETTER, '$1 $2')
      .replace(RE_SPACES, ' ')
      .trim();

    for (let i = 0; i < UNIT_SYNONYM_REGEXES.length; i++) {
      normalized = normalized.replace(UNIT_SYNONYM_REGEXES[i].regex, UNIT_SYNONYM_REGEXES[i].std);
    }

    return normalized;
  } catch {
    return str;
  }
};

export const normalizeUnit = (unit: any): string => {
  if (unit === null || unit === undefined || unit === '') return '';
  const str = String(unit);
  const cached = unitNormCache.get(str);
  if (cached !== undefined) return cached;

  try {
    let normalized = str.toUpperCase()
      .normalize("NFD").replace(RE_ACCENTS, "")
      .replace(RE_SPECIAL_CHARS, ' ');

    for (let i = 0; i < UNIT_IGNORE_REGEXES.length; i++) {
      normalized = normalized.replace(UNIT_IGNORE_REGEXES[i], '');
    }

    const result = normalized.toLowerCase()
      .replace(RE_C_WORD, 'casa')
      .replace(RE_SPACES, '')
      .replace(RE_AP_WORDS, 'ap')
      .replace(RE_CASA_WORDS, 'casa')
      .replace(RE_LOTE_WORDS, 'lote')
      .replace(RE_BLOCO_WORDS, 'bloco')
      .replace(RE_TORRE_WORDS, 'torre');

    if (unitNormCache.size < 5000) unitNormCache.set(str, result);
    return result;
  } catch {
    const fallback = str.toLowerCase().replace(RE_SPACES, '');
    return fallback;
  }
};

export const normalizeName = (name: any): string => {
  if (name === null || name === undefined || name === '') return '';
  const str = String(name);
  const cached = nameNormCache.get(str);
  if (cached !== undefined) return cached;

  try {
    let normalized = str.toUpperCase()
      .normalize("NFD").replace(RE_ACCENTS, "")
      .replace(RE_SPECIAL_CHARS, ' ');

    for (let i = 0; i < NAME_IGNORE_REGEXES.length; i++) {
      normalized = normalized.replace(NAME_IGNORE_REGEXES[i], '');
    }

    const result = normalized
      .replace(RE_DIGITS, '')
      .replace(RE_SPACES, ' ')
      .trim();

    if (nameNormCache.size < 5000) nameNormCache.set(str, result);
    return result;
  } catch {
    return str.toLowerCase().trim();
  }
};

// Ultra-fast zero-allocation rolling 1D array Levenshtein algorithm
export const getLevenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const diff = Math.abs(aLen - bLen);
  if (diff > 3) return diff;

  let prevRow = new Int32Array(bLen + 1);
  let currRow = new Int32Array(bLen + 1);

  for (let j = 0; j <= bLen; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    currRow[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,
        currRow[j - 1] + 1,
        prevRow[j - 1] + cost
      );
    }
    for (let k = 0; k <= bLen; k++) {
      prevRow[k] = currRow[k];
    }
  }

  return prevRow[bLen];
};

const CONNECTORS = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']);

/**
 * Extrai partes de um nome (removendo conectores como 'de', 'da', etc)
 */
export const getNameParts = (name: string): string[] => {
  if (!name) return [];
  const cached = namePartsCache.get(name);
  if (cached !== undefined) return cached;

  const parts = normalizeName(name)
    .toUpperCase()
    .split(' ')
    .filter(p => p.length > 2 && !CONNECTORS.has(p));

  if (namePartsCache.size < 5000) namePartsCache.set(name, parts);
  return parts;
};

const FAKE_UNIT_KEYWORDS = ['ROTA', 'PARADA', 'PACOTE', 'STOP', 'PEDIDO', 'TRACKING', 'PL1', 'CTCE', 'HUB'];

export const findMatchingResidents = async (
  condominiumId: string,
  unit: string,
  name: string,
  details?: any,
  initial?: string,
  cachedResidents?: Morador[]
): Promise<ScoredResident[]> => {
  if (!unit && !name && !details && !initial) {
    return [];
  }

  // 1. Usar moradores em memória se disponíveis, evitando consulta repetida ao Supabase
  let allResidents: Morador[] = cachedResidents || [];
  if (!allResidents || allResidents.length === 0) {
    const { data } = await supabase
      .from('moradores')
      .select('*')
      .eq('condominium_id', condominiumId)
      .eq('ativo', true);
    allResidents = data || [];
  }

  if (!allResidents || allResidents.length === 0) return [];

  const rawOcrName = (name || '').toUpperCase().trim();
  const ocrParts = rawOcrName ? getNameParts(rawOcrName) : [];
  const normalizedOcrUnit = normalizeUnit(unit || '').toLowerCase();
  const ocrInitial = (initial || '').toUpperCase().trim();
  
  const ocrUnitNum = details?.number ? normalizeUnit(details.number).toLowerCase() : '';

  const isLikelyFakeUnit = (u: string) => {
    if (!u) return false;
    const upperU = u.toUpperCase();
    if (u.length > 6) return true;
    for (let i = 0; i < FAKE_UNIT_KEYWORDS.length; i++) {
      if (upperU.includes(FAKE_UNIT_KEYWORDS[i])) return true;
    }
    if (upperU.includes('C') && u.length <= 3 && !ocrParts.length && !upperU.includes('CASA')) {
      return true;
    }
    return false;
  };

  const isFakeUnit = isLikelyFakeUnit(normalizedOcrUnit);

  const scoredResidents: ScoredResident[] = [];

  for (let i = 0; i < allResidents.length; i++) {
    const r = allResidents[i];
    if (!r) continue;

    let score = 0;
    const resFullName = (r.nome || '').toUpperCase();
    const resUnit = normalizeUnit(r.unidade || '').toLowerCase();

    // 1. MATCH DE UNIDADE
    const unitMatches = resUnit && (
      normalizedOcrUnit === resUnit || 
      (normalizedOcrUnit.length >= 2 && (normalizedOcrUnit.includes(resUnit) || resUnit.includes(normalizedOcrUnit))) || 
      (ocrUnitNum && ocrUnitNum === resUnit)
    );
    
    // 2. MATCH DE NOME (FUZZY E PARTES)
    let nameScore = 0;
    
    if (rawOcrName && resFullName === rawOcrName) {
      nameScore += 100;
    }

    if (ocrParts.length > 0) {
      const resParts = getNameParts(resFullName);
      if (resParts.length > 0) {
        let matchedParts = 0;
        for (let opIdx = 0; opIdx < ocrParts.length; opIdx++) {
          const op = ocrParts[opIdx];
          let partMatched = false;
          for (let rpIdx = 0; rpIdx < resParts.length; rpIdx++) {
            const rp = resParts[rpIdx];
            if (op === rp) {
              matchedParts += 1;
              partMatched = true;
              break;
            }
          }
          if (!partMatched) {
            for (let rpIdx = 0; rpIdx < resParts.length; rpIdx++) {
              const rp = resParts[rpIdx];
              const dist = getLevenshteinDistance(op, rp);
              if (dist <= 1 && op.length > 3) {
                matchedParts += 0.8;
                break;
              } else if (dist <= 2 && op.length > 5) {
                matchedParts += 0.5;
                break;
              }
            }
          }
        }

        const matchRatio = matchedParts / Math.max(ocrParts.length, resParts.length);
        nameScore += (matchRatio * 80);

        if (ocrParts.length >= 2 && resParts.length >= 2) {
          const firstDist = getLevenshteinDistance(ocrParts[0], resParts[0]);
          const lastDist = getLevenshteinDistance(ocrParts[ocrParts.length - 1], resParts[resParts.length - 1]);
          
          if (firstDist <= 1 && lastDist <= 1) {
            nameScore += 50;
          } else if (firstDist <= 1) {
            nameScore += 20;
          }
        }
      }
    }

    // Match de Inicial
    if (ocrInitial && resFullName.startsWith(ocrInitial)) {
      nameScore += 120;
    }

    // 3. CÁLCULO DE SCORE COMBINADO
    if (unitMatches && nameScore >= 100) {
      score = 400 + nameScore;
    } else if (unitMatches && nameScore >= 50) {
      score = 300 + nameScore;
    } else if (unitMatches && nameScore > 0) {
      score = 200 + nameScore;
    } else if (unitMatches && !isFakeUnit) {
      score = 150;
    } else if (nameScore >= 60) {
      score = 100 + nameScore;
    } else if (nameScore >= 30) {
      score = 50 + nameScore;
    }

    if (normalizedOcrUnit && resUnit && !unitMatches && !isFakeUnit) {
      score = Math.max(0, score - 200);
    }

    if (score >= 50) {
      scoredResidents.push({ resident: r, score });
    }
  }

  scoredResidents.sort((a, b) => b.score - a.score);
  return scoredResidents;
};

