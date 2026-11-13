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

export interface BrasiliaDateParts {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Retorna os componentes exatos de data e hora no Fuso Horário Oficial de Brasília (America/Sao_Paulo).
 * Garante que a determinação de turnos, escalas pares/ímpares e dias da semana seja imune
 * a discrepâncias de fuso horário do dispositivo (UTC, servidores internacionais ou navegadores externos).
 */
export const getBrasiliaDateParts = (d: Date = new Date()): BrasiliaDateParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let day = d.getDate();
  let hours = d.getHours();
  let minutes = d.getMinutes();
  let seconds = d.getSeconds();

  for (const p of parts) {
    if (p.type === 'year') year = parseInt(p.value, 10);
    if (p.type === 'month') month = parseInt(p.value, 10);
    if (p.type === 'day') day = parseInt(p.value, 10);
    if (p.type === 'hour') hours = parseInt(p.value, 10);
    if (p.type === 'minute') minutes = parseInt(p.value, 10);
    if (p.type === 'second') seconds = parseInt(p.value, 10);
  }

  if (hours === 24) hours = 0;

  // Meio-dia em UTC (15:00 UTC = 12:00 BRT) para calcular o dia da semana com precisão absoluta
  const middayUtc = new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
  const dayOfWeek = middayUtc.getUTCDay();

  return { year, month, day, dayOfWeek, hours, minutes, seconds };
};

/**
 * Valida se um determinado momento (em horário de Brasília) está dentro do intervalo do turno.
 * Suporta escalas que atravessam a meia-noite (ex: 18:00 às 06:00, 19:00 às 07:00, 20:00 às 08:00).
 */
export const isTimeInShift = (now: Date, inicioStr?: string, fimStr?: string): boolean => {
  if (!inicioStr || !fimStr) return true; // Se não configurado, considera liberado para todos os horários

  const [hIni, mIni] = inicioStr.split(':').map(Number);
  const [hFim, mFim] = fimStr.split(':').map(Number);

  if (isNaN(hIni) || isNaN(mIni) || isNaN(hFim) || isNaN(mFim)) return true;

  const inicioMin = hIni * 60 + mIni;
  const fimMin = hFim * 60 + mFim;

  const { hours, minutes } = getBrasiliaDateParts(now);
  const currentMin = hours * 60 + minutes;

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
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PLANTAO_KEY);
    if (!raw) return null;
    const parsed: PlantaoAtivo = JSON.parse(raw);
    if (!parsed) return null;
    
    // Isolamento de condomínio estrito: se o condomínio ativo estiver definido, exige correspondência exata
    if (currentCondoId) {
      if (!parsed.condominium_id || parsed.condominium_id !== currentCondoId) {
        clearActivePlantao();
        return null;
      }
    }

    // Validação de expiração: se o plantão salvo expirou, descarta e limpa
    if (isPlantaoExpired(parsed, new Date())) {
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
  if (typeof localStorage === 'undefined') return;
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
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PLANTAO_KEY);
  localStorage.removeItem('porteiro_manual');
};

/**
 * Retorna os componentes da data de início (referência) do plantão no Fuso Horário de Brasília.
 * 
 * Regra do Plantão Noturno que atravessa a meia-noite (ex: 19:00 às 07:00 onde inicioMin > fimMin):
 * - Na madrugada (entre 00:00 e antes do horário de término, ex: < 07:00),
 *   o plantão em andamento iniciou na noite do dia anterior (D - 1).
 *   Logo, a data e a paridade de referência pertencem a D - 1.
 * - No período noturno inicial (a partir de 19:00 até 23:59),
 *   o plantão iniciou no próprio dia atual (D).
 * 
 * Para turnos diurnos (ex: 07:00 às 19:00 onde inicioMin < fimMin):
 * - A data de referência é sempre o próprio dia atual (D).
 */
export const getShiftStartDate = (now: Date = new Date(), inicioStr?: string, fimStr?: string): BrasiliaDateParts => {
  const parts = getBrasiliaDateParts(now);
  if (!inicioStr || !fimStr) return parts;

  const [hIni, mIni] = inicioStr.split(':').map(Number);
  const [hFim, mFim] = fimStr.split(':').map(Number);
  if (isNaN(hIni) || isNaN(mIni) || isNaN(hFim) || isNaN(mFim)) return parts;

  const inicioMin = hIni * 60 + mIni;
  const fimMin = hFim * 60 + mFim;
  const currentMin = parts.hours * 60 + parts.minutes;

  // Plantão noturno atravessando a meia-noite
  if (inicioMin > fimMin) {
    if (currentMin < fimMin) {
      // Madrugada posterior ao início: o plantão começou no dia anterior
      const prevUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1, 15, 0, 0));
      return getBrasiliaDateParts(prevUtc);
    }
  }

  return parts;
};

/**
 * Retorna a paridade ('impar' ou 'par') do dia da data de início do plantão em Brasília.
 */
export const getShiftDayParity = (shiftStart: BrasiliaDateParts | Date): 'impar' | 'par' => {
  const day = 'day' in shiftStart ? shiftStart.day : getBrasiliaDateParts(shiftStart).day;
  return (day % 2 !== 0) ? 'impar' : 'par';
};

export type EscalaNormalizada = 
  | { tipo: 'impar' }
  | { tipo: 'par' }
  | { tipo: 'todos' }
  | { tipo: 'dias_semana'; dias: number[] }; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

/**
 * Analisa a escala cadastrada para o porteiro, com suporte a:
 * - 'impar' (dias ímpares da escala 12x36)
 * - 'par' (dias pares da escala 12x36)
 * - 'todos' (diário / todos os dias)
 * - Dias da semana (ex: 'segunda a sexta', 'seg a sab', 'final de semana', ou dias específicos)
 */
export const parseEscalaTipo = (escala?: string | null): EscalaNormalizada | null => {
  if (!escala) return null;
  const clean = escala.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (clean.includes('impar')) return { tipo: 'impar' };
  if (clean.includes('par') && !clean.includes('compart')) return { tipo: 'par' };
  if (clean.includes('todo') || clean.includes('diari') || clean.includes('24h') || clean === 'todos') {
    return { tipo: 'todos' };
  }

  // Dias da semana específicos
  if (clean.includes('segunda a sexta') || clean.includes('seg a sex') || clean.includes('dias uteis')) {
    return { tipo: 'dias_semana', dias: [1, 2, 3, 4, 5] };
  }
  if (clean.includes('segunda a sabado') || clean.includes('seg a sab')) {
    return { tipo: 'dias_semana', dias: [1, 2, 3, 4, 5, 6] };
  }
  if (clean.includes('fim de semana') || clean.includes('final de semana') || (clean.includes('sab') && clean.includes('dom'))) {
    return { tipo: 'dias_semana', dias: [0, 6] };
  }

  // Dias individuais
  const diasDetectados: number[] = [];
  if (clean.includes('domingo') || clean.includes('dom')) diasDetectados.push(0);
  if (clean.includes('segunda') || clean.includes('seg')) diasDetectados.push(1);
  if (clean.includes('terca') || clean.includes('ter')) diasDetectados.push(2);
  if (clean.includes('quarta') || clean.includes('qua')) diasDetectados.push(3);
  if (clean.includes('quinta') || clean.includes('qui')) diasDetectados.push(4);
  if (clean.includes('sexta') || clean.includes('sex')) diasDetectados.push(5);
  if (clean.includes('sabado') || clean.includes('sab')) diasDetectados.push(6);

  if (diasDetectados.length > 0) {
    return { tipo: 'dias_semana', dias: Array.from(new Set(diasDetectados)) };
  }

  return null;
};

export const normalizeEscalaTipo = (escala?: string | null): 'impar' | 'par' | 'todos' | null => {
  const parsed = parseEscalaTipo(escala);
  if (!parsed) return null;
  if (parsed.tipo === 'impar' || parsed.tipo === 'par' || parsed.tipo === 'todos') {
    return parsed.tipo;
  }
  return null;
};

/**
 * Retorna a escala efetiva do porteiro cadastrado no sistema.
 * Não utiliza nomes hardcoded ou informações de outros condomínios,
 * garantindo estrita separação e segurança entre condomínios.
 */
export const getEffectiveEscalaTipo = (porteiro: Profile): 'impar' | 'par' | 'todos' | null => {
  return normalizeEscalaTipo(porteiro.escala_tipo);
};

/**
 * Verifica se o plantão atual está expirado em relação ao horário e data de início de agora (em horário de Brasília).
 * 
 * Regras de Expiração:
 * 1. Se não houver plantão ou horários não estiverem preenchidos -> expirado.
 * 2. Se o plantão foi iniciado há mais de 24 horas -> expirado.
 * 3. Se o horário atual em Brasília saiu da janela do turno (isTimeInShift) -> expirado.
 * 4. Comparação da Data de Início da Escala:
 *    Se a data de início do plantão salvo for diferente da data de início esperada
 *    para o turno no momento atual (getShiftStartDate), o plantão salvo expira imediatamente.
 */
export const isPlantaoExpired = (plantao: PlantaoAtivo | null, now: Date = new Date()): boolean => {
  if (!plantao) return true;
  if (!plantao.horario_inicio || !plantao.horario_fim) return true;

  // 1. Se o plantão foi iniciado há mais de 24 horas, está obrigatoriamente expirado
  if (plantao.started_at) {
    const started = new Date(plantao.started_at).getTime();
    if (!isNaN(started) && (now.getTime() - started) > 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  // 2. Verifica se o horário atual em Brasília está dentro da janela do turno
  if (!isTimeInShift(now, plantao.horario_inicio, plantao.horario_fim)) {
    return true;
  }

  // 3. Validação rigorosa da data de início do plantão salvo vs data esperada para o momento atual (ambas em Brasília)
  if (plantao.started_at) {
    const startedDate = new Date(plantao.started_at);
    if (!isNaN(startedDate.getTime())) {
      const savedStart = getShiftStartDate(startedDate, plantao.horario_inicio, plantao.horario_fim);
      const expectedStart = getShiftStartDate(now, plantao.horario_inicio, plantao.horario_fim);

      const isSameDate = (
        savedStart.year === expectedStart.year &&
        savedStart.month === expectedStart.month &&
        savedStart.day === expectedStart.day
      );

      if (!isSameDate) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Verifica se um porteiro específico é elegível para o plantão no horário fornecido.
 * 
 * Regras Estritas da Escala Cadastrada:
 * 1. Role porteiro e ativo (!== false)
 * 2. Horários de início e fim preenchidos e válidos
 * 3. Horário atual em Brasília dentro da janela do turno (isTimeInShift)
 * 4. Validação da Data Real de Início do Turno:
 *    - Turno diurno (07:00 às 19:00): inicia no próprio dia às 07:00.
 *    - Turno noturno (19:00 às 07:00): inicia às 19:00. Na madrugada (00:00–06:59),
 *      pertence ao dia anterior, mantendo a paridade e o dia de início da noite.
 * 5. Comparação da escala cadastrada do porteiro:
 *    - 'par' com 'par'
 *    - 'impar' com 'impar'
 *    - 'todos' com qualquer dia
 *    - Dias da semana (ex: 'segunda a sexta', 'final de semana', etc.)
 */
export const isPorterEligibleForShift = (
  porteiro: Profile,
  now: Date = new Date(),
  _allPorteirosInCondo?: Profile[]
): boolean => {
  if (!porteiro) return false;
  if (porteiro.role !== 'porteiro') return false;
  if (porteiro.active === false) return false;
  if (!porteiro.horario_inicio || !porteiro.horario_fim) return false;

  // Valida se o momento atual (em horário de Brasília) está dentro da janela deste turno
  if (!isTimeInShift(now, porteiro.horario_inicio, porteiro.horario_fim)) {
    return false;
  }

  const parsedEscala = parseEscalaTipo(porteiro.escala_tipo);
  if (!parsedEscala) {
    return false;
  }

  // Se for diário / todos os dias
  if (parsedEscala.tipo === 'todos') {
    return true;
  }

  // Determina os componentes da data de início deste turno específico em Brasília
  const shiftStartParts = getShiftStartDate(now, porteiro.horario_inicio, porteiro.horario_fim);

  // Escala por dias da semana
  if (parsedEscala.tipo === 'dias_semana') {
    return parsedEscala.dias.includes(shiftStartParts.dayOfWeek);
  }

  // Escala por paridade de dia (12x36 Par / Ímpar)
  const shiftParity = getShiftDayParity(shiftStartParts);
  return parsedEscala.tipo === shiftParity;
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

  const condoPorters = porteiros.filter(p => {
    if (targetCondominiumId) {
      if (!p.condominium_id || p.condominium_id !== targetCondominiumId) {
        return false;
      }
    }
    return p.role === 'porteiro' && p.active !== false;
  });

  const eligibleList = condoPorters.filter(p => isPorterEligibleForShift(p, now, condoPorters));

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
