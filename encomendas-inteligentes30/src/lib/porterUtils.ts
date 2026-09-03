import { getActivePlantao, setActivePlantao as setPlantaoAtivo, clearActivePlantao } from './plantaoUtils';

const PORTEIRO_MANUAL_KEY = 'porteiro_manual';

/**
 * Retorna o porteiro selecionado no plantão ativo ou localStorage com validação do condomínio.
 */
export const getCurrentPorter = (currentCondoId?: string): string => {
  const activePlantao = getActivePlantao(currentCondoId);
  if (activePlantao?.porteiro_nome) {
    if (!currentCondoId || activePlantao.condominium_id === currentCondoId) {
      return activePlantao.porteiro_nome;
    }
  }

  const manualPorter = localStorage.getItem(PORTEIRO_MANUAL_KEY);
  if (manualPorter) {
    try {
      const parsed = JSON.parse(manualPorter);
      if (parsed && typeof parsed === 'object') {
        if (!currentCondoId || !parsed.condominium_id || parsed.condominium_id === currentCondoId) {
          return parsed.name || 'Selecione o Porteiro';
        } else {
          localStorage.removeItem(PORTEIRO_MANUAL_KEY);
          return 'Selecione o Porteiro';
        }
      }
    } catch {
      // Se for string legado sem objeto de condomínio
      if (currentCondoId) {
        localStorage.removeItem(PORTEIRO_MANUAL_KEY);
        return 'Selecione o Porteiro';
      }
      return manualPorter;
    }
  }

  return 'Selecione o Porteiro';
};

/**
 * Salva a seleção manual do porteiro vinculada ao condomínio.
 */
export const setManualPorter = (name: string, condoId?: string): void => {
  localStorage.setItem(PORTEIRO_MANUAL_KEY, JSON.stringify({ name, condominium_id: condoId }));
};

/**
 * Limpa a seleção manual do porteiro.
 */
export const clearManualPorter = (): void => {
  localStorage.removeItem(PORTEIRO_MANUAL_KEY);
  clearActivePlantao();
};

/**
 * Retorna o rótulo do turno atual.
 */
export const getCurrentShiftLabel = (): string => {
  const activePlantao = getActivePlantao();
  if (activePlantao?.horario_inicio && activePlantao?.horario_fim) {
    return `${activePlantao.horario_inicio} - ${activePlantao.horario_fim}`;
  }
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'Diurno' : 'Noturno';
};

