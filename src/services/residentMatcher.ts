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

export const findMatchingResidents = async (
  condominiumId: string,
  unit: string,
  name: string,
  details?: any
): Promise<ScoredResident[]> => {
  if (!unit && !name && !details) {
    return [];
  }

  const normalizedOcrUnit = normalizeUnit(unit || '');
  const normalizedOcrName = normalizeName(name || '');
  const ocrStreet = normalizeName(details?.street || '');
  
  const ocrNum = details?.number || (unit?.match(/\d+/) ? unit.match(/\d+/)![0] : '');
  
  // AVOID MISASSOCIATION: If the unit number looks like a tracking code or logistical text, ignore it
  const logisticalPrefixes = ['BR', 'CR', 'FA', 'PR', 'NF', 'ROTA', 'STOP', 'PARADA', 'PEDIDO', 'HUB', 'PAC'];
  const isLogisticalText = unit && logisticalPrefixes.some(p => unit.toUpperCase().startsWith(p));
  const isLikelyTrackingCode = (ocrNum && ocrNum.length > 6) || isLogisticalText;
  const effectiveOcrNum = isLikelyTrackingCode ? '' : ocrNum;

  const ocrType = normalizeUnit(details?.type || '');
  const ocrBlock = normalizeUnit(details?.block || '');
  const ocrTower = normalizeUnit(details?.tower || '');

  // 1. Fetch all active residents for the condominium
  const { data: allResidents } = await supabase
    .from('moradores')
    .select('*')
    .eq('condominium_id', condominiumId)
    .eq('ativo', true);

  if (!allResidents || allResidents.length === 0) return [];

  // 1.5 Determine if street is a relevant differentiator
  // If most residents share the same street, it's not useful for disambiguation
  const streetFrequency: Record<string, number> = {};
  let totalWithStreet = 0;
  allResidents.forEach(r => {
    const s = (r.street || '').trim().toUpperCase();
    if (s) {
      streetFrequency[s] = (streetFrequency[s] || 0) + 1;
      totalWithStreet++;
    }
  });

  const distinctStreets = Object.keys(streetFrequency).length;
  const maxFreq = Math.max(0, ...Object.values(streetFrequency));
  
  // Street is relevant ONLY if there's more than one street 
  // AND no single street dominates too much (e.g., > 80% of those who have a street)
  const isStreetRelevant = totalWithStreet > 0 && distinctStreets > 1 && (maxFreq / totalWithStreet) < 0.8;

  // 2. Fetch history (last 50 packages) to boost confidence
  const { data: history } = await supabase
    .from('packages')
    .select('recipient_id, unit_number, recipient_name_raw')
    .eq('condominium_id', condominiumId)
    .order('received_at', { ascending: false })
    .limit(50);

  // Scoring system for residents
  const scoredResidents = allResidents.map(r => {
    let score = 0;
    const resName = normalizeName(r.nome || '');
    const resUnit = normalizeUnit(r.unidade || '');
    const resType = normalizeUnit(r.unit_type || '');
    
    // A. Unit Matching (High Priority)
    if ((unit || details) && !isLikelyTrackingCode) {
      // 1. Exact number match (Highest Priority)
      if (r.unidade && effectiveOcrNum && r.unidade.toString() === effectiveOcrNum.toString()) {
        score += 80;
        
        // 2. Unit type match (Bonus)
        if (resType && ocrType && resType === ocrType) {
          score += 40;
        }
        
        // 3. Block/Tower match (Bonus)
        if (!r.bloco || !ocrBlock || normalizeUnit(r.bloco) === ocrBlock) score += 10;
        if (!r.lote || !ocrTower || normalizeUnit(r.lote) === ocrTower) score += 10;
      }

      // Street match (Bonus) - Only if street is a relevant differentiator in this condo
      if (isStreetRelevant) {
        const resStreet = normalizeName(r.street || '');
        if (resStreet && ocrStreet && (resStreet === ocrStreet || resStreet.includes(ocrStreet) || ocrStreet.includes(resStreet))) {
          score += 50;
        }
      }
    }

    // B. Name Matching
    if (normalizedOcrName) {
      const ocrParts = normalizedOcrName.split(' ').filter(p => p.length > 1);
      const resParts = resName.split(' ').filter(p => p.length > 1);

      // Exact match
      if (resName === normalizedOcrName) {
        score += 100;
        // Bonus for full name (more than one part)
        if (resParts.length > 1) {
          score += 20;
        }
      } 
      // Partial match (contains)
      else if (resName.includes(normalizedOcrName) || normalizedOcrName.includes(resName)) {
        score += 60;
        if (resName.startsWith(normalizedOcrName) || normalizedOcrName.startsWith(resName)) {
          score += 20;
        }
        // Bonus if multiple parts match
        let partMatches = 0;
        ocrParts.forEach(op => {
          if (resParts.some(rp => rp === op)) {
            partMatches++;
          }
        });
        if (partMatches > 1) {
          score += 30;
        }
      } 
      // Fuzzy match
      else {
        const distance = getLevenshteinDistance(normalizedOcrName, resName);
        if (distance <= 2) {
          score += 80;
        } else {
          // Match by parts
          let partMatches = 0;
          ocrParts.forEach(op => {
            if (resParts.some(rp => rp === op || rp.startsWith(op) || op.startsWith(rp))) {
              partMatches++;
            }
          });

          if (partMatches > 0) {
            score += (partMatches / Math.max(ocrParts.length, resParts.length)) * 70;
          }
        }
      }
    }

    // C. History Boost
    if (history && history.length > 0) {
      const residentHistory = history.filter(h => h.recipient_id === r.id);
      if (residentHistory.length > 0) {
        const unitMatch = residentHistory.some(h => normalizeUnit(h.unit_number) === normalizedOcrUnit);
        if (unitMatch) score += 20;
        
        const nameMatch = residentHistory.some(h => normalizeName(h.recipient_name_raw) === normalizedOcrName);
        if (nameMatch) score += 15;
      }
    }

    return { resident: r, score };
  });

  // Filter and sort by score
  const threshold = 30; 
  return scoredResidents
    .filter(sr => sr.score >= threshold)
    .sort((a, b) => b.score - a.score);
};
