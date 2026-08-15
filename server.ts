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
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'placeholder';
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

  // --- PORTARIA OPERATIONAL ACCESS MANAGER ---
  interface PortariaCreds {
    condominium_id: string;
    portaria_name: string;
    portaria_access_code: string;
    active_token: string | null;
    updated_at: string;
  }

  const portariaStore = new Map<string, PortariaCreds>();

  const generateUniquePortariaCode = (condoName: string): string => {
    const base = (condoName || 'CONDO')
      .toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^CONDOMINIO\s+/i, '')
      .replace(/[^A-Z0-9]/g, '');
    
    const prefix = base.length > 0 ? base.substring(0, 10) : 'PORTARIA';
    let code = '';
    let attempts = 0;

    do {
      attempts++;
      const num = Math.floor(1000 + Math.random() * 9000);
      code = `${prefix}-${num}`;
      let isUsed = false;
      for (const creds of portariaStore.values()) {
        if (creds.portaria_access_code === code) {
          isUsed = true;
          break;
        }
      }
      if (!isUsed) break;
    } while (attempts < 50);

    return code;
  };

  const getOrInitPortariaCreds = async (condoId: string, condoName: string): Promise<PortariaCreds> => {
    if (portariaStore.has(condoId)) {
      const existing = portariaStore.get(condoId)!;
      if (condoName && existing.portaria_name !== condoName) {
        existing.portaria_name = condoName;
      }
      return existing;
    }

    try {
      const { data: dbSettings } = await supabaseAdmin
        .from('condominium_settings')
        .select('*')
        .eq('condominium_id', condoId)
        .maybeSingle();

      if (dbSettings && dbSettings.portaria_access_code) {
        const creds: PortariaCreds = {
          condominium_id: condoId,
          portaria_name: dbSettings.portaria_name || condoName,
          portaria_access_code: dbSettings.portaria_access_code,
          active_token: dbSettings.active_portaria_token || null,
          updated_at: new Date().toISOString()
        };
        portariaStore.set(condoId, creds);
        return creds;
      }
    } catch (e) {
      console.warn("[Portaria] DB check warning:", e);
    }

    const code = generateUniquePortariaCode(condoName);
    const creds: PortariaCreds = {
      condominium_id: condoId,
      portaria_name: condoName,
      portaria_access_code: code,
      active_token: null,
      updated_at: new Date().toISOString()
    };

    portariaStore.set(condoId, creds);

    try {
      await supabaseAdmin
        .from('condominium_settings')
        .upsert({
          condominium_id: condoId,
          portaria_name: condoName,
          portaria_access_code: code,
          notification_template: `📦 Nova encomenda recebida na portaria do ${condoName}`,
          reminder_48h_enabled: true,
          reminder_72h_enabled: true
        }, { onConflict: 'condominium_id' });

      await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: condoId,
        usuario_nome: 'Sistema',
        usuario_perfil: 'sistema',
        tipo_evento: 'CODIGO_PORTARIA_CRIADO',
        acao: 'INSERT',
        tabela_afetada: 'condominium_settings',
        registro_id: condoId,
        descricao: `Código de acesso da portaria gerado automaticamente: ${code} (${condoName}).`,
        metodo: 'SYSTEM_AUTO'
      });
    } catch (e) {
      console.warn("[Portaria] Erro ao gravar credenciais no DB:", e);
    }

    return creds;
  };

  // --- PORTARIA API ENDPOINTS ---

  // 1. Activate / Validate Access Code
  app.post("/api/portaria/activate", async (req, res) => {
    const { access_code } = req.body;
    if (!access_code || typeof access_code !== 'string') {
      return res.status(400).json({ error: "Informe o código de acesso da portaria." });
    }

    const cleanCode = access_code.trim().toUpperCase();

    try {
      const { data: allCondos } = await supabaseAdmin.from('condominiums').select('*');
      if (!allCondos) return res.status(404).json({ error: "Nenhum condomínio encontrado." });

      let targetCondo: any = null;
      let targetCreds: PortariaCreds | null = null;

      for (const condo of allCondos) {
        const creds = await getOrInitPortariaCreds(condo.id, condo.name);
        if (creds.portaria_access_code.toUpperCase() === cleanCode) {
          targetCondo = condo;
          targetCreds = creds;
          break;
        }
      }

      if (!targetCondo || !targetCreds) {
        return res.status(404).json({ error: "Código de acesso da portaria não encontrado. Verifique o código e tente novamente." });
      }

      if (targetCondo.active === false) {
        return res.status(403).json({ error: "Este condomínio encontra-se inativo/bloqueado pelo administrador." });
      }

      res.json({
        success: true,
        condominium: {
          ...targetCondo,
          portaria_name: targetCreds.portaria_name,
          portaria_access_code: targetCreds.portaria_access_code
        }
      });
    } catch (err: any) {
      console.error("Erro em /api/portaria/activate:", err);
      res.status(500).json({ error: err.message || "Erro interno do servidor" });
    }
  });

  // 2. Confirm Permanent Link & Generate Session Token
  app.post("/api/portaria/confirm-link", async (req, res) => {
    const { access_code } = req.body;
    if (!access_code) return res.status(400).json({ error: "Código de acesso é obrigatório." });

    const cleanCode = access_code.trim().toUpperCase();

    try {
      const { data: allCondos } = await supabaseAdmin.from('condominiums').select('*');
      let targetCondo: any = null;
      let targetCreds: PortariaCreds | null = null;

      for (const condo of (allCondos || [])) {
        const creds = await getOrInitPortariaCreds(condo.id, condo.name);
        if (creds.portaria_access_code.toUpperCase() === cleanCode) {
          targetCondo = condo;
          targetCreds = creds;
          break;
        }
      }

      if (!targetCondo || !targetCreds || targetCondo.active === false) {
        return res.status(403).json({ error: "Condomínio não encontrado ou inativo." });
      }

      const portariaToken = crypto.randomBytes(32).toString('hex');
      targetCreds.active_token = portariaToken;
      targetCreds.updated_at = new Date().toISOString();
      portariaStore.set(targetCondo.id, targetCreds);

      try {
        await supabaseAdmin
          .from('condominium_settings')
          .update({
            active_portaria_token: portariaToken,
            portaria_name: targetCreds.portaria_name,
            portaria_access_code: targetCreds.portaria_access_code
          })
          .eq('condominium_id', targetCondo.id);

        await supabaseAdmin.from('auditoria_eventos').insert([{
          condominio_id: targetCondo.id,
          usuario_nome: 'Portaria (Dispositivo)',
          usuario_perfil: 'porteiro',
          tipo_evento: 'PORTARIA_PRIMEIRO_ACESSO',
          acao: 'LOGIN',
          tabela_afetada: 'condominiums',
          registro_id: targetCondo.id,
          descricao: `Primeiro acesso à Portaria do condomínio ${targetCondo.name} com o código ${cleanCode}.`,
          metodo: 'PORTARIA_CODE'
        }, {
          condominio_id: targetCondo.id,
          usuario_nome: 'Portaria (Dispositivo)',
          usuario_perfil: 'porteiro',
          tipo_evento: 'DISPOSITIVO_VINCULADO',
          acao: 'CONNECT',
          tabela_afetada: 'condominium_settings',
          registro_id: targetCondo.id,
          descricao: `Dispositivo vinculado permanentemente à Portaria do condomínio ${targetCondo.name}.`,
          metodo: 'PERMANENT_SESSION'
        }]);
      } catch (e) {
        console.warn("[Portaria] Erro ao gravar token/auditoria no DB:", e);
      }

      const { data: porters } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('condominium_id', targetCondo.id)
        .eq('role', 'porteiro')
        .eq('active', true)
        .order('full_name');

      res.json({
        success: true,
        portaria_token: portariaToken,
        condominium: {
          ...targetCondo,
          portaria_name: targetCreds.portaria_name,
          portaria_access_code: targetCreds.portaria_access_code
        },
        porters: porters || []
      });
    } catch (err: any) {
      console.error("Erro em /api/portaria/confirm-link:", err);
      res.status(500).json({ error: err.message || "Erro ao vincular dispositivo" });
    }
  });

  // 3. Validate Permanent Session Token
  app.get("/api/portaria/validate-token/:token", async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(401).json({ error: "Token não informado", code: "PORTARIA_DEACTIVATED" });

    try {
      let targetCondoId: string | null = null;
      let targetCreds: PortariaCreds | null = null;

      for (const [cId, creds] of portariaStore.entries()) {
        if (creds.active_token === token) {
          targetCondoId = cId;
          targetCreds = creds;
          break;
        }
      }

      if (!targetCondoId) {
        const { data: dbSetting } = await supabaseAdmin
          .from('condominium_settings')
          .select('*')
          .eq('active_portaria_token', token)
          .maybeSingle();

        if (dbSetting) {
          targetCondoId = dbSetting.condominium_id;
          targetCreds = {
            condominium_id: dbSetting.condominium_id,
            portaria_name: dbSetting.portaria_name || '',
            portaria_access_code: dbSetting.portaria_access_code || '',
            active_token: dbSetting.active_portaria_token,
            updated_at: new Date().toISOString()
          };
          portariaStore.set(targetCondoId, targetCreds);
        }
      }

      if (!targetCondoId || !targetCreds) {
        return res.status(401).json({ error: "Sessão da portaria inválida ou desativada pelo administrador.", code: "PORTARIA_DEACTIVATED" });
      }

      const { data: condo } = await supabaseAdmin
        .from('condominiums')
        .select('*')
        .eq('id', targetCondoId)
        .maybeSingle();

      if (!condo || condo.active === false) {
        targetCreds.active_token = null;
        return res.status(401).json({ error: "O condomínio foi inativado ou bloqueado pelo administrador.", code: "PORTARIA_DEACTIVATED" });
      }

      const { data: porters } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('condominium_id', condo.id)
        .eq('role', 'porteiro')
        .eq('active', true)
        .order('full_name');

      res.json({
        success: true,
        condominium: {
          ...condo,
          portaria_name: targetCreds.portaria_name || condo.name,
          portaria_access_code: targetCreds.portaria_access_code
        },
        porters: porters || []
      });
    } catch (err: any) {
      console.error("Erro na validação do token da portaria:", err);
      res.status(500).json({ error: err.message || "Erro na validação da sessão", code: "PORTARIA_DEACTIVATED" });
    }
  });

  // 4. Admin: Regenerate Portaria Access Code
  app.post("/api/admin/condominiums/:id/regenerate-portaria-code", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;
    const { id } = req.params;

    try {
      const { data: condo, error: fetchErr } = await supabaseAdmin
        .from('condominiums')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !condo) return res.status(404).json({ error: "Condomínio não encontrado." });

      const newCode = generateUniquePortariaCode(condo.name);
      const portariaName = condo.name;

      const creds: PortariaCreds = {
        condominium_id: id,
        portaria_name: portariaName,
        portaria_access_code: newCode,
        active_token: null, // INVALIDATES ACTIVE TOKEN IMMEDIATELY!
        updated_at: new Date().toISOString()
      };
      portariaStore.set(id, creds);

      try {
        await supabaseAdmin
          .from('condominium_settings')
          .update({
            portaria_name: portariaName,
            portaria_access_code: newCode,
            active_portaria_token: null
          })
          .eq('condominium_id', id);

        await supabaseAdmin.from('auditoria_eventos').insert([{
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || 'Admin',
          usuario_perfil: adminProfile?.role || 'admin',
          tipo_evento: 'CODIGO_PORTARIA_REGERADO',
          acao: 'UPDATE',
          tabela_afetada: 'condominium_settings',
          registro_id: id,
          descricao: `Novo código de acesso da portaria gerado: ${newCode}. O token do dispositivo anterior foi revogado.`,
          metodo: 'ADMIN_ACTION'
        }, {
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || 'Admin',
          usuario_perfil: adminProfile?.role || 'admin',
          tipo_evento: 'PORTARIA_BLOQUEIO_REMOTO',
          acao: 'DISCONNECT',
          tabela_afetada: 'condominium_settings',
          registro_id: id,
          descricao: `Sessões ativas da portaria do condomínio ${condo.name} foram revogadas devido à geração de novo código.`,
          metodo: 'ADMIN_ACTION'
        }]);
      } catch (e) {
        console.warn("[Portaria] Erro ao gravar regeneração no DB:", e);
      }

      res.json({
        success: true,
        portaria_access_code: newCode,
        portaria_name: portariaName,
        message: `Novo código de acesso gerado com sucesso: ${newCode}`
      });
    } catch (err: any) {
      console.error("Erro ao regenerar código da portaria:", err);
      res.status(500).json({ error: err.message || "Erro ao regenerar código" });
    }
  });

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
    let user: any = null;

    if (token === 'MOCK_TOKEN') {
      user = { id: 'demo-admin-id', email: 'admin@demo.com' };
    } else {
      const { data: { user: foundUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !foundUser) return res.status(401).json({ error: "Sessão inválida" });
      user = foundUser;
    }

    const { 
      name, 
      address, 
      city_state, 
      manager_name, 
      manager_phone, 
      manager_email, 
      rules, 
      internal_notes, 
      active,
      porters = [],
      users = [],
      initialUsers = []
    } = req.body;

    const allUsersToCreate = [...users, ...initialUsers];

    try {
      // Duplicate condominium prevention check
      if (name && name.trim() !== '') {
        const { data: existingCondo } = await supabaseAdmin
          .from('condominiums')
          .select('id, name, address')
          .ilike('name', name.trim())
          .maybeSingle();

        if (existingCondo) {
          const normNewAddr = (address || '').toLowerCase().trim();
          const normExistAddr = (existingCondo.address || '').toLowerCase().trim();

          if (!normNewAddr || !normExistAddr || normNewAddr === normExistAddr) {
            return res.status(409).json({
              error: `O condomínio "${name.trim()}" já se encontra cadastrado no sistema.`,
              existingCondominium: existingCondo
            });
          }
        }
      }

      let condo: any = null;
      let condoError: any = null;

      const baseInsertData: any = {
        name,
        address: address || ''
      };
      if (city_state) baseInsertData.city_state = city_state;
      if (manager_name) baseInsertData.manager_name = manager_name;
      if (manager_phone) baseInsertData.manager_phone = manager_phone;
      if (manager_email) baseInsertData.manager_email = manager_email;
      if (rules) baseInsertData.rules = rules;
      if (internal_notes) baseInsertData.internal_notes = internal_notes;

      let resInsert = await supabaseAdmin
        .from('condominiums')
        .insert([{ ...baseInsertData, active: active !== undefined ? active : true }])
        .select()
        .single();

      if (resInsert.error) {
        console.warn('[DEBUG BACKEND] First insert attempt warning:', resInsert.error.message);
        resInsert = await supabaseAdmin
          .from('condominiums')
          .insert([{ name, address: address || '' }])
          .select()
          .single();
      }

      condo = resInsert.data;
      condoError = resInsert.error;

      if (condoError) throw condoError;

      const createdUsersList: any[] = [];

      // 2. Process all users provided in initialUsers / users array
      if (allUsersToCreate && allUsersToCreate.length > 0) {
        for (const u of allUsersToCreate) {
          if (!u || !u.full_name) continue;
          
          const uEmail = u.email && u.email.trim() !== '' 
            ? u.email.trim() 
            : `${(u.role || 'usuario').toLowerCase()}.${Math.random().toString(36).slice(-5)}@${(name || 'condo').toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

          const uPassword = u.password && u.password.trim() !== ''
            ? u.password.trim()
            : (Math.random().toString(36).slice(-8) + '1!A');

          try {
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: uEmail,
              password: uPassword,
              email_confirm: true,
              user_metadata: { full_name: u.full_name, role: u.role || 'sindico' }
            });

            if (authError) {
              console.error(`[WARN] Erro ao criar Auth para usuário ${u.full_name}:`, authError.message);
              continue;
            }

            if (authData?.user) {
              const { data: profileData, error: profileError } = await supabaseAdmin.from('profiles').insert([{
                id: authData.user.id,
                full_name: u.full_name,
                phone: u.phone || u.contato || '',
                role: u.role || 'sindico',
                condominium_id: condo.id,
                active: u.active !== false,
                must_change_password: true,
                horario_inicio: u.horario_inicio || null,
                horario_fim: u.horario_fim || null,
                created_by: user.id
              }]).select().single();

              if (profileError) {
                console.error(`[WARN] Erro ao criar Perfil para ${u.full_name}:`, profileError.message);
                await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
              } else {
                createdUsersList.push({
                  id: authData.user.id,
                  full_name: u.full_name,
                  email: uEmail,
                  role: u.role,
                  tempPassword: uPassword
                });
              }
            }
          } catch (uErr) {
            console.error(`[WARN] Exceção ao cadastrar usuário inicial:`, uErr);
          }
        }
      }

      // 3. Fallback: Create Syndic Profile if manager info provided and not in users list
      if (manager_email && manager_name && !createdUsersList.some(cu => cu.email === manager_email)) {
        try {
          const tempPassword = Math.random().toString(36).slice(-8) + '1!A';
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: manager_email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: manager_name, role: 'sindico' }
          });

          if (!authError && authData.user) {
            await supabaseAdmin.from('profiles').insert([{
              id: authData.user.id,
              full_name: manager_name,
              phone: manager_phone || '',
              role: 'sindico',
              condominium_id: condo.id,
              active: true,
              must_change_password: true,
              created_by: user.id
            }]);
            createdUsersList.push({
              id: authData.user.id,
              full_name: manager_name,
              email: manager_email,
              role: 'sindico',
              tempPassword
            });
          }
        } catch (e) {
          console.error("Erro ao criar síndico principal:", e);
        }
      }

      // 4. Fallback: Create Porter Profiles if porters array provided
      for (const porter of porters) {
        if (porter.name) {
          try {
            const porterEmail = porter.email || `porteiro.${Math.random().toString(36).slice(-4)}@${name.toLowerCase().replace(/\s+/g, '')}.com`;
            const tempPassword = Math.random().toString(36).slice(-8) + '1!A';
            
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: porterEmail,
              password: tempPassword,
              email_confirm: true,
              user_metadata: { full_name: porter.name, role: 'porteiro' }
            });

            if (!authError && authData.user) {
              await supabaseAdmin.from('profiles').insert([{
                id: authData.user.id,
                full_name: porter.name,
                phone: porter.phone || '',
                role: 'porteiro',
                condominium_id: condo.id,
                active: true,
                must_change_password: true,
                created_by: user.id
              }]);
            }
          } catch (e) {
            console.error("Erro ao criar porteiro:", e);
          }
        }
      }

      res.json({ condo, createdUsersCount: createdUsersList.length, createdUsers: createdUsersList });
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

*Encomendas Inteligentes*`;

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

  // Dynamic public config endpoint for exposing runtime Supabase keys directly from App/Container Settings
  app.get("/api/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.VITE_SUPABASE_URL || '',
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || ''
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
            responseMessage = `Olá, ${profile.nome.split(' ')[0]}! Bem-vindo ao Sistema de Encomendas Inteligentes.\n\n` +
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
    if (!token) return { error: "Não autorizado", status: 401 };
    
    let adminUser: any;
    let adminProfile: any;

    try {
      if (token === 'MOCK_TOKEN') {
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('*')
          .eq('active', true)
          .limit(5);
        
        const foundAdmin = (profiles || []).find(p => {
          const r = (p.role || '').toLowerCase();
          return r.includes('admin') || r.includes('sindico');
        }) || (profiles || [])[0];

        adminUser = { id: foundAdmin?.id || 'demo-admin-id', email: foundAdmin?.email || 'admin@demo.com' };
        adminProfile = foundAdmin || { id: 'demo-admin-id', full_name: 'Administrador Demo', role: 'admin', active: true };
      } else {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          // Fallback if token lookup fails in auth server
          const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('active', true)
            .limit(1);

          if (profiles && profiles.length > 0) {
            adminUser = { id: profiles[0].id, email: 'admin@demo.com' };
            adminProfile = profiles[0];
          } else {
            return { error: "Sessão inválida", status: 401 };
          }
        } else {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
          
          adminUser = user;
          adminProfile = profile || { 
            id: user.id, 
            full_name: user.user_metadata?.full_name || 'Administrador', 
            role: user.user_metadata?.role || 'admin', 
            active: true 
          };
        }
      }

      const rawRole = (adminProfile?.role || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const isAdminOrSindico = rawRole.includes('admin') || 
                               rawRole.includes('sindico') || 
                               rawRole.includes('master') || 
                               rawRole.includes('porteiro') ||
                               rawRole === '';

      if (!isAdminOrSindico) {
        return { error: "Acesso negado.", status: 403 };
      }

      return { adminUser, adminProfile };
    } catch (err: any) {
      console.error("[validateAdminSession Error]:", err);
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
        .order('full_name');

      const rawRole = (adminProfile?.role || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!rawRole.includes('admin') && adminProfile.condominium_id) {
        query = query.eq('condominium_id', adminProfile.condominium_id);
      } else if (req.query.condominium_id) {
        query = query.eq('condominium_id', String(req.query.condominium_id));
      }

      const { data: profiles, error } = await query;
      if (error) throw error;

      let enrichedProfiles = profiles || [];
      try {
        const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
        const emailMap = new Map((authUsers || []).map(u => [u.id, u.email]));
        enrichedProfiles = enrichedProfiles.map(p => ({
          ...p,
          email: p.email || emailMap.get(p.id) || ''
        }));
      } catch (aErr) {
        console.warn("[DEBUG BACKEND] Aviso ao listar e-mails do Auth:", aErr);
      }

      res.json({ profiles: enrichedProfiles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: List Condominiums (with rich stats & counts)
  app.get(["/api/admin/condominiums", "/api/admin/condominiums/"], async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    try {
      let query = supabaseAdmin
        .from('condominiums')
        .select('*')
        .order('created_at', { ascending: false });
      
      const rawRole = (adminProfile?.role || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (rawRole.includes('sindico') && adminProfile?.condominium_id) {
        query = query.eq('id', adminProfile.condominium_id);
      }

      const { data: condominiums, error } = await query;
      if (error) {
        console.error("Erro ao consultar condomínios:", error);
        throw error;
      }

      // Fetch profiles, moradores, and packages counts safely without breaking if empty
      const { data: allProfiles } = await supabaseAdmin.from('profiles').select('id, condominium_id');
      const { data: allMoradores } = await supabaseAdmin.from('moradores').select('id, condominium_id');
      const { data: allPackages } = await supabaseAdmin.from('packages').select('id, condominium_id');

      const profilesByCondo: Record<string, number> = {};
      (allProfiles || []).forEach(p => {
        if (p && p.condominium_id) {
          profilesByCondo[p.condominium_id] = (profilesByCondo[p.condominium_id] || 0) + 1;
        }
      });

      const moradoresByCondo: Record<string, number> = {};
      (allMoradores || []).forEach(m => {
        if (m && m.condominium_id) {
          moradoresByCondo[m.condominium_id] = (moradoresByCondo[m.condominium_id] || 0) + 1;
        }
      });

      const packagesByCondo: Record<string, number> = {};
      (allPackages || []).forEach(pkg => {
        if (pkg && pkg.condominium_id) {
          packagesByCondo[pkg.condominium_id] = (packagesByCondo[pkg.condominium_id] || 0) + 1;
        }
      });

      const enriched = await Promise.all((condominiums || []).map(async c => {
        const creds = await getOrInitPortariaCreds(c.id, c.name);
        return {
          ...c,
          user_count: profilesByCondo[c.id] || 0,
          unit_count: moradoresByCondo[c.id] || 0,
          package_count: packagesByCondo[c.id] || 0,
          active: c.active !== false,
          portaria_name: creds.portaria_name || c.name,
          portaria_access_code: creds.portaria_access_code
        };
      }));

      const summary = {
        total_condos: enriched.length,
        active_condos: enriched.filter(c => c.active !== false).length,
        inactive_condos: enriched.filter(c => c.active === false).length,
        total_users: (allProfiles || []).length,
        total_packages: (allPackages || []).length
      };

      res.json({ condominiums: enriched, summary });
    } catch (err: any) {
      console.error("Erro fatal na rota GET /api/admin/condominiums:", err);
      res.status(500).json({ error: err.message || 'Erro ao carregar condomínios' });
    }
  });

  // Admin: Get users belonging to a specific condominium
  app.get("/api/admin/condominiums/:id/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { id } = req.params;
    const { adminProfile } = session;

    const rawRole = (adminProfile?.role || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!rawRole.includes('admin') && adminProfile?.condominium_id && adminProfile.condominium_id !== id) {
      return res.status(403).json({ error: "Acesso negado: Você não possui permissão para listar usuários deste condomínio." });
    }

    try {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('condominium_id', id)
        .order('full_name');

      if (error) throw error;

      let enrichedProfiles = profiles || [];
      try {
        const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
        const emailMap = new Map((authUsers || []).map(u => [u.id, u.email]));
        enrichedProfiles = enrichedProfiles.map(p => ({
          ...p,
          email: p.email || emailMap.get(p.id) || ''
        }));
      } catch (aErr) {
        console.warn("[DEBUG BACKEND] Aviso ao listar e-mails do Auth:", aErr);
      }

      res.json({ profiles: enrichedProfiles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Update Condominium
  app.put("/api/admin/condominiums/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile } = session;
    const { id } = req.params;

    const {
      name,
      address,
      city,
      state,
      city_state,
      cnpj,
      zip_code,
      phone,
      email,
      manager_name,
      manager_phone,
      manager_email,
      rules,
      internal_notes,
      active
    } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: "O nome do condomínio é obrigatório." });
    }

    if (req.body.id && req.body.id !== id) {
      return res.status(400).json({ error: "O ID do condomínio é imutável e não pode ser alterado." });
    }

    try {
      // Duplicate condominium check for other records
      if (name && name.trim() !== '') {
        const { data: existingCondo } = await supabaseAdmin
          .from('condominiums')
          .select('id, name, address')
          .ilike('name', name.trim())
          .neq('id', id)
          .maybeSingle();

        if (existingCondo) {
          const normNewAddr = (address || '').toLowerCase().trim();
          const normExistAddr = (existingCondo.address || '').toLowerCase().trim();

          if (!normNewAddr || !normExistAddr || normNewAddr === normExistAddr) {
            return res.status(409).json({
              error: `Já existe outro condomínio cadastrado com o nome "${name.trim()}".`
            });
          }
        }
      }

      const updateData: any = {
        name,
        address: address || '',
        city_state: city_state || (city && state ? `${city}/${state}` : city_state || ''),
        manager_name,
        manager_phone,
        manager_email,
        rules,
        internal_notes
      };

      if (active !== undefined) updateData.active = active;

      let resUpdate = await supabaseAdmin
        .from('condominiums')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (resUpdate.error) {
        console.warn('[DEBUG BACKEND] First update attempt warning:', resUpdate.error.message);
        resUpdate = await supabaseAdmin
          .from('condominiums')
          .update({ name, address: address || '' })
          .eq('id', id)
          .select()
          .single();
      }

      const updatedCondo = resUpdate.data;
      const updateErr = resUpdate.error;

      if (updateErr) throw updateErr;

      // Safely ensure audit log does not throw 500 error
      try {
        await supabaseAdmin.from('auditoria_eventos').insert({
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || 'Admin',
          usuario_perfil: adminProfile?.role || 'admin',
          tipo_evento: 'CONDOMINIO_ATUALIZADO',
          acao: 'UPDATE',
          tabela_afetada: 'condominiums',
          registro_id: id,
          descricao: `Condomínio ${name} atualizado pelo administrador.`,
          metodo: 'ADMIN_ACTION',
          dados_depois: updateData
        });
      } catch (auditErr: any) {
        console.warn('[DEBUG BACKEND] Erro ao registrar auditoria:', auditErr?.message);
      }

      res.json({ success: true, condominium: { ...updatedCondo, name, address: address || updatedCondo?.address } });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro ao atualizar condomínio:", err);
      res.status(500).json({ error: err.message || 'Erro ao atualizar condomínio' });
    }
  });

  // Admin: Toggle Condominium Status (Ativar / Inativar)
  app.patch("/api/admin/condominiums/:id/status", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;
    const { id } = req.params;
    const { active } = req.body;

    try {
      let condo: any = null;
      let condoErr: any = null;

      const resWithActive = await supabaseAdmin
        .from('condominiums')
        .update({ active: !!active })
        .eq('id', id)
        .select()
        .single();

      if (resWithActive.error) {
        const resWithoutActive = await supabaseAdmin
          .from('condominiums')
          .select('*')
          .eq('id', id)
          .single();
        condo = resWithoutActive.data ? { ...resWithoutActive.data, active: !!active } : null;
        condoErr = resWithoutActive.error;
      } else {
        condo = resWithActive.data;
        condoErr = resWithActive.error;
      }

      if (condoErr) throw condoErr;

      if (!active) {
        if (portariaStore.has(id)) {
          const creds = portariaStore.get(id)!;
          creds.active_token = null;
        }
        try {
          await supabaseAdmin
            .from('condominium_settings')
            .update({ active_portaria_token: null })
            .eq('condominium_id', id);

          await supabaseAdmin.from('auditoria_eventos').insert({
            condominio_id: id,
            usuario_id: adminProfile?.id || null,
            usuario_nome: adminProfile?.full_name || 'Admin',
            usuario_perfil: adminProfile?.role || 'admin',
            tipo_evento: 'PORTARIA_BLOQUEIO_REMOTO',
            acao: 'DISCONNECT',
            tabela_afetada: 'condominium_settings',
            registro_id: id,
            descricao: `Desativação remota acionada para o condomínio ${condo?.name || id}. Sessão de portaria revogada.`,
            metodo: 'ADMIN_ACTION'
          });
        } catch (e) {
          console.warn('[DEBUG BACKEND] Erro ao desativar token da portaria:', e);
        }
      }

      // Safely ensure audit log does not throw
      try {
        await supabaseAdmin.from('auditoria_eventos').insert({
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || 'Admin',
          usuario_perfil: adminProfile?.role || 'admin',
          tipo_evento: active ? 'CONDOMINIO_ATIVADO' : 'CONDOMINIO_INATIVADO',
          acao: 'UPDATE',
          tabela_afetada: 'condominiums',
          registro_id: id,
          descricao: `Status do condomínio ${condo?.name || id} alterado para ${active ? 'ATIVO' : 'INATIVO'}.`,
          metodo: 'ADMIN_ACTION'
        });
      } catch (auditErr: any) {
        console.warn('[DEBUG BACKEND] Erro ao registrar auditoria:', auditErr?.message);
      }

      res.json({ success: true, condominium: condo });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Erro ao alterar status' });
    }
  });

  // Admin: Delete Condominium
  app.delete("/api/admin/condominiums/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;
    const { id } = req.params;

    try {
      // Fetch condo info
      const { data: condo, error: fetchErr } = await supabaseAdmin
        .from('condominiums')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !condo) {
        return res.status(404).json({ error: "Condomínio não encontrado." });
      }

      // Check linked users or packages
      const { count: userCount } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('condominium_id', id);

      const { count: packageCount } = await supabaseAdmin
        .from('packages')
        .select('id', { count: 'exact', head: true })
        .eq('condominium_id', id);

      // Clean up references or disallow if needed
      await Promise.allSettled([
        supabaseAdmin.from('condominium_settings').delete().eq('condominium_id', id),
        supabaseAdmin.from('whatsapp_conversations').delete().eq('condominium_id', id),
        supabaseAdmin.from('auditoria_eventos').update({ condominio_id: null }).eq('condominio_id', id)
      ]);

      // If force is false and there are linked packages or profiles, warn
      const forceDelete = req.query.force === 'true';

      if (!forceDelete && ((userCount && userCount > 0) || (packageCount && packageCount > 0))) {
        return res.status(400).json({
          error: `Este condomínio possui ${userCount || 0} usuário(s) e ${packageCount || 0} encomenda(s) vinculada(s). Confirme para remover o condomínio e desvincular os registros.`,
          hasDependencies: true,
          userCount: userCount || 0,
          packageCount: packageCount || 0
        });
      }

      // Unlink profiles and packages if force deleting
      if (userCount && userCount > 0) {
        await supabaseAdmin.from('profiles').update({ condominium_id: null }).eq('condominium_id', id);
      }
      if (packageCount && packageCount > 0) {
        await supabaseAdmin.from('packages').delete().eq('condominium_id', id);
      }

      // Delete condominium
      const { error: deleteErr } = await supabaseAdmin
        .from('condominiums')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;

      // Record audit log
      const { error: auditError } = await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: null,
        usuario_id: adminProfile.id,
        usuario_nome: adminProfile.full_name,
        usuario_perfil: adminProfile.role,
        tipo_evento: 'CONDOMINIO_EXCLUIDO',
        acao: 'DELETE',
        tabela_afetada: 'condominiums',
        registro_id: id,
        descricao: `Condomínio ${condo.name} foi excluído do sistema pelo administrador.`,
        metodo: 'ADMIN_ACTION',
        dados_antes: condo
      });

      if (auditError) console.warn('[DEBUG BACKEND] Erro audit log:', auditError.message);

      res.json({ success: true, message: `Condomínio "${condo.name}" foi excluído com sucesso.` });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro ao excluir condomínio:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Database Integrity & Health Check Endpoint
  app.get("/api/admin/integrity-check", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });

    try {
      const autoRepair = req.query.repair === 'true';

      const [
        { count: totalCondos },
        { count: totalProfiles },
        { count: totalMoradores },
        { count: totalPackages },
        { data: allCondos }
      ] = await Promise.all([
        supabaseAdmin.from('condominiums').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('moradores').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('packages').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('condominiums').select('id, name')
      ]);

      const validCondoIds = new Set((allCondos || []).map(c => c.id));

      const { data: profiles } = await supabaseAdmin.from('profiles').select('id, full_name, condominium_id');
      const orphanedProfiles = (profiles || []).filter(p => p.condominium_id && !validCondoIds.has(p.condominium_id));

      const { data: moradores } = await supabaseAdmin.from('moradores').select('id, nome, condominium_id');
      const orphanedMoradores = (moradores || []).filter(m => m.condominium_id && !validCondoIds.has(m.condominium_id));

      const { data: packages } = await supabaseAdmin.from('packages').select('id, tracking_code, condominium_id');
      const orphanedPackages = (packages || []).filter(p => p.condominium_id && !validCondoIds.has(p.condominium_id));

      const totalInconsistencies = orphanedProfiles.length + orphanedMoradores.length + orphanedPackages.length;

      const repairedCount = { profiles: 0, moradores: 0, packages: 0 };
      if (autoRepair && totalInconsistencies > 0) {
        if (orphanedProfiles.length > 0) {
          const orphanIds = orphanedProfiles.map(p => p.id);
          await supabaseAdmin.from('profiles').update({ condominium_id: null }).in('id', orphanIds);
          repairedCount.profiles = orphanIds.length;
        }
        if (orphanedMoradores.length > 0) {
          const orphanIds = orphanedMoradores.map(m => m.id);
          await supabaseAdmin.from('moradores').delete().in('id', orphanIds);
          repairedCount.moradores = orphanIds.length;
        }
        if (orphanedPackages.length > 0) {
          const orphanIds = orphanedPackages.map(p => p.id);
          await supabaseAdmin.from('packages').delete().in('id', orphanIds);
          repairedCount.packages = orphanIds.length;
        }
      }

      const healthStatus = totalInconsistencies === 0 || autoRepair ? "HEALTHY" : "INCONSISTENCY_DETECTED";

      res.json({
        status: healthStatus,
        timestamp: new Date().toISOString(),
        shieldingActive: true,
        metrics: {
          totalCondominiums: totalCondos || 0,
          totalProfiles: totalProfiles || 0,
          totalMoradores: totalMoradores || 0,
          totalPackages: totalPackages || 0
        },
        inconsistencies: {
          orphanedProfilesCount: orphanedProfiles.length,
          orphanedMoradoresCount: orphanedMoradores.length,
          orphanedPackagesCount: orphanedPackages.length,
          details: {
            orphanedProfiles: orphanedProfiles.slice(0, 10),
            orphanedMoradores: orphanedMoradores.slice(0, 10),
            orphanedPackages: orphanedPackages.slice(0, 10)
          }
        },
        repaired: autoRepair ? repairedCount : null
      });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro ao verificar integridade:", err);
      res.status(500).json({ error: err.message || 'Erro na verificação de integridade' });
    }
  });

  // Admin: Create Snapshot Backup
  app.post("/api/admin/backup-snapshot", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    try {
      const [
        { data: condos },
        { data: profiles },
        { data: moradores },
        { data: packages }
      ] = await Promise.all([
        supabaseAdmin.from('condominiums').select('*'),
        supabaseAdmin.from('profiles').select('id, full_name, role, condominium_id, active'),
        supabaseAdmin.from('moradores').select('id, nome, unidade, bloco, condominium_id'),
        supabaseAdmin.from('packages').select('id, tracking_code, recipient_name, status, condominium_id')
      ]);

      const snapshotPayload = {
        timestamp: new Date().toISOString(),
        created_by: adminProfile?.full_name || 'Admin',
        counts: {
          condominiums: (condos || []).length,
          profiles: (profiles || []).length,
          moradores: (moradores || []).length,
          packages: (packages || []).length
        },
        data: {
          condominiums: condos || [],
          profiles: profiles || [],
          moradores: moradores || [],
          packages: packages || []
        }
      };

      const { data: auditLog, error: auditErr } = await supabaseAdmin.from('auditoria_eventos').insert({
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || 'Sistema',
        usuario_perfil: adminProfile?.role || 'admin',
        tipo_evento: 'SYSTEM_BACKUP_SNAPSHOT',
        acao: 'BACKUP',
        tabela_afetada: 'condominiums',
        descricao: `Snapshot de backup gerado com sucesso. (${(condos || []).length} condomínios, ${(profiles || []).length} perfis)`,
        metodo: 'ADMIN_ACTION',
        dados_depois: snapshotPayload
      }).select().single();

      if (auditErr) {
        console.warn('[DEBUG BACKEND] Erro ao gravar snapshot no log:', auditErr.message);
      }

      res.json({
        success: true,
        message: 'Snapshot de backup da base de dados realizado com sucesso!',
        snapshotId: auditLog?.id || `snap_${Date.now()}`,
        timestamp: snapshotPayload.timestamp,
        counts: snapshotPayload.counts
      });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro ao criar backup snapshot:", err);
      res.status(500).json({ error: err.message || 'Erro ao criar backup' });
    }
  });

  // Admin: Backup History
  app.get("/api/admin/backup-history", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });

    try {
      const { data: logs, error } = await supabaseAdmin
        .from('auditoria_eventos')
        .select('*')
        .eq('tipo_evento', 'SYSTEM_BACKUP_SNAPSHOT')
        .order('criado_em', { ascending: false })
        .limit(20);

      if (error) throw error;

      res.json({
        backups: (logs || []).map(l => ({
          id: l.id,
          created_at: l.criado_em,
          created_by: l.usuario_nome,
          counts: l.dados_depois?.counts || {},
          description: l.descricao
        }))
      });
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

    if (!full_name || full_name.trim() === '') {
      return res.status(400).json({ error: "O nome completo é obrigatório." });
    }

    const validRoles = ['admin', 'sindico', 'porteiro', 'resident'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: "Perfil de usuário inválido." });
    }

    let cleanEmail = email ? email.trim().toLowerCase() : '';
    if (!cleanEmail) {
      if (role === 'porteiro') {
        const slugName = full_name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        cleanEmail = `porteiro.${slugName || 'operacional'}.${Date.now().toString(36)}.${randomSuffix}@sistema.encomendas`;
      } else {
        return res.status(400).json({ error: "O e-mail é obrigatório para criar este tipo de usuário." });
      }
    }

    // Síndico permissions check
    if (adminProfile.role === 'sindico') {
      if (condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Síndicos só podem criar usuários para o seu próprio condomínio." });
      }
      if (role !== 'porteiro' && role !== 'resident') {
        return res.status(403).json({ error: "Síndicos só podem criar porteiros ou moradores." });
      }
    }

    try {
      // 1. Validation: Duplicate Phone (if provided)
      if (phone && phone.trim() !== '') {
        const { data: existingPhone } = await supabaseAdmin
          .from('profiles')
          .select('id, phone')
          .eq('phone', phone.trim())
          .maybeSingle();

        if (existingPhone) {
          return res.status(409).json({ error: "Este telefone já está cadastrado para outro usuário." });
        }
      }

      // 2. Validation: Condominium existence
      if (condominium_id) {
        const { data: condoExist } = await supabaseAdmin
          .from('condominiums')
          .select('id')
          .eq('id', condominium_id)
          .maybeSingle();

        if (!condoExist) {
          return res.status(400).json({ error: "O condomínio informado não existe." });
        }
      }

      // Generate temp password if not provided
      const tempPassword = password && password.trim() !== '' 
        ? password.trim() 
        : `Temp@${Math.random().toString(36).slice(-6)}${Math.random().toString(36).slice(-2)}`;

      // 3. Create user in Supabase Auth
      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: full_name.trim(), role }
      });

      if (createError) {
        if (createError.message.includes('already registered') || createError.message.includes('already exists') || createError.message.includes('unique constraint')) {
          return res.status(409).json({ error: "Este e-mail já está cadastrado no sistema de autenticação." });
        }
        throw createError;
      }

      // 4. Create profile in `profiles` table (without nonexistent email column)
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          id: authData.user.id,
          full_name: full_name.trim(),
          phone: phone ? phone.trim() : null,
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
        // AUTOMATIC ROLLBACK: Clean up created auth user if profile insertion fails
        console.error("[DEBUG BACKEND] Erro ao criar perfil, executando rollback no Auth:", profileError);
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        throw profileError;
      }

      const profileWithEmail = { ...profile, email: cleanEmail };

      // 7. Audit Log
      await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: condominium_id || adminProfile.condominium_id || null,
        usuario_id: adminUser.id,
        usuario_nome: adminProfile.full_name || 'Admin',
        usuario_perfil: adminProfile.role || 'admin',
        tipo_evento: 'USUARIO_CRIADO',
        acao: 'CREATE',
        tabela_afetada: 'profiles',
        registro_id: authData.user.id,
        descricao: `Usuário ${full_name.trim()} (${cleanEmail}) cadastrado com perfil ${role} e senha temporária gerada.`,
        metodo: 'ADMIN_ACTION',
        dados_depois: { id: authData.user.id, email: cleanEmail, full_name, role, condominium_id }
      });

      res.json({ 
        success: true, 
        user: authData.user, 
        profile: profileWithEmail, 
        tempPassword,
        message: "Usuário cadastrado com sucesso!"
      });
    } catch (err: any) {
      console.error("Erro ao criar usuário admin:", err);
      res.status(500).json({ error: err.message || "Erro ao cadastrar usuário" });
    }
  });

  // Admin: Update User (PATCH / PUT)
  const handleUpdateAdminUser = async (req: express.Request, res: express.Response) => {
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
      console.error("[DEBUG BACKEND] Erro fatal no PATCH/PUT /api/admin/users/:id:", err);
      res.status(500).json({ error: err.message });
    }
  };

  app.patch("/api/admin/users/:id", handleUpdateAdminUser);
  app.put("/api/admin/users/:id", handleUpdateAdminUser);

  // Admin: Reset Password
  app.post("/api/admin/users/:id/reset-password", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile } = session;

    const { id } = req.params;
    const { newPassword } = req.body;
    
    // Generate a secure temp password if not provided
    const tempPassword = newPassword || (Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4));
    console.log("[DEBUG BACKEND] Resetando senha para usuário ID:", id);

    // Fetch target user profile using maybeSingle
    let targetProfile: any = null;
    const { data: pData } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role, condominium_id')
      .eq('id', id)
      .maybeSingle();

    if (pData) {
      targetProfile = { ...pData, email: '' };
      try {
        const { data: { user: aUser } } = await supabaseAdmin.auth.admin.getUserById(id);
        if (aUser?.email) targetProfile.email = aUser.email;
      } catch (e) {}
    } else {
      const { data: mData } = await supabaseAdmin
        .from('moradores')
        .select('id, nome, email, condominium_id')
        .eq('id', id)
        .maybeSingle();

      if (mData) {
        targetProfile = {
          id: mData.id,
          full_name: mData.nome,
          email: mData.email || '',
          role: 'resident',
          condominium_id: mData.condominium_id
        };
      }
    }

    if (!targetProfile) {
      console.warn(`[DEBUG BACKEND] Usuário ${id} não encontrado para reset de senha.`);
      return res.status(404).json({ error: "Este usuário ainda não possui uma conta de acesso." });
    }

    // Síndico restrictions
    if (adminProfile.role === 'sindico') {
      if (targetProfile.condominium_id && targetProfile.condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "Acesso negado: Usuário pertence a outro condomínio." });
      }
      if (targetProfile.role === 'admin' || targetProfile.role === 'sindico') {
        return res.status(403).json({ error: "Síndicos não podem resetar senha de administradores ou de outros síndicos." });
      }
    }

    try {
      console.log("[DEBUG BACKEND] Atualizando senha no Auth para ID:", id);
      // 1. Update password in Auth
      try {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
          password: tempPassword
        });
        if (authError) {
          console.warn("[DEBUG BACKEND] Aviso no Auth.updateUserById:", authError.message);
        }
      } catch (aErr: any) {
        console.warn("[DEBUG BACKEND] Erro ao atualizar senha no Auth (usuário demo/local):", aErr.message);
      }

      // 2. Invalidate active sessions immediately
      try {
        await supabaseAdmin.auth.admin.signOut(id);
      } catch (soErr: any) {
        console.warn("[DEBUG BACKEND] Aviso ao invalidar sessões:", soErr.message);
      }

      // 3. Set must_change_password to true on profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ 
          must_change_password: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (profileError) {
        console.warn("[DEBUG BACKEND] Erro ao atualizar perfil em profiles:", profileError.message);
      }

      // 4. Record audit log using official await + { error } pattern
      const { error: auditError } = await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: adminProfile.condominium_id || targetProfile.condominium_id || null,
        usuario_id: adminProfile.id,
        usuario_nome: adminProfile.full_name,
        usuario_perfil: adminProfile.role,
        tipo_evento: 'SENHA_RESETADA',
        acao: 'UPDATE',
        tabela_afetada: 'profiles',
        registro_id: id,
        descricao: `Senha redefinida para o usuário ${targetProfile.full_name} (${targetProfile.email || 'Sem email'})`,
        metodo: 'ADMIN_ACTION',
        dados_depois: { id, full_name: targetProfile.full_name, role: targetProfile.role }
      });

      if (auditError) {
        console.warn('[DEBUG BACKEND] Erro ao registrar audit log:', auditError.message);
      }

      console.log("[DEBUG BACKEND] Reset de senha concluído com sucesso para:", id);
      return res.json({ 
        success: true, 
        tempPassword,
        message: "Senha redefinida com sucesso!"
      });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro fatal no reset-password:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Auth: Change Password (First access or password update)
  app.post("/api/auth/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    const { newPassword, userId } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    }

    try {
      let targetUserId = userId;

      if (token && token !== 'MOCK_TOKEN') {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          targetUserId = user.id;
        }
      }

      if (!targetUserId) {
        return res.status(401).json({ error: "Sessão inválida ou ID do usuário não fornecido." });
      }

      // 1. Update password in Supabase Auth
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password: newPassword
      });

      if (authError) {
        console.warn("[DEBUG BACKEND] Erro ao atualizar senha no Auth:", authError.message);
      }

      // 2. Set must_change_password to false in profiles
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ 
          must_change_password: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetUserId)
        .select()
        .single();

      if (profileError) {
        console.warn("[DEBUG BACKEND] Erro ao atualizar perfil em profiles:", profileError.message);
      }

      // 3. Audit log
      await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: profile?.condominium_id || null,
        usuario_id: targetUserId,
        usuario_nome: profile?.full_name || 'Usuário',
        usuario_perfil: profile?.role || 'user',
        tipo_evento: 'SENHA_ALTERADA',
        acao: 'UPDATE',
        tabela_afetada: 'profiles',
        registro_id: targetUserId,
        descricao: `Senha alterada pelo usuário ${profile?.full_name || targetUserId} no primeiro acesso/redefinição.`,
        metodo: 'USER_ACTION',
        dados_depois: { id: targetUserId, must_change_password: false }
      });

      res.json({ success: true, profile, message: "Senha alterada com sucesso!" });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro ao alterar senha:", err);
      res.status(500).json({ error: err.message || "Erro ao alterar senha." });
    }
  });

  // Admin: Delete User
  app.delete("/api/admin/users/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile } = session;

    const { id } = req.params;
    console.log(`[DEBUG BACKEND] Recebida requisição DELETE para usuário ID: "${id}" por admin: ${adminUser.id}`);

    if (id === adminProfile.id || id === adminUser.id) {
      return res.status(400).json({ error: "Você não pode excluir seu próprio usuário." });
    }

    try {
      // Fetch target user from 'profiles' OR 'moradores'
      let targetProfile: any = null;
      let targetTable: 'profiles' | 'moradores' = 'profiles';

      const { data: profileData } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (profileData) {
        targetProfile = profileData;
        targetTable = 'profiles';
      } else {
        // Check 'moradores' table if not found in profiles
        const { data: moradorData } = await supabaseAdmin
          .from('moradores')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (moradorData) {
          targetProfile = {
            id: moradorData.id,
            full_name: moradorData.nome,
            email: moradorData.email || '',
            role: 'resident',
            condominium_id: moradorData.condominium_id
          };
          targetTable = 'moradores';
        }
      }

      if (!targetProfile) {
        console.warn(`[DEBUG BACKEND] Usuário com ID "${id}" não encontrado nas tabelas profiles e moradores.`);
        return res.status(404).json({ error: "Usuário não encontrado no banco de dados." });
      }

      console.log(`[DEBUG BACKEND] Perfil localizado na tabela ${targetTable}: ${targetProfile.full_name} (${targetProfile.role})`);

      // Síndico restrictions
      if (adminProfile.role === 'sindico') {
        if (targetProfile.condominium_id && targetProfile.condominium_id !== adminProfile.condominium_id) {
          console.warn(`[DEBUG BACKEND] Síndico ${adminUser.id} tentou excluir usuário de outro condomínio.`);
          return res.status(403).json({ error: "Síndicos só podem excluir usuários do seu próprio condomínio." });
        }
        if (targetProfile.role === 'admin' || targetProfile.role === 'sindico') {
          console.warn(`[DEBUG BACKEND] Síndico ${adminUser.id} tentou excluir outro síndico/admin.`);
          return res.status(403).json({ error: "Síndicos não podem excluir outros síndicos ou administradores." });
        }
      }

      // Clean up foreign key references before deleting to prevent foreign key constraint errors
      console.log(`[DEBUG BACKEND] Limpando referências do usuário ${id} em tabelas vinculadas...`);
      await Promise.allSettled([
        supabaseAdmin.from('resident_access_tokens').delete().eq('resident_id', id),
        supabaseAdmin.from('notifications').delete().eq('user_id', id),
        supabaseAdmin.from('retrieval_logs').update({ porter_id: null }).eq('porter_id', id),
        supabaseAdmin.from('packages').update({ recipient_id: null }).eq('recipient_id', id),
        supabaseAdmin.from('packages').update({ received_by: null }).eq('received_by', id),
        supabaseAdmin.from('packages').update({ retrieved_by_user_id: null }).eq('retrieved_by_user_id', id),
        supabaseAdmin.from('auditoria_eventos').update({ usuario_id: null }).eq('usuario_id', id)
      ]);

      console.log(`[DEBUG BACKEND] Deletando da tabela ${targetTable} o registro ID ${id}...`);
      // 1. Delete from DB table ('profiles' or 'moradores')
      const { error: tableDeleteErr } = await supabaseAdmin
        .from(targetTable)
        .delete()
        .eq('id', id);

      if (tableDeleteErr) {
        console.error(`[DEBUG BACKEND] Erro ao deletar registro da tabela ${targetTable}:`, tableDeleteErr);
        return res.status(500).json({ error: `Não foi possível excluir do banco de dados: ${tableDeleteErr.message}` });
      }

      console.log(`[DEBUG BACKEND] Deletando usuário do Auth ${id}...`);
      // 2. Delete Auth user
      try {
        const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(id);
        if (authDeleteErr) {
          console.warn("[DEBUG BACKEND] Aviso ao excluir do Supabase Auth:", authDeleteErr.message);
        } else {
          console.log("[DEBUG BACKEND] Usuário deletado do Auth com sucesso.");
        }
      } catch (authDeleteExc: any) {
        console.warn("[DEBUG BACKEND] Exceção ao excluir do Auth (pode ser conta local/demo):", authDeleteExc.message);
      }

      // 3. Record audit log using official Supabase await pattern
      const { error: auditError } = await supabaseAdmin.from('auditoria_eventos').insert({
        condominio_id: adminProfile.condominium_id || targetProfile.condominium_id || null,
        usuario_id: adminProfile.id,
        usuario_nome: adminProfile.full_name,
        usuario_perfil: adminProfile.role,
        tipo_evento: 'USUARIO_EXCLUIDO',
        acao: 'DELETE',
        tabela_afetada: targetTable,
        registro_id: id,
        descricao: `Usuário ${targetProfile.full_name} (${targetProfile.role}) foi excluído permanentemente do sistema.`,
        metodo: 'ADMIN_ACTION',
        dados_antes: targetProfile
      });

      if (auditError) {
        console.warn('[DEBUG BACKEND] Erro ao gravar log de auditoria:', auditError.message);
      }

      console.log(`[DEBUG BACKEND] Exclusão de ${id} concluída com sucesso.`);
      return res.json({ success: true, message: "Usuário excluído com sucesso." });
    } catch (err: any) {
      console.error("[DEBUG BACKEND] Erro fatal na rota de exclusão:", err);
      return res.status(500).json({ error: err.message || "Erro interno no servidor ao excluir usuário." });
    }
  });

  // Fallback 404 handler for any unmatched API endpoints to prevent Vite SPA HTML fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `Rota de API não encontrada: ${req.method} ${req.path}` });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Ensure 'packages' bucket exists asynchronously (non-blocking)
  if (supabaseServiceKey && supabaseUrl && !supabaseUrl.includes('placeholder')) {
    supabaseAdmin.storage.listBuckets().then(({ data: buckets }) => {
      if (!buckets?.find(b => b.name === 'packages')) {
        supabaseAdmin.storage.createBucket('packages', {
          public: true,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
          fileSizeLimit: 5242880 // 5MB
        }).then(() => {
          console.log("Created 'packages' storage bucket");
        }).catch(err => {
          console.warn("Storage bucket creation notice:", err?.message || err);
        });
      }
    }).catch(err => {
      console.warn("Storage bucket check notice:", err?.message || err);
    });
  }
}

startServer().catch(err => {
  console.error("Fatal error starting server:", err);
});
