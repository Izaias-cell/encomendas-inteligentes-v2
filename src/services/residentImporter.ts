import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { Morador } from '../types';
import { registrarAuditoria } from './auditService';
import { ImportMode, formatObservacoesWithMode } from './residentModeService';

export interface RawSpreadsheetData {
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

export interface ColumnMapping {
  nameColumn: string;
  unitColumn: string;
  phoneColumn: string;
  blockColumn?: string;
  unitTypeColumn?: string;
  obsColumn?: string;
}

export type ResidentRecordStatus = 'complete' | 'pending' | 'inconsistent';

export type DuplicateStatus = 'new' | 'exact_duplicate' | 'unit_occupied' | 'name_exists';

export interface ProcessedResident {
  id: string; // temporary client UUID
  rawRowIndex: number;
  nome: string;
  unidade: string;
  telefone: string;
  observacao?: string;
  unit_type?: string;
  block?: string;
  status: ResidentRecordStatus;
  statusReasons: string[];
  duplicateStatus: DuplicateStatus;
  existingResidentId?: string;
  existingResidentName?: string;
  existingResidentPhone?: string;
  isSelected: boolean;
}

export interface ImportPreviewSummary {
  total: number;
  complete: number;
  pending: number;
  inconsistent: number;
  duplicates: number;
  selectedToImport: number;
  records: ProcessedResident[];
}

export type DuplicateStrategy = 'ignore_existing' | 'update_existing' | 'import_all';

// Aliases para reconhecimento inteligente de colunas
const NAME_ALIASES = [
  'nome', 'nome completo', 'morador', 'morador(a)', 'moradora', 'moradores',
  'proprietario', 'proprietaria', 'proprietário', 'proprietária',
  'inquilino', 'inquilina', 'responsavel', 'responsável', 'titular',
  'resident', 'name', 'full name', 'fullname', 'nome morador', 'nome do morador',
  'nome_morador', 'nome_completo'
];

const UNIT_ALIASES = [
  'residencia', 'residência', 'unidade', 'unid', 'unid.', 'unidades', 'unidade residencial', 'unid residencial',
  'residencial', 'residenciais', 'resid',
  'casa', 'casas', 'apartamento', 'apartamentos', 'apto', 'aptos', 'ap', 'apt', 'ap.', 'apt.',
  'numero', 'número', 'num', 'num.', 'nº', 'n°', 'n.', 'no', 'no.', 'nr', 'nr.', 'nro', 'nro.',
  'numero da unidade', 'numero da casa', 'numero do apartamento', 'numero do apto',
  'numero da residencia', 'numero do imovel', 'n casa', 'n unidade', 'n apto', 'n residencia', 'n imovel',
  'casa/apto', 'casa / apto', 'unidade/casa', 'unidade / casa', 'bloco/casa', 'bloco/apto', 'torre/casa', 'torre/apartamento',
  'lote', 'lotes', 'quadra', 'quadras', 'lote/quadra', 'quadra/lote',
  'endereco', 'endereço', 'endereco da unidade', 'endereço da unidade',
  'imovel', 'imóvel', 'imoveis', 'imóveis', 'identificacao', 'identificação',
  'unit', 'residence', 'apartment', 'house', 'unit_number', 'numero_unidade', 'unidade_residencial'
];

const BLOCK_ALIASES = [
  'bloco', 'block', 'bl', 'torre', 'tower', 'tr', 'quadra', 'qd', 'conjunto', 'alameda'
];

const PHONE_ALIASES = [
  'whatsapp', 'whats', 'zap', 'telefone', 'celular', 'telefone whatsapp', 'whatsapp/telefone',
  'telefone/whatsapp', 'contato', 'fone', 'tel', 'phone',
  'mobile', 'cel', 'telefone_morador', 'contato_whatsapp', 'telefone 1', 'celular 1',
  'tel 1', 'fone 1', 'whats 1', 'numero do celular', 'numero de telefone', 'numero whatsapp',
  'numero do whats', 'num celular', 'num telefone'
];

const OBS_ALIASES = [
  'observacao', 'observação', 'observacoes', 'observações', 'obs', 'obs.',
  'status', 'nota', 'notas', 'anotacao', 'anotação', 'anotacoes', 'anotações',
  'comentario', 'comentário', 'comentarios', 'comentários',
  'quality', 'comment', 'comments', 'observation', 'observations', 'notes', 'note'
];

/**
 * Corrige problemas de codificação/decodificação UTF-8 (mojibake)
 * Exemplos:
 * "JoÃ£o Silva" -> "João Silva"
 * "AndrÃ©" -> "André"
 * "MÃ¡rcia" -> "Márcia"
 * "JosÃ©" -> "José"
 * "ConceiÃ§Ã£o" -> "Conceição"
 */
export function fixUtf8Mojibake(str: any): string {
  if (str === null || str === undefined) return '';
  const text = String(str);
  if (!text) return '';

  // Se não contém caracteres marcadores de mojibake UTF-8 -> Latin1
  if (!/Ã|Â|â|ð/.test(text) && !/[\u00C0-\u00DF][\u0080-\u00BF]/.test(text)) {
    return text;
  }

  // Tenta reinterpretar bytes Latin-1 como UTF-8
  try {
    const bytes = new Uint8Array(text.length);
    let canDecode = true;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 255) {
        canDecode = false;
        break;
      }
      bytes[i] = code;
    }
    if (canDecode) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded && decoded !== text) {
        return decoded;
      }
    }
  } catch {
    // Ignora erro e recorre ao mapeamento estruturado
  }

  // Mapeamento explícito de contingência para pares clássicos de mojibake português
  return text
    .replace(/Ã£/g, 'ã')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã /g, 'à')
    .replace(/Ã¢/g, 'â')
    .replace(/Ã©/g, 'é')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã´/g, 'ô')
    .replace(/Ãµ/g, 'õ')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã/g, 'Á')
    .replace(/Ã€/g, 'À')
    .replace(/Ã‚/g, 'Â')
    .replace(/Ãƒ/g, 'Ã')
    .replace(/Ã‰/g, 'É')
    .replace(/ÃŠ/g, 'Ê')
    .replace(/Ã/g, 'Í')
    .replace(/Ã“/g, 'Ó')
    .replace(/Ã”/g, 'Ô')
    .replace(/Ã•/g, 'Õ')
    .replace(/Ãš/g, 'Ú')
    .replace(/Ã‡/g, 'Ç')
    .replace(/Âª/g, 'ª')
    .replace(/Âº/g, 'º');
}

/**
 * Identifica se uma determinada string é um número de telefone e NÃO uma residência.
 * Exemplos de telefones: "41994440000", "41991110003", "41991110001", "(41) 99111-0003", "+5541994440000"
 * Exemplos de residências legítimas: "426", "Casa 426", "AP 101", "BLOCO A/AP 101", "BLOCO 11/CASA 426", "TORRE 5/CASA 426"
 */
export function isLikelyPhoneNumber(value: any): boolean {
  if (value === null || value === undefined) return false;
  let str = String(value).trim();
  if (!str) return false;

  const upper = str.toUpperCase();
  // Se contiver palavras explícitas de residência ou rua/bloco/lote, não é apenas um telefone
  if (/\b(CASA|AP|APTO|APARTAMENTO|BLOCO|BL|TORRE|TR|LOTE|LT|QUADRA|QD|CONJUNTO|ALAMEDA|RUA|COND|CONDOMINIO)\b/.test(upper)) {
    return false;
  }

  // Se for notação científica (ex: 4.199111e+10)
  if (/[eE][+-]?\d+/.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && isFinite(num)) {
      str = BigInt(Math.round(num)).toString();
    }
  }

  // Extrai apenas dígitos
  let digits = str.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.substring(2);
  }

  // Se tiver 10 ou 11 dígitos numéricos puros (ex: 41994440000, 41991110003, 41991110001, 11987654321, 4133334444)
  if (digits.length === 10 || digits.length === 11) {
    const ddd = parseInt(digits.substring(0, 2), 10);
    // DDDs brasileiros válidos vão de 11 a 99
    if (!isNaN(ddd) && ddd >= 11 && ddd <= 99) {
      return true;
    }
  }

  // Formato com máscara de telefone brasileiro: (41) 99111-0003, 41 99111-0003, (11) 98765-4321, +55 41 99444-0000
  if (/^\+?55\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}$/.test(str) || /^\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}$/.test(str)) {
    return true;
  }

  // Mais de 8 dígitos puros sem letras (não é um número de casa normal)
  if (digits.length >= 8 && !/[a-zA-Z]/.test(str) && digits.length > 5) {
    return true;
  }

  return false;
}

/**
 * Normaliza strings para comparação de cabeçalhos
 */
export function normalizeHeader(header: string): string {
  if (!header) return '';
  return String(header)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, ' ') // remove caracteres especiais
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifica se um cabeçalho é claramente relacionado a telefone
 */
export function isPhoneHeader(header: string): boolean {
  const norm = normalizeHeader(header);
  if (!norm) return false;
  const phoneWords = ['telefone', 'celular', 'whatsapp', 'whats', 'zap', 'fone', 'phone', 'mobile', 'contato'];
  return phoneWords.some(w => norm === w || norm.startsWith(w + ' ') || norm.endsWith(' ' + w) || norm.includes(' ' + w + ' '));
}

/**
 * Encontra a melhor coluna correspondente baseada nos aliases
 */
export function findBestColumnMatch(headers: string[], aliases: string[], excludePhone = false): string {
  if (!headers || headers.length === 0) return '';

  const normalizedHeaders = headers.map(h => ({
    original: h,
    normalized: normalizeHeader(h),
    isPhone: isPhoneHeader(h)
  }));

  // Filtra se for para excluir colunas de telefone (ao procurar residência ou nome)
  const candidateHeaders = excludePhone
    ? normalizedHeaders.filter(h => !h.isPhone)
    : normalizedHeaders;

  // 1. Correspondência exata
  for (const alias of aliases) {
    const normAlias = normalizeHeader(alias);
    const match = candidateHeaders.find(h => h.normalized === normAlias);
    if (match) return match.original;
  }

  // 2. Correspondência de prefixo ou inclusão de palavra inteira
  for (const alias of aliases) {
    const normAlias = normalizeHeader(alias);
    const match = candidateHeaders.find(h => 
      h.normalized === normAlias ||
      h.normalized.startsWith(normAlias + ' ') ||
      h.normalized.endsWith(' ' + normAlias) ||
      h.normalized.includes(' ' + normAlias + ' ')
    );
    if (match) return match.original;
  }

  return '';
}

/**
 * Detecta automaticamente o mapeamento de colunas da planilha garantindo que
 * os campos (Nome, Residência, Telefone, Observação) nunca se misturem nem colidam.
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  let nameColumn = findBestColumnMatch(headers, NAME_ALIASES, true);
  let unitColumn = findBestColumnMatch(headers, UNIT_ALIASES, true);
  let phoneColumn = findBestColumnMatch(headers, PHONE_ALIASES, false);
  let blockColumn = findBestColumnMatch(headers, BLOCK_ALIASES, true);
  let obsColumn = findBestColumnMatch(headers, OBS_ALIASES, true);

  // Evita colisão entre colunas (telefone nunca pode ser atribuído como residência, nome ou observação)
  if (unitColumn && (unitColumn === phoneColumn || isPhoneHeader(unitColumn))) {
    unitColumn = '';
  }

  if (unitColumn && unitColumn === nameColumn) {
    const norm = normalizeHeader(unitColumn);
    const isName = NAME_ALIASES.some(a => norm.includes(normalizeHeader(a)));
    if (isName) {
      unitColumn = '';
    } else {
      nameColumn = '';
    }
  }

  if (nameColumn && (nameColumn === phoneColumn || isPhoneHeader(nameColumn))) {
    nameColumn = '';
  }

  if (obsColumn && (obsColumn === phoneColumn || obsColumn === unitColumn || obsColumn === nameColumn)) {
    obsColumn = '';
  }

  // Se o nome não foi detectado pelos aliases, tenta a primeira coluna não utilizada por telefone, unidade, bloco ou observação
  if (!nameColumn && headers.length > 0) {
    const candidate = headers.find(h => h !== phoneColumn && h !== unitColumn && h !== blockColumn && h !== obsColumn && !isPhoneHeader(h));
    if (candidate) nameColumn = candidate;
  }

  return {
    nameColumn: nameColumn || (headers[0] || ''),
    unitColumn: unitColumn || '',
    phoneColumn: phoneColumn || '',
    blockColumn: (blockColumn && blockColumn !== unitColumn && blockColumn !== nameColumn && blockColumn !== phoneColumn && blockColumn !== obsColumn) ? blockColumn : undefined,
    obsColumn: obsColumn || undefined
  };
}

/**
 * Limpa e formata o telefone/WhatsApp brasileiro preservando o número.
 * Trata números inteiros e notação científica de planilhas Excel (ex: "4.199111e+10").
 */
export function normalizePhoneNumber(rawPhone: any): string {
  if (rawPhone === null || rawPhone === undefined) return '';
  let str = String(rawPhone).trim();
  if (!str) return '';

  // Se for notação científica (ex: 4.199111e+10, 4.199888E10, etc.)
  if (/[eE][+-]?\d+/.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && isFinite(num)) {
      str = BigInt(Math.round(num)).toString();
    }
  }

  // Extrai apenas dígitos
  let digits = str.replace(/\D/g, '');

  // Se vier com DDI 55 (Brasil) e tiver 12 ou 13 dígitos
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.substring(2);
  }

  // Se tiver 10 ou 11 dígitos, formata elegantemente
  if (digits.length === 11) {
    // (DD) 9XXXX-XXXX
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  } else if (digits.length === 10) {
    // (DD) XXXX-XXXX
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`;
  } else if (digits.length >= 8 && digits.length <= 9) {
    // Apenas número local sem DDD
    return digits;
  } else if (digits.length > 0) {
    return str; // mantém o original se for formato internacional específico
  }

  return '';
}

/**
 * Preserva a identificação COMPLETA da residência sem reduzi-la simplesmente a número
 * Exemplos:
 * "CASA 426" -> "CASA 426"
 * "AP 426" -> "AP 426"
 * "BLOCO 11/CASA 426" -> "BLOCO 11/CASA 426"
 * "TORRE 5/CASA 426" -> "TORRE 5/CASA 426"
 * Bloco separado: Bloco "11" + Casa "426" -> "BLOCO 11 / CASA 426"
 */
export function formatFullResidence(rawUnit: any, rawBlock?: any): string {
  const unitStr = rawUnit !== null && rawUnit !== undefined ? String(rawUnit).trim() : '';
  const blockStr = rawBlock !== null && rawBlock !== undefined ? String(rawBlock).trim() : '';

  if (!unitStr && !blockStr) return '';

  // Se vierem em colunas separadas
  if (blockStr && unitStr) {
    const blockUpper = blockStr.toUpperCase();
    const unitUpper = unitStr.toUpperCase();

    // Se a unidade já contém a menção ao bloco, não duplica
    if (unitUpper.includes(blockUpper)) {
      return unitStr.trim();
    }

    const formattedBlock = blockUpper.startsWith('BLOCO') || blockUpper.startsWith('TORRE') || blockUpper.startsWith('QD') || blockUpper.startsWith('QUADRA')
      ? blockStr
      : `BLOCO ${blockStr}`;

    const formattedUnit = unitUpper.startsWith('AP') || unitUpper.startsWith('CASA') || unitUpper.startsWith('LT') || unitUpper.startsWith('LOTE')
      ? unitStr
      : unitStr;

    return `${formattedBlock} / ${formattedUnit}`.trim();
  }

  return unitStr;
}

/**
 * Lê o arquivo (.xlsx, .xls, .csv) e retorna os cabeçalhos e linhas brutas com codificação UTF-8 correta
 */
export async function readSpreadsheetFile(file: File): Promise<RawSpreadsheetData> {
  const buffer = await file.arrayBuffer();
  const fileName = file.name.toLowerCase();

  let workbook: XLSX.WorkBook;
  if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
    const bytes = new Uint8Array(buffer);
    let text: string;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      text = decoder.decode(bytes);
    } catch {
      const decoder = new TextDecoder('windows-1252');
      text = decoder.decode(bytes);
    }
    // Remove BOM se presente
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.substring(1);
    }
    workbook = XLSX.read(text, { type: 'string', raw: true, cellDates: true });
  } else {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, codepage: 65001 });
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('A planilha está vazia ou não possui abas válidas.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  // Converte para matriz de linhas para identificar cabeçalho
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('Nenhum dado encontrado na planilha.');
  }

  // Encontrar a primeira linha que contenha texto como cabeçalho
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i];
    if (Array.isArray(row) && row.some(cell => typeof cell === 'string' && cell.trim().length > 0)) {
      headerRowIndex = i;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex] || [];
  const headers = headerRow.map((h, idx) => {
    if (h !== undefined && h !== null && String(h).trim()) {
      return fixUtf8Mojibake(String(h).trim());
    }
    return `Coluna ${idx + 1}`;
  });

  const rows: Record<string, any>[] = [];
  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const rowArray = rawRows[i];
    if (!Array.isArray(rowArray) || rowArray.every(c => c === '' || c === null || c === undefined)) {
      continue; // Pula linhas vazias
    }

    const rowObj: Record<string, any> = {};
    headers.forEach((header, colIdx) => {
      const cellVal = rowArray[colIdx] !== undefined ? rowArray[colIdx] : '';
      rowObj[header] = typeof cellVal === 'string' ? fixUtf8Mojibake(cellVal.trim()) : cellVal;
    });
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    totalRows: rows.length
  };
}

/**
 * Processa as linhas da planilha extraindo SOMENTE Nome, Residência e Telefone
 * e descarta todos os outros campos da planilha.
 */
export function processRawResidents(
  rawData: RawSpreadsheetData,
  mapping: ColumnMapping,
  existingResidents: Morador[] = []
): ImportPreviewSummary {
  const records: ProcessedResident[] = [];
  let completeCount = 0;
  let pendingCount = 0;
  let inconsistentCount = 0;
  let duplicateCount = 0;

  // Mapa para checagem rápida de duplicidades existentes
  const existingMap = new Map<string, Morador>();
  const existingUnitMap = new Map<string, Morador>();
  const existingNameMap = new Map<string, Morador>();

  existingResidents.forEach(res => {
    const normName = (res.nome || '').trim().toLowerCase();
    const normUnit = (res.unidade || '').trim().toLowerCase();
    
    if (normName && normUnit) {
      existingMap.set(`${normName}:::${normUnit}`, res);
    }
    if (normUnit) {
      existingUnitMap.set(normUnit, res);
    }
    if (normName) {
      existingNameMap.set(normName, res);
    }
  });

  rawData.rows.forEach((row, index) => {
    // 1. Extração estrita apenas dos campos autorizados com saneamento UTF-8
    const rawName = mapping.nameColumn ? row[mapping.nameColumn] : undefined;
    const rawUnit = mapping.unitColumn ? row[mapping.unitColumn] : undefined;
    const rawBlock = mapping.blockColumn ? row[mapping.blockColumn] : undefined;
    const rawPhone = mapping.phoneColumn ? row[mapping.phoneColumn] : undefined;
    const rawObs = mapping.obsColumn ? row[mapping.obsColumn] : undefined;

    const nome = rawName !== null && rawName !== undefined ? fixUtf8Mojibake(String(rawName).trim()) : '';
    let unidade = formatFullResidence(rawUnit, rawBlock);
    const telefone = normalizePhoneNumber(rawPhone);
    const observacao = rawObs !== null && rawObs !== undefined ? fixUtf8Mojibake(String(rawObs).trim()) : '';

    // Validação de segurança anti-mistura: se a unidade for um telefone
    // Um telefone NUNCA pode ser utilizado como residência
    if (unidade) {
      if (isLikelyPhoneNumber(unidade)) {
        unidade = ''; // Telefone não pode ser interpretado como residência
      }
    }

    // 2. Validação e Classificação de Status
    const statusReasons: string[] = [];
    let status: ResidentRecordStatus = 'complete';

    // A residência é a âncora indispensável do cadastro
    if (!unidade || !unidade.trim()) {
      statusReasons.push('Inconsistente — Residência obrigatória');
      status = 'inconsistent';
    }

    // Se a residência for válida mas o nome estiver ausente, não descartamos o registro!
    if (unidade && (!nome || !nome.trim())) {
      status = 'pending';
      statusReasons.push(observacao ? `Nome ausente (${observacao})` : 'Nome não informado na planilha');
    }

    if (status !== 'inconsistent') {
      const cleanPhoneDigits = telefone.replace(/\D/g, '');
      if (!telefone || cleanPhoneDigits.length < 10) {
        status = 'pending';
        statusReasons.push(observacao ? `WhatsApp não informado (${observacao})` : 'WhatsApp/Telefone não informado');
      }
    }

    // 3. Detecção de Duplicidades
    let duplicateStatus: DuplicateStatus = 'new';
    let existingResident: Morador | undefined = undefined;

    const normName = nome.toLowerCase();
    const normUnit = unidade.toLowerCase();

    if (nome && unidade) {
      const exactMatch = existingMap.get(`${normName}:::${normUnit}`);
      if (exactMatch) {
        duplicateStatus = 'exact_duplicate';
        existingResident = exactMatch;
      } else if (existingUnitMap.has(normUnit)) {
        duplicateStatus = 'unit_occupied';
        existingResident = existingUnitMap.get(normUnit);
      } else if (existingNameMap.has(normName)) {
        duplicateStatus = 'name_exists';
        existingResident = existingNameMap.get(normName);
      }
    } else if (unidade && existingUnitMap.has(normUnit)) {
      duplicateStatus = 'unit_occupied';
      existingResident = existingUnitMap.get(normUnit);
    }

    if (duplicateStatus !== 'new') {
      duplicateCount++;
    }

    if (status === 'complete') completeCount++;
    else if (status === 'pending') pendingCount++;
    else inconsistentCount++;

    // Selecionado por padrão se for completo ou pendente com residência (inconsistentes sem residência desmarcados por padrão)
    const isSelected = status !== 'inconsistent' && duplicateStatus !== 'exact_duplicate' && Boolean(unidade && unidade.trim());

    records.push({
      id: `imp-${index}-${Date.now()}`,
      rawRowIndex: index + 1,
      nome,
      unidade,
      telefone,
      observacao,
      status,
      statusReasons,
      duplicateStatus,
      existingResidentId: existingResident?.id,
      existingResidentName: existingResident?.nome,
      existingResidentPhone: existingResident?.telefone,
      isSelected
    });
  });

  return {
    total: records.length,
    complete: completeCount,
    pending: pendingCount,
    inconsistent: inconsistentCount,
    duplicates: duplicateCount,
    selectedToImport: records.filter(r => r.isSelected).length,
    records
  };
}

/**
 * Executa a importação em lote para a tabela `moradores` do Supabase
 */
export async function executeResidentImport({
  condominiumId,
  records,
  duplicateStrategy,
  currentUser,
  importMode = 'teste',
  onProgress
}: {
  condominiumId: string;
  records: ProcessedResident[];
  duplicateStrategy: DuplicateStrategy;
  currentUser: { id: string; full_name: string; role: string };
  importMode?: ImportMode;
  onProgress?: (progress: { current: number; total: number; percentage: number }) => void;
}): Promise<{
  successCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
}> {
  if (!condominiumId) {
    throw new Error('Identificação do condomínio é obrigatória para a importação.');
  }

  // Filtra registros que o usuário selecionou para importar e que possuem residência válida (Residência é estritamente obrigatória!)
  const toProcess = records.filter(r => r.isSelected && r.status !== 'inconsistent' && r.unidade && r.unidade.trim());
  const total = toProcess.length;

  let successCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const toInsertList: any[] = [];
  const toUpdateList: { id: string; data: any }[] = [];

  for (const record of toProcess) {
    const modeObservacao = formatObservacoesWithMode(record.observacao, importMode);

    if (record.duplicateStatus === 'exact_duplicate') {
      if (duplicateStrategy === 'ignore_existing') {
        skippedCount++;
        continue;
      } else if (duplicateStrategy === 'update_existing' && record.existingResidentId) {
        // Atualiza telefone se houver novo telefone
        if (record.telefone) {
          toUpdateList.push({
            id: record.existingResidentId,
            data: {
              telefone: record.telefone,
              ativo: true,
              observacoes: modeObservacao
            }
          });
        } else {
          skippedCount++;
        }
        continue;
      }
    }

    // Inserção como novo morador com APENAS os dados autorizados e preservando observação + tag do modo
    const nomeFinal = record.nome && record.nome.trim()
      ? record.nome.trim()
      : (record.observacao && !record.observacao.toLowerCase().includes('modo') ? record.observacao : 'Morador');

    toInsertList.push({
      condominium_id: condominiumId,
      nome: nomeFinal,
      unidade: record.unidade,
      telefone: record.telefone || '',
      ativo: true,
      observacoes: modeObservacao
    });
  }

  // 1. Executa Inserções em Lotes (Chunks de 50)
  const CHUNK_SIZE = 50;
  for (let i = 0; i < toInsertList.length; i += CHUNK_SIZE) {
    const chunk = toInsertList.slice(i, i + CHUNK_SIZE);
    try {
      const { data, error } = await supabase
        .from('moradores')
        .insert(chunk)
        .select('id');

      if (error) {
        throw error;
      }

      successCount += data ? data.length : chunk.length;
    } catch (err: any) {
      console.error('Erro ao inserir lote de moradores:', err);
      errors.push(`Erro no lote ${Math.floor(i / CHUNK_SIZE) + 1}: ${err.message || 'Falha de gravação'}`);
    }

    if (onProgress) {
      const current = Math.min(i + CHUNK_SIZE, toInsertList.length);
      onProgress({
        current,
        total,
        percentage: Math.round((current / total) * 100)
      });
    }
  }

  // 2. Executa Atualizações (se houver)
  for (const item of toUpdateList) {
    try {
      const { error } = await supabase
        .from('moradores')
        .update(item.data)
        .eq('id', item.id);

      if (error) throw error;
      updatedCount++;
    } catch (err: any) {
      errors.push(`Erro ao atualizar morador ID ${item.id}: ${err.message}`);
    }
  }

  // 3. Grava Trilha de Auditoria
  try {
    await registrarAuditoria({
      condominio_id: condominiumId,
      usuario_id: currentUser.id,
      usuario_nome: currentUser.full_name,
      usuario_perfil: currentUser.role,
      tipo_evento: 'IMPORTACAO_MORADORES',
      acao: 'CREATE',
      tabela_afetada: 'moradores',
      registro_id: condominiumId,
      descricao: `Importação de moradores via planilha (${importMode === 'teste' ? '🧪 MODO TESTE' : '🟢 MODO REAL'}): ${successCount} inseridos, ${updatedCount} atualizados, ${skippedCount} ignorados.`,
      metodo: 'PLANILHA',
      dados_depois: {
        totalProcessados: total,
        modo_importacao: importMode,
        inseridos: successCount,
        atualizados: updatedCount,
        ignorados: skippedCount,
        estrategiaDuplicidade: duplicateStrategy
      }
    });
  } catch (auditErr) {
    console.warn('Erro ao registrar log de auditoria da importação:', auditErr);
  }

  return {
    successCount,
    updatedCount,
    skippedCount,
    errors
  };
}

/**
 * Gera e baixa uma planilha modelo (.xlsx) com exemplos completos
 */
export function downloadSampleSpreadsheet(): void {
  const sampleData = [
    {
      'Nome Completo': 'João Silva',
      'Residência / Unidade': 'CASA 426',
      'WhatsApp / Telefone': '(11) 98765-4321'
    },
    {
      'Nome Completo': 'Maria Souza',
      'Residência / Unidade': 'AP 426',
      'WhatsApp / Telefone': '(11) 99876-5432'
    },
    {
      'Nome Completo': 'Carlos Oliveira',
      'Residência / Unidade': 'BLOCO 11/CASA 426',
      'WhatsApp / Telefone': '(11) 97654-3210'
    },
    {
      'Nome Completo': 'Ana Santos',
      'Residência / Unidade': 'TORRE 5/CASA 426',
      'WhatsApp / Telefone': '(11) 96543-2109'
    },
    {
      'Nome Completo': 'Lucas Pereira',
      'Residência / Unidade': 'BLOCO B AP 102',
      'WhatsApp / Telefone': '' // Exemplo de morador pendente (sem whatsapp)
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  
  // Ajuste de largura das colunas
  ws['!cols'] = [
    { wch: 25 },
    { wch: 25 },
    { wch: 20 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Moradores');
  XLSX.writeFile(wb, 'modelo_importacao_moradores.xlsx');
}
