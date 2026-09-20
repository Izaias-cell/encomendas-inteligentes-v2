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
 * Verifica se o plantão atual está expirado em relação ao horário e data de início de agora.
 * 
 * Regras de Expiração:
 * 1. Se não houver plantão ou horários não estiverem preenchidos -> expirado.
 * 2. Se o plantão foi iniciado há mais de 24 horas -> expirado.
 * 3. Se o horário atual saiu da janela do turno (isTimeInShift) -> expirado.
 * 4. Comparação da Data de Início da Escala:
 *    Se a data de início do plantão salvo for diferente da data de início esperada
 *    para o turno no momento atual (getShiftStartDate), o plantão salvo expira imediatamente.
 */
export const isPlantaoExpired = (plantao: PlantaoAtivo | null, now: Date = new Date()): boolean => {
  if (!plantao) return true;
  if (!plantao.horario_inicio || !plantao.horario_fim) return false;

  // 1. Se o plantão foi iniciado há mais de 24 horas, está obrigatoriamente expirado
  if (plantao.started_at) {
    const started = new Date(plantao.started_at).getTime();
    if (!isNaN(started) && (now.getTime() - started) > 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  // 2. Verifica se o horário atual está dentro da janela do turno
  if (!isTimeInShift(now, plantao.horario_inicio, plantao.horario_fim)) {
    return true;
  }

  // 3. Validação rigorosa da data de início do plantão salvo vs data esperada para o momento atual
  if (plantao.started_at) {
    const startedDate = new Date(plantao.started_at);
    if (!isNaN(startedDate.getTime())) {
      const savedShiftStartDate = getShiftStartDate(startedDate, plantao.horario_inicio, plantao.horario_fim);
      const expectedShiftStartDate = getShiftStartDate(now, plantao.horario_inicio, plantao.horario_fim);

      const isSameDate = (
        savedShiftStartDate.getFullYear() === expectedShiftStartDate.getFullYear() &&
        savedShiftStartDate.getMonth() === expectedShiftStartDate.getMonth() &&
        savedShiftStartDate.getDate() === expectedShiftStartDate.getDate()
      );

      if (!isSameDate) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Retorna a data de início (referência) do plantão para o momento avaliado.
 * 
 * Regra Crítica do Plantão Noturno (ex: 19:00 às 07:00 onde inicioMin > fimMin):
 * - Na madrugada (entre 00:00 e antes do horário de término, ex: < 07:00),
 *   o plantão em andamento começou na noite do dia anterior (D - 1).
 *   Logo, a data de referência é D - 1.
 * - No período noturno inicial (a partir de 19:00 até 23:59),
 *   o plantão iniciou no próprio dia atual (D).
 * 
 * Para turnos diurnos (ex: 07:00 às 19:00 onde inicioMin < fimMin):
 * - A data de referência é sempre o próprio dia atual (D).
 */
export const getShiftStartDate = (now: Date = new Date(), inicioStr?: string, fimStr?: string): Date => {
  const ref = new Date(now);
  if (!inicioStr || !fimStr) return ref;

  const [hIni, mIni] = inicioStr.split(':').map(Number);
  const [hFim, mFim] = fimStr.split(':').map(Number);
  if (isNaN(hIni) || isNaN(mIni) || isNaN(hFim) || isNaN(mFim)) return ref;

  const inicioMin = hIni * 60 + mIni;
  const fimMin = hFim * 60 + mFim;
  const currentMin = now.getHours() * 60 + now.getMinutes();

  // Plantão noturno atravessando a meia-noite
  if (inicioMin > fimMin) {
    if (currentMin < fimMin) {
      // Madrugada posterior ao início: o plantão começou no dia anterior
      ref.setDate(ref.getDate() - 1);
    }
  }

  return ref;
};

/**
 * Retorna a paridade ('impar' ou 'par') do dia da data de início do plantão.
 */
export const getShiftDayParity = (shiftStartDate: Date): 'impar' | 'par' => {
  const day = shiftStartDate.getDate();
  return (day % 2 !== 0) ? 'impar' : 'par';
};

/**
 * Verifica se um porteiro específico é elegível para o plantão no horário fornecido.
 * 
 * Regras:
 * 1. Role porteiro
 * 2. Ativo (!== false)
 * 3. Horários de início e fim preenchidos e válidos
 * 4. Horário atual dentro da janela do turno (isTimeInShift)
 * 5. Se não possuir escala_tipo definida (legado/vazio), retorna false para evitar suposições
 * 6. Se escala_tipo for 'todos', é elegível em qualquer dia
 * 7. Se escala_tipo for 'impar' ou 'par', calcula a data de início do plantão e compara a paridade
 */
export const isPorterEligibleForShift = (
  porteiro: Profile,
  now: Date = new Date()
): boolean => {
  if (!porteiro) return false;
  if (porteiro.role !== 'porteiro') return false;
  if (porteiro.active === false) return false;
  if (!porteiro.horario_inicio || !porteiro.horario_fim) return false;

  // Valida o horário dentro do turno
  if (!isTimeInShift(now, porteiro.horario_inicio, porteiro.horario_fim)) {
    return false;
  }

  // Se não tem escala definida, não auto-elege (mantém seleção manual)
  if (!porteiro.escala_tipo) {
    return false;
  }

  // Se for diário / todos os dias
  if (porteiro.escala_tipo === 'todos') {
    return true;
  }

  // Determina a data em que este plantão específico começou
  const shiftStartDate = getShiftStartDate(now, porteiro.horario_inicio, porteiro.horario_fim);
  const shiftParity = getShiftDayParity(shiftStartDate);

  return porteiro.escala_tipo === shiftParity;
};

export interface ShiftDeterminationResult {
  eligiblePorter: Profile | null;
  count: number;
  allEligible: Profile[];
}

/**
 * Localiza o porteiro elegível entre uma lista de porteiros cadastrados.
 * 
 * Comportamento de Segurança:
 * - Se count === 1: retorna o único porteiro elegível.
 * - Se count === 0 ou count >= 2: retorna eligiblePorter: null, forçando seleção manual segura.
 */
export const findEligiblePorterForShift = (
  porteiros: Profile[],
  now: Date = new Date(),
  targetCondominiumId?: string
): ShiftDeterminationResult => {
  if (!Array.isArray(porteiros) || porteiros.length === 0) {
    return { eligiblePorter: null, count: 0, allEligible: [] };
  }

  const eligibleList = porteiros.filter(p => {
    if (targetCondominiumId && p.condominium_id && p.condominium_id !== targetCondominiumId) {
      return false;
    }
    return isPorterEligibleForShift(p, now);
  });

  return {
    eligiblePorter: eligibleList.length === 1 ? eligibleList[0] : null,
    count: eligibleList.length,
    allEligible: eligibleList
  };
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
