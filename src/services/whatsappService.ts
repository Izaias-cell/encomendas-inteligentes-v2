import { Morador } from '../types';
import { supabase } from '../lib/supabase';

export interface WhatsAppVariables {
  saudacao: string;
  nome_morador: string;
  unidade: string;
  rua_logradouro?: string;
  bloco_torre?: string;
  codigo_retirada: string;
  pickup_token: string;
  data_recebimento: string;
  hora_recebimento: string;
  nome_condominio: string;
  observacao?: string;
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
  const baseUrl = 'https://encomendas-inteligentes-v2.vercel.app';
const linkRetirada = `${baseUrl}/retirada?token=${vars.pickup_token}`;
  
  // Limpeza rigorosa da observação (Tipo da encomenda)
  const cleanObs = vars.observacao ? vars.observacao
    .replace(/FAVOR DESCONSIDERAR[!]?/gi, '')
    .replace(/Corpo da mensagem enviada[👇]?/gi, '')
    .replace(/MENSAGEM DE TESTE/gi, '')
    .replace(/\s\s+/g, ' ')
    .trim() : 'Encomenda';

  const lines = [
    `${vars.saudacao}, ${var8s.nome_morador}!`,
    '',
    `Sua encomenda chegou na portaria.`,
    '',
    `Unidade: ${vars.unidade}${vars.bloco_torre ? ` ${vars.bloco_torre}` : ''}`,
    '',
    `📦 Tipo: ${cleanObs || 'Encomenda'}`,
    '',
    `🔐 Código de retirada:`,
    `\`${vars.codigo_retirada}\``,
    '',
    `Ou utilize o QR Code abaixo:`,
    `${linkRetirada}`,
    '',
    `Recebido em ${vars.data_recebimento} às ${vars.hora_recebimento}.`,
    '',
    `Portaria - ${vars.nome_condominio}`
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
pickupToken: string,
observation?: string
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
    pickup_token: pickupToken,
    data_recebimento: now.toLocaleDateString('pt-BR'),
    hora_recebimento: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    nome_condominio: condoName,
    observacao: observation
  };

  return assembleWhatsAppMessage(vars);
};

/**
 * Sends a WhatsApp message via Z-API (Hardcoded credentials as requested)
 */
export async function sendWhatsAppMessage(phone: string, message: string, condominiumId: string) {
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

  console.log("Enviando WhatsApp:", {
    phone: normalizedPhone,
    message: message
  });

  try {
    // Requisição com Account Security Token (Client-Token)
    const response = await fetch("https://api.z-api.io/instances/3F0CA22AFB9F62F46D76D268A7BECB03/token/851123DB426AFD0E08384D87/send-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": "F3cec1a5aa2b14f0cbc667b86c75de2ebS"
      },
      body: JSON.stringify({
        phone: normalizedPhone,
        message: message
      })
    });

    const data = await response.json();
    const status_envio = response.ok ? 'sucesso' : 'erro';
    
    console.log("Resposta completa Z-API:", {
      status: response.status,
      ok: response.ok,
      data: data
    });
    
    // Log no banco de dados
    try {
      await supabase.from('message_logs').insert([{
        condominium_id: condominiumId,
        telefone: normalizedPhone,
        status_envio: status_envio,
        status: response.ok ? 'sent' : 'failed', // Mantendo compatibilidade se necessário
        erro_api: !response.ok ? JSON.stringify(data) : null,
        data_envio: new Date().toISOString()
      }]);
    } catch (logErr) {
      console.error("Erro ao registrar log de mensagem:", logErr);
    }
    
    if (!response.ok) {
      console.error("Erro detalhado Z-API:", data);
    } else {
      console.log('[WhatsApp Service] Sucesso no envio:', data);
    }

    return { ...data, httpStatus: response.status, status_envio };
  } catch (error) {
    console.error("Erro Z-API:", error);
    
    // Log de erro de conexão/exceção
    try {
      await supabase.from('message_logs').insert([{
        condominium_id: condominiumId,
        telefone: normalizedPhone,
        status_envio: 'erro',
        status: 'failed',
        erro_api: error instanceof Error ? error.message : String(error),
        data_envio: new Date().toISOString()
      }]);
    } catch (logErr) {
      console.error("Erro ao registrar log de erro de mensagem:", logErr);
    }

    return { error: error instanceof Error ? error.message : String(error), httpStatus: 500, status_envio: 'erro' };
  }
}
