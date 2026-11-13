import { Morador } from '../types';
import { supabase } from '../lib/supabase';

export interface WhatsAppVariables {
  saudacao: string;
  nome_morador: string;
  unidade: string;
  rua_logradouro?: string;
  bloco_torre?: string;
  codigo_retirada: string;
  data_recebimento: string;
  hora_recebimento: string;
  nome_condominio: string;
  observacao?: string;
  pickup_token?: string;
  quantidade_encomendas?: number;
  tipo_notificacao?: 'disponivel' | 'retirada';
  retirado_por?: string;
  hora_retirada?: string;
  photo_url?: string;
  is_large_package?: boolean;
}

/**
 * Generates a 4-digit random pickup code
 */
export const generatePickupCode = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Returns a greeting based on the current time
 */
export const getGreeting = (): string => {
  const hour = new Date().getHours();
  // 06:00 até 11:59 → Bom dia
  if (hour >= 6 && hour < 12) return 'Bom dia';
  // 12:00 até 17:59 → Boa tarde
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  // 18:00 até 05:59 → Boa noite
  return 'Boa noite';
};

/**
 * Formats the unit type and number correctly
 */
export const formatUnit = (resident: Morador): string => {
  const type = resident.unit_type || 'Unidade';
  return `${type} ${resident.unidade}`;
};

/**
 * Assembles the WhatsApp message from variables following the "Encomendas Inteligentes" standard
 */
// Helper robusto para obter o link público absoluto de retirada da encomenda com foto e código
export const getRetiradaPageLink = (pickupToken?: string, fallbackPhotoUrl?: string): string => {
  if (pickupToken && pickupToken.trim().length > 0) {
    const cleanToken = encodeURIComponent(pickupToken.trim());
    
    // 1. Obtém URL base configurada explicitamente por variável de ambiente ou localStorage
    const configuredUrl = (typeof window !== 'undefined' && (localStorage.getItem('public_app_url') || localStorage.getItem('homologacao_app_url')))
      || (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_APP_URL || import.meta.env?.VITE_HOMOLOG_URL))
      || (typeof process !== 'undefined' && (process.env?.VITE_APP_URL || process.env?.APP_URL))
      || '';

    if (configuredUrl) {
      return `${configuredUrl.replace(/\/$/, '')}/retirada?token=${cleanToken}`;
    }

    // 2. Se estiver em ambiente de navegador
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = window.location.origin;
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
      const isAiStudioDev = origin.includes('ais-dev-');

      // Se estiver no sandbox de desenvolvimento do AI Studio (Cloud Run),
      // converte para o Shared App URL (ais-pre-), que é público e acessível no celular sem login Google
      if (isAiStudioDev) {
        const sharedUrl = origin.replace('ais-dev-', 'ais-pre-');
        return `${sharedUrl.replace(/\/$/, '')}/retirada?token=${cleanToken}`;
      }

      // Se for domínio público real (Vercel de homologação, domínio próprio, preview etc. não localhost)
      if (!isLocalhost && !origin.includes('.run.app')) {
        return `${origin.replace(/\/$/, '')}/retirada?token=${cleanToken}`;
      }

      // Se for localhost puro sem URL pública configurada, usa o origin local (nunca força produção silenciosamente)
      return `${origin.replace(/\/$/, '')}/retirada?token=${cleanToken}`;
    }

    // 3. Fallback para execução sem window
    return `/retirada?token=${cleanToken}`;
  }
  return fallbackPhotoUrl || '';
};

export const assembleWhatsAppMessage = (vars: WhatsAppVariables): string => {
  const isRetirada = vars.tipo_notificacao === 'retirada';
  
  if (isRetirada) {
    return [
      `${vars.saudacao}, ${vars.nome_morador}!`,
      '',
      `📦 Sua encomenda foi retirada`,
      '',
      `📍 ${vars.unidade}`,
      `🕒 ${vars.hora_retirada || vars.hora_recebimento}`,
      `👤 Retirado por: *${vars.retirado_por || 'morador'}*`,
      '',
      `Qualquer dúvida estamos à disposição.`,
      `*${vars.nome_condominio}*`
    ].join('\n');
  }

  // Modelo especial para ENCOMENDA GRANDE
  if (vars.is_large_package) {
    const qty = (vars.quantidade_encomendas && vars.quantidade_encomendas > 0) ? vars.quantidade_encomendas : 1;
    const packageDesc = qty > 1
      ? `Recebemos *${qty} encomendas (incluindo volume grande)* para sua unidade (${vars.unidade}).`
      : `Recebemos uma *ENCOMENDA GRANDE* para sua unidade (${vars.unidade}).`;

    return [
      `🔔 *AVISO IMPORTANTE – PORTARIA*`,
      '',
      `${vars.saudacao}, ${vars.nome_morador}.`,
      '',
      packageDesc,
      '',
      `👉 Por gentileza, solicitamos retirada o mais breve possível devido ao volume.`,
      '',
      `📸 Clique no link para ver a foto da encomenda:`,
      `${getRetiradaPageLink(vars.pickup_token, vars.photo_url) || 'Link não disponível'}`,
      '',
      `🔐 Código de retirada: ${vars.codigo_retirada}`,
      '',
      `Obrigado!`,
      `Portaria`
    ].join('\n');
  }

  // Modelo padronizado para encomendas recebidas (respeita singular/plural com quantitativo real canônico)
  const qty = (vars.quantidade_encomendas && vars.quantidade_encomendas > 0)
    ? vars.quantidade_encomendas
    : 1;

  const headerTitle = qty > 1
    ? '📦 Suas encomendas chegaram!'
    : '📦 Sua encomenda chegou!';

  const lines = [
    `${vars.saudacao}, ${vars.nome_morador}!`,
    '',
    headerTitle,
    '',
    `📍 ${vars.unidade}`,
  ];

  if (qty > 1) {
    lines.push(`📦 Você possui *${qty} encomendas disponíveis* para retirada.`);
  }

  lines.push(`📦 Código: *${vars.codigo_retirada}*`);
  lines.push(`🕒 ${vars.data_recebimento} às ${vars.hora_recebimento}`);
  lines.push('');
  lines.push('Por gentileza, apresente o código para retirada.');

  const pageLink = getRetiradaPageLink(vars.pickup_token, vars.photo_url);
  if (pageLink) {
    lines.push('');
    lines.push(`📸 Clique no link para ver a foto da encomenda:`);
    lines.push(pageLink);
  }

  return lines.join('\n');
};

/**
 * Prepares the full WhatsApp message for a resident
 */
export const prepareWhatsAppNotification = (
  resident: Morador,
  condoName: string,
  pickupCode: string,
  observation?: string,
  pickupToken?: string,
  packageCount?: number,
  notificationType: 'disponivel' | 'retirada' = 'disponivel',
  retiradoPor?: string,
  horaRetirada?: string,
  photoUrl?: string,
  isLargePackage?: boolean
): string | null => {
  // Do not notify inactive residents
  if (!resident.ativo) return null;

  const now = new Date();
  
  // Rule for block/tower: use only if exists, don't duplicate
  const blocoTorre = resident.block || resident.bloco || resident.lote;

  const vars: WhatsAppVariables = {
    saudacao: getGreeting(),
    nome_morador: resident.nome,
    unidade: formatUnit(resident),
    bloco_torre: blocoTorre,
    codigo_retirada: pickupCode,
    data_recebimento: now.toLocaleDateString('pt-BR'),
    hora_recebimento: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    nome_condominio: condoName,
    observacao: observation,
    pickup_token: pickupToken,
    quantidade_encomendas: packageCount,
    tipo_notificacao: notificationType,
    retirado_por: retiradoPor,
    hora_retirada: horaRetirada,
    photo_url: photoUrl,
    is_large_package: isLargePackage
  };

  return assembleWhatsAppMessage(vars);
};

/**
 * Generates a WhatsApp wa.me link for manual sending
 */
export const getWhatsAppLink = (phone: string, message: string, photoUrl?: string): string => {
  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.length > 0 && !normalizedPhone.startsWith('55')) {
    normalizedPhone = '55' + normalizedPhone;
  }
  
  // A mensagem já inclui o link da foto se disponível (conforme assembleWhatsAppMessage)
  const encodedMessage = encodeURIComponent(message);
  
  return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
};

/**
 * Sends a WhatsApp message via dynamic API configuration
 */
export async function sendWhatsAppMessage(
  phone: string, 
  message: string, 
  condominiumId: string,
  config?: {
    api_url?: string;
    api_token?: string;
    instance_id?: string;
    whatsapp_provider?: string;
    photo_url?: string;
    isTestMode?: boolean;
    is_teste?: boolean;
    timeoutMs?: number;
  }
) {
  if (!message || message.trim() === "") {
    console.warn('[WhatsApp Service] Mensagem vazia');
    return { error: 'Mensagem vazia', httpStatus: 400, status_envio: 'erro' };
  }

  // Normalize phone number: remove all non-digits
  let normalizedPhone = phone.replace(/\D/g, '');
  
  // Ensure it starts with 55
  if (normalizedPhone.length > 0 && !normalizedPhone.startsWith('55')) {
    normalizedPhone = '55' + normalizedPhone;
  }

  if (normalizedPhone.length < 12) { // 55 + DDD + 8 or 9 digits
    console.warn('[WhatsApp Service] Telefone inválido:', normalizedPhone);
    return { error: 'Telefone inválido', httpStatus: 400, status_envio: 'erro' };
  }

  // =========================================================================
  // BLOQUEIO CRÍTICO DE SEGURANÇA: MODO TESTE (NUNCA ENVIAR MENSAGEM REAL)
  // =========================================================================
  if (config?.isTestMode || config?.is_teste) {
    console.log(`[WhatsApp Service] [🧪 SIMULAÇÃO MODO TESTE ATIVA] Bloqueio de envio real para: ${normalizedPhone}`);
    
    // Registra log da simulação sem fazer chamada externa HTTP
    try {
      await supabase.from('message_logs').insert([{
        condominium_id: condominiumId,
        telefone: normalizedPhone,
        status_envio: 'simulado_teste',
        tipo: 'whatsapp_teste',
        conteudo: message,
        data_envio: new Date().toISOString(),
        detalhes: { modo: 'teste', simulacao: true }
      }]);
    } catch (e) {
      console.warn('[WhatsApp Service] Log de simulação local:', e);
    }

    return {
      status_envio: 'sucesso',
      is_teste: true,
      is_simulated: true,
      message: 'Notificação simulada (MODO TESTE). Nenhuma mensagem foi enviada ao WhatsApp.',
      httpStatus: 200,
      data: { simulated: true }
    };
  }

  console.log("Enviando mensagem para:", normalizedPhone);

  // Utilize estritamente as configurações fornecidas (sem credenciais hardcoded)
  let baseApiUrl = (config?.api_url || "https://api.z-api.io").replace(/\/$/, '');
  const apiToken = (config?.api_token || "").trim();
  const instanceId = (config?.instance_id || "").trim();

  if (!apiToken || !instanceId) {
    console.warn('[WhatsApp Service] Instância ou Token da Z-API não configurados.');
    return { error: 'Instância ou Token da Z-API não configurados', httpStatus: 400, status_envio: 'erro' };
  }

  // Envio exclusivo como mensagem de texto (send-text)
  // A foto da encomenda é acessada exclusivamente via link público de retirada
  let finalApiUrl = "";
  if (baseApiUrl.includes('/instances/')) {
    finalApiUrl = baseApiUrl.replace(/\/send-image\/?$/, '/send-text');
    if (!finalApiUrl.endsWith('/send-text')) {
      finalApiUrl = `${finalApiUrl.replace(/\/$/, '')}/send-text`;
    }
  } else {
    finalApiUrl = `${baseApiUrl}/instances/${instanceId}/token/${apiToken}/send-text`;
  }

  const timeoutMs = config?.timeoutMs ?? 15000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutTimer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const body = {
      phone: normalizedPhone,
      message: message.trim()
    };

    const response = await fetch(finalApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {})
    });

    if (timeoutTimer) clearTimeout(timeoutTimer);

    const data = await response.json().catch(() => ({}));
    const status_envio = response.ok ? 'sucesso' : 'erro';
    
    // Log no banco de dados
    try {
      await supabase.from('message_logs').insert([{
        condominium_id: condominiumId,
        telefone: normalizedPhone,
        status_envio: status_envio,
        status: response.ok ? 'sent' : 'failed',
        erro_api: !response.ok ? JSON.stringify(data) : null,
        data_envio: new Date().toISOString()
      }]);
    } catch (logErr) {
      console.error("Erro ao registrar log de mensagem:", logErr);
    }
    
    return {
      ...data,
      httpStatus: response.status,
      status_envio,
      ...(response.ok ? {} : { error: data?.error || data?.message || `Erro HTTP ${response.status}` })
    };
  } catch (error: any) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    const isTimeout = error?.name === 'AbortError';
    console.error("Erro na API de WhatsApp:", error);
    return {
      error: isTimeout ? `Timeout ao aguardar resposta da API (${timeoutMs}ms)` : (error instanceof Error ? error.message : String(error)),
      httpStatus: isTimeout ? 408 : 500,
      status_envio: 'erro'
    };
  }
}

/**
 * Tests the Z-API connection by attempting a simple profile fetch or similar lightweight call
 */
export async function testZApiConnection(apiUrl: string, apiToken: string) {
  if (!apiUrl || !apiToken) {
    return { success: false, error: 'URL ou Token não informados' };
  }

  try {
    // Z-API usually has a /status or /instance-status endpoint. 
    // We'll try to reach the base instance URL to check connectivity.
    // The apiUrl usually ends in /send-text, we need the base instance URL.
    const baseUrl = apiUrl.split('/token/')[0];
    
    const response = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": apiToken
      }
    });

    if (response.ok) {
      return { success: true };
    } else {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.message || `Erro HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
