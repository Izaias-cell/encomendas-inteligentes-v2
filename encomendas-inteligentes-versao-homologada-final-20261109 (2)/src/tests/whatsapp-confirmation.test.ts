/**
 * TESTES REAIS DE UNIDADE E INTEGRAÇÃO:
 * CONFIRMAÇÃO DE WHATSAPP, FALHAS DE PERSISTÊNCIA, ENVIO AUTOMÁTICO (9 ETAPAS) E SINCRONIZAÇÃO ENTRE COMPUTADORES
 *
 * Executa diretamente as funções reais da aplicação:
 * - executeManualSendConfirmation (whatsappConfirmationService.ts)
 * - executePortariaAutoSend (whatsappConfirmationService.ts)
 * - isStrictWhatsAppApiSuccess (whatsappConfirmationService.ts)
 * - sendWhatsAppMessage (whatsappService.ts)
 * - recordCondoActivity, fetchCondoActivity, subscribeCondoActivity, shouldShowInactivityAlert (activitySyncService.ts)
 * - Endpoints reais HTTP /api/portaria/activity (server.ts)
 */

import fs from 'fs';
import path from 'path';
import {
  normalizeResidentPhone,
  getPackagesNeedingNotification,
  sumPackageItems,
  formatBatchNotes
} from '../lib/packageUtils';
import {
  getWhatsAppLink,
  prepareWhatsAppNotification,
  generatePickupCode,
  sendWhatsAppMessage
} from '../services/whatsappService';
import {
  isStrictWhatsAppApiSuccess,
  executeManualSendConfirmation,
  executePortariaAutoSend,
  PackageNotificationConfirmedFields
} from '../services/whatsappConfirmationService';
import {
  INACTIVITY_ALERT_TIMEOUT_MS,
  shouldShowInactivityAlert,
  recordCondoActivity,
  fetchCondoActivity,
  subscribeCondoActivity
} from '../services/activitySyncService';
import { Morador } from '../types';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  } else {
    console.error(`❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('📱 TESTES REAIS: WHATSAPP, FALHA DE BANCO, API E SYNC');
  console.log('======================================================\n');

  // -----------------------------------------------------------------------------------
  // 1. Normalização de telefones e preparação básica
  // -----------------------------------------------------------------------------------
  const phoneWithDdd = normalizeResidentPhone('(41) 99888-7766');
  assert(
    phoneWithDdd.isValid && phoneWithDdd.phone === '41998887766',
    '1. normalizeResidentPhone: normaliza telefone com DDD para 11 dígitos'
  );

  const phoneWithCountry = normalizeResidentPhone('+55 (11) 98765-4321');
  assert(
    phoneWithCountry.isValid && phoneWithCountry.phone === '11987654321',
    '2. normalizeResidentPhone: remove DDI +55 preservando DDD + número'
  );

  const phoneIncomplete = normalizeResidentPhone('98888-7777');
  assert(
    !phoneIncomplete.isValid && phoneIncomplete.isIncomplete,
    '3. normalizeResidentPhone: identifica telefone sem DDD como incompleto'
  );

  const phoneIncompleteWithDdd = normalizeResidentPhone('98888-7777', '41');
  assert(
    phoneIncompleteWithDdd.isValid && phoneIncompleteWithDdd.phone === '41988887777',
    '4. normalizeResidentPhone: aplica DDD padrão do condomínio'
  );

  const mockResident: Morador = {
    id: 'res-100',
    nome: 'Mariana Souza',
    unidade: '102',
    telefone: '41999990001',
    condominium_id: 'condo-test',
    ativo: true,
    created_at: new Date().toISOString()
  };

  // -----------------------------------------------------------------------------------
  // 2. Estado inicial e abertura do WhatsApp sem marcar como enviada
  // -----------------------------------------------------------------------------------
  let dbPackages: any[] = [
    {
      id: 'pkg-1',
      recipient_id: 'res-100',
      status: 'received',
      whatsapp_status: 'pending',
      whatsapp_notified: false,
      whatsapp_sent: false
    },
    {
      id: 'pkg-2',
      recipient_id: 'res-100',
      status: 'received',
      whatsapp_status: 'pending',
      whatsapp_notified: false,
      whatsapp_sent: false
    }
  ];
  let localPackages = dbPackages.map((p) => ({ ...p }));

  const pickupCode = generatePickupCode();
  assert(pickupCode.length === 4 && /^\d{4}$/.test(pickupCode), '5. generatePickupCode: gera código numérico de 4 dígitos');

  const msg = prepareWhatsAppNotification(mockResident, 'Condomínio Solar', pickupCode, 'Portaria');
  const waLink = getWhatsAppLink(mockResident.telefone, msg || '');
  assert(
    Boolean(msg && msg.includes(pickupCode)) && waLink.startsWith('https://wa.me/5541999990001?text='),
    '6. getWhatsAppLink & prepareWhatsAppNotification: gera link válido sem alterar status da encomenda'
  );
  assert(
    getPackagesNeedingNotification(dbPackages, [mockResident]).length === 2,
    '7. Abertura do link WhatsApp mantém ambas as encomendas pendentes na fila'
  );

  // -----------------------------------------------------------------------------------
  // 3. Confirmação manual (executeManualSendConfirmation) - Falhas reais de persistência + Retry
  // -----------------------------------------------------------------------------------
  const applyLocalUpdate = (pkgIds: string[], fields: PackageNotificationConfirmedFields) => {
    localPackages = localPackages.map((p) => (pkgIds.includes(p.id) ? { ...p, ...fields } : p));
  };

  // 3a. Erro retornado pelo Supabase ({ error }) SEM lançar exceção
  let modalOpen = true;
  let formResetCalled = false;
  const dbErrorRes = await executeManualSendConfirmation({
    packageIds: ['pkg-1'],
    updatePackagesFn: async () => ({
      data: null,
      error: { message: 'new row violates row-level security policy', code: '42501' },
      status: 403
    }),
    onConfirmedLocalState: (fields) => {
      applyLocalUpdate(['pkg-1'], fields);
      modalOpen = false;
      formResetCalled = true;
    }
  });

  assert(
    !dbErrorRes.ok && Boolean(dbErrorRes.error?.includes('row-level security')),
    '8. executeManualSendConfirmation: trata retorno { error } do Supabase sem exceção'
  );
  assert(
    modalOpen === true && formResetCalled === false && localPackages[0].whatsapp_notified === false && dbPackages[0].whatsapp_notified === false,
    '9. Falha com { error }: mantém modal aberto, não reseta formulário e mantém encomenda pendente'
  );

  // 3b. Exceção lançada pelo banco
  const dbExceptionRes = await executeManualSendConfirmation({
    packageIds: ['pkg-1'],
    updatePackagesFn: async () => {
      throw new Error('Failed to fetch: connection reset by peer');
    },
    onConfirmedLocalState: (fields) => {
      applyLocalUpdate(['pkg-1'], fields);
      modalOpen = false;
      formResetCalled = true;
    }
  });
  assert(
    !dbExceptionRes.ok && Boolean(dbExceptionRes.error?.includes('Failed to fetch')) && modalOpen && !localPackages[0].whatsapp_sent,
    '10. executeManualSendConfirmation: captura exceção do banco, mantém modal aberto e encomenda pendente'
  );

  // 3c. Timeout na gravação no banco
  const dbTimeoutRes = await executeManualSendConfirmation({
    packageIds: ['pkg-1'],
    timeoutMs: 40,
    updatePackagesFn: () =>
      new Promise((resolve) => setTimeout(() => resolve({ data: null, error: null, status: 204 }), 250)),
    onConfirmedLocalState: (fields) => {
      applyLocalUpdate(['pkg-1'], fields);
      modalOpen = false;
    }
  });
  assert(
    !dbTimeoutRes.ok && dbTimeoutRes.isTimeout === true && modalOpen && !localPackages[0].whatsapp_notified,
    '11. executeManualSendConfirmation: trata timeout real no Supabase e mantém encomenda pendente'
  );

  // 3d. Retorno inesperado (null / HTTP 500)
  const dbUnexpectedRes = await executeManualSendConfirmation({
    packageIds: ['pkg-1'],
    updatePackagesFn: async () => null as any,
    onConfirmedLocalState: (fields) => applyLocalUpdate(['pkg-1'], fields)
  });
  assert(
    !dbUnexpectedRes.ok && !localPackages[0].whatsapp_sent,
    '12. executeManualSendConfirmation: rejeita retorno inesperado/nulo sem confirmar envio'
  );

  // 3e. Retry bem-sucedido após falha anterior
  const dbRetrySuccess = await executeManualSendConfirmation({
    packageIds: ['pkg-1'],
    pickupCode: '4321',
    updatePackagesFn: async (ids, fields) => {
      dbPackages = dbPackages.map((p) => (ids.includes(p.id) ? { ...p, ...fields } : p));
      return { data: dbPackages.filter((p) => ids.includes(p.id)), error: null, status: 200 };
    },
    onConfirmedLocalState: (fields) => {
      applyLocalUpdate(['pkg-1'], fields);
      modalOpen = false;
      formResetCalled = true;
    }
  });
  assert(
    dbRetrySuccess.ok &&
      !modalOpen &&
      formResetCalled &&
      dbPackages[0].whatsapp_notified === true &&
      localPackages[0].whatsapp_status === 'enviado' &&
      getPackagesNeedingNotification(dbPackages, [mockResident]).length === 1,
    '13. Retry após falha: confirma no Supabase, atualiza estado local, fecha modal e mantém apenas pkg-2 pendente'
  );

  // -----------------------------------------------------------------------------------
  // 4. Validação estrita da API de WhatsApp + Fluxo automático de 9 etapas (executePortariaAutoSend)
  // -----------------------------------------------------------------------------------
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'sucesso', httpStatus: 200 }) === true, '14. isStrictWhatsAppApiSuccess: aceita HTTP 200 + status_envio="sucesso"');
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'sucesso', httpStatus: 201 }) === true, '15. isStrictWhatsAppApiSuccess: aceita HTTP 201 + status_envio="sucesso"');
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'sucesso' }) === false, '16. isStrictWhatsAppApiSuccess: REJEITA resposta sem httpStatus explícito (200/201)');
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'sucesso', httpStatus: 500 }) === false, '17. isStrictWhatsAppApiSuccess: REJEITA HTTP 500');
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'erro', httpStatus: 200 }) === false, '18. isStrictWhatsAppApiSuccess: REJEITA status_envio != "sucesso"');
  assert(isStrictWhatsAppApiSuccess({ status_envio: 'sucesso', httpStatus: 200, error: 'Erro API' }) === false, '19. isStrictWhatsAppApiSuccess: REJEITA quando existe error');

  // 4a. Testando sendWhatsAppMessage real com fetch mockado (HTTP 500, timeout e HTTP 200)
  const originalFetch = globalThis.fetch;
  try {
    // HTTP 500
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })) as any;

    let dbUpdateCalledOnApi500 = false;
    let localUpdatedOnApi500 = false;
    const autoApi500 = await executePortariaAutoSend({
      phone: mockResident.telefone!,
      message: 'Teste HTTP 500',
      condominiumId: 'condo-test',
      packageId: 'pkg-2',
      config: { api_url: 'https://api.whatsapp.local', api_token: 'tok-123', instance_id: 'inst-123', whatsapp_provider: 'zapi' },
      updatePackagesFn: async () => {
        dbUpdateCalledOnApi500 = true;
        return { data: null, error: null, status: 200 };
      },
      onConfirmedLocalState: () => {
        localUpdatedOnApi500 = true;
      }
    });
    assert(
      !autoApi500.ok && autoApi500.stage === 'api' && !dbUpdateCalledOnApi500 && !localUpdatedOnApi500,
      '20. executePortariaAutoSend + sendWhatsAppMessage (HTTP 500): aborta antes do banco e estado local'
    );

    // Timeout real na chamada fetch de sendWhatsAppMessage
    globalThis.fetch = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err: any = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      })) as any;

    const directTimeout = await sendWhatsAppMessage(mockResident.telefone!, 'Teste Timeout', 'condo-test', {
      api_url: 'https://api.whatsapp.local',
      api_token: 'tok-123',
      instance_id: 'inst-123',
      whatsapp_provider: 'zapi',
      timeoutMs: 40
    });
    assert(
      directTimeout.status_envio === 'erro' && directTimeout.httpStatus === 408 && Boolean(directTimeout.error),
      '21. sendWhatsAppMessage: trata timeout com AbortController retornando httpStatus 408 e status_envio="erro"'
    );

    // API HTTP 200 com sucesso, mas falha no Supabase (.update retorna error) -> estado local NÃO deve mudar!
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'msg-999', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })) as any;

    const sequenceOnDbFail: string[] = [];
    let localMutatedOnDbFail = false;
    const autoApiOkDbFail = await executePortariaAutoSend({
      phone: mockResident.telefone!,
      message: 'Teste API OK + Banco Falha',
      condominiumId: 'condo-test',
      packageId: 'pkg-2',
      config: { api_url: 'https://api.whatsapp.local', api_token: 'tok-123', instance_id: 'inst-123', whatsapp_provider: 'zapi' },
      updatePackagesFn: async () => {
        sequenceOnDbFail.push('database_attempt');
        return { data: null, error: { message: 'Database write failed' }, status: 500 };
      },
      onConfirmedLocalState: () => {
        sequenceOnDbFail.push('local_state');
        localMutatedOnDbFail = true;
      }
    });
    assert(
      !autoApiOkDbFail.ok &&
        autoApiOkDbFail.stage === 'database' &&
        !localMutatedOnDbFail &&
        localPackages[1].whatsapp_notified === false,
      '22. executePortariaAutoSend (API 200 + Erro no Supabase): NÃO marca enviado localmente e retorna stage="database"'
    );

    // Fluxo completo bem-sucedido: verifica ordem exata API -> Banco -> Estado Local
    const executionOrder: string[] = [];
    const autoSuccess = await executePortariaAutoSend({
      phone: mockResident.telefone!,
      message: 'Teste Fluxo Completo',
      condominiumId: 'condo-test',
      packageId: 'pkg-2',
      pickupCode: '9988',
      config: { api_url: 'https://api.whatsapp.local', api_token: 'tok-123', instance_id: 'inst-123', whatsapp_provider: 'zapi' },
      sendFn: async (phone, message, condoId, cfg) => {
        executionOrder.push('api');
        return sendWhatsAppMessage(phone, message, condoId, cfg);
      },
      updatePackagesFn: async (ids, fields) => {
        executionOrder.push('database');
        dbPackages = dbPackages.map((p) => (ids.includes(p.id) ? { ...p, ...fields } : p));
        return { data: dbPackages.filter((p) => ids.includes(p.id)), error: null, status: 200 };
      },
      onConfirmedLocalState: (fields) => {
        executionOrder.push('local_state');
        applyLocalUpdate(['pkg-2'], fields);
      }
    });
    assert(
      autoSuccess.ok &&
        executionOrder.join('>') === 'api>database>local_state' &&
        dbPackages[1].whatsapp_sent === true &&
        localPackages[1].whatsapp_status === 'enviado',
      '23. executePortariaAutoSend: cumpre ordem estrita api -> database -> local_state e confirma pkg-2'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -----------------------------------------------------------------------------------
  // 5. Sincronização real entre 2 computadores + Isolamento de Condomínios + Timer 180.000 ms
  // -----------------------------------------------------------------------------------
  assert(INACTIVITY_ALERT_TIMEOUT_MS === 180000, '24. INACTIVITY_ALERT_TIMEOUT_MS é estritamente 180.000 ms (3 minutos)');

  // 5a. Teste da regra temporal pura com shouldShowInactivityAlert
  const baseTs = 1_700_000_000_000;
  assert(
    shouldShowInactivityAlert({ lastActivityTimestamp: baseTs, now: baseTs + 179_999, pendingCount: 3, notifyAfter: true }) === false,
    '25. shouldShowInactivityAlert: NÃO dispara com 179.999 ms (antes de 3 minutos)'
  );
  assert(
    shouldShowInactivityAlert({ lastActivityTimestamp: baseTs, now: baseTs + 180_000, pendingCount: 3, notifyAfter: true }) === true,
    '26. shouldShowInactivityAlert: dispara exatamente aos 180.000 ms quando há pendências'
  );
  assert(
    shouldShowInactivityAlert({ lastActivityTimestamp: baseTs, now: baseTs + 240_000, pendingCount: 0, notifyAfter: true }) === false,
    '27. shouldShowInactivityAlert: desativa imediatamente quando pendingCount chega a 0'
  );

  // 5b. Simulação de 2 computadores sincronizados via servidor (/api/portaria/activity quando online, ou store compartilhado) e Realtime Broadcast
  const condoA = `condo-sync-A-${Date.now()}`;
  const condoB = `condo-sync-B-${Date.now()}`;
  const sharedMemoryApiStore = new Map<string, number>();

  // Tenta chamar o endpoint real do Express em localhost:3000; se o server não estiver rodando no ambiente unitário isolado, usa o espelho HTTP equivalente
  let usingLiveServerEndpoint = false;
  try {
    const probe = await fetch(`http://localhost:3000/api/portaria/activity?condominiumId=${encodeURIComponent(condoA)}`);
    if (probe.ok) usingLiveServerEndpoint = true;
  } catch {
    usingLiveServerEndpoint = false;
  }

  const postActivityAdapter = usingLiveServerEndpoint
    ? undefined
    : async (_endpoint: string, body: any) => {
        const prev = sharedMemoryApiStore.get(body.condominiumId) || 0;
        const nextTs = Math.max(prev, body.timestamp || Date.now());
        sharedMemoryApiStore.set(body.condominiumId, nextTs);
        return { ok: true, data: { success: true, condominiumId: body.condominiumId, lastActivityTimestamp: nextTs } };
      };

  const getActivityAdapter = usingLiveServerEndpoint
    ? undefined
    : async (endpoint: string) => {
        const condoId = decodeURIComponent(endpoint.split('condominiumId=')[1] || '');
        return {
          ok: true,
          data: {
            success: true,
            condominiumId: condoId,
            lastActivityTimestamp: sharedMemoryApiStore.get(condoId) || null
          }
        };
      };

  const t1 = Date.now() - 190_000; // Há mais de 3 min ( Computador B estaria em alerta )
  await recordCondoActivity({
    condominiumId: condoA,
    action: 'ENCOMENDA_CADASTRADA',
    timestamp: t1,
    postActivityFn: postActivityAdapter
  });

  // Computador B consulta o estado do condomínio A -> recebe t1 -> alerta estaria ativo (>180s)
  const compBBefore = await fetchCondoActivity({ condominiumId: condoA, getActivityFn: getActivityAdapter });
  assert(
    compBBefore.ok &&
      compBBefore.lastActivityTimestamp === t1 &&
      shouldShowInactivityAlert({ lastActivityTimestamp: compBBefore.lastActivityTimestamp, now: Date.now(), pendingCount: 2, notifyAfter: true }) === true,
    `28. Computador B (${usingLiveServerEndpoint ? 'HTTP real /api/portaria/activity' : 'store compartilhado'}) sincroniza inatividade >180s do Condomínio A`
  );

  // Agora Computador A APENAS abre o WhatsApp (WHATSAPP_ABERTO) — NÃO confirma envio!
  const t2 = Date.now();
  await recordCondoActivity({
    condominiumId: condoA,
    action: 'WHATSAPP_ABERTO',
    packageId: 'pkg-pending-sync',
    timestamp: t2,
    postActivityFn: postActivityAdapter
  });

  // Computador B atualiza via servidor -> timer de 3 min zera no Computador B! E Condomínio B continua isolado (null)!
  const compBAfterOpen = await fetchCondoActivity({ condominiumId: condoA, getActivityFn: getActivityAdapter });
  const condoBCheck = await fetchCondoActivity({ condominiumId: condoB, getActivityFn: getActivityAdapter });

  assert(
    compBAfterOpen.ok &&
      compBAfterOpen.lastActivityTimestamp !== null &&
      compBAfterOpen.lastActivityTimestamp >= t2 &&
      shouldShowInactivityAlert({ lastActivityTimestamp: compBAfterOpen.lastActivityTimestamp, now: t2 + 5000, pendingCount: 2, notifyAfter: true }) === false,
    '29. Abertura do WhatsApp no Computador A reinicia o temporizador de 3 min no Computador B (sem localStorage compartilhado)'
  );
  assert(
    condoBCheck.ok && condoBCheck.lastActivityTimestamp === null,
    '30. Isolamento por condomínio: atividade no Condomínio A NÃO afeta Condomínio B'
  );

  // Testa também canal Realtime Broadcast isolado por condomínio (subscribeCondoActivity)
  const busListeners = new Map<string, Array<(msg: any) => void>>();
  const createSimulatedRealtimeSupabase = () =>
    ({
      channel: (channelName: string) => {
        const callbacks: Array<(msg: any) => void> = [];
        const list = busListeners.get(channelName) || [];
        const obj: any = {
          on: (type: string, filterOrOpts: any, cb: (msg: any) => void) => {
            if (type === 'broadcast') {
              callbacks.push(cb);
              list.push(cb);
              busListeners.set(channelName, list);
            }
            return obj;
          },
          subscribe: () => obj,
          send: async (msg: any) => {
            const targets = busListeners.get(channelName) || [];
            targets.forEach((fn) => fn(msg));
          },
          unsubscribe: () => {}
        };
        return obj;
      },
      removeChannel: () => {}
    } as any);

  const simSupabase = createSimulatedRealtimeSupabase();
  let compBReceivedTs: number | null = null;
  let compCReceivedTs: number | null = null;

  const subCompB = subscribeCondoActivity({
    condominiumId: condoA,
    supabaseClient: simSupabase,
    onRemoteActivity: (ts) => {
      compBReceivedTs = ts;
    }
  });
  const subCompC = subscribeCondoActivity({
    condominiumId: condoB,
    supabaseClient: simSupabase,
    onRemoteActivity: (ts) => {
      compCReceivedTs = ts;
    }
  });

  const t3 = Date.now() + 1000;
  await recordCondoActivity({
    condominiumId: condoA,
    action: 'WHATSAPP_RETORNO',
    timestamp: t3,
    postActivityFn: postActivityAdapter,
    realtimeBroadcastFn: (payload) => subCompB.broadcast(payload)
  });

  assert(
    compBReceivedTs === t3 && compCReceivedTs === null,
    '31. subscribeCondoActivity (Realtime): evento WHATSAPP_RETORNO do Condomínio A propaga para Computador B e isola Condomínio B'
  );
  subCompB.unsubscribe();
  subCompC.unsubscribe();

  // -----------------------------------------------------------------------------------
  // 6. Cálculos de lote e auditoria estática de conformidade no código-fonte real
  // -----------------------------------------------------------------------------------
  const totalItems = sumPackageItems([
    { id: 'b-1', notes: '[QTD: 3] Lote 3' },
    { id: 'b-2', notes: 'Simples' },
    { id: 'b-3', notes: '[QTD: 2] Lote 2' }
  ]);
  assert(totalItems === 6, '32. sumPackageItems: soma corretamente 3 + 1 + 2 = 6 volumes');
  assert(formatBatchNotes('Caixa grande', 4).includes('[QTD: 4]'), '33. formatBatchNotes: preserva nota e quantidade');

  const portariaCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Portaria.tsx'), 'utf-8');
  const packageNewCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PackageNew.tsx'), 'utf-8');

  assert(
    portariaCode.includes('executePortariaAutoSend') &&
      portariaCode.includes('executeManualSendConfirmation') &&
      portariaCode.includes('recordCondoActivity') &&
      !portariaCode.includes('!result.httpStatus'),
    '34. Portaria.tsx: usa funções canônicas de confirmação/sync e NÃO aceita resposta da API sem httpStatus'
  );

  assert(
    packageNewCode.includes('executePortariaAutoSend') &&
      packageNewCode.includes('executeManualSendConfirmation') &&
      packageNewCode.includes('recordCondoActivity') &&
      !packageNewCode.includes('!apiResult.httpStatus'),
    '35. PackageNew.tsx: usa funções canônicas de confirmação/sync e NÃO aceita resposta da API sem httpStatus'
  );

  console.log('\n------------------------------------------------------');
  console.log(`TOTAL APROVADOS: ${passed}/${total}`);
  console.log('======================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
