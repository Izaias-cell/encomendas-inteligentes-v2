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
  return unit.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/apartamento|apto|ap/g, 'ap')
    .replace(/casa|cs/g, 'casa')
    .replace(/lote/g, 'lote')
    .replace(/bloco|bl/g, 'bloco')
    .replace(/torre|tr/g, 'torre')
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

export const normalizeName = (name: string) => {
  if (!name) return '';
  return name.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^A-Z\s]/g, ' ') // Remove non-letters
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
  
  const ocrNum = details?.number || (unit?.match(/\d+/) ? unit.match(/\d+/)![0] : '');
  
  // AVOID MISASSOCIATION: If the unit number looks like a tracking code or logistical text, ignore it
  const logisticalPrefixes = ['BR', 'CR', 'FA', 'PR', 'ROTA', 'STOP', 'PARADA', 'PEDIDO', 'HUB', 'PAC'];
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

  if (!allResidents) return [];

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
    
    // A. Unit Matching (High Priority)
    if ((unit || details) && !isLikelyTrackingCode) {
      // Exact structured match
      if (r.unidade && effectiveOcrNum && r.unidade.toString() === effectiveOcrNum.toString()) {
        score += 50;
        // if (!r.unit_type || !ocrType || normalizeUnit(r.unit_type) === ocrType) score += 10;
        if (!r.bloco || !ocrBlock || normalizeUnit(r.bloco) === ocrBlock) score += 10;
        if (!r.lote || !ocrTower || normalizeUnit(r.lote) === ocrTower) score += 10;
      }

      // Legacy unit match
      if (resUnit === normalizedOcrUnit && resUnit.length > 0) {
        score += 70;
      } else if (resUnit.length > 0 && normalizedOcrUnit.length > 0) {
        if (normalizedOcrUnit.includes(resUnit) || resUnit.includes(normalizedOcrUnit)) {
          score += 30;
        }
      }
    }

    // B. Name Matching
    if (normalizedOcrName) {
      // Exact match
      if (resName === normalizedOcrName) {
        score += 100;
      } 
      // Partial match (contains)
      else if (resName.includes(normalizedOcrName) || normalizedOcrName.includes(resName)) {
        score += 60;
      } 
      // Fuzzy match for common variations (SOUSA/SOUZA)
      else {
        const fuzzyOcr = normalizedOcrName.replace(/Z/g, 'S');
        const fuzzyRes = resName.replace(/Z/g, 'S');
        if (fuzzyOcr === fuzzyRes) {
          score += 90;
        } else if (fuzzyRes.includes(fuzzyOcr) || fuzzyOcr.includes(fuzzyRes)) {
          score += 55;
        } else {
          // Levenshtein distance for small typos
          const distance = getLevenshteinDistance(normalizedOcrName, resName);
          if (distance <= 2) {
            score += 80;
          } else {
            // Match by parts (first and last name)
            const ocrParts = normalizedOcrName.split(' ').filter(p => p.length > 1);
            const resParts = resName.split(' ').filter(p => p.length > 1);
            
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
    }

    // C. History Boost
    if (history && history.length > 0) {
      const residentHistory = history.filter(h => h.recipient_id === r.id);
      if (residentHistory.length > 0) {
        // If this resident has received packages in this unit before
        const unitMatch = residentHistory.some(h => normalizeUnit(h.unit_number) === normalizedOcrUnit);
        if (unitMatch) score += 20;
        
        // If this resident has received packages with this raw name before
        const nameMatch = residentHistory.some(h => normalizeName(h.recipient_name_raw) === normalizedOcrName);
        if (nameMatch) score += 15;
      }
    }

    return { resident: r, score };
  });

  // Filter and sort by score
  const threshold = 40; 
  return scoredResidents
    .filter(sr => sr.score >= threshold)
    .sort((a, b) => b.score - a.score);
};
