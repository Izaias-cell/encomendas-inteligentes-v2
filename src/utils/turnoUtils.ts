import { Usuario, TipoTurno, UserRole, OperadorIdentificado, Paridade12x36 } from '../types';

export interface Opcao12x36 {
  id: string;
  label: string;
  horaInicio: string;
  horaFim: string;
  atravessaMeiaNoite: boolean;
}

export const OPCOES_12X36: Opcao12x36[] = [
  {
    id: '07:00-19:00',
    label: '07:00 às 19:00',
    horaInicio: '07:00',
    horaFim: '19:00',
    atravessaMeiaNoite: false,
  },
  {
    id: '08:00-20:00',
    label: '08:00 às 20:00',
    horaInicio: '08:00',
    horaFim: '20:00',
    atravessaMeiaNoite: false,
  },
  {
    id: '19:00-07:00',
    label: '19:00 às 07:00 (Atravessa a meia-noite)',
    horaInicio: '19:00',
    horaFim: '07:00',
    atravessaMeiaNoite: true,
  },
  {
    id: '06:00-18:00',
    label: '06:00 às 18:00',
    horaInicio: '06:00',
    horaFim: '18:00',
    atravessaMeiaNoite: false,
  },
  {
    id: '18:00-06:00',
    label: '18:00 às 06:00 (Atravessa a meia-noite)',
    horaInicio: '18:00',
    horaFim: '06:00',
    atravessaMeiaNoite: true,
  },
];

/**
 * Converte "HH:MM" para total de minutos desde a meia-noite (0..1439).
 */
export function timeStringToMinutes(timeStr: string | any): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/**
 * Formata um Date em string "HH:MM" (horário local).
 */
export function getCurrentTimeString(date: Date = new Date()): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    date = new Date();
  }
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Converte com segurança string (HH:mm, DD/MM/YYYY, ISO) ou Date em um objeto Date válido.
 */
export function parseDateOrTimeString(horarioConsulta?: string | Date): Date {
  if (!horarioConsulta) return new Date();
  if (horarioConsulta instanceof Date) {
    return isNaN(horarioConsulta.getTime()) ? new Date() : horarioConsulta;
  }
  if (typeof horarioConsulta === 'string') {
    const trimmed = horarioConsulta.trim();
    // Formato simples "HH:mm"
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      const now = new Date();
      const [h, m] = trimmed.split(':').map((v) => parseInt(v, 10));
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    }
    // Formato brasileiro "DD/MM/YYYY HH:mm" ou "DD/MM/YYYY"
    const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (brMatch) {
      const dia = parseInt(brMatch[1], 10);
      const mes = parseInt(brMatch[2], 10) - 1;
      const ano = parseInt(brMatch[3], 10);
      const hora = brMatch[4] ? parseInt(brMatch[4], 10) : 0;
      const min = brMatch[5] ? parseInt(brMatch[5], 10) : 0;
      return new Date(ano, mes, dia, hora, min, 0, 0);
    }
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

/**
 * Retorna a paridade de um dia do calendário (19 -> ÍMPAR, 20 -> PAR).
 */
export function getParidadeDia(diaNumero: number): Paridade12x36 {
  return diaNumero % 2 !== 0 ? Paridade12x36.IMPAR : Paridade12x36.PAR;
}

/**
 * Retorna a Data do início do plantão ativo.
 * 
 * REGRA FUNDAMENTAL:
 * DATA DE INÍCIO DO PLANTÃO = DATA DE REFERÊNCIA DA PARIDADE.
 * 
 * Para turnos que atravessam a meia-noite (ex: 19:00 às 07:00, 18:00 às 06:00):
 * - Se a hora atual está entre 00:00 e o término do turno (ex: 00:30, 05:00):
 *   O plantão iniciou ONTEM à noite.
 *   Portanto, a data de início do plantão = dataAtual - 1 dia.
 * - Se a hora atual está a partir do início do turno (ex: 19:00 às 23:59):
 *   O plantão iniciou HOJE à noite.
 *   Portanto, a data de início do plantão = dataAtual (hoje).
 * 
 * Para turnos diurnos (ex: 07:00 às 19:00):
 * - O plantão iniciou no dia de hoje.
 */
export function getDataInicioPlantao(
  dataRef: Date = new Date(),
  horaInicio?: string,
  horaFim?: string
): Date {
  const safeDate = !(dataRef instanceof Date) || isNaN(dataRef.getTime()) ? new Date() : dataRef;
  
  if (!horaInicio || !horaFim) {
    return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
  }

  const currentMin = safeDate.getHours() * 60 + safeDate.getMinutes();
  const startMin = timeStringToMinutes(horaInicio);
  const endMin = timeStringToMinutes(horaFim);

  // Turno noturno que atravessa a meia-noite (horaInicio > horaFim)
  if (startMin > endMin) {
    if (currentMin < endMin) {
      // Estamos na madrugada após a meia-noite (ex: 00:30, 05:00): o plantão iniciou ontem às 19:00
      return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate() - 1);
    } else {
      // Estamos na noite (ex: 19:00 às 23:59): o plantão iniciou hoje
      return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
    }
  }

  // Turno que não atravessa a meia-noite (horaInicio <= horaFim)
  return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
}

/**
 * Calcula a paridade do plantão ativo para uma data/horário de referência.
 * A paridade é estritamente vinculada ao dia em que o plantão COMEÇOU.
 */
export function calcularParidadePlantao(
  dataRef: Date = new Date(),
  horaInicio?: string,
  horaFim?: string
): Paridade12x36 {
  const dataInicio = getDataInicioPlantao(dataRef, horaInicio, horaFim);
  return getParidadeDia(dataInicio.getDate());
}

/**
 * Verifica se um determinado horário "HH:MM" cai dentro do intervalo [horaInicio, horaFim).
 * Trata corretamente turnos que atravessam a meia-noite (ex: 19:00 às 07:00).
 * 
 * Regra:
 * - Se inicio < fim (ex: 07:00 às 19:00): ativo se current >= inicio E current < fim
 * - Se inicio > fim (ex: 19:00 às 07:00): ativo se current >= inicio OU current < fim
 * - Se inicio == fim: turno de 24 horas contínuo
 */
export function isHorarioNoTurno(horario: string, horaInicio?: string, horaFim?: string): boolean {
  if (!horario || !horaInicio || !horaFim) return false;

  const current = timeStringToMinutes(horario);
  const start = timeStringToMinutes(horaInicio);
  const end = timeStringToMinutes(horaFim);

  if (start < end) {
    return current >= start && current < end;
  } else if (start > end) {
    return current >= start || current < end;
  } else {
    return true; // 24 horas
  }
}

/**
 * Identifica automaticamente qual usuário/porteiro está em operação no momento.
 * 
 * Avalia rigorosamente:
 * 1. Apenas usuários ATIVOS do condomínio com horário cadastrado.
 * 2. HORÁRIO ATUAL dentro do intervalo do turno ([horaInicio, horaFim)).
 * 3. TIPO DE TURNO e PARIDADE 12x36 (DATA DE INÍCIO DO PLANTÃO = REFERÊNCIA DA PARIDADE).
 * 4. CONFLITO DE ESCALA: Se múltiplos porteiros ativos coincidirem na mesma regra, reporta 'CONFLITO'.
 * 5. AUSÊNCIA DE OPERADOR: Se nenhum atender, reporta 'SEM_PORTEIRO'.
 */
export function identificarOperadorEmOperacao(
  usuarios: Usuario[] = [],
  horarioConsulta?: string | Date
): OperadorIdentificado {
  const refDate = parseDateOrTimeString(horarioConsulta);
  const horarioAtual = getCurrentTimeString(refDate);
  const safeUsuarios = Array.isArray(usuarios) ? usuarios : [];

  // Filtra apenas porteiros/operadores ativos com turno cadastrado
  const operadoresCandidatos = safeUsuarios.filter((u) => {
    if (!u || !u.ativo) return false;
    if (!u.horaInicio || !u.horaFim) return false;

    // 1. O horário atual precisa estar dentro da faixa do turno
    const noHorario = isHorarioNoTurno(horarioAtual, u.horaInicio, u.horaFim);
    if (!noHorario) return false;

    // 2. Se for escala 12x36, valida a paridade da data de início do plantão
    if (u.tipoTurno === TipoTurno.TURNO_12X36) {
      const paridadePlantao = calcularParidadePlantao(refDate, u.horaInicio, u.horaFim);
      if (u.paridade12x36) {
        return u.paridade12x36 === paridadePlantao;
      }
      return true;
    }

    // 3. Outros turnos (COMERCIAL / PERSONALIZADO)
    return true;
  });

  if (operadoresCandidatos.length === 1) {
    const op = operadoresCandidatos[0];
    return {
      status: 'OK',
      operador: op,
      horarioAtual,
      mensagem: `Operador identificado: ${op.nome}`,
    };
  }

  if (operadoresCandidatos.length === 0) {
    const dataInicioReferencia = getDataInicioPlantao(refDate);
    const paridadeDia = getParidadeDia(dataInicioReferencia.getDate());
    return {
      status: 'SEM_PORTEIRO',
      horarioAtual,
      mensagem: `Nenhum porteiro cadastrado para o horário ${horarioAtual} (Dia de início ${dataInicioReferencia.getDate()} - Dias ${
        paridadeDia === Paridade12x36.IMPAR ? 'Ímpares' : 'Pares'
      }).`,
    };
  }

  // CONFLITO DE ESCALA
  const nomes = operadoresCandidatos.map((u) => u.nome).join(', ');
  return {
    status: 'CONFLITO',
    conflitoUsuarios: operadoresCandidatos,
    horarioAtual,
    mensagem: `Conflito de escala: múltiplos operadores detectados no mesmo turno e paridade (${nomes}).`,
  };
}

