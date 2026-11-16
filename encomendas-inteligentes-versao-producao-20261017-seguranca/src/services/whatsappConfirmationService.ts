import { api } from '../lib/apiClient';
import { sendWhatsAppMessage } from './whatsappService';

export interface PackageNotificationConfirmedFields {
  whatsapp_notified: true;
  whatsapp_sent: true;
  whatsapp_status: 'enviado';
  notified_at: string;
  whatsapp_sent_at: string;
  last_notification_at: string;
  whatsapp_message?: string;
  pickup_code?: string;
  pickup_token?: string;
}

export interface DbUpdateResponse {
  data?: any;
  error?: { message?: string; code?: string } | any;
  status?: number;
}

export type UpdatePackagesFn = (
  packageIds: string[],
  fields: PackageNotificationConfirmedFields
) => Promise<DbUpdateResponse>;

export type SendWhatsAppApiFn = (
  phone: string,
  message: string,
  condominiumId: string,
  config?: any
) => Promise<any>;

export interface PersistenceResult {
  ok: boolean;
  error?: string;
  isTimeout?: boolean;
  fields?: PackageNotificationConfirmedFields;
}

export interface AutoSendFlowResult {
  ok: boolean;
  stage?: 'api' | 'database';
  error?: string;
  isTimeout?: boolean;
  apiResult?: any;
  fields?: PackageNotificationConfirmedFields;
}

/**
 * Valida estritamente o contrato de retorno da API de WhatsApp:
 * - Deve existir objeto de resposta
 * - status_envio deve ser estritamente 'sucesso'
 * - Não pode conter propriedade error truthy
 * - Código HTTP explícito deve ser obrigatoriamente 200 ou 201
 */
export function isStrictWhatsAppApiSuccess(result: any): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  if (result.status_envio !== 'sucesso') {
    return false;
  }
  if (result.error) {
    return false;
  }
  if (result.httpStatus !== 200 && result.httpStatus !== 201) {
    return false;
  }
  return true;
}

export const defaultUpdatePackagesInSupabase: UpdatePackagesFn = async (packageIds, fields) => {
  try {
    const res = await api.post<{ success?: boolean; data?: any }>('/api/operational/packages/whatsapp-status', {
      packageIds,
      fields
    });
    if (!res.ok) {
      return {
        data: null,
        error: { message: res.error || 'Erro ao atualizar status do WhatsApp no servidor.' },
        status: res.status || 500
      };
    }
    return { data: res.data?.data ?? res.data, error: null, status: res.status || 200 };
  } catch (err: any) {
    return {
      data: null,
      error: { message: err?.message || 'Erro ao atualizar status do WhatsApp no servidor.' },
      status: err?.status || 500
    };
  }
};

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(timeoutMessage);
      err.isTimeout = true;
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Solicita atualização no banco de dados e valida integralmente o retorno,
 * tratando retorno { error }, exceções, timeout e respostas inesperadas.
 */
export async function persistPackageNotificationConfirmation(params: {
  packageIds: string[];
  fields: PackageNotificationConfirmedFields;
  updatePackagesFn?: UpdatePackagesFn;
  timeoutMs?: number;
}): Promise<PersistenceResult> {
  const {
    packageIds,
    fields,
    updatePackagesFn = defaultUpdatePackagesInSupabase,
    timeoutMs = 15000
  } = params;

  if (!Array.isArray(packageIds) || packageIds.length === 0) {
    return {
      ok: false,
      error: 'Nenhuma encomenda informada para confirmação.'
    };
  }

  try {
    const response = await runWithTimeout(
      Promise.resolve(updatePackagesFn(packageIds, fields)),
      timeoutMs,
      `Tempo limite esgotado (${timeoutMs}ms) ao salvar confirmação no banco de dados.`
    );

    if (!response || typeof response !== 'object') {
      return {
        ok: false,
        error: 'Resposta inesperada do banco de dados ao salvar confirmação.'
      };
    }

    if (response.error) {
      const errMsg =
        typeof response.error === 'string'
          ? response.error
          : response.error?.message || 'Erro retornado pelo banco de dados.';
      return {
        ok: false,
        error: errMsg
      };
    }

    if (typeof response.status === 'number' && response.status >= 400) {
      return {
        ok: false,
        error: `Falha HTTP ${response.status} ao salvar confirmação no banco.`
      };
    }

    return {
      ok: true,
      fields
    };
  } catch (err: any) {
    return {
      ok: false,
      isTimeout: Boolean(err?.isTimeout || err?.name === 'AbortError'),
      error: err instanceof Error ? err.message : String(err || 'Erro desconhecido ao persistir confirmação.')
    };
  }
}

/**
 * Fluxo canônico de confirmação manual de envio (usado em PackageNew e Portaria):
 * 1. Solicita atualização no Supabase.
 * 2. Verifica retorno completo da operação.
 * 3. Somente após persistência confirmada atualiza o estado local via callback.
 */
export async function executeManualSendConfirmation(params: {
  packageIds: string[];
  pickupCode?: string;
  pickupToken?: string;
  message?: string;
  nowIso?: string;
  updatePackagesFn?: UpdatePackagesFn;
  onConfirmedLocalState?: (fields: PackageNotificationConfirmedFields) => void;
  timeoutMs?: number;
}): Promise<PersistenceResult> {
  const nowIso = params.nowIso || new Date().toISOString();

  const fields: PackageNotificationConfirmedFields = {
    whatsapp_notified: true,
    whatsapp_sent: true,
    whatsapp_status: 'enviado',
    notified_at: nowIso,
    whatsapp_sent_at: nowIso,
    last_notification_at: nowIso,
    ...(params.message !== undefined ? { whatsapp_message: params.message } : {}),
    ...(params.pickupCode !== undefined ? { pickup_code: params.pickupCode } : {}),
    ...(params.pickupToken !== undefined ? { pickup_token: params.pickupToken } : {})
  };

  const persistence = await persistPackageNotificationConfirmation({
    packageIds: params.packageIds,
    fields,
    updatePackagesFn: params.updatePackagesFn,
    timeoutMs: params.timeoutMs
  });

  if (!persistence.ok) {
    return persistence;
  }

  if (params.onConfirmedLocalState) {
    params.onConfirmedLocalState(fields);
  }

  return persistence;
}

/**
 * Fluxo canônico de envio automático via API (usado na Portaria e em PackageNew):
 * Sequência obrigatória:
 * 1. Solicitar envio pela API
 * 2. Verificar resposta da API
 * 3. Confirmar result.status_envio === 'sucesso'
 * 4. Confirmar ausência de result.error
 * 5. Confirmar código HTTP explícito 200 ou 201
 * 6. Solicitar atualização no Supabase
 * 7. Verificar se Supabase retornou error
 * 8. Somente depois da gravação confirmada atualizar estado local
 */
export async function executePortariaAutoSend(params: {
  phone: string;
  message: string;
  condominiumId: string;
  packageId: string;
  pickupCode?: string;
  pickupToken?: string;
  config?: any;
  nowIso?: string;
  sendFn?: SendWhatsAppApiFn;
  updatePackagesFn?: UpdatePackagesFn;
  onConfirmedLocalState?: (fields: PackageNotificationConfirmedFields) => void;
  timeoutMs?: number;
}): Promise<AutoSendFlowResult> {
  const {
    phone,
    message,
    condominiumId,
    packageId,
    pickupCode,
    pickupToken,
    config,
    nowIso = new Date().toISOString(),
    sendFn = sendWhatsAppMessage,
    updatePackagesFn = defaultUpdatePackagesInSupabase,
    onConfirmedLocalState,
    timeoutMs = 15000
  } = params;

  let apiResult: any;
  try {
    apiResult = await runWithTimeout(
      Promise.resolve(sendFn(phone, message, condominiumId, { ...config, timeoutMs })),
      timeoutMs,
      `Timeout ao aguardar resposta da API de WhatsApp (${timeoutMs}ms).`
    );
  } catch (apiErr: any) {
    return {
      ok: false,
      stage: 'api',
      isTimeout: Boolean(apiErr?.isTimeout || apiErr?.name === 'AbortError'),
      error: apiErr instanceof Error ? apiErr.message : String(apiErr || 'Exceção na API de WhatsApp')
    };
  }

  if (!isStrictWhatsAppApiSuccess(apiResult)) {
    return {
      ok: false,
      stage: 'api',
      apiResult,
      error:
        apiResult?.error ||
        `Resposta da API inválida ou sem confirmação HTTP 200/201 (status_envio=${apiResult?.status_envio}, httpStatus=${apiResult?.httpStatus})`
    };
  }

  const fields: PackageNotificationConfirmedFields = {
    whatsapp_notified: true,
    whatsapp_sent: true,
    whatsapp_status: 'enviado',
    notified_at: nowIso,
    whatsapp_sent_at: nowIso,
    last_notification_at: nowIso,
    whatsapp_message: message,
    ...(pickupCode !== undefined ? { pickup_code: pickupCode } : {}),
    ...(pickupToken !== undefined ? { pickup_token: pickupToken } : {})
  };

  const dbResult = await persistPackageNotificationConfirmation({
    packageIds: [packageId],
    fields,
    updatePackagesFn,
    timeoutMs
  });

  if (!dbResult.ok) {
    return {
      ok: false,
      stage: 'database',
      isTimeout: dbResult.isTimeout,
      apiResult,
      error: dbResult.error || 'Falha ao persistir confirmação no Supabase.'
    };
  }

  if (onConfirmedLocalState) {
    onConfirmedLocalState(fields);
  }

  return {
    ok: true,
    apiResult,
    fields
  };
}
