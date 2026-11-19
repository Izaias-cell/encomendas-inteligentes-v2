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
 * Verifica de forma canônica se uma encomenda (ou todas as encomendas de um grupo)
 * já possui confirmação válida de notificação enviada ao morador.
 */
export const isPackageNotificationConfirmed = (pkg: any): boolean => {
  if (!pkg) return false;
  if (pkg.isGroup && Array.isArray(pkg.packages) && pkg.packages.length > 0) {
    return pkg.packages.every((item: any) => isPackageNotificationConfirmed(item));
  }
  if (pkg.whatsapp_notified === true || pkg.whatsapp_sent === true) return true;
  const waStatus = String(pkg.whatsapp_status || '').trim().toLowerCase();
  if (['sent', 'enviado', 'delivered', 'read'].includes(waStatus)) return true;

  const pkgStatus = String(pkg.status || '').trim().toLowerCase();
  if (pkgStatus === 'notified') return true;

  const isFailedOrPendingWa = [
    'pending',
    'pending_configuration',
    'error',
    'failed',
    'no_recipient',
    'cancelled',
    'canceled'
  ].includes(waStatus);
  if (!isFailedOrPendingWa && Boolean(pkg.notified_at || pkg.whatsapp_sent_at)) {
    return true;
  }

  return false;
};

export const isPackageDelivered = (pkg: any): boolean => {
  if (!pkg) return false;
  if (pkg.isGroup && Array.isArray(pkg.packages) && pkg.packages.length > 0) {
    return pkg.packages.every((item: any) => isPackageDelivered(item));
  }
  return pkg.status === 'delivered' || Boolean(pkg.delivered_at);
};

export interface GroupNotificationSummary {
  totalItems: number;
  confirmedItems: number;
  pendingItems: number;
  isAllConfirmed: boolean;
  isMixed: boolean;
}

export const getGroupNotificationSummary = (pkg: any): GroupNotificationSummary => {
  if (!pkg) {
    return { totalItems: 0, confirmedItems: 0, pendingItems: 0, isAllConfirmed: false, isMixed: false };
  }
  if (pkg.isGroup && Array.isArray(pkg.packages) && pkg.packages.length > 0) {
    const totalItems = pkg.packages.length;
    const confirmedItems = pkg.packages.filter((item: any) => isPackageNotificationConfirmed(item)).length;
    const pendingItems = totalItems - confirmedItems;
    return {
      totalItems,
      confirmedItems,
      pendingItems,
      isAllConfirmed: pendingItems === 0,
      isMixed: confirmedItems > 0 && pendingItems > 0
    };
  }
  const confirmed = isPackageNotificationConfirmed(pkg);
  return {
    totalItems: 1,
    confirmedItems: confirmed ? 1 : 0,
    pendingItems: confirmed ? 0 : 1,
    isAllConfirmed: confirmed,
    isMixed: false
  };
};

/**
 * Retorna apenas os itens ainda não entregues cuja notificação já foi confirmada.
 * Em grupos mistos, nunca inclui itens ainda não confirmados.
 */
export const getConfirmedPackagesForResend = (pkg: any): any[] => {
  if (!pkg || isPackageDelivered(pkg)) return [];
  if (pkg.isGroup && Array.isArray(pkg.packages) && pkg.packages.length > 0) {
    return pkg.packages.filter((item: any) => !isPackageDelivered(item) && isPackageNotificationConfirmed(item));
  }
  return isPackageNotificationConfirmed(pkg) ? [pkg] : [];
};

/**
 * Define quando o botão REENVIAR deve ser exibido no card da Portaria:
 * somente quando a notificação já foi confirmada (todas no caso de grupo)
 * e a encomenda ainda não foi entregue.
 */
export const canShowResendButton = (pkg: any): boolean => {
  if (!pkg || isPackageDelivered(pkg)) return false;
  return isPackageNotificationConfirmed(pkg);
};

export const shouldShowOperationalNotifyHeader = (params: {
  notifyAfter: boolean;
  showInactivityAlert: boolean;
  pendingNoticesCount: number;
}): boolean => {
  return Boolean(params.notifyAfter && params.showInactivityAlert && params.pendingNoticesCount > 0);
};

export interface PackageNotificationBadgeState {
  kind: 'confirmed' | 'delivered_unnotified' | 'auto_pending' | 'notify_after_waiting' | 'notify_after_pending';
  label: string | null;
  isClickable: boolean;
  isPulsing: boolean;
  summary: GroupNotificationSummary;
}

export const getPackageNotificationBadgeState = (
  pkg: any,
  options: { notifyAfter: boolean; showInactivityAlert?: boolean; interactive?: boolean; rawStatus?: string }
): PackageNotificationBadgeState => {
  const summary = getGroupNotificationSummary(pkg);
  const confirmed = pkg
    ? isPackageNotificationConfirmed(pkg)
    : ['sent', 'enviado', 'delivered', 'read'].includes(String(options.rawStatus || '').trim().toLowerCase());

  if (confirmed) {
    return {
      kind: 'confirmed',
      label: '💬 Avisado',
      isClickable: false,
      isPulsing: false,
      summary
    };
  }

  if (isPackageDelivered(pkg)) {
    return {
      kind: 'delivered_unnotified',
      label: null,
      isClickable: false,
      isPulsing: false,
      summary
    };
  }

  if (!options.notifyAfter) {
    const waStatus = String(pkg?.whatsapp_status || options.rawStatus || '').trim().toLowerCase();
    let label = 'Envio pendente';
    if (waStatus === 'no_recipient') {
      label = 'Sem telefone';
    } else if (waStatus === 'pending_configuration') {
      label = 'API não configurada';
    } else if (waStatus === 'error' || waStatus === 'failed') {
      label = 'Falha no envio';
    }
    return {
      kind: 'auto_pending',
      label,
      isClickable: false,
      isPulsing: false,
      summary
    };
  }

  // No modo APÓS REGISTRO, os cards só exibem AVISAR MORADOR após showInactivityAlert (3 minutos)
  if (!options.showInactivityAlert) {
    return {
      kind: 'notify_after_waiting',
      label: null,
      isClickable: false,
      isPulsing: false,
      summary
    };
  }

  const interactive = options.interactive !== false;
  const label = summary.isMixed
    ? `💬 Avisar Morador (${summary.pendingItems}/${summary.totalItems})`
    : '💬 Avisar Morador';

  return {
    kind: 'notify_after_pending',
    label,
    isClickable: interactive,
    isPulsing: interactive,
    summary
  };
};

export interface ParsedQrScanInput {
  cleanText: string;
  searchId: string;
  searchCode: string;
  searchToken: string;
  lookupTerm: string;
  isJsonPayload: boolean;
  isQrFormatValid: boolean;
}

const QR_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_LOOKUP_REGEX = /^[A-Za-z0-9_-]{4,128}$/;

export const parseQrScanInput = (rawText: string): ParsedQrScanInput => {
  const cleanText = String(rawText || '').trim();
  let searchId = '';
  let searchCode = '';
  let searchToken = '';
  let isJsonPayload = false;

  if (!cleanText) {
    return {
      cleanText: '',
      searchId: '',
      searchCode: '',
      searchToken: '',
      lookupTerm: '',
      isJsonPayload: false,
      isQrFormatValid: false
    };
  }

  if (cleanText.startsWith('{') || cleanText.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleanText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        isJsonPayload = true;
        searchId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
        searchCode = parsed.code !== undefined && parsed.code !== null ? String(parsed.code).trim() : '';
        searchToken = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      } else {
        // JSON inválido/array não representa payload de QR válido
        return {
          cleanText,
          searchId: '',
          searchCode: '',
          searchToken: '',
          lookupTerm: '',
          isJsonPayload: false,
          isQrFormatValid: false
        };
      }
    } catch {
      return {
        cleanText,
        searchId: '',
        searchCode: '',
        searchToken: '',
        lookupTerm: '',
        isJsonPayload: false,
        isQrFormatValid: false
      };
    }
  } else if (/^https?:\/\//i.test(cleanText) || cleanText.includes('/retirada')) {
    try {
      const normalizedUrl = /^https?:\/\//i.test(cleanText)
        ? cleanText
        : `https://local.invalid${cleanText.startsWith('/') ? cleanText : `/${cleanText}`}`;
      const url = new URL(normalizedUrl);
      const tokenParam = url.searchParams.get('token')?.trim() || '';
      const codeParam = url.searchParams.get('code')?.trim() || '';
      const pathSegs = url.pathname.split('/').filter(Boolean);
      const lastSeg = pathSegs[pathSegs.length - 1] || '';
      if (tokenParam) {
        searchToken = tokenParam;
      } else if (lastSeg && lastSeg.toLowerCase() !== 'retirada') {
        searchToken = lastSeg;
      }
      if (codeParam) {
        searchCode = codeParam;
      }
    } catch {
      // Fallback para texto bruto abaixo
    }
  } else {
    searchToken = cleanText;
    searchCode = cleanText;
    searchId = cleanText;
  }

  const validId = Boolean(searchId && QR_UUID_REGEX.test(searchId));
  const validToken = Boolean(searchToken && SAFE_LOOKUP_REGEX.test(searchToken));
  const validCode = Boolean(searchCode && SAFE_LOOKUP_REGEX.test(searchCode));

  const lookupTerm = (validToken ? searchToken : '') || (validCode ? searchCode : '') || (validId ? searchId : '');
  const isQrFormatValid = Boolean(lookupTerm) && (!isJsonPayload || validToken || validCode || validId);

  return {
    cleanText,
    searchId: validId ? searchId : (isJsonPayload ? searchId : ''),
    searchCode,
    searchToken,
    lookupTerm,
    isJsonPayload,
    isQrFormatValid
  };
};

export interface QrValidationResult {
  ok: boolean;
  reason?: 'invalid_qr' | 'not_found' | 'cross_condo' | 'already_delivered' | 'unnotified';
  message?: string;
  targetPackage?: any;
  packageData?: any;
}

export const validateQrScanResult = (params: {
  parsed: ParsedQrScanInput;
  matchedPackages: any[];
  expectedCondoId?: string | null;
  scanMethod?: 'qr_code' | 'code';
}): QrValidationResult => {
  const { parsed, matchedPackages, expectedCondoId, scanMethod = 'qr_code' } = params;

  if (!parsed.isQrFormatValid || !parsed.lookupTerm) {
    return {
      ok: false,
      reason: 'invalid_qr',
      message: 'Conteúdo do QR Code inválido'
    };
  }

  const list = Array.isArray(matchedPackages) ? matchedPackages : [];
  if (list.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      message: scanMethod === 'code'
        ? 'Código não encontrado ou encomenda de outro condomínio'
        : 'QR Code inválido, encomenda não encontrada ou de outro condomínio'
    };
  }

  if (expectedCondoId) {
    const crossCondo = list.some((p: any) => p?.condominium_id && p.condominium_id !== expectedCondoId);
    const sameCondoList = list.filter((p: any) => !p?.condominium_id || p.condominium_id === expectedCondoId);
    if (crossCondo && sameCondoList.length === 0) {
      return {
        ok: false,
        reason: 'cross_condo',
        message: 'QR Code pertence a outro condomínio'
      };
    }
  }

  const scopedList = expectedCondoId
    ? list.filter((p: any) => !p?.condominium_id || p.condominium_id === expectedCondoId)
    : list;

  // Para QR JSON estruturado ({ id, code, token }), valida consistência de identidade contra adulteração
  if (parsed.isJsonPayload) {
    const matchedById = parsed.searchId ? scopedList.find((p: any) => p.id === parsed.searchId) : null;
    if (parsed.searchId && !matchedById) {
      return {
        ok: false,
        reason: 'invalid_qr',
        message: 'QR Code inválido ou incompatível com a encomenda.'
      };
    }

    const referenceRows = matchedById ? [matchedById] : scopedList;
    const identityMatches = referenceRows.some((row: any) => {
      const tokenMatches = !parsed.searchToken || row.pickup_token === parsed.searchToken;
      const codeMatches = !parsed.searchCode || row.pickup_code === parsed.searchCode;
      return tokenMatches && codeMatches;
    });

    if (!identityMatches) {
      return {
        ok: false,
        reason: 'invalid_qr',
        message: 'QR Code inválido ou adulterado.'
      };
    }
  }

  const pendingRows = scopedList.filter((p: any) => p.status !== 'delivered' && !p.delivered_at);
  const deliveredRows = scopedList.filter((p: any) => p.status === 'delivered' || Boolean(p.delivered_at));

  if (pendingRows.length === 0 && deliveredRows.length > 0) {
    return {
      ok: false,
      reason: 'already_delivered',
      message: 'Esta encomenda já foi entregue anteriormente.',
      packageData: deliveredRows[0]
    };
  }

  if (pendingRows.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      message: 'Encomenda não encontrada ou já entregue'
    };
  }

  const availableQrRows = pendingRows.filter((p: any) => p.pickup_qr_code !== 'used');
  if (availableQrRows.length === 0) {
    return {
      ok: false,
      reason: 'already_delivered',
      message: 'Este QR Code já foi utilizado.',
      packageData: pendingRows[0]
    };
  }

  const primaryPkg = (parsed.searchId ? availableQrRows.find((p: any) => p.id === parsed.searchId) : null) || availableQrRows[0];

  // Agrupa encomendas pendentes do mesmo token/lote ou código/morador
  const relatedGroupRows = availableQrRows.filter((p: any) => {
    if (primaryPkg.pickup_token && p.pickup_token) {
      return p.pickup_token === primaryPkg.pickup_token;
    }
    if (primaryPkg.pickup_code && p.pickup_code && primaryPkg.recipient_id && p.recipient_id) {
      return p.pickup_code === primaryPkg.pickup_code && p.recipient_id === primaryPkg.recipient_id;
    }
    return p.id === primaryPkg.id;
  });

  const targetRows = relatedGroupRows.length > 0 ? relatedGroupRows : [primaryPkg];
  const notifiedRows = targetRows.filter((p: any) => isPackageNotificationConfirmed(p));

  // Se NENHUMA encomenda do conjunto/token foi notificada, bloqueia rigorosamente
  if (notifiedRows.length === 0) {
    return {
      ok: false,
      reason: 'unnotified',
      message: 'POR FAVOR ENVIE A NOTIFICAÇÃO PARA DAR BAIXA DA ENCOMENDA',
      packageData: primaryPkg
    };
  }

  // Se o próprio item lido por ID não foi notificado (e não há token compartilhado já notificado), bloqueia;
  // caso o token compartilhado já tenha sido notificado, entrega exclusivamente as encomendas já notificadas.
  const leadNotified = notifiedRows.find((p: any) => p.id === primaryPkg.id) || notifiedRows[0];
  const targetPackage = notifiedRows.length > 1
    ? {
        ...leadNotified,
        isGroup: true,
        packages: notifiedRows
      }
    : leadNotified;

  return {
    ok: true,
    targetPackage,
    packageData: targetPackage
  };
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
    if (isPackageNotificationConfirmed(p)) return false;
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
