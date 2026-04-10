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
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
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
export const assembleWhatsAppMessage = (vars: WhatsAppVariables): string => {
  const BASE_URL = (typeof process !== 'undefined' && process.env?.APP_URL) || 
                   (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) || 
                   "https://encomendas-inteligentes-v2.vercel.app";
  const linkRetirada = vars.pickup_token 
    ? `${BASE_URL}/retirada?token=${vars.pickup_token}`
    : `${BASE_URL}/retirada?code=${vars.codigo_retirada}`;
  
  // Limpeza rigorosa da observação (Tipo da encomenda)
  const cleanObs = vars.observacao ? vars.observacao
    .replace(/FAVOR DESCONSIDERAR[!]?/gi, '')
    .replace(/Corpo da mensagem enviada[👇]?/gi, '')
    .replace(/MENSAGEM DE TESTE/gi, '')
    .replace(/\s\s+/g, ' ')
    .trim() : 'Encomenda';

  const lines = [
    `${vars.saudacao}, ${vars.nome_morador}! 📦`,
    '',
    `Chegou uma encomenda para sua unidade ${vars.unidade}${vars.bloco_torre ? ` ${vars.bloco_torre}` : ''}${vars.quantidade_encomendas && vars.quantidade_encomendas > 1 ? ` (${vars.quantidade_encomendas} encomendas)` : ''}.`,
    '',
    `Clique no link abaixo para visualizar seu código de retirada e apresentar na portaria:`,
    '',
    `${linkRetirada}`
  ];

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
  packageCount?: number
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
    quantidade_encomendas: packageCount
  };

  return assembleWhatsAppMessage(vars);
};

/**
 * Generates a WhatsApp wa.me link for manual sending
 */
export const getWhatsAppLink = (phone: string, message: string): string => {
  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.length > 0 && !normalizedPhone.startsWith('55')) {
    normalizedPhone = '55' + normalizedPhone;
  }
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
  }
) {
  if (!message || message.trim() === "") {
    console.warn('[WhatsApp Service] Mensagem vazia');
    return { error: 'Mensagem vazia', httpStatus: 400 };
  }

  // Normalize phone number: remove all non-digits
  let normalizedPhone = phone.replace(/\D/g, '');
  
  // Ensure it starts with 55
  if (normalizedPhone.length > 0 && !normalizedPhone.startsWith('55')) {
    normalizedPhone = '55' + normalizedPhone;
  }

  if (normalizedPhone.length < 12) { // 55 + DDD + 8 or 9 digits
    console.warn('[WhatsApp Service] Telefone inválido:', normalizedPhone);
    return { error: 'Telefone inválido', httpStatus: 400 };
  }

  // Use provided config or fallback to hardcoded (for backward compatibility/default)
  const apiUrl = config?.api_url || "https://api.z-api.io/instances/3F0CA22AFB9F62F46D76D268A7BECB03/token/851123DB426AFD0E08384D87/send-text";
  const apiToken = config?.api_token || "F3cec1a5aa2b14f0cbc667b86c75de2ebS";

  console.log("Enviando WhatsApp via API:", {
    phone: normalizedPhone,
    apiUrl: apiUrl.split('/token/')[0] + '/...' // Hide token in logs
  });

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": apiToken
      },
      body: JSON.stringify({
        phone: normalizedPhone,
        message: message
      })
    });

    const data = await response.json();
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
    
    return { ...data, httpStatus: response.status, status_envio };
  } catch (error) {
    console.error("Erro na API de WhatsApp:", error);
    return { error: error instanceof Error ? error.message : String(error), httpStatus: 500, status_envio: 'erro' };
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
