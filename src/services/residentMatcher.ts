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
 * Extrai o primeiro nome e o sobrenome (última palavra)
 */
/**
 * Extrai o primeiro nome
 */
const getFirstName = (fullName: string) => {
  const normalized = normalizeName(fullName);
  const parts = normalized.split(' ').filter(p => p.length > 0);
  return parts[0] || '';
};

/**
 * Extrai as N primeiras letras de uma string
 */
const getFirstNLetters = (text: string, n: number) => {
  return text.substring(0, n).toUpperCase();
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

  const normalizedOcrName = normalizeName(name || '').toUpperCase();
  const normalizedOcrUnit = normalizeUnit(unit || '').toLowerCase();
  
  // Se tivermos detalhes da unidade (número isolado), usamos também
  const ocrUnitNum = details?.number ? normalizeUnit(details.number).toLowerCase() : '';

  // 2. Extrair Primeiro Nome do OCR
  const ocrFirstName = getFirstName(normalizedOcrName);
  const ocrF3Name = getFirstNLetters(ocrFirstName, 3);
  const ocrF4Name = getFirstNLetters(ocrFirstName, 4);

  const scoredResidents = allResidents.map(r => {
    let score = 0;
    const resFullName = (r.nome || '').toUpperCase();
    const resUnit = normalizeUnit(r.unidade || '').toLowerCase();

    // 1. Primeiro Nome do morador cadastrado
    const resFirstName = getFirstName(resFullName);

    // 2. Extrair letras para desempate
    const resF3Name = getFirstNLetters(resFirstName, 3);
    const resF4Name = getFirstNLetters(resFirstName, 4);

    // 3. MATCHING LÓGICA (Requisito: 3 letras nome + unidade facultativa)
    const unitMatches = resUnit && (normalizedOcrUnit === resUnit || normalizedOcrUnit.includes(resUnit) || (ocrUnitNum && ocrUnitNum === resUnit));
    
    // Match de 3 letras (Base principal)
    const name3Matches = resF3Name.length >= 3 && ocrF3Name === resF3Name;
    
    // Match de 4 letras (Desempate de ambiguidade)
    const name4Matches = resF4Name.length >= 4 && ocrF4Name === resF4Name;

    // CÁLCULO DE SCORE
    
    // Prioridade Máxima: Unidade + Nome (4 letras)
    if (unitMatches && name4Matches) {
      score += 300; // Seleção automática imediata
    } 
    // Alta: Unidade + Nome (3 letras)
    else if (unitMatches && name3Matches) {
      score += 250; 
    }
    // Alta/Média: Apenas Unidade (Se detectada claramente)
    else if (unitMatches && normalizedOcrUnit.length > 0) {
      score += 150;
    }
    // Média: Apenas Nome (4 letras)
    else if (name4Matches) {
      score += 100;
    }
    // Base: Apenas Nome (3 letras)
    else if (name3Matches) {
      score += 80;
    }
    // Fallback: Nome contém as 3 letras mas não no início
    else if (resF3Name.length >= 3 && normalizedOcrName.includes(resF3Name)) {
      score += 40;
    }

    // SEGURANÇA: Se a unidade foi detectada e NÃO bate, penaliza fortemente
    if (normalizedOcrUnit && resUnit && !unitMatches) {
      score = Math.max(0, score - 200);
    }

    return { resident: r, score };
  });

  // Ordenar pelo maior score e filtrar os que não tiveram match significativo
  const sortedMatches = scoredResidents
    .filter(sr => sr.score >= 40)
    .sort((a, b) => b.score - a.score);

  return sortedMatches;
};

