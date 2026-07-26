const PORTEIRO_MANUAL_KEY = 'porteiro_manual';

/**
 * Retorna o porteiro selecionado manualmente no localStorage.
 */
export const getCurrentPorter = (): string => {
  // 1. Verificamos se existe uma seleção manual no localStorage
  const manualPorter = localStorage.getItem(PORTEIRO_MANUAL_KEY);
  if (manualPorter) {
    return manualPorter;
  }

  // 2. Fallback caso não haja seleção ainda
  return 'Selecione o Porteiro';
};

/**
 * Salva a seleção manual do porteiro.
 */
export const setManualPorter = (name: string): void => {
  localStorage.setItem(PORTEIRO_MANUAL_KEY, name);
};

/**
 * Limpa a seleção manual do porteiro, voltando para o automático.
 */
export const clearManualPorter = (): void => {
  localStorage.removeItem(PORTEIRO_MANUAL_KEY);
};

/**
 * Retorna o rótulo do turno atual.
 */
export const getCurrentShiftLabel = (): string => {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'Diurno' : 'Noturno';
};
