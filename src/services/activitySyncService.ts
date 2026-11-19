import { api } from '../lib/apiClient';
import { supabase } from '../lib/supabase';

export const INACTIVITY_ALERT_TIMEOUT_MS = 3 * 60 * 1000; // Estritamente 3 minutos (180.000 ms)

export type CondoActivityAction =
  | 'WHATSAPP_ABERTO'
  | 'WHATSAPP_RETORNO'
  | 'WHATSAPP_CONFIRMADO'
  | 'WHATSAPP_CANCELADO'
  | 'ENCOMENDA_CADASTRADA'
  | 'FILA_ACAO';

export interface InactivityEvaluationInput {
  lastActivityTimestamp: number | null | undefined;
  now: number;
  pendingCount: number;
  notifyAfter: boolean;
}

/**
 * Avalia estritamente se o alerta de inatividade de 3 minutos (180.000 ms) deve estar ativo.
 * - Se notifyAfter for false ou não houver pendências (pendingCount <= 0), encerra imediatamente (false).
 * - Se não houver atividade registrada ainda, não dispara prematuramente (false).
 * - Dispara apenas quando (now - lastActivityTimestamp) >= 180.000 ms com pendências > 0.
 */
export function shouldShowInactivityAlert(input: InactivityEvaluationInput): boolean {
  const { lastActivityTimestamp, now, pendingCount, notifyAfter } = input;
  if (!notifyAfter || pendingCount <= 0) {
    return false;
  }
  if (!lastActivityTimestamp || !Number.isFinite(lastActivityTimestamp) || lastActivityTimestamp <= 0) {
    return false;
  }
  return (now - lastActivityTimestamp) >= INACTIVITY_ALERT_TIMEOUT_MS;
}

export interface RecordActivityParams {
  condominiumId: string;
  action: CondoActivityAction;
  userId?: string;
  userName?: string;
  userRole?: string;
  packageId?: string;
  timestamp?: number;
  postActivityFn?: (endpoint: string, body: any) => Promise<{ ok: boolean; data?: any; error?: string }>;
  realtimeBroadcastFn?: (payload: { condominiumId: string; timestamp: number; action: CondoActivityAction }) => Promise<void> | void;
}

export interface RecordActivityResult {
  ok: boolean;
  condominiumId: string;
  lastActivityTimestamp: number | null;
  syncedViaServer: boolean;
  error?: string;
}

/**
 * Registra uma atividade da portaria de forma compartilhada para o condomínio:
 * 1. Persiste no servidor/Supabase (auditoria_eventos existente, isolado por condominiumId).
 * 2. Emite broadcast em tempo real pelo canal do condomínio (Supabase Realtime) quando disponível.
 * Atenção: NUNCA altera o status de envio (whatsapp_notified/whatsapp_sent) da encomenda.
 */
export async function recordCondoActivity(params: RecordActivityParams): Promise<RecordActivityResult> {
  const {
    condominiumId,
    action,
    userId,
    userName,
    userRole,
    packageId,
    timestamp = Date.now(),
    postActivityFn = (endpoint, body) => api.post(endpoint, body, { retries: 1, timeoutMs: 8000 }),
    realtimeBroadcastFn
  } = params;

  if (!condominiumId || typeof condominiumId !== 'string' || condominiumId.trim() === '') {
    return {
      ok: false,
      condominiumId: '',
      lastActivityTimestamp: null,
      syncedViaServer: false,
      error: 'condominiumId é obrigatório para sincronização isolada.'
    };
  }

  const cleanCondoId = condominiumId.trim();
  let effectiveTimestamp = timestamp;
  let syncedViaServer = false;
  let syncError: string | undefined;

  try {
    const res = await postActivityFn('/api/portaria/activity', {
      condominiumId: cleanCondoId,
      action,
      userId,
      userName,
      userRole,
      packageId,
      timestamp
    });

    if (res && res.ok && typeof res.data?.lastActivityTimestamp === 'number') {
      effectiveTimestamp = Math.max(effectiveTimestamp, res.data.lastActivityTimestamp);
      syncedViaServer = true;
    } else {
      syncError = res?.error || 'Falha ao sincronizar atividade com o servidor.';
    }
  } catch (err: any) {
    syncError = err instanceof Error ? err.message : String(err || 'Erro de rede ao sincronizar atividade.');
  }

  if (realtimeBroadcastFn) {
    try {
      await Promise.resolve(
        realtimeBroadcastFn({
          condominiumId: cleanCondoId,
          timestamp: effectiveTimestamp,
          action
        })
      );
    } catch (rtErr) {
      console.warn('[ActivitySync] Aviso ao transmitir evento Realtime:', rtErr);
    }
  }

  return {
    ok: syncedViaServer,
    condominiumId: cleanCondoId,
    lastActivityTimestamp: effectiveTimestamp,
    syncedViaServer,
    ...(syncError ? { error: syncError } : {})
  };
}

export interface FetchActivityResult {
  ok: boolean;
  condominiumId: string;
  lastActivityTimestamp: number | null;
  error?: string;
}

/**
 * Consulta o último horário de atividade compartilhado do condomínio no servidor/Supabase.
 */
export async function fetchCondoActivity(params: {
  condominiumId: string;
  getActivityFn?: (endpoint: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
}): Promise<FetchActivityResult> {
  const {
    condominiumId,
    getActivityFn = (endpoint) => api.get(endpoint, { retries: 1, timeoutMs: 8000 })
  } = params;

  if (!condominiumId || typeof condominiumId !== 'string' || condominiumId.trim() === '') {
    return {
      ok: false,
      condominiumId: '',
      lastActivityTimestamp: null,
      error: 'condominiumId é obrigatório.'
    };
  }

  const cleanCondoId = condominiumId.trim();

  try {
    const res = await getActivityFn(`/api/portaria/activity?condominiumId=${encodeURIComponent(cleanCondoId)}`);
    if (res && res.ok) {
      const ts = typeof res.data?.lastActivityTimestamp === 'number' ? res.data.lastActivityTimestamp : null;
      return {
        ok: true,
        condominiumId: cleanCondoId,
        lastActivityTimestamp: ts
      };
    }
    return {
      ok: false,
      condominiumId: cleanCondoId,
      lastActivityTimestamp: null,
      error: res?.error || 'Erro ao consultar atividade compartilhada do condomínio.'
    };
  } catch (err: any) {
    return {
      ok: false,
      condominiumId: cleanCondoId,
      lastActivityTimestamp: null,
      error: err instanceof Error ? err.message : String(err || 'Erro de rede ao consultar atividade.')
    };
  }
}

export interface CondoActivitySubscription {
  broadcast: (payload: { condominiumId: string; timestamp: number; action: CondoActivityAction }) => Promise<void>;
  unsubscribe: () => void;
}

/**
 * Inscreve o terminal no canal Supabase Realtime do condomínio específico (Broadcast + Postgres Changes em packages)
 * garantindo isolamento estrito por condominiumId.
 */
export function subscribeCondoActivity(params: {
  condominiumId: string;
  supabaseClient?: typeof supabase;
  onRemoteActivity: (timestamp: number, action?: CondoActivityAction) => void;
  onPackagesChanged?: () => void;
}): CondoActivitySubscription {
  const {
    condominiumId,
    supabaseClient = supabase,
    onRemoteActivity,
    onPackagesChanged
  } = params;

  if (!condominiumId || !supabaseClient || typeof supabaseClient.channel !== 'function') {
    return {
      broadcast: async () => {},
      unsubscribe: () => {}
    };
  }

  const channelName = `portaria-activity:${condominiumId}`;
  const channel = supabaseClient.channel(channelName);

  channel
    .on('broadcast', { event: 'send_activity' }, (msg: any) => {
      const payload = msg?.payload;
      if (
        payload &&
        payload.condominiumId === condominiumId &&
        typeof payload.timestamp === 'number' &&
        Number.isFinite(payload.timestamp)
      ) {
        onRemoteActivity(payload.timestamp, payload.action);
      }
    })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'packages',
        filter: `condominium_id=eq.${condominiumId}`
      },
      (change: any) => {
        const record = change?.new;
        if (record && record.condominium_id === condominiumId) {
          const candidates = [
            record.received_at,
            record.notified_at,
            record.whatsapp_sent_at,
            record.last_notification_at
          ]
            .map((d: any) => (d ? new Date(d).getTime() : 0))
            .filter((t: number) => Number.isFinite(t) && t > 0);
          if (candidates.length > 0) {
            onRemoteActivity(Math.max(...candidates), 'FILA_ACAO');
          }
        }
        if (onPackagesChanged) {
          onPackagesChanged();
        }
      }
    )
    .subscribe();

  return {
    broadcast: async (payload) => {
      if (payload.condominiumId !== condominiumId) return;
      try {
        await channel.send({
          type: 'broadcast',
          event: 'send_activity',
          payload
        });
      } catch (err) {
        console.warn('[ActivitySync] Falha ao enviar broadcast Realtime:', err);
      }
    },
    unsubscribe: () => {
      try {
        supabaseClient.removeChannel(channel);
      } catch {
        try {
          channel.unsubscribe();
        } catch {}
      }
    }
  };
}
