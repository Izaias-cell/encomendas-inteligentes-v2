/**
 * Determina o porteiro de plantão com base no dia do mês e horário.
 * 
 * DIAS PARES:
 * - Marcos → 07:00 às 19:00
 * - Izaias → 19:00 às 07:00
 * 
 * DIAS ÍMPARES:
 * - Bruno → 07:00 às 19:00
 * - Marisa → 19:00 às 07:00
 */
export const getCurrentPorter = (): string => {
  const now = new Date();
  const day = now.getDate();
  const hour = now.getHours();

  const isEvenDay = day % 2 === 0;
  const isDayShift = hour >= 7 && hour < 19;

  if (isEvenDay) {
    return isDayShift ? 'Marcos' : 'Izaias';
  } else {
    return isDayShift ? 'Bruno' : 'Marisa';
  }
};

/**
 * Retorna o rótulo do turno atual.
 */
export const getCurrentShiftLabel = (): string => {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'Diurno' : 'Noturno';
};
