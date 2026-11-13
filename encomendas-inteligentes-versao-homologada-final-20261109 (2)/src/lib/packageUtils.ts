/**
 * Utilitários para extração e cálculo de quantidade de encomendas (Lotes/Volumes).
 * Compatível com o esquema do banco atual sem necessidade de migrations estruturais.
 */

export interface PackageWithNotes {
  notes?: string | null;
  [key: string]: any;
}

/**
 * Extrai a quantidade real de itens/volumes representados por um registro de encomenda.
 * Identifica marcações padronizadas:
 * - [QTD: X]
 * - Lote de X encomendas
 * - (Lote de X encomendas)
 * Retorna 1 se não houver marcação de lote.
 */
export const getPackageItemCount = (pkg?: PackageWithNotes | null): number => {
  if (!pkg || !pkg.notes) return 1;
  const str = pkg.notes;

  // 1. Marcação padronizada [QTD: X]
  const qtdMatch = str.match(/\[QTD:\s*(\d+)\]/i);
  if (qtdMatch && qtdMatch[1]) {
    const val = parseInt(qtdMatch[1], 10);
    return !isNaN(val) && val > 0 ? val : 1;
  }

  // 2. Marcação legada "Lote de X encomendas"
  const loteMatch = str.match(/lote de (\d+) encomendas/i);
  if (loteMatch && loteMatch[1]) {
    const val = parseInt(loteMatch[1], 10);
    return !isNaN(val) && val > 0 ? val : 1;
  }

  return 1;
};

/**
 * Soma o total de itens considerando lotes para uma lista de encomendas.
 */
export const sumPackageItems = (packages: PackageWithNotes[]): number => {
  if (!packages || packages.length === 0) return 0;
  return packages.reduce((acc, p) => acc + getPackageItemCount(p), 0);
};

/**
 * Gera a string de observações formatada com a quantidade padrão.
 */
export const formatBatchNotes = (userNotes: string = '', quantity: number = 1): string => {
  const trimmedNotes = userNotes.trim();
  if (quantity <= 1) return trimmedNotes;

  // Se já tiver uma anotação de lote ou QTD, limpa para não duplicar
  const cleanedNotes = trimmedNotes
    .replace(/\[QTD:\s*\d+\]/gi, '')
    .replace(/,?\s*\(?Lote de \d+ encomendas\)?/gi, '')
    .trim()
    .replace(/^,|,$/g, '')
    .trim();

  const tag = `[QTD: ${quantity}] Lote de ${quantity} encomendas`;
  return cleanedNotes ? `${cleanedNotes}, ${tag}` : tag;
};

/**
 * Validação segura de telefone sem forçar DDD global:
 * - Se já possui DDD (10 ou 11 dígitos): válido diretamente.
 * - Se possui 8 ou 9 dígitos (sem DDD): permite opcionalmente aplicar o DDD padrão
 *   específico do condomínio (ex: obtido das configurações do condomínio), sem regra global cega.
 */
export const normalizeResidentPhone = (
  rawPhone?: string | null,
  condoDefaultDdd?: string | null
): { phone: string; isValid: boolean; isIncomplete: boolean } => {
  if (!rawPhone) return { phone: '', isValid: false, isIncomplete: true };
  const digits = rawPhone.replace(/\D/g, '');

  // Número brasileiro padrão com DDD (ex: 41 99999-9999 ou 41 3333-3333)
  if (digits.length === 10 || digits.length === 11) {
    return { phone: digits, isValid: true, isIncomplete: false };
  }

  // Número com código de país (ex: 5541999999999)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return { phone: digits.substring(2), isValid: true, isIncomplete: false };
  }

  // Telefone sem DDD (8 ou 9 dígitos):
  if (digits.length === 8 || digits.length === 9) {
    if (condoDefaultDdd && condoDefaultDdd.length === 2) {
      return { phone: `${condoDefaultDdd}${digits}`, isValid: true, isIncomplete: false };
    }
    // Sem DDD configurado, marcar como incompleto para ação do usuário
    return { phone: digits, isValid: false, isIncomplete: true };
  }

  return { phone: digits, isValid: false, isIncomplete: true };
};

/**
 * Função canônica para processar/filtrar encomendas que necessitam de notificação.
 * Garante que uma encomenda permaneça pendente até confirmação válida do envio.
 */
export const getPackagesNeedingNotification = (
  pkgList: any[],
  residents: any[] = [],
  includeIncompletePhone: boolean = true
): any[] => {
  if (!Array.isArray(pkgList) || pkgList.length === 0) return [];
  return pkgList.filter(p => {
    // Regra 1: Se já foi notificado com confirmação válida, sai da fila
    if (p.whatsapp_notified === true || p.whatsapp_sent === true) return false;
    // Regra 2: Se já foi entregue, sai da fila
    if (p.status === 'delivered' || p.delivered_at) return false;
    // Regra 3: Se não tem destinatário vinculado, não pode enviar
    if (!p.recipient_id) return false;
    
    // Resolução do morador
    const resident = residents.find(r => r.id === p.recipient_id) || (p as any).moradores;
    if (!resident) {
      return true; // Mantém na fila até que os dados sejam carregados
    }
    
    const phoneCheck = normalizeResidentPhone(resident.telefone);
    if (includeIncompletePhone) {
      return true;
    }
    return phoneCheck.isValid;
  });
};
