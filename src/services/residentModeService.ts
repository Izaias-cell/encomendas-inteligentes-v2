import { Morador, Profile } from '../types';

export type ImportMode = 'teste' | 'real';

export const TAG_MODO_TESTE = '[MODO_TESTE]';
export const TAG_MODO_REAL = '[MODO_REAL]';

/**
 * Identifica se um morador pertence a uma importação em MODO TESTE
 * Checa de forma multi-camada: flag is_teste, tag [MODO_TESTE] em observações ou nome.
 */
export function isTestResident(resident?: Partial<Morador> | Partial<Profile> | null): boolean {
  if (!resident) return false;
  
  if (resident.is_teste === true) return true;
  if ((resident as any).modo_importacao === 'teste') return true;
  if ((resident as any).import_mode === 'teste') return true;

  const obs = String((resident as any).observacoes || '');
  if (obs.includes(TAG_MODO_TESTE) || obs.includes('[TESTE]') || obs.toUpperCase().includes('MODO_TESTE')) {
    return true;
  }

  // Verifica se o nome possui marcador explícito de teste
  const nome = String((resident as any).nome || (resident as any).full_name || '').toLowerCase();
  if (nome.includes('(teste)') || nome.includes('[teste]')) {
    return true;
  }

  return false;
}

/**
 * Retorna o modo de importação do morador ('teste' ou 'real')
 */
export function getResidentImportMode(resident?: Partial<Morador> | Partial<Profile> | null): ImportMode {
  return isTestResident(resident) ? 'teste' : 'real';
}

/**
 * Formata o campo de observações associando a tag do modo de importação
 */
export function formatObservacoesWithMode(
  currentObservacoes: string | null | undefined,
  mode: ImportMode
): string {
  const cleanObs = (currentObservacoes || '')
    .replace(TAG_MODO_TESTE, '')
    .replace(TAG_MODO_REAL, '')
    .trim();

  const tag = mode === 'teste' ? TAG_MODO_TESTE : TAG_MODO_REAL;
  return cleanObs ? `${tag} ${cleanObs}` : tag;
}
