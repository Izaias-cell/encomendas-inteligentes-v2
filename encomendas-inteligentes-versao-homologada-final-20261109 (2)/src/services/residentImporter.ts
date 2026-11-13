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
}

export type ResidentRecordStatus = 'complete' | 'pending' | 'inconsistent';

export type DuplicateStatus = 'new' | 'exact_duplicate' | 'unit_occupied' | 'name_exists';

export interface ProcessedResident {
  id: string; // temporary client UUID
  rawRowIndex: number;
  nome: string;
  unidade: string;
  telefone: string;
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
  'unidade', 'residencia', 'residência', 'casa', 'apartamento', 'apto', 'ap',
  'imovel', 'imóvel', 'casa/apto', 'unidade/casa', 'identificacao', 'identificação',
  'bloco/casa', 'bloco/apto', 'torre/casa', 'torre/apartamento', 'lote', 'quadra',
  'endereco', 'endereço', 'endereco da unidade', 'endereço da unidade',
  'unit', 'residence', 'apartment', 'house', 'unit_number', 'numero_unidade'
];

const BLOCK_ALIASES = [
  'bloco', 'block', 'bl', 'torre', 'tower', 'tr', 'quadra', 'qd', 'conjunto', 'alameda'
];

const PHONE_ALIASES = [
  'whatsapp', 'whats', 'zap', 'telefone', 'celular', 'telefone whatsapp', 'whatsapp/telefone',
  'telefone/whatsapp', 'contato', 'numero', 'número', 'fone', 'tel', 'phone',
  'mobile', 'cel', 'telefone_morador', 'contato_whatsapp', 'telefone 1', 'celular 1'
];

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
 * Encontra a melhor coluna correspondente baseada nos aliases
 */
export function findBestColumnMatch(headers: string[], aliases: string[]): string {
  if (!headers || headers.length === 0) return '';

  const normalizedHeaders = headers.map(h => ({
    original: h,
    normalized: normalizeHeader(h)
  }));

  // 1. Correspondência exata
  for (const alias of aliases) {
    const normAlias = normalizeHeader(alias);
    const match = normalizedHeaders.find(h => h.normalized === normAlias);
    if (match) return match.original;
  }

  // 2. Correspondência parcial (início ou inclusão)
  for (const alias of aliases) {
    const normAlias = normalizeHeader(alias);
    const match = normalizedHeaders.find(h => 
      h.normalized.includes(normAlias) || normAlias.includes(h.normalized)
    );
    if (match) return match.original;
  }

  return '';
}

/**
 * Detecta automaticamente o mapeamento de colunas da planilha
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const nameColumn = findBestColumnMatch(headers, NAME_ALIASES);
  const unitColumn = findBestColumnMatch(headers, UNIT_ALIASES);
  const phoneColumn = findBestColumnMatch(headers, PHONE_ALIASES);
  const blockColumn = findBestColumnMatch(headers, BLOCK_ALIASES);

  return {
    nameColumn: nameColumn || (headers[0] || ''),
    unitColumn: unitColumn || (headers[1] || ''),
    phoneColumn: phoneColumn || (headers[2] || ''),
    blockColumn: (blockColumn && blockColumn !== unitColumn) ? blockColumn : undefined
  };
}

/**
 * Limpa e formata o telefone/WhatsApp brasileiro preservando o número
 */
export function normalizePhoneNumber(rawPhone: any): string {
  if (rawPhone === null || rawPhone === undefined) return '';
  const str = String(rawPhone).trim();
  if (!str) return '';

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
 * Lê o arquivo (.xlsx, .xls, .csv) e retorna os cabeçalhos e linhas brutas
 */
export async function readSpreadsheetFile(file: File): Promise<RawSpreadsheetData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

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
  const headers = headerRow.map((h, idx) => (h !== undefined && h !== null && String(h).trim()) ? String(h).trim() : `Coluna ${idx + 1}`);

  const rows: Record<string, any>[] = [];
  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const rowArray = rawRows[i];
    if (!Array.isArray(rowArray) || rowArray.every(c => c === '' || c === null || c === undefined)) {
      continue; // Pula linhas vazias
    }

    const rowObj: Record<string, any> = {};
    headers.forEach((header, colIdx) => {
      rowObj[header] = rowArray[colIdx] !== undefined ? rowArray[colIdx] : '';
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
    // 1. Extração estrita apenas dos campos autorizados
    const rawName = row[mapping.nameColumn];
    const rawUnit = row[mapping.unitColumn];
    const rawBlock = mapping.blockColumn ? row[mapping.blockColumn] : undefined;
    const rawPhone = row[mapping.phoneColumn];

    const nome = rawName !== null && rawName !== undefined ? String(rawName).trim() : '';
    const unidade = formatFullResidence(rawUnit, rawBlock);
    const telefone = normalizePhoneNumber(rawPhone);

    // 2. Validação e Classificação de Status
    const statusReasons: string[] = [];
    let status: ResidentRecordStatus = 'complete';

    if (!unidade || !unidade.trim()) {
      statusReasons.push('Inconsistente — Residência obrigatória');
      status = 'inconsistent';
    }

    if (!nome || !nome.trim()) {
      statusReasons.push('Nome ausente');
      status = 'inconsistent';
    }

    if (status !== 'inconsistent') {
      const cleanPhoneDigits = telefone.replace(/\D/g, '');
      if (!telefone || cleanPhoneDigits.length < 10) {
        status = 'pending';
        statusReasons.push('WhatsApp/Telefone não informado ou incompleto');
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
    }

    if (duplicateStatus !== 'new') {
      duplicateCount++;
    }

    if (status === 'complete') completeCount++;
    else if (status === 'pending') pendingCount++;
    else inconsistentCount++;

    // Selecionado por padrão se for completo ou pendente (inconsistentes desmarcados por padrão)
    const isSelected = status !== 'inconsistent' && duplicateStatus !== 'exact_duplicate';

    records.push({
      id: `imp-${index}-${Date.now()}`,
      rawRowIndex: index + 1,
      nome,
      unidade,
      telefone,
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

  // Filtra registros que o usuário selecionou para importar e que possuem dados válidos (Residência é estritamente obrigatória!)
  const toProcess = records.filter(r => r.isSelected && r.status !== 'inconsistent' && r.nome && r.nome.trim() && r.unidade && r.unidade.trim());
  const total = toProcess.length;

  let successCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const toInsertList: any[] = [];
  const toUpdateList: { id: string; data: any }[] = [];

  const modeObservacao = formatObservacoesWithMode(null, importMode);

  for (const record of toProcess) {
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

    // Inserção como novo morador com APENAS os dados autorizados e tag do modo
    toInsertList.push({
      condominium_id: condominiumId,
      nome: record.nome,
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
