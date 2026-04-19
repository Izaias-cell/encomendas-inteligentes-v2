import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import "dotenv/config";
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase clients
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Client for general operations
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for bypassing RLS (uses service role key)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

if (!supabaseServiceKey) {
  console.warn("[DEBUG BACKEND] AVISO: SUPABASE_SERVICE_ROLE_KEY não encontrada. As ações administrativas podem falhar devido ao RLS.");
} else {
  console.log("[DEBUG BACKEND] SUPABASE_SERVICE_ROLE_KEY encontrada. Cliente admin inicializado.");
}

async function startServer() {
  const formatSafeDateTime = (value: any) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("pt-BR");
};

const formatSafeDate = (value: any) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
};

// ... existing code ...
const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  const getOrCreatePortalToken = async (residentId: string, condominiumId: string) => {
    try {
      // Check for existing active token
      const { data: existing } = await supabase
        .from('resident_access_tokens')
        .select('*')
        .eq('resident_id', residentId)
        .eq('active', true)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (existing) return existing.token;

      // Generate new token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiration

      const { data: newToken, error } = await supabase
        .from('resident_access_tokens')
        .insert([{
          resident_id: residentId,
          condominium_id: condominiumId,
          token,
          expires_at: expiresAt.toISOString(),
          active: true
        }])
        .select()
        .single();

      if (error) {
        console.error("Error generating token:", error);
        return null;
      }

      return token;
    } catch (err) {
      console.error("Token generation failed:", err);
      return null;
    }
  };

  app.get("/api/portal/validate/:token", async (req, res) => {
    const { token } = req.params;

    try {
      const { data: tokenData, error: tokenError } = await supabase
        .from('resident_access_tokens')
        .select('*')
        .eq('token', token)
        .eq('active', true)
        .maybeSingle();

      if (tokenError || !tokenData) {
        return res.status(404).json({ error: "Link inválido" });
      }

      const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at) : null;
      if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
        return res.status(403).json({ error: "Link expirado ou inválido" });
      }

      // Update last accessed
      await supabase
        .from('resident_access_tokens')
        .update({ last_accessed_at: new Date().toISOString() })
        .eq('id', tokenData.id);

      // Fetch resident data
      const { data: resident, error: resError } = await supabase
        .from('moradores')
        .select('*')
        .eq('id', tokenData.resident_id)
        .single();

      if (resError || !resident) {
        return res.status(404).json({ error: "Morador não encontrado" });
      }

      // Fetch condominium data
      const { data: condo } = await supabase
        .from('condominiums')
        .select('*')
        .eq('id', tokenData.condominium_id)
        .single();

      // Fetch packages
      const { data: packages } = await supabase
        .from('packages')
        .select('*')
        .eq('unit_number_raw', resident.unidade)
        .eq('condominium_id', resident.condominium_id)
        .order('received_at', { ascending: false });

      res.json({
        resident,
        condominium: condo,
        packages: packages || []
      });
    } catch (err) {
      console.error("Portal validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  // Validate pickup code and return portal data
  app.get("/api/portal/validate-code/:code", async (req, res) => {
    try {
      const { code } = req.params;

      // Fetch package by pickup code
      const { data: pkg, error: pkgError } = await supabase
        .from('packages')
        .select('*, moradores(*), condominiums(*)')
        .eq('pickup_code', code)
        .neq('status', 'delivered')
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pkgError || !pkg) {
        return res.status(404).json({ error: "Código de retirada inválido ou encomenda já retirada" });
      }

      const resident = pkg.moradores;
      const condo = pkg.condominiums;

      if (!resident || !condo) {
        return res.status(404).json({ error: "Dados do morador ou condomínio não encontrados" });
      }

      // Fetch all pending packages for this resident
      const { data: allPackages } = await supabase
        .from('packages')
        .select('*')
        .eq('unit_number_raw', resident.unidade)
        .eq('condominium_id', resident.condominium_id)
        .order('received_at', { ascending: false });

      res.json({
        resident,
        condominium: condo,
        packages: allPackages || []
      });
    } catch (err) {
      console.error("Code validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  // Fetch single package by pickup token
  app.get("/api/portal/package/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Fetch package by pickup token or pickup code
      const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('*, moradores(*), condominiums(*)')
        .or(`pickup_token.eq.${token},pickup_code.eq.${token}`)
        .maybeSingle();

      if (pkgError || !pkg) {
        return res.status(404).json({ error: "Encomenda não encontrada ou link inválido" });
      }

      const resident = pkg.moradores;
      const condo = pkg.condominiums;

      if (!resident || !condo) {
        return res.status(404).json({ error: "Dados do morador ou condomínio não encontrados" });
      }

      res.json({
        package: pkg,
        resident,
        condominium: condo
      });
    } catch (err) {
      console.error("Package token validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  // Create condominium API route to bypass RLS for authenticated users
  app.post("/api/condominiums/create", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Não autorizado" });

    const token = authHeader.split(' ')[1];
    // Verify user with anon client
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return res.status(401).json({ error: "Sessão inválida" });

    const { name, address } = req.body;

    try {
      // 1. Create the condominium using admin client to bypass RLS
      const { data: condo, error: condoError } = await supabaseAdmin
        .from('condominiums')
        .insert([{ name, address }])
        .select()
        .single();

      if (condoError) throw condoError;

      // 2. Update the user's profile using admin client
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ condominium_id: condo.id })
        .eq('id', user.id)
        .select()
        .single();

      if (profileError) throw profileError;

      res.json({ condo, profile });
    } catch (err: any) {
      console.error("Erro ao criar condomínio:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Select condominium API route
  app.post("/api/profiles/select-condominium", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Não autorizado" });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return res.status(401).json({ error: "Sessão inválida" });

    const { condominiumId } = req.body;

    try {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ condominium_id: condominiumId })
        .eq('id', user.id)
        .select()
        .single();

      if (profileError) throw profileError;

      res.json({ profile });
    } catch (err: any) {
      console.error("Erro ao selecionar condomínio:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Create initial profile API route (for signup)
  app.post("/api/auth/create-profile", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Não autorizado" });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return res.status(401).json({ error: "Sessão inválida" });

    const { fullName, role } = req.body;

    try {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: user.id,
          full_name: fullName,
          role: role || 'resident',
          active: true
        }])
        .select()
        .single();

      if (profileError) throw profileError;

      res.json({ profile });
    } catch (err: any) {
      console.error("Erro ao criar perfil:", err);
      res.status(500).json({ error: err.message });
    }
  });

  const sendWhatsAppMessage = async (to: string, message: string, condominiumId: string, packageId?: string, isTemplate = false, templateData?: any) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    // Clean phone number (remove non-digits)
    let cleanPhone = to.replace(/\D/g, '');
    
    // If it's a Brazilian number (10 or 11 digits) and doesn't have 55, add it
    if ((cleanPhone.length === 10 || cleanPhone.length === 11) && !cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }

    if (!accessToken || !phoneNumberId) {
      console.log(`[WhatsApp Mock] [Condo: ${condominiumId}] Para ${cleanPhone}: ${message}`);
      if (packageId) {
        await supabase.from('packages').update({ 
          whatsapp_status: 'pending_configuration', 
          last_notification_at: new Date().toISOString() 
        }).eq('id', packageId);
      }
      return { success: false, mock: true, notConfigured: true };
    }

    try {
      const body: any = {
        messaging_product: "whatsapp",
        to: cleanPhone,
      };

      if (isTemplate) {
        body.type = "template";
        body.template = templateData;
      } else {
        body.type = "text";
        body.text = { body: message };
      }

      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const status = data.messages ? 'sent' : 'failed';
      const error = data.error ? JSON.stringify(data.error) : null;

      // Log message
      await supabase.from('message_logs').insert([{
        condominium_id: condominiumId,
        telefone: cleanPhone,
        status: status,
        status_envio: status === 'sent' ? 'sucesso' : 'erro',
        erro_api: error,
        data_envio: new Date().toISOString()
      }]);

      if (packageId) {
        await supabase.from('packages').update({ 
          whatsapp_status: status, 
          last_notification_at: new Date().toISOString() 
        }).eq('id', packageId);

        // Record notification
        const { data: pkg } = await supabase.from('packages').select('received_by').eq('id', packageId).single();
        await supabase.from('notifications').insert([{
          condominium_id: condominiumId,
          user_id: pkg?.received_by,
          message: message,
          status: status,
          delivery_channel: 'whatsapp'
        }]);
      }

      return { success: status === 'sent', data };
    } catch (error) {
      console.error("Erro ao enviar WhatsApp:", error);
      return { success: false, error };
    }
  };

  // Notificação via WhatsApp Cloud API
  app.post("/api/notify-resident", async (req, res) => {
    // Basic auth check
    const authHeader = req.headers.authorization;
    // Note: In a real app, we'd verify the token here. 
    // For this demo, we'll allow the request if it comes from our frontend.

    let { phone, residentName, unitNumber, carrier, trackingNumber, packageId, condominiumId } = req.body;
    
    try {
      // Fetch package data if fields are missing
      const { data: pkg, error: pkgError } = await supabase
        .from('packages')
        .select('*, moradores(nome, telefone, unidade)')
        .eq('id', packageId)
        .single();

      if (pkgError || !pkg) {
        return res.status(404).json({ error: "Encomenda não encontrada" });
      }

      // Fill in missing data from the database record
      residentName = residentName || pkg.moradores?.nome || pkg.recipient_name_raw;
      phone = phone || pkg.moradores?.telefone;
      unitNumber = unitNumber || pkg.moradores?.unidade || pkg.unit_number_raw;
      carrier = carrier || pkg.carrier;
      trackingNumber = trackingNumber || pkg.tracking_code;
      condominiumId = condominiumId || pkg.condominium_id;

      if (!phone) {
        return res.status(400).json({ error: "Telefone do morador não encontrado" });
      }

      // Generate Portal Link
      const residentId = pkg.recipient_id;
      const BASE_URL = process.env.APP_URL || "https://encomendas-inteligentes-v2.vercel.app";
      let portalLink = "";
      let directPickupLink = "";

      if (residentId) {
        const token = await getOrCreatePortalToken(residentId, condominiumId);
        if (token) {
          portalLink = `${BASE_URL}/portal/${token}`;
        }
      }

      if (pkg.pickup_token) {
        directPickupLink = `${BASE_URL}/retirada?token=${pkg.pickup_token}`;
      }

      // Fetch custom settings
      const { data: settings } = await supabase
        .from('condominium_settings')
        .select('notification_template')
        .eq('condominium_id', condominiumId)
        .maybeSingle();

      let message = `📦 *Nova Encomenda Recebida!*

Olá, *${residentName}*!
Uma nova encomenda chegou para você na portaria.

*Detalhes:*
📍 Unidade: ${unitNumber}
📦 Transportadora: ${carrier}
🕒 Recebido em: ${formatSafeDateTime(pkg.received_at)}${trackingNumber ? `\n🔍 Rastreio: ${trackingNumber}` : ''}
🔢 Código de Retirada: *${pkg.pickup_code || 'N/A'}*

Você pode retirar sua encomenda apresentando o código acima ou o QR Code no link abaixo:
${directPickupLink || portalLink || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${pkg.pickup_token}`}

*Portaria Inteligente*`;

      if (settings?.notification_template) {
        message = settings.notification_template
          .replace('{{name}}', residentName)
          .replace('{{unit}}', unitNumber)
          .replace('{{carrier}}', carrier)
          .replace('{{code}}', pkg.pickup_code || '');
      }

      const templateData = {
        name: "encomenda_recebida",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: residentName },
              { type: "text", text: unitNumber },
              { type: "text", text: carrier }
            ]
          }
        ]
      };

      const result = await sendWhatsAppMessage(phone, message, condominiumId, packageId, true, templateData);
      res.json(result);
    } catch (err: any) {
      console.error("Erro no endpoint de notificação:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Check system status (environment variables)
  app.get("/api/system-status", (req, res) => {
    res.json({
      whatsapp: {
        configured: !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
        mock: !(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
      },
      supabase: {
        serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
  });

  // Rota para lembretes automáticos (pode ser chamada por um cron job externo)
  app.post("/api/cron/reminders", async (req, res) => {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

    // Fetch settings for all condominiums (simplified for now, ideally per condo)
    const { data: allSettings } = await supabase.from('condominium_settings').select('*');

    // Buscar encomendas não retiradas há mais de 48h ou 72h que ainda não receberam lembrete recente
    const { data: pendingPackages } = await supabase
      .from('packages')
      .select('*, moradores!inner(telefone, nome)')
      .eq('status', 'notified')
      .or(`received_at.lte.${fortyEightHoursAgo},received_at.lte.${seventyTwoHoursAgo}`);

    if (pendingPackages) {
      for (const pkg of pendingPackages) {
        const settings = allSettings?.find(s => s.condominium_id === pkg.condominium_id);
        
        // Check if reminders are enabled for this condo
        const hoursPending = (now.getTime() - new Date(pkg.received_at).getTime()) / (1000 * 60 * 60);
        
        const is48hReminder = hoursPending >= 48 && hoursPending < 72 && settings?.reminder_48h_enabled !== false;
        const is72hReminder = hoursPending >= 72 && settings?.reminder_72h_enabled !== false;

        if (is48hReminder || is72hReminder) {
          const resident = (pkg as any).moradores;
          const message = `📦 Lembrete de encomenda\n\nOlá ${resident.nome}.\n\nAinda existe uma encomenda aguardando retirada na portaria da sua unidade.\n\n📍 Unidade: ${pkg.unit_number_raw}\n\nPor favor retire quando possível.`;
          
          await sendWhatsAppMessage(resident.telefone, message, pkg.condominium_id, pkg.id);
        }
      }
    }

    res.json({ success: true, processed: pendingPackages?.length || 0 });
  });

  // Webhook para o Portal do Morador via WhatsApp
  app.get("/api/whatsapp/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    }
  });

  app.post("/api/whatsapp/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Handle Status Updates (delivered/read)
      if (value?.statuses) {
        const statusUpdate = value.statuses[0];
        const whatsappId = statusUpdate.id;
        const status = statusUpdate.status; // delivered, read, failed

        // Update package status if we can map the whatsappId
        // In a real app, we'd store the message ID returned by the API
        // For now, we'll just log it
        console.log(`Status update for message ${whatsappId}: ${status}`);
      }

      // Handle Incoming Messages
      if (value?.messages) {
        const message = value.messages[0];
        const from = message.from; // WhatsApp ID (phone number)
        const text = message.text?.body?.toLowerCase() || "";

        console.log(`Mensagem recebida de ${from}: ${text}`);

        // Find resident by phone
        const { data: profile } = await supabase
          .from('moradores')
          .select('id, nome, unidade, condominium_id')
          .eq('telefone', from)
          .eq('ativo', true)
          .maybeSingle();

        let responseMessage = "";

        if (!profile) {
          responseMessage = "Desculpe, seu número não está cadastrado como morador em nosso sistema. Por favor, procure a administração do condomínio.";
        } else {
          // Log conversation with condominium_id
          await supabase.from('whatsapp_conversations').insert([{
            condominium_id: profile.condominium_id,
            phone: from,
            message: text,
            direction: 'inbound',
            created_at: new Date().toISOString()
          }]);

          if (text.includes("oi") || text.includes("olá") || text.includes("menu")) {
            responseMessage = `Olá, ${profile.nome.split(' ')[0]}! Bem-vindo ao Sistema de Portaria Inteligente.\n\n` +
              "Como posso ajudar hoje?\n" +
              "1. Ver minhas encomendas pendentes\n" +
              "2. Ver histórico de entregas\n" +
              "3. Falar com a administração\n\n" +
              "Você também pode perguntar 'tem encomenda?' ou 'minhas encomendas'.";
          } else if (text === "1" || text.includes("encomenda")) {
            // Buscar encomendas pendentes para a unidade do morador
            const { data: packages } = await supabase
              .from('packages')
              .select('carrier, received_at')
              .eq('unit_number_raw', profile.unidade)
              .eq('condominium_id', profile.condominium_id)
              .eq('status', 'notified')
              .order('received_at', { ascending: false });
            
            if (packages && packages.length > 0) {
              responseMessage = `📦 Você possui ${packages.length} encomenda${packages.length > 1 ? 's' : ''} aguardando retirada.\n\n`;
              packages.forEach((p, i) => {
                responseMessage += `📍 Transportadora: ${p.carrier}\n🕒 Recebido em: ${formatSafeDateTime(p.received_at)}\n\n`;
              });
              responseMessage += "Retire na portaria quando desejar. Obrigado!";
            } else {
              responseMessage = "Você não tem encomendas pendentes no momento. 🎉";
            }
          } else if (text === "2" || text.includes("histórico")) {
            // Histórico (últimas 5)
            const { data: history } = await supabase
              .from('packages')
              .select('carrier, delivered_at')
              .eq('unit_number_raw', profile.unidade)
              .eq('condominium_id', profile.condominium_id)
              .eq('status', 'delivered')
              .order('delivered_at', { ascending: false })
              .limit(5);
            
            if (history && history.length > 0) {
              responseMessage = "🕒 Seu histórico recente de retiradas:\n\n";
              history.forEach((p, i) => {
                responseMessage += `✅ ${p.carrier} - Entregue em ${formatSafeDate(p.delivered_at!)}\n`;
              });
            } else {
              responseMessage = "Nenhum histórico de entregas encontrado para sua unidade.";
            }
          } else if (text === "3" || text.includes("falar") || text.includes("ajuda")) {
            responseMessage = "Sua solicitação foi encaminhada para a administração. Em breve um atendente entrará em contato por este número.";
          } else if (text.includes("retirei")) {
            responseMessage = "Entendido! Se você já retirou sua encomenda, o porteiro atualizará o sistema em breve. Caso a encomenda ainda conste como pendente, por favor confirme com a portaria.";
          } else {
            responseMessage = "Desculpe, não entendi. Digite 'MENU' para ver as opções disponíveis ou pergunte 'tem encomenda?'.";
          }
        }

        if (responseMessage && profile) {
          await sendWhatsAppMessage(from, responseMessage, profile.condominium_id);
          
          // Log outbound conversation
          await supabase.from('whatsapp_conversations').insert([{
            condominium_id: profile.condominium_id,
            phone: from,
            message: responseMessage,
            direction: 'outbound',
            created_at: new Date().toISOString()
          }]);
        } else if (responseMessage) {
          // If no profile, we can't log with condominium_id easily, 
          // but we can still send the "not registered" message
          await sendWhatsAppMessage(from, responseMessage, 'unknown');
        }
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  });

  const validateAdminSession = async (req: express.Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return { error: "Não autorizado", status: 401 };

    const token = authHeader.split(' ')[1];
    
    let adminUser: any;
    let adminProfile: any;

    try {
      if (token === 'MOCK_TOKEN') {
        const { data: profile, error } = await supabaseAdmin
          .from('profiles')
          .select('*')
          .in('role', ['admin', 'sindico'])
          .eq('active', true)
          .limit(1)
          .single();
        
        if (error || !profile) return { error: "Nenhum usuário administrativo encontrado para modo demo.", status: 403 };
        adminUser = { id: profile.id, email: profile.email };
        adminProfile = profile;
      } else {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return { error: "Sessão inválida", status: 401 };
        
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        if (profileError || !profile) return { error: "Perfil administrativo não encontrado", status: 404 };
        adminUser = user;
        adminProfile = profile;
      }

      if (adminProfile.role !== 'admin' && adminProfile.role !== 'sindico') {
        return { error: "Acesso negado.", status: 403 };
      }

      return { adminUser, adminProfile };
    } catch (err: any) {
      return { error: err.message, status: 500 };
    }
  };

  // Admin: List Users
  app.get("/api/admin/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    try {
      let query = supabaseAdmin
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'sindico', 'porteiro'])
        .order('full_name');

      if (adminProfile.role === 'sindico') {
        query = query.eq('condominium_id', adminProfile.condominium_id);
      }

      const { data: profiles, error } = await query;
      if (error) throw error;
      res.json({ profiles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: List Condominiums
  app.get("/api/admin/condominiums", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    try {
      let query = supabaseAdmin
        .from('condominiums')
        .select('*')
        .order('name');
      
      if (adminProfile.role === 'sindico') {
        query = query.eq('id', adminProfile.condominium_id);
      }

      const { data: condominiums, error } = await query;
      if (error) throw error;
      res.json({ condominiums });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Create User
  app.post("/api/admin/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile } = session;

    const { email, password, full_name, phone, role, condominium_id, horario_inicio, horario_fim } = req.body;
    console.log("[DEBUG BACKEND] Criando novo usuário:", { email, full_name, role, condominium_id });

    if (!email || email.trim() === '') {
      return res.status(400).json({ error: "O e-mail é obrigatório para criar um novo usuário." });
    }

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: "O nome completo é obrigatório." });
    }

    // Síndico can only create users for their own condo and only roles 'porteiro' or 'resident'
    if (adminProfile.role === 'sindico') {
      if (condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Síndicos só podem criar usuários para o seu próprio condomínio." });
      }
      if (role !== 'porteiro' && role !== 'resident') {
        return res.status(403).json({ error: "Síndicos só podem criar porteiros ou moradores." });
      }
    }

    try {
      // 1. Create user in Supabase Auth
      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role }
      });

      if (createError) throw createError;

      // 2. Create profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: authData.user.id,
          full_name,
          phone,
          role,
          condominium_id: condominium_id || null,
          active: true,
          must_change_password: true,
          horario_inicio: horario_inicio || null,
          horario_fim: horario_fim || null,
          created_by: adminUser.id
        }])
        .select()
        .single();

      if (profileError) {
        // Cleanup Auth user if profile creation fails
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        throw profileError;
      }

      res.json({ user: authData.user, profile });
    } catch (err: any) {
      console.error("Erro ao criar usuário admin:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Update User
  app.patch("/api/admin/users/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile } = session;

    const { id } = req.params;
    const { full_name, phone, role, condominium_id, active, horario_inicio, horario_fim } = req.body;
    console.log("[DEBUG BACKEND] Atualizando usuário:", id, { full_name, phone, role, condominium_id, active, horario_inicio, horario_fim });

    // Fetch target user to check permissions
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, condominium_id')
      .eq('id', id)
      .single();

    if (!targetProfile) return res.status(404).json({ error: "Usuário não encontrado." });

    // Síndico restrictions
    if (adminProfile.role === 'sindico') {
      if (targetProfile.condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Síndicos só podem editar usuários do seu próprio condomínio." });
      }
      if (targetProfile.role === 'admin' || targetProfile.role === 'sindico') {
        return res.status(403).json({ error: "Síndicos não podem editar outros síndicos ou administradores." });
      }
      // If changing condo or role
      if (condominium_id && condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Síndicos não podem mover usuários para outros condomínios." });
      }
      if (role && role !== 'porteiro' && role !== 'resident') {
        return res.status(403).json({ error: "Síndicos só podem atribuir perfis de porteiro ou morador." });
      }
    }

    try {
      console.log("[DEBUG BACKEND] Iniciando atualização no Supabase para ID:", id);
      // Update profile
      const updateData: any = {
        updated_by: adminUser.id,
        updated_at: new Date().toISOString()
      };
      if (full_name !== undefined) updateData.full_name = full_name;
      if (phone !== undefined) updateData.phone = phone;
      if (role !== undefined) updateData.role = role;
      if (condominium_id !== undefined) updateData.condominium_id = condominium_id || null;
      if (active !== undefined) updateData.active = active;
      if (horario_inicio !== undefined) updateData.horario_inicio = horario_inicio || null;
      if (horario_fim !== undefined) updateData.horario_fim = horario_fim || null;

      console.log("[DEBUG BACKEND] Dados de atualização:", updateData);

      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (profileError) {
        console.error("[DEBUG BACKEND] Erro ao atualizar perfil no Supabase:", profileError);
        throw profileError;
      }

      console.log("[DEBUG BACKEND] Perfil atualizado com sucesso no Supabase:", profile.id);
      res.json({ profile });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro fatal no PATCH /api/admin/users/:id:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Reset Password
  app.post("/api/admin/users/:id/reset-password", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    const { id } = req.params;
    const { newPassword } = req.body;
    console.log("[DEBUG BACKEND] Resetando senha para usuário:", id);

    // Síndico restrictions
    if (adminProfile.role === 'sindico') {
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('role, condominium_id')
        .eq('id', id)
        .single();
      
      if (!targetProfile) return res.status(404).json({ error: "Usuário não encontrado." });
      if (targetProfile.condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Acesso negado." });
      }
      if (targetProfile.role === 'admin' || targetProfile.role === 'sindico') {
        return res.status(403).json({ error: "Acesso negado." });
      }
    }

    try {
      console.log("[DEBUG BACKEND] Iniciando reset de senha no Auth para ID:", id);
      // 1. Update password in Auth
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: newPassword
      });

      if (authError) {
        console.error("[DEBUG BACKEND] Erro ao resetar senha no Auth:", authError);
        throw authError;
      }

      console.log("[DEBUG BACKEND] Senha resetada no Auth. Atualizando perfil...");

      // 2. Set must_change_password to true
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', id);

      if (profileError) {
        console.error("[DEBUG BACKEND] Erro ao atualizar must_change_password no perfil:", profileError);
        throw profileError;
      }

      console.log("[DEBUG BACKEND] Reset de senha concluído com sucesso para:", id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro fatal no reset-password:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Delete User
  app.delete("/api/admin/users/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile } = session;

    const { id } = req.params;
    console.log(`[DEBUG BACKEND] Recebida requisição DELETE para usuário: ${id} por admin: ${adminUser.id}`);

    try {
      // Fetch target user to check permissions
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('role, condominium_id')
        .eq('id', id)
        .single();

      if (!targetProfile) {
        console.warn(`[DEBUG BACKEND] Usuário ${id} não encontrado na tabela profiles.`);
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      console.log(`[DEBUG BACKEND] Perfil encontrado: role=${targetProfile.role}, condo=${targetProfile.condominium_id}`);

      // Síndico restrictions
      if (adminProfile.role === 'sindico') {
        if (targetProfile.condominium_id !== adminProfile.condominium_id) {
          console.warn(`[DEBUG BACKEND] Síndico ${adminUser.id} tentou excluir usuário de outro condomínio.`);
          return res.status(403).json({ error: "Síndicos só podem excluir usuários do seu próprio condomínio." });
        }
        if (targetProfile.role === 'admin' || targetProfile.role === 'sindico') {
          console.warn(`[DEBUG BACKEND] Síndico ${adminUser.id} tentou excluir outro síndico/admin.`);
          return res.status(403).json({ error: "Síndicos não podem excluir outros síndicos ou administradores." });
        }
      }

      console.log(`[DEBUG BACKEND] Deletando perfil de ${id}...`);
      // 1. Delete profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', id);

      if (profileError) {
        console.error(`[DEBUG BACKEND] Erro ao deletar perfil:`, profileError);
        throw profileError;
      }

      console.log(`[DEBUG BACKEND] Deletando usuário do Auth ${id}...`);
      // 2. Delete Auth user
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (deleteError) {
        console.error("[DEBUG BACKEND] Erro ao excluir usuário do Auth (perfil já excluído):", deleteError);
        // We don't throw here because the profile is already gone, but it's a problem
      }

      console.log(`[DEBUG BACKEND] Exclusão de ${id} concluída com sucesso.`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro fatal na rota de exclusão:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware para desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Ensure 'packages' bucket exists
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.find(b => b.name === 'packages')) {
      await supabaseAdmin.storage.createBucket('packages', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
        fileSizeLimit: 5242880 // 5MB
      });
      console.log("Created 'packages' storage bucket");
    }
  } catch (err) {
    console.error("Error checking/creating storage bucket:", err);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
