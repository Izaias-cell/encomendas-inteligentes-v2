import { Profile } from '../types';

export interface PlantaoAtivo {
  id: string;
  condominium_id: string;
  porteiro_id: string;
  porteiro_nome: string;
  horario_inicio?: string;
  horario_fim?: string;
  started_at: string;
  substituicao?: {
    is_substituicao: boolean;
    substituido_id?: string;
    substituido_nome?: string;
    motivo?: string;
    observacoes?: string;
  };
}

const PLANTAO_KEY = 'encomendas_plantao_ativo';

/**
 * Valida se um determinado horário atual está dentro do intervalo do turno.
 * Suporta escalas que atravessam a meia-noite (ex: 18:00 às 06:00, 19:00 às 07:00).
 */
export const isTimeInShift = (now: Date, inicioStr?: string, fimStr?: string): boolean => {
  if (!inicioStr || !fimStr) return true; // Se não configurado, considera liberado para todos os horários

  const [hIni, mIni] = inicioStr.split(':').map(Number);
  const [hFim, mFim] = fimStr.split(':').map(Number);

  if (isNaN(hIni) || isNaN(mIni) || isNaN(hFim) || isNaN(mFim)) return true;

  const inicioMin = hIni * 60 + mIni;
  const fimMin = hFim * 60 + mFim;
  const currentMin = now.getHours() * 60 + now.getMinutes();

  if (inicioMin < fimMin) {
    // Turno no mesmo dia (ex: 07:00 às 19:00)
    return currentMin >= inicioMin && currentMin < fimMin;
  } else if (inicioMin > fimMin) {
    // Turno atravessa a meia-noite (ex: 19:00 às 07:00, 18:00 às 06:00, 20:00 às 08:00)
    return currentMin >= inicioMin || currentMin < fimMin;
  } else {
    // 24 horas (00:00 às 00:00)
    return true;
  }
};

/**
 * Retorna o plantão ativo salvo no localStorage com validação do condomínio.
 */
export const getActivePlantao = (currentCondoId?: string): PlantaoAtivo | null => {
  try {
    const raw = localStorage.getItem(PLANTAO_KEY);
    if (!raw) return null;
    const parsed: PlantaoAtivo = JSON.parse(raw);
    if (!parsed) return null;
    
    // Isolamento de condomínio: se o ID do condomínio ativo for diferente do plantão salvo, descarta
    if (currentCondoId && parsed.condominium_id && parsed.condominium_id !== currentCondoId) {
      clearActivePlantao();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Salva o plantão ativo vinculado ao condomínio.
 */
export const setActivePlantao = (plantao: PlantaoAtivo): void => {
  localStorage.setItem(PLANTAO_KEY, JSON.stringify(plantao));
  localStorage.setItem('porteiro_manual', JSON.stringify({
    name: plantao.porteiro_nome,
    condominium_id: plantao.condominium_id
  }));
};

/**
 * Limpa o plantão ativo.
 */
export const clearActivePlantao = (): void => {
  localStorage.removeItem(PLANTAO_KEY);
  localStorage.removeItem('porteiro_manual');
};

/**
 * Verifica se o plantão atual está expirado em relação ao horário de agora.
 */
export const isPlantaoExpired = (plantao: PlantaoAtivo | null, now: Date = new Date()): boolean => {
  if (!plantao) return true;
  if (!plantao.horario_inicio || !plantao.horario_fim) return false;
  return !isTimeInShift(now, plantao.horario_inicio, plantao.horario_fim);
};

/**
 * Opções de Presets rápidos de horário de portaria
 */
export const SHIFT_PRESETS = [
  { label: '06:00 às 18:00', inicio: '06:00', fim: '18:00' },
  { label: '18:00 às 06:00', inicio: '18:00', fim: '06:00' },
  { label: '07:00 às 19:00', inicio: '07:00', fim: '19:00' },
  { label: '19:00 às 07:00', inicio: '19:00', fim: '07:00' },
  { label: '08:00 às 20:00', inicio: '08:00', fim: '20:00' },
  { label: '20:00 às 08:00', inicio: '20:00', fim: '08:00' },
  { label: 'Horário Personalizado', inicio: 'custom', fim: 'custom' }
];
