// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var supabaseUrl = process.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
var supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "placeholder";
var supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
var supabase = createClient(supabaseUrl, supabaseAnonKey);
var supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
if (!supabaseServiceKey) {
  console.warn("[DEBUG BACKEND] AVISO: SUPABASE_SERVICE_ROLE_KEY n\xE3o encontrada. As a\xE7\xF5es administrativas podem falhar devido ao RLS.");
} else {
  console.log("[DEBUG BACKEND] SUPABASE_SERVICE_ROLE_KEY encontrada. Cliente admin inicializado.");
}
var app = express();
var formatSafeDateTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("pt-BR");
};
var formatSafeDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
};
var PORT = Number(process.env.PORT) || 3e3;
app.use(express.json({ limit: "10mb" }));
var portariaStore = /* @__PURE__ */ new Map();
var generateUniquePortariaCode = (condoName) => {
  const base = (condoName || "CONDO").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^CONDOMINIO\s+/i, "").replace(/[^A-Z0-9]/g, "");
  const prefix = base.length > 0 ? base.substring(0, 10) : "PORTARIA";
  let code = "";
  let attempts = 0;
  do {
    attempts++;
    const num = Math.floor(1e3 + Math.random() * 9e3);
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
var getOrInitPortariaCreds = async (condoId, condoName) => {
  if (portariaStore.has(condoId)) {
    const existing = portariaStore.get(condoId);
    if (condoName && existing.portaria_name !== condoName) {
      existing.portaria_name = condoName;
    }
    return existing;
  }
  try {
    const { data: dbSettings } = await supabaseAdmin.from("condominium_settings").select("*").eq("condominium_id", condoId).maybeSingle();
    if (dbSettings && dbSettings.portaria_access_code) {
      const creds2 = {
        condominium_id: condoId,
        portaria_name: dbSettings.portaria_name || condoName,
        portaria_access_code: dbSettings.portaria_access_code,
        active_token: dbSettings.active_portaria_token || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      portariaStore.set(condoId, creds2);
      return creds2;
    }
  } catch (e) {
    console.warn("[Portaria] DB check warning:", e);
  }
  const code = generateUniquePortariaCode(condoName);
  const creds = {
    condominium_id: condoId,
    portaria_name: condoName,
    portaria_access_code: code,
    active_token: null,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  portariaStore.set(condoId, creds);
  try {
    await supabaseAdmin.from("condominium_settings").upsert({
      condominium_id: condoId,
      portaria_name: condoName,
      portaria_access_code: code,
      notification_template: `\u{1F4E6} Nova encomenda recebida na portaria do ${condoName}`,
      reminder_48h_enabled: true,
      reminder_72h_enabled: true
    }, { onConflict: "condominium_id" });
    await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: condoId,
      usuario_nome: "Sistema",
      usuario_perfil: "sistema",
      tipo_evento: "CODIGO_PORTARIA_CRIADO",
      acao: "INSERT",
      tabela_afetada: "condominium_settings",
      registro_id: condoId,
      descricao: `C\xF3digo de acesso da portaria gerado automaticamente: ${code} (${condoName}).`,
      metodo: "SYSTEM_AUTO"
    });
  } catch (e) {
    console.warn("[Portaria] Erro ao gravar credenciais no DB:", e);
  }
  return creds;
};
app.post("/api/portaria/activate", async (req, res) => {
  const { access_code } = req.body;
  if (!access_code || typeof access_code !== "string") {
    return res.status(400).json({ error: "Informe o c\xF3digo de acesso da portaria." });
  }
  const cleanCode = access_code.trim().toUpperCase();
  try {
    const { data: allCondos } = await supabaseAdmin.from("condominiums").select("*");
    if (!allCondos) return res.status(404).json({ error: "Nenhum condom\xEDnio encontrado." });
    let targetCondo = null;
    let targetCreds = null;
    for (const condo of allCondos) {
      const creds = await getOrInitPortariaCreds(condo.id, condo.name);
      if (creds.portaria_access_code.toUpperCase() === cleanCode) {
        targetCondo = condo;
        targetCreds = creds;
        break;
      }
    }
    if (!targetCondo || !targetCreds) {
      return res.status(404).json({ error: "C\xF3digo de acesso da portaria n\xE3o encontrado. Verifique o c\xF3digo e tente novamente." });
    }
    if (targetCondo.active === false) {
      return res.status(403).json({ error: "Este condom\xEDnio encontra-se inativo/bloqueado pelo administrador." });
    }
    res.json({
      success: true,
      condominium: {
        ...targetCondo,
        portaria_name: targetCreds.portaria_name,
        portaria_access_code: targetCreds.portaria_access_code
      }
    });
  } catch (err) {
    console.error("Erro em /api/portaria/activate:", err);
    res.status(500).json({ error: err.message || "Erro interno do servidor" });
  }
});
app.post("/api/portaria/confirm-link", async (req, res) => {
  const { access_code } = req.body;
  if (!access_code) return res.status(400).json({ error: "C\xF3digo de acesso \xE9 obrigat\xF3rio." });
  const cleanCode = access_code.trim().toUpperCase();
  try {
    const { data: allCondos } = await supabaseAdmin.from("condominiums").select("*");
    let targetCondo = null;
    let targetCreds = null;
    for (const condo of allCondos || []) {
      const creds = await getOrInitPortariaCreds(condo.id, condo.name);
      if (creds.portaria_access_code.toUpperCase() === cleanCode) {
        targetCondo = condo;
        targetCreds = creds;
        break;
      }
    }
    if (!targetCondo || !targetCreds || targetCondo.active === false) {
      return res.status(403).json({ error: "Condom\xEDnio n\xE3o encontrado ou inativo." });
    }
    const portariaToken = crypto.randomBytes(32).toString("hex");
    targetCreds.active_token = portariaToken;
    targetCreds.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    portariaStore.set(targetCondo.id, targetCreds);
    try {
      await supabaseAdmin.from("condominium_settings").update({
        active_portaria_token: portariaToken,
        portaria_name: targetCreds.portaria_name,
        portaria_access_code: targetCreds.portaria_access_code
      }).eq("condominium_id", targetCondo.id);
      await supabaseAdmin.from("auditoria_eventos").insert([{
        condominio_id: targetCondo.id,
        usuario_nome: "Portaria (Dispositivo)",
        usuario_perfil: "porteiro",
        tipo_evento: "PORTARIA_PRIMEIRO_ACESSO",
        acao: "LOGIN",
        tabela_afetada: "condominiums",
        registro_id: targetCondo.id,
        descricao: `Primeiro acesso \xE0 Portaria do condom\xEDnio ${targetCondo.name} com o c\xF3digo ${cleanCode}.`,
        metodo: "PORTARIA_CODE"
      }, {
        condominio_id: targetCondo.id,
        usuario_nome: "Portaria (Dispositivo)",
        usuario_perfil: "porteiro",
        tipo_evento: "DISPOSITIVO_VINCULADO",
        acao: "CONNECT",
        tabela_afetada: "condominium_settings",
        registro_id: targetCondo.id,
        descricao: `Dispositivo vinculado permanentemente \xE0 Portaria do condom\xEDnio ${targetCondo.name}.`,
        metodo: "PERMANENT_SESSION"
      }]);
    } catch (e) {
      console.warn("[Portaria] Erro ao gravar token/auditoria no DB:", e);
    }
    const { data: porters } = await supabaseAdmin.from("profiles").select("*").eq("condominium_id", targetCondo.id).eq("role", "porteiro").eq("active", true).order("full_name");
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
  } catch (err) {
    console.error("Erro em /api/portaria/confirm-link:", err);
    res.status(500).json({ error: err.message || "Erro ao vincular dispositivo" });
  }
});
app.get("/api/portaria/validate-token/:token", async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(401).json({ error: "Token n\xE3o informado", code: "PORTARIA_DEACTIVATED" });
  try {
    let targetCondoId = null;
    let targetCreds = null;
    for (const [cId, creds] of portariaStore.entries()) {
      if (creds.active_token === token) {
        targetCondoId = cId;
        targetCreds = creds;
        break;
      }
    }
    if (!targetCondoId) {
      const { data: dbSetting } = await supabaseAdmin.from("condominium_settings").select("*").eq("active_portaria_token", token).maybeSingle();
      if (dbSetting) {
        targetCondoId = dbSetting.condominium_id;
        targetCreds = {
          condominium_id: dbSetting.condominium_id,
          portaria_name: dbSetting.portaria_name || "",
          portaria_access_code: dbSetting.portaria_access_code || "",
          active_token: dbSetting.active_portaria_token,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        portariaStore.set(targetCondoId, targetCreds);
      }
    }
    if (!targetCondoId || !targetCreds) {
      return res.status(401).json({ error: "Sess\xE3o da portaria inv\xE1lida ou desativada pelo administrador.", code: "PORTARIA_DEACTIVATED" });
    }
    const { data: condo } = await supabaseAdmin.from("condominiums").select("*").eq("id", targetCondoId).maybeSingle();
    if (!condo || condo.active === false) {
      targetCreds.active_token = null;
      return res.status(401).json({ error: "O condom\xEDnio foi inativado ou bloqueado pelo administrador.", code: "PORTARIA_DEACTIVATED" });
    }
    const { data: porters } = await supabaseAdmin.from("profiles").select("*").eq("condominium_id", condo.id).eq("role", "porteiro").eq("active", true).order("full_name");
    res.json({
      success: true,
      condominium: {
        ...condo,
        portaria_name: targetCreds.portaria_name || condo.name,
        portaria_access_code: targetCreds.portaria_access_code
      },
      porters: porters || []
    });
  } catch (err) {
    console.error("Erro na valida\xE7\xE3o do token da portaria:", err);
    res.status(500).json({ error: err.message || "Erro na valida\xE7\xE3o da sess\xE3o", code: "PORTARIA_DEACTIVATED" });
  }
});
app.post("/api/admin/condominiums/:id/regenerate-portaria-code", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  const { id } = req.params;
  try {
    const { data: condo, error: fetchErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
    if (fetchErr || !condo) return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
    const newCode = generateUniquePortariaCode(condo.name);
    const portariaName = condo.name;
    const creds = {
      condominium_id: id,
      portaria_name: portariaName,
      portaria_access_code: newCode,
      active_token: null,
      // INVALIDATES ACTIVE TOKEN IMMEDIATELY!
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    portariaStore.set(id, creds);
    try {
      await supabaseAdmin.from("condominium_settings").update({
        portaria_name: portariaName,
        portaria_access_code: newCode,
        active_portaria_token: null
      }).eq("condominium_id", id);
      await supabaseAdmin.from("auditoria_eventos").insert([{
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: "CODIGO_PORTARIA_REGERADO",
        acao: "UPDATE",
        tabela_afetada: "condominium_settings",
        registro_id: id,
        descricao: `Novo c\xF3digo de acesso da portaria gerado: ${newCode}. O token do dispositivo anterior foi revogado.`,
        metodo: "ADMIN_ACTION"
      }, {
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: "PORTARIA_BLOQUEIO_REMOTO",
        acao: "DISCONNECT",
        tabela_afetada: "condominium_settings",
        registro_id: id,
        descricao: `Sess\xF5es ativas da portaria do condom\xEDnio ${condo.name} foram revogadas devido \xE0 gera\xE7\xE3o de novo c\xF3digo.`,
        metodo: "ADMIN_ACTION"
      }]);
    } catch (e) {
      console.warn("[Portaria] Erro ao gravar regenera\xE7\xE3o no DB:", e);
    }
    res.json({
      success: true,
      portaria_access_code: newCode,
      portaria_name: portariaName,
      message: `Novo c\xF3digo de acesso gerado com sucesso: ${newCode}`
    });
  } catch (err) {
    console.error("Erro ao regenerar c\xF3digo da portaria:", err);
    res.status(500).json({ error: err.message || "Erro ao regenerar c\xF3digo" });
  }
});
var getOrCreatePortalToken = async (residentId, condominiumId) => {
  try {
    const { data: existing } = await supabase.from("resident_access_tokens").select("*").eq("resident_id", residentId).eq("active", true).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).maybeSingle();
    if (existing) return existing.token;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = /* @__PURE__ */ new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const { data: newToken, error } = await supabase.from("resident_access_tokens").insert([{
      resident_id: residentId,
      condominium_id: condominiumId,
      token,
      expires_at: expiresAt.toISOString(),
      active: true
    }]).select().single();
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
    const { data: tokenData, error: tokenError } = await supabase.from("resident_access_tokens").select("*").eq("token", token).eq("active", true).maybeSingle();
    if (tokenError || !tokenData) {
      return res.status(404).json({ error: "Link inv\xE1lido" });
    }
    const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at) : null;
    if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt < /* @__PURE__ */ new Date()) {
      return res.status(403).json({ error: "Link expirado ou inv\xE1lido" });
    }
    await supabase.from("resident_access_tokens").update({ last_accessed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", tokenData.id);
    const { data: resident, error: resError } = await supabase.from("moradores").select("*").eq("id", tokenData.resident_id).single();
    if (resError || !resident) {
      return res.status(404).json({ error: "Morador n\xE3o encontrado" });
    }
    const { data: condo } = await supabase.from("condominiums").select("*").eq("id", tokenData.condominium_id).single();
    const { data: packages } = await supabase.from("packages").select("*").eq("unit_number_raw", resident.unidade).eq("condominium_id", resident.condominium_id).order("received_at", { ascending: false });
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
app.get("/api/portal/validate-code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { data: pkg, error: pkgError } = await supabase.from("packages").select("*, moradores(*), condominiums(*)").eq("pickup_code", code).neq("status", "delivered").order("received_at", { ascending: false }).limit(1).maybeSingle();
    if (pkgError || !pkg) {
      return res.status(404).json({ error: "C\xF3digo de retirada inv\xE1lido ou encomenda j\xE1 retirada" });
    }
    const resident = pkg.moradores;
    const condo = pkg.condominiums;
    if (!resident || !condo) {
      return res.status(404).json({ error: "Dados do morador ou condom\xEDnio n\xE3o encontrados" });
    }
    const { data: allPackages } = await supabase.from("packages").select("*").eq("unit_number_raw", resident.unidade).eq("condominium_id", resident.condominium_id).order("received_at", { ascending: false });
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
app.get("/api/portal/package/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { data: pkg, error: pkgError } = await supabaseAdmin.from("packages").select("*, moradores(*), condominiums(*)").or(`pickup_token.eq.${token},pickup_code.eq.${token}`).maybeSingle();
    if (pkgError || !pkg) {
      return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
    }
    const resident = pkg.moradores;
    const condo = pkg.condominiums;
    if (!resident || !condo) {
      return res.status(404).json({ error: "Dados do morador ou condom\xEDnio n\xE3o encontrados" });
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
app.post("/api/condominiums/create", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "N\xE3o autorizado" });
  const token = authHeader.split(" ")[1];
  let user = null;
  if (token === "MOCK_TOKEN") {
    user = { id: "demo-admin-id", email: "admin@demo.com" };
  } else {
    const { data: { user: foundUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !foundUser) return res.status(401).json({ error: "Sess\xE3o inv\xE1lida" });
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
    if (name && name.trim() !== "") {
      const { data: existingCondo } = await supabaseAdmin.from("condominiums").select("id, name, address").ilike("name", name.trim()).maybeSingle();
      if (existingCondo) {
        const normNewAddr = (address || "").toLowerCase().trim();
        const normExistAddr = (existingCondo.address || "").toLowerCase().trim();
        if (!normNewAddr || !normExistAddr || normNewAddr === normExistAddr) {
          return res.status(409).json({
            error: `O condom\xEDnio "${name.trim()}" j\xE1 se encontra cadastrado no sistema.`,
            existingCondominium: existingCondo
          });
        }
      }
    }
    let condo = null;
    let condoError = null;
    const baseInsertData = {
      name,
      address: address || ""
    };
    if (city_state) baseInsertData.city_state = city_state;
    if (manager_name) baseInsertData.manager_name = manager_name;
    if (manager_phone) baseInsertData.manager_phone = manager_phone;
    if (manager_email) baseInsertData.manager_email = manager_email;
    if (rules) baseInsertData.rules = rules;
    if (internal_notes) baseInsertData.internal_notes = internal_notes;
    let resInsert = await supabaseAdmin.from("condominiums").insert([{ ...baseInsertData, active: active !== void 0 ? active : true }]).select().single();
    if (resInsert.error) {
      console.warn("[DEBUG BACKEND] First insert attempt warning:", resInsert.error.message);
      resInsert = await supabaseAdmin.from("condominiums").insert([{ name, address: address || "" }]).select().single();
    }
    condo = resInsert.data;
    condoError = resInsert.error;
    if (condoError) throw condoError;
    const createdUsersList = [];
    if (allUsersToCreate && allUsersToCreate.length > 0) {
      for (const u of allUsersToCreate) {
        if (!u || !u.full_name) continue;
        const uEmail = u.email && u.email.trim() !== "" ? u.email.trim() : `${(u.role || "usuario").toLowerCase()}.${Math.random().toString(36).slice(-5)}@${(name || "condo").toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
        const uPassword = u.password && u.password.trim() !== "" ? u.password.trim() : Math.random().toString(36).slice(-8) + "1!A";
        try {
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: uEmail,
            password: uPassword,
            email_confirm: true,
            user_metadata: { full_name: u.full_name, role: u.role || "sindico" }
          });
          if (authError) {
            console.error(`[WARN] Erro ao criar Auth para usu\xE1rio ${u.full_name}:`, authError.message);
            continue;
          }
          if (authData?.user) {
            const { data: profileData, error: profileError } = await supabaseAdmin.from("profiles").insert([{
              id: authData.user.id,
              full_name: u.full_name,
              phone: u.phone || u.contato || "",
              role: u.role || "sindico",
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
          console.error(`[WARN] Exce\xE7\xE3o ao cadastrar usu\xE1rio inicial:`, uErr);
        }
      }
    }
    if (manager_email && manager_name && !createdUsersList.some((cu) => cu.email === manager_email)) {
      try {
        const tempPassword = Math.random().toString(36).slice(-8) + "1!A";
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: manager_email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: manager_name, role: "sindico" }
        });
        if (!authError && authData.user) {
          await supabaseAdmin.from("profiles").insert([{
            id: authData.user.id,
            full_name: manager_name,
            phone: manager_phone || "",
            role: "sindico",
            condominium_id: condo.id,
            active: true,
            must_change_password: true,
            created_by: user.id
          }]);
          createdUsersList.push({
            id: authData.user.id,
            full_name: manager_name,
            email: manager_email,
            role: "sindico",
            tempPassword
          });
        }
      } catch (e) {
        console.error("Erro ao criar s\xEDndico principal:", e);
      }
    }
    for (const porter of porters) {
      if (porter.name) {
        try {
          const porterEmail = porter.email || `porteiro.${Math.random().toString(36).slice(-4)}@${name.toLowerCase().replace(/\s+/g, "")}.com`;
          const tempPassword = Math.random().toString(36).slice(-8) + "1!A";
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: porterEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: porter.name, role: "porteiro" }
          });
          if (!authError && authData.user) {
            await supabaseAdmin.from("profiles").insert([{
              id: authData.user.id,
              full_name: porter.name,
              phone: porter.phone || "",
              role: "porteiro",
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
  } catch (err) {
    console.error("Erro ao criar condom\xEDnio:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/profiles/select-condominium", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "N\xE3o autorizado" });
  const token = authHeader.split(" ")[1];
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Sess\xE3o inv\xE1lida" });
  const { condominiumId } = req.body;
  try {
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update({ condominium_id: condominiumId }).eq("id", user.id).select().single();
    if (profileError) throw profileError;
    res.json({ profile });
  } catch (err) {
    console.error("Erro ao selecionar condom\xEDnio:", err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/auth/create-profile", async (req, res) => {
  return res.status(403).json({ error: "Cadastro p\xFAblico desativado. Somente o administrador pode criar contas de acesso." });
});
var sendWhatsAppMessage = async (to, message, condominiumId, packageId, isTemplate = false, templateData) => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let cleanPhone = to.replace(/\D/g, "");
  if ((cleanPhone.length === 10 || cleanPhone.length === 11) && !cleanPhone.startsWith("55")) {
    cleanPhone = "55" + cleanPhone;
  }
  if (!accessToken || !phoneNumberId) {
    console.log(`[WhatsApp Mock] [Condo: ${condominiumId}] Para ${cleanPhone}: ${message}`);
    if (packageId) {
      await supabase.from("packages").update({
        whatsapp_status: "pending_configuration",
        last_notification_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", packageId);
    }
    return { success: false, mock: true, notConfigured: true };
  }
  try {
    const body = {
      messaging_product: "whatsapp",
      to: cleanPhone
    };
    if (isTemplate) {
      body.type = "template";
      body.template = templateData;
    } else {
      body.type = "text";
      body.text = { body: message };
    }
    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    const status = data.messages ? "sent" : "failed";
    const error = data.error ? JSON.stringify(data.error) : null;
    await supabase.from("message_logs").insert([{
      condominium_id: condominiumId,
      telefone: cleanPhone,
      status,
      status_envio: status === "sent" ? "sucesso" : "erro",
      erro_api: error,
      data_envio: (/* @__PURE__ */ new Date()).toISOString()
    }]);
    if (packageId) {
      await supabase.from("packages").update({
        whatsapp_status: status,
        last_notification_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", packageId);
      const { data: pkg } = await supabase.from("packages").select("received_by").eq("id", packageId).single();
      await supabase.from("notifications").insert([{
        condominium_id: condominiumId,
        user_id: pkg?.received_by,
        message,
        status,
        delivery_channel: "whatsapp"
      }]);
    }
    return { success: status === "sent", data };
  } catch (error) {
    console.error("Erro ao enviar WhatsApp:", error);
    return { success: false, error };
  }
};
app.post("/api/notify-resident", async (req, res) => {
  const authHeader = req.headers.authorization;
  let { phone, residentName, unitNumber, carrier, trackingNumber, packageId, condominiumId } = req.body;
  try {
    const { data: pkg, error: pkgError } = await supabase.from("packages").select("*, moradores(nome, telefone, unidade)").eq("id", packageId).single();
    if (pkgError || !pkg) {
      return res.status(404).json({ error: "Encomenda n\xE3o encontrada" });
    }
    residentName = residentName || pkg.moradores?.nome || pkg.recipient_name_raw;
    phone = phone || pkg.moradores?.telefone;
    unitNumber = unitNumber || pkg.moradores?.unidade || pkg.unit_number_raw;
    carrier = carrier || pkg.carrier;
    trackingNumber = trackingNumber || pkg.tracking_code;
    condominiumId = condominiumId || pkg.condominium_id;
    if (!phone) {
      return res.status(400).json({ error: "Telefone do morador n\xE3o encontrado" });
    }
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
    const { data: settings } = await supabase.from("condominium_settings").select("notification_template").eq("condominium_id", condominiumId).maybeSingle();
    let message = `\u{1F4E6} *Nova Encomenda Recebida!*

Ol\xE1, *${residentName}*!
Uma nova encomenda chegou para voc\xEA na portaria.

*Detalhes:*
\u{1F4CD} Unidade: ${unitNumber}
\u{1F4E6} Transportadora: ${carrier}
\u{1F552} Recebido em: ${formatSafeDateTime(pkg.received_at)}${trackingNumber ? `
\u{1F50D} Rastreio: ${trackingNumber}` : ""}
\u{1F522} C\xF3digo de Retirada: *${pkg.pickup_code || "N/A"}*

Voc\xEA pode retirar sua encomenda apresentando o c\xF3digo acima ou o QR Code no link abaixo:
${directPickupLink || portalLink || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${pkg.pickup_token}`}

*Encomendas Inteligentes*`;
    if (settings?.notification_template) {
      message = settings.notification_template.replace("{{name}}", residentName).replace("{{unit}}", unitNumber).replace("{{carrier}}", carrier).replace("{{code}}", pkg.pickup_code || "");
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
  } catch (err) {
    console.error("Erro no endpoint de notifica\xE7\xE3o:", err);
    res.status(500).json({ error: err.message });
  }
});
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
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.VITE_SUPABASE_URL || "",
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || ""
  });
});
app.post("/api/cron/reminders", async (req, res) => {
  const now = /* @__PURE__ */ new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1e3).toISOString();
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1e3).toISOString();
  const { data: allSettings } = await supabase.from("condominium_settings").select("*");
  const { data: pendingPackages } = await supabase.from("packages").select("*, moradores!inner(telefone, nome)").eq("status", "notified").or(`received_at.lte.${fortyEightHoursAgo},received_at.lte.${seventyTwoHoursAgo}`);
  if (pendingPackages) {
    for (const pkg of pendingPackages) {
      const settings = allSettings?.find((s) => s.condominium_id === pkg.condominium_id);
      const hoursPending = (now.getTime() - new Date(pkg.received_at).getTime()) / (1e3 * 60 * 60);
      const is48hReminder = hoursPending >= 48 && hoursPending < 72 && settings?.reminder_48h_enabled !== false;
      const is72hReminder = hoursPending >= 72 && settings?.reminder_72h_enabled !== false;
      if (is48hReminder || is72hReminder) {
        const resident = pkg.moradores;
        const message = `\u{1F4E6} Lembrete de encomenda

Ol\xE1 ${resident.nome}.

Ainda existe uma encomenda aguardando retirada na portaria da sua unidade.

\u{1F4CD} Unidade: ${pkg.unit_number_raw}

Por favor retire quando poss\xEDvel.`;
        await sendWhatsAppMessage(resident.telefone, message, pkg.condominium_id, pkg.id);
      }
    }
  }
  res.json({ success: true, processed: pendingPackages?.length || 0 });
});
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
    if (value?.statuses) {
      const statusUpdate = value.statuses[0];
      const whatsappId = statusUpdate.id;
      const status = statusUpdate.status;
      console.log(`Status update for message ${whatsappId}: ${status}`);
    }
    if (value?.messages) {
      const message = value.messages[0];
      const from = message.from;
      const text = message.text?.body?.toLowerCase() || "";
      console.log(`Mensagem recebida de ${from}: ${text}`);
      const { data: profile } = await supabase.from("moradores").select("id, nome, unidade, condominium_id").eq("telefone", from).eq("ativo", true).maybeSingle();
      let responseMessage = "";
      if (!profile) {
        responseMessage = "Desculpe, seu n\xFAmero n\xE3o est\xE1 cadastrado como morador em nosso sistema. Por favor, procure a administra\xE7\xE3o do condom\xEDnio.";
      } else {
        await supabase.from("whatsapp_conversations").insert([{
          condominium_id: profile.condominium_id,
          phone: from,
          message: text,
          direction: "inbound",
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        }]);
        if (text.includes("oi") || text.includes("ol\xE1") || text.includes("menu")) {
          responseMessage = `Ol\xE1, ${profile.nome.split(" ")[0]}! Bem-vindo ao Sistema de Encomendas Inteligentes.

Como posso ajudar hoje?
1. Ver minhas encomendas pendentes
2. Ver hist\xF3rico de entregas
3. Falar com a administra\xE7\xE3o

Voc\xEA tamb\xE9m pode perguntar 'tem encomenda?' ou 'minhas encomendas'.`;
        } else if (text === "1" || text.includes("encomenda")) {
          const { data: packages } = await supabase.from("packages").select("carrier, received_at").eq("unit_number_raw", profile.unidade).eq("condominium_id", profile.condominium_id).eq("status", "notified").order("received_at", { ascending: false });
          if (packages && packages.length > 0) {
            responseMessage = `\u{1F4E6} Voc\xEA possui ${packages.length} encomenda${packages.length > 1 ? "s" : ""} aguardando retirada.

`;
            packages.forEach((p, i) => {
              responseMessage += `\u{1F4CD} Transportadora: ${p.carrier}
\u{1F552} Recebido em: ${formatSafeDateTime(p.received_at)}

`;
            });
            responseMessage += "Retire na portaria quando desejar. Obrigado!";
          } else {
            responseMessage = "Voc\xEA n\xE3o tem encomendas pendentes no momento. \u{1F389}";
          }
        } else if (text === "2" || text.includes("hist\xF3rico")) {
          const { data: history } = await supabase.from("packages").select("carrier, delivered_at").eq("unit_number_raw", profile.unidade).eq("condominium_id", profile.condominium_id).eq("status", "delivered").order("delivered_at", { ascending: false }).limit(5);
          if (history && history.length > 0) {
            responseMessage = "\u{1F552} Seu hist\xF3rico recente de retiradas:\n\n";
            history.forEach((p, i) => {
              responseMessage += `\u2705 ${p.carrier} - Entregue em ${formatSafeDate(p.delivered_at)}
`;
            });
          } else {
            responseMessage = "Nenhum hist\xF3rico de entregas encontrado para sua unidade.";
          }
        } else if (text === "3" || text.includes("falar") || text.includes("ajuda")) {
          responseMessage = "Sua solicita\xE7\xE3o foi encaminhada para a administra\xE7\xE3o. Em breve um atendente entrar\xE1 em contato por este n\xFAmero.";
        } else if (text.includes("retirei")) {
          responseMessage = "Entendido! Se voc\xEA j\xE1 retirou sua encomenda, o porteiro atualizar\xE1 o sistema em breve. Caso a encomenda ainda conste como pendente, por favor confirme com a portaria.";
        } else {
          responseMessage = "Desculpe, n\xE3o entendi. Digite 'MENU' para ver as op\xE7\xF5es dispon\xEDveis ou pergunte 'tem encomenda?'.";
        }
      }
      if (responseMessage && profile) {
        await sendWhatsAppMessage(from, responseMessage, profile.condominium_id);
        await supabase.from("whatsapp_conversations").insert([{
          condominium_id: profile.condominium_id,
          phone: from,
          message: responseMessage,
          direction: "outbound",
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        }]);
      } else if (responseMessage) {
        await sendWhatsAppMessage(from, responseMessage, "unknown");
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});
var validateAdminSession = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return { error: "N\xE3o autorizado", status: 401 };
  const token = authHeader.split(" ")[1];
  if (!token) return { error: "N\xE3o autorizado", status: 401 };
  let adminUser;
  let adminProfile;
  try {
    if (token === "MOCK_TOKEN") {
      const { data: profiles } = await supabaseAdmin.from("profiles").select("*").eq("active", true).limit(5);
      const foundAdmin = (profiles || []).find((p) => {
        const r = (p.role || "").toLowerCase();
        return r.includes("admin") || r.includes("sindico");
      }) || (profiles || [])[0];
      adminUser = { id: foundAdmin?.id || "demo-admin-id", email: foundAdmin?.email || "admin@demo.com" };
      adminProfile = foundAdmin || { id: "demo-admin-id", full_name: "Administrador Demo", role: "admin", active: true };
    } else {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        const { data: profiles } = await supabaseAdmin.from("profiles").select("*").eq("active", true).limit(1);
        if (profiles && profiles.length > 0) {
          adminUser = { id: profiles[0].id, email: "admin@demo.com" };
          adminProfile = profiles[0];
        } else {
          return { error: "Sess\xE3o inv\xE1lida", status: 401 };
        }
      } else {
        const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle();
        adminUser = user;
        adminProfile = profile || {
          id: user.id,
          full_name: user.user_metadata?.full_name || "Administrador",
          role: user.user_metadata?.role || "admin",
          active: true
        };
      }
    }
    const rawRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isAdminOrSindico = rawRole.includes("admin") || rawRole.includes("sindico") || rawRole.includes("master") || rawRole.includes("porteiro") || rawRole === "";
    if (!isAdminOrSindico) {
      return { error: "Acesso negado.", status: 403 };
    }
    return { adminUser, adminProfile };
  } catch (err) {
    console.error("[validateAdminSession Error]:", err);
    return { error: err.message, status: 500 };
  }
};
app.get("/api/admin/users", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  try {
    let query = supabaseAdmin.from("profiles").select("*").order("full_name");
    const rawRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!rawRole.includes("admin") && adminProfile.condominium_id) {
      query = query.eq("condominium_id", adminProfile.condominium_id);
    } else if (req.query.condominium_id) {
      query = query.eq("condominium_id", String(req.query.condominium_id));
    }
    const { data: profiles, error } = await query;
    if (error) throw error;
    let enrichedProfiles = profiles || [];
    try {
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
      const emailMap = new Map((authUsers || []).map((u) => [u.id, u.email]));
      enrichedProfiles = enrichedProfiles.map((p) => ({
        ...p,
        email: p.email || emailMap.get(p.id) || ""
      }));
    } catch (aErr) {
      console.warn("[DEBUG BACKEND] Aviso ao listar e-mails do Auth:", aErr);
    }
    res.json({ profiles: enrichedProfiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get(["/api/admin/condominiums", "/api/admin/condominiums/"], async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  try {
    let query = supabaseAdmin.from("condominiums").select("*").order("created_at", { ascending: false });
    const rawRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (rawRole.includes("sindico") && adminProfile?.condominium_id) {
      query = query.eq("id", adminProfile.condominium_id);
    }
    const { data: condominiums, error } = await query;
    if (error) {
      console.error("Erro ao consultar condom\xEDnios:", error);
      throw error;
    }
    const { data: allProfiles } = await supabaseAdmin.from("profiles").select("id, condominium_id");
    const { data: allMoradores } = await supabaseAdmin.from("moradores").select("id, condominium_id");
    const { data: allPackages } = await supabaseAdmin.from("packages").select("id, condominium_id");
    const profilesByCondo = {};
    (allProfiles || []).forEach((p) => {
      if (p && p.condominium_id) {
        profilesByCondo[p.condominium_id] = (profilesByCondo[p.condominium_id] || 0) + 1;
      }
    });
    const moradoresByCondo = {};
    (allMoradores || []).forEach((m) => {
      if (m && m.condominium_id) {
        moradoresByCondo[m.condominium_id] = (moradoresByCondo[m.condominium_id] || 0) + 1;
      }
    });
    const packagesByCondo = {};
    (allPackages || []).forEach((pkg) => {
      if (pkg && pkg.condominium_id) {
        packagesByCondo[pkg.condominium_id] = (packagesByCondo[pkg.condominium_id] || 0) + 1;
      }
    });
    const enriched = await Promise.all((condominiums || []).map(async (c) => {
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
      active_condos: enriched.filter((c) => c.active !== false).length,
      inactive_condos: enriched.filter((c) => c.active === false).length,
      total_users: (allProfiles || []).length,
      total_packages: (allPackages || []).length
    };
    res.json({ condominiums: enriched, summary });
  } catch (err) {
    console.error("Erro fatal na rota GET /api/admin/condominiums:", err);
    res.status(500).json({ error: err.message || "Erro ao carregar condom\xEDnios" });
  }
});
app.get("/api/admin/condominiums/:id/users", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { id } = req.params;
  const { adminProfile } = session;
  const rawRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!rawRole.includes("admin") && adminProfile?.condominium_id && adminProfile.condominium_id !== id) {
    return res.status(403).json({ error: "Acesso negado: Voc\xEA n\xE3o possui permiss\xE3o para listar usu\xE1rios deste condom\xEDnio." });
  }
  try {
    const { data: profiles, error } = await supabaseAdmin.from("profiles").select("*").eq("condominium_id", id).order("full_name");
    if (error) throw error;
    let enrichedProfiles = profiles || [];
    try {
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
      const emailMap = new Map((authUsers || []).map((u) => [u.id, u.email]));
      enrichedProfiles = enrichedProfiles.map((p) => ({
        ...p,
        email: p.email || emailMap.get(p.id) || ""
      }));
    } catch (aErr) {
      console.warn("[DEBUG BACKEND] Aviso ao listar e-mails do Auth:", aErr);
    }
    res.json({ profiles: enrichedProfiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
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
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "O nome do condom\xEDnio \xE9 obrigat\xF3rio." });
  }
  if (req.body.id && req.body.id !== id) {
    return res.status(400).json({ error: "O ID do condom\xEDnio \xE9 imut\xE1vel e n\xE3o pode ser alterado." });
  }
  try {
    if (name && name.trim() !== "") {
      const { data: existingCondo } = await supabaseAdmin.from("condominiums").select("id, name, address").ilike("name", name.trim()).neq("id", id).maybeSingle();
      if (existingCondo) {
        const normNewAddr = (address || "").toLowerCase().trim();
        const normExistAddr = (existingCondo.address || "").toLowerCase().trim();
        if (!normNewAddr || !normExistAddr || normNewAddr === normExistAddr) {
          return res.status(409).json({
            error: `J\xE1 existe outro condom\xEDnio cadastrado com o nome "${name.trim()}".`
          });
        }
      }
    }
    const updateData = {
      name,
      address: address || "",
      city_state: city_state || (city && state ? `${city}/${state}` : city_state || ""),
      manager_name,
      manager_phone,
      manager_email,
      rules,
      internal_notes
    };
    if (active !== void 0) updateData.active = active;
    let resUpdate = await supabaseAdmin.from("condominiums").update(updateData).eq("id", id).select().single();
    if (resUpdate.error) {
      console.warn("[DEBUG BACKEND] First update attempt warning:", resUpdate.error.message);
      resUpdate = await supabaseAdmin.from("condominiums").update({ name, address: address || "" }).eq("id", id).select().single();
    }
    const updatedCondo = resUpdate.data;
    const updateErr = resUpdate.error;
    if (updateErr) throw updateErr;
    try {
      await supabaseAdmin.from("auditoria_eventos").insert({
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: "CONDOMINIO_ATUALIZADO",
        acao: "UPDATE",
        tabela_afetada: "condominiums",
        registro_id: id,
        descricao: `Condom\xEDnio ${name} atualizado pelo administrador.`,
        metodo: "ADMIN_ACTION",
        dados_depois: updateData
      });
    } catch (auditErr) {
      console.warn("[DEBUG BACKEND] Erro ao registrar auditoria:", auditErr?.message);
    }
    res.json({ success: true, condominium: { ...updatedCondo, name, address: address || updatedCondo?.address } });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro ao atualizar condom\xEDnio:", err);
    res.status(500).json({ error: err.message || "Erro ao atualizar condom\xEDnio" });
  }
});
app.patch("/api/admin/condominiums/:id/status", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  const { id } = req.params;
  const { active } = req.body;
  try {
    let condo = null;
    let condoErr = null;
    const resWithActive = await supabaseAdmin.from("condominiums").update({ active: !!active }).eq("id", id).select().single();
    if (resWithActive.error) {
      const resWithoutActive = await supabaseAdmin.from("condominiums").select("*").eq("id", id).single();
      condo = resWithoutActive.data ? { ...resWithoutActive.data, active: !!active } : null;
      condoErr = resWithoutActive.error;
    } else {
      condo = resWithActive.data;
      condoErr = resWithActive.error;
    }
    if (condoErr) throw condoErr;
    if (!active) {
      if (portariaStore.has(id)) {
        const creds = portariaStore.get(id);
        creds.active_token = null;
      }
      try {
        await supabaseAdmin.from("condominium_settings").update({ active_portaria_token: null }).eq("condominium_id", id);
        await supabaseAdmin.from("auditoria_eventos").insert({
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || "Admin",
          usuario_perfil: adminProfile?.role || "admin",
          tipo_evento: "PORTARIA_BLOQUEIO_REMOTO",
          acao: "DISCONNECT",
          tabela_afetada: "condominium_settings",
          registro_id: id,
          descricao: `Desativa\xE7\xE3o remota acionada para o condom\xEDnio ${condo?.name || id}. Sess\xE3o de portaria revogada.`,
          metodo: "ADMIN_ACTION"
        });
      } catch (e) {
        console.warn("[DEBUG BACKEND] Erro ao desativar token da portaria:", e);
      }
    }
    try {
      await supabaseAdmin.from("auditoria_eventos").insert({
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: active ? "CONDOMINIO_ATIVADO" : "CONDOMINIO_INATIVADO",
        acao: "UPDATE",
        tabela_afetada: "condominiums",
        registro_id: id,
        descricao: `Status do condom\xEDnio ${condo?.name || id} alterado para ${active ? "ATIVO" : "INATIVO"}.`,
        metodo: "ADMIN_ACTION"
      });
    } catch (auditErr) {
      console.warn("[DEBUG BACKEND] Erro ao registrar auditoria:", auditErr?.message);
    }
    res.json({ success: true, condominium: condo });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro ao alterar status" });
  }
});
app.delete("/api/admin/condominiums/:id", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  const { id } = req.params;
  try {
    const { data: condo, error: fetchErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
    if (fetchErr || !condo) {
      return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
    }
    const { count: userCount } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("condominium_id", id);
    const { count: packageCount } = await supabaseAdmin.from("packages").select("id", { count: "exact", head: true }).eq("condominium_id", id);
    await Promise.allSettled([
      supabaseAdmin.from("condominium_settings").delete().eq("condominium_id", id),
      supabaseAdmin.from("whatsapp_conversations").delete().eq("condominium_id", id),
      supabaseAdmin.from("auditoria_eventos").update({ condominio_id: null }).eq("condominio_id", id)
    ]);
    const forceDelete = req.query.force === "true";
    if (!forceDelete && (userCount && userCount > 0 || packageCount && packageCount > 0)) {
      return res.status(400).json({
        error: `Este condom\xEDnio possui ${userCount || 0} usu\xE1rio(s) e ${packageCount || 0} encomenda(s) vinculada(s). Confirme para remover o condom\xEDnio e desvincular os registros.`,
        hasDependencies: true,
        userCount: userCount || 0,
        packageCount: packageCount || 0
      });
    }
    if (userCount && userCount > 0) {
      await supabaseAdmin.from("profiles").update({ condominium_id: null }).eq("condominium_id", id);
    }
    if (packageCount && packageCount > 0) {
      await supabaseAdmin.from("packages").delete().eq("condominium_id", id);
    }
    const { error: deleteErr } = await supabaseAdmin.from("condominiums").delete().eq("id", id);
    if (deleteErr) throw deleteErr;
    const { error: auditError } = await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: null,
      usuario_id: adminProfile.id,
      usuario_nome: adminProfile.full_name,
      usuario_perfil: adminProfile.role,
      tipo_evento: "CONDOMINIO_EXCLUIDO",
      acao: "DELETE",
      tabela_afetada: "condominiums",
      registro_id: id,
      descricao: `Condom\xEDnio ${condo.name} foi exclu\xEDdo do sistema pelo administrador.`,
      metodo: "ADMIN_ACTION",
      dados_antes: condo
    });
    if (auditError) console.warn("[DEBUG BACKEND] Erro audit log:", auditError.message);
    res.json({ success: true, message: `Condom\xEDnio "${condo.name}" foi exclu\xEDdo com sucesso.` });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro ao excluir condom\xEDnio:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/admin/integrity-check", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  try {
    const autoRepair = req.query.repair === "true";
    const [
      { count: totalCondos },
      { count: totalProfiles },
      { count: totalMoradores },
      { count: totalPackages },
      { data: allCondos }
    ] = await Promise.all([
      supabaseAdmin.from("condominiums").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("moradores").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("packages").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("condominiums").select("id, name")
    ]);
    const validCondoIds = new Set((allCondos || []).map((c) => c.id));
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name, condominium_id");
    const orphanedProfiles = (profiles || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
    const { data: moradores } = await supabaseAdmin.from("moradores").select("id, nome, condominium_id");
    const orphanedMoradores = (moradores || []).filter((m) => m.condominium_id && !validCondoIds.has(m.condominium_id));
    const { data: packages } = await supabaseAdmin.from("packages").select("id, tracking_code, condominium_id");
    const orphanedPackages = (packages || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
    const totalInconsistencies = orphanedProfiles.length + orphanedMoradores.length + orphanedPackages.length;
    const repairedCount = { profiles: 0, moradores: 0, packages: 0 };
    if (autoRepair && totalInconsistencies > 0) {
      if (orphanedProfiles.length > 0) {
        const orphanIds = orphanedProfiles.map((p) => p.id);
        await supabaseAdmin.from("profiles").update({ condominium_id: null }).in("id", orphanIds);
        repairedCount.profiles = orphanIds.length;
      }
      if (orphanedMoradores.length > 0) {
        const orphanIds = orphanedMoradores.map((m) => m.id);
        await supabaseAdmin.from("moradores").delete().in("id", orphanIds);
        repairedCount.moradores = orphanIds.length;
      }
      if (orphanedPackages.length > 0) {
        const orphanIds = orphanedPackages.map((p) => p.id);
        await supabaseAdmin.from("packages").delete().in("id", orphanIds);
        repairedCount.packages = orphanIds.length;
      }
    }
    const healthStatus = totalInconsistencies === 0 || autoRepair ? "HEALTHY" : "INCONSISTENCY_DETECTED";
    res.json({
      status: healthStatus,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
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
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro ao verificar integridade:", err);
    res.status(500).json({ error: err.message || "Erro na verifica\xE7\xE3o de integridade" });
  }
});
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
      supabaseAdmin.from("condominiums").select("*"),
      supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active"),
      supabaseAdmin.from("moradores").select("id, nome, unidade, bloco, condominium_id"),
      supabaseAdmin.from("packages").select("id, tracking_code, recipient_name, status, condominium_id")
    ]);
    const snapshotPayload = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      created_by: adminProfile?.full_name || "Admin",
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
    const { data: auditLog, error: auditErr } = await supabaseAdmin.from("auditoria_eventos").insert({
      usuario_id: adminProfile?.id || null,
      usuario_nome: adminProfile?.full_name || "Sistema",
      usuario_perfil: adminProfile?.role || "admin",
      tipo_evento: "SYSTEM_BACKUP_SNAPSHOT",
      acao: "BACKUP",
      tabela_afetada: "condominiums",
      descricao: `Snapshot de backup gerado com sucesso. (${(condos || []).length} condom\xEDnios, ${(profiles || []).length} perfis)`,
      metodo: "ADMIN_ACTION",
      dados_depois: snapshotPayload
    }).select().single();
    if (auditErr) {
      console.warn("[DEBUG BACKEND] Erro ao gravar snapshot no log:", auditErr.message);
    }
    res.json({
      success: true,
      message: "Snapshot de backup da base de dados realizado com sucesso!",
      snapshotId: auditLog?.id || `snap_${Date.now()}`,
      timestamp: snapshotPayload.timestamp,
      counts: snapshotPayload.counts
    });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro ao criar backup snapshot:", err);
    res.status(500).json({ error: err.message || "Erro ao criar backup" });
  }
});
app.get("/api/admin/backup-history", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  try {
    const { data: logs, error } = await supabaseAdmin.from("auditoria_eventos").select("*").eq("tipo_evento", "SYSTEM_BACKUP_SNAPSHOT").order("criado_em", { ascending: false }).limit(20);
    if (error) throw error;
    res.json({
      backups: (logs || []).map((l) => ({
        id: l.id,
        created_at: l.criado_em,
        created_by: l.usuario_nome,
        counts: l.dados_depois?.counts || {},
        description: l.descricao
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/admin/users", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminUser, adminProfile } = session;
  const { email, password, full_name, phone, role, condominium_id, horario_inicio, horario_fim } = req.body;
  console.log("[DEBUG BACKEND] Criando novo usu\xE1rio:", { email, full_name, role, condominium_id });
  if (!full_name || full_name.trim() === "") {
    return res.status(400).json({ error: "O nome completo \xE9 obrigat\xF3rio." });
  }
  const validRoles = ["admin", "sindico", "porteiro", "resident"];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Perfil de usu\xE1rio inv\xE1lido." });
  }
  let cleanEmail = email ? email.trim().toLowerCase() : "";
  if (!cleanEmail) {
    if (role === "porteiro") {
      const slugName = full_name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const randomSuffix = Math.floor(1e3 + Math.random() * 9e3);
      cleanEmail = `porteiro.${slugName || "operacional"}.${Date.now().toString(36)}.${randomSuffix}@sistema.encomendas`;
    } else {
      return res.status(400).json({ error: "O e-mail \xE9 obrigat\xF3rio para criar este tipo de usu\xE1rio." });
    }
  }
  const rawRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!rawRole.includes("admin")) {
    return res.status(403).json({ error: "Acesso negado. Apenas o administrador pode criar novos acessos de usu\xE1rios." });
  }
  try {
    if (phone && phone.trim() !== "") {
      const { data: existingPhone } = await supabaseAdmin.from("profiles").select("id, phone").eq("phone", phone.trim()).maybeSingle();
      if (existingPhone) {
        return res.status(409).json({ error: "Este telefone j\xE1 est\xE1 cadastrado para outro usu\xE1rio." });
      }
    }
    if (condominium_id) {
      const { data: condoExist } = await supabaseAdmin.from("condominiums").select("id").eq("id", condominium_id).maybeSingle();
      if (!condoExist) {
        return res.status(400).json({ error: "O condom\xEDnio informado n\xE3o existe." });
      }
    }
    const tempPassword = password && password.trim() !== "" ? password.trim() : `Temp@${Math.random().toString(36).slice(-6)}${Math.random().toString(36).slice(-2)}`;
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), role }
    });
    if (createError) {
      if (createError.message.includes("already registered") || createError.message.includes("already exists") || createError.message.includes("unique constraint")) {
        return res.status(409).json({ error: "Este e-mail j\xE1 est\xE1 cadastrado no sistema de autentica\xE7\xE3o." });
      }
      throw createError;
    }
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").insert([{
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
    }]).select().single();
    if (profileError) {
      console.error("[DEBUG BACKEND] Erro ao criar perfil, executando rollback no Auth:", profileError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }
    const profileWithEmail = { ...profile, email: cleanEmail };
    await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: condominium_id || adminProfile.condominium_id || null,
      usuario_id: adminUser.id,
      usuario_nome: adminProfile.full_name || "Admin",
      usuario_perfil: adminProfile.role || "admin",
      tipo_evento: "USUARIO_CRIADO",
      acao: "CREATE",
      tabela_afetada: "profiles",
      registro_id: authData.user.id,
      descricao: `Usu\xE1rio ${full_name.trim()} (${cleanEmail}) cadastrado com perfil ${role} e senha tempor\xE1ria gerada.`,
      metodo: "ADMIN_ACTION",
      dados_depois: { id: authData.user.id, email: cleanEmail, full_name, role, condominium_id }
    });
    res.json({
      success: true,
      user: authData.user,
      profile: profileWithEmail,
      tempPassword,
      message: "Usu\xE1rio cadastrado com sucesso!"
    });
  } catch (err) {
    console.error("Erro ao criar usu\xE1rio admin:", err);
    res.status(500).json({ error: err.message || "Erro ao cadastrar usu\xE1rio" });
  }
});
var handleUpdateAdminUser = async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminUser, adminProfile } = session;
  const { id } = req.params;
  const { full_name, phone, role, condominium_id, active, horario_inicio, horario_fim } = req.body;
  console.log("[DEBUG BACKEND] Atualizando usu\xE1rio:", id, { full_name, phone, role, condominium_id, active, horario_inicio, horario_fim });
  const { data: targetProfile } = await supabaseAdmin.from("profiles").select("role, condominium_id").eq("id", id).single();
  if (!targetProfile) return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado." });
  if (adminProfile.role === "sindico") {
    if (targetProfile.condominium_id !== adminProfile.condominium_id) {
      return res.status(403).json({ error: "S\xEDndicos s\xF3 podem editar usu\xE1rios do seu pr\xF3prio condom\xEDnio." });
    }
    if (targetProfile.role === "admin" || targetProfile.role === "sindico") {
      return res.status(403).json({ error: "S\xEDndicos n\xE3o podem editar outros s\xEDndicos ou administradores." });
    }
    if (condominium_id && condominium_id !== adminProfile.condominium_id) {
      return res.status(403).json({ error: "S\xEDndicos n\xE3o podem mover usu\xE1rios para outros condom\xEDnios." });
    }
    if (role && role !== "porteiro" && role !== "resident") {
      return res.status(403).json({ error: "S\xEDndicos s\xF3 podem atribuir perfis de porteiro ou morador." });
    }
  }
  try {
    console.log("[DEBUG BACKEND] Iniciando atualiza\xE7\xE3o no Supabase para ID:", id);
    const updateData = {
      updated_by: adminUser.id,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (full_name !== void 0) updateData.full_name = full_name;
    if (phone !== void 0) updateData.phone = phone;
    if (role !== void 0) updateData.role = role;
    if (condominium_id !== void 0) updateData.condominium_id = condominium_id || null;
    if (active !== void 0) updateData.active = active;
    if (horario_inicio !== void 0) updateData.horario_inicio = horario_inicio || null;
    if (horario_fim !== void 0) updateData.horario_fim = horario_fim || null;
    console.log("[DEBUG BACKEND] Dados de atualiza\xE7\xE3o:", updateData);
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update(updateData).eq("id", id).select().single();
    if (profileError) {
      console.error("[DEBUG BACKEND] Erro ao atualizar perfil no Supabase:", profileError);
      throw profileError;
    }
    console.log("[DEBUG BACKEND] Perfil atualizado com sucesso no Supabase:", profile.id);
    res.json({ profile });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro fatal no PATCH/PUT /api/admin/users/:id:", err);
    res.status(500).json({ error: err.message });
  }
};
app.patch("/api/admin/users/:id", handleUpdateAdminUser);
app.put("/api/admin/users/:id", handleUpdateAdminUser);
app.post("/api/admin/users/:id/reset-password", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminProfile } = session;
  const { id } = req.params;
  const { newPassword } = req.body;
  const tempPassword = newPassword || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);
  console.log("[DEBUG BACKEND] Resetando senha para usu\xE1rio ID:", id);
  let targetProfile = null;
  const { data: pData } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id").eq("id", id).maybeSingle();
  if (pData) {
    targetProfile = { ...pData, email: "" };
    try {
      const { data: { user: aUser } } = await supabaseAdmin.auth.admin.getUserById(id);
      if (aUser?.email) targetProfile.email = aUser.email;
    } catch (e) {
    }
  } else {
    const { data: mData } = await supabaseAdmin.from("moradores").select("id, nome, email, condominium_id").eq("id", id).maybeSingle();
    if (mData) {
      targetProfile = {
        id: mData.id,
        full_name: mData.nome,
        email: mData.email || "",
        role: "resident",
        condominium_id: mData.condominium_id
      };
    }
  }
  if (!targetProfile) {
    console.warn(`[DEBUG BACKEND] Usu\xE1rio ${id} n\xE3o encontrado para reset de senha.`);
    return res.status(404).json({ error: "Este usu\xE1rio ainda n\xE3o possui uma conta de acesso." });
  }
  const resetCallerRole = (adminProfile?.role || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!resetCallerRole.includes("admin")) {
    return res.status(403).json({ error: "Acesso negado. Apenas o administrador pode gerar ou redefinir credenciais de acesso." });
  }
  try {
    console.log("[DEBUG BACKEND] Atualizando senha no Auth para ID:", id);
    try {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: tempPassword
      });
      if (authError) {
        console.warn("[DEBUG BACKEND] Aviso no Auth.updateUserById:", authError.message);
      }
    } catch (aErr) {
      console.warn("[DEBUG BACKEND] Erro ao atualizar senha no Auth (usu\xE1rio demo/local):", aErr.message);
    }
    try {
      await supabaseAdmin.auth.admin.signOut(id);
    } catch (soErr) {
      console.warn("[DEBUG BACKEND] Aviso ao invalidar sess\xF5es:", soErr.message);
    }
    const { error: profileError } = await supabaseAdmin.from("profiles").update({
      must_change_password: true,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", id);
    if (profileError) {
      console.warn("[DEBUG BACKEND] Erro ao atualizar perfil em profiles:", profileError.message);
    }
    const { error: auditError } = await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: adminProfile.condominium_id || targetProfile.condominium_id || null,
      usuario_id: adminProfile.id,
      usuario_nome: adminProfile.full_name,
      usuario_perfil: adminProfile.role,
      tipo_evento: "SENHA_RESETADA",
      acao: "UPDATE",
      tabela_afetada: "profiles",
      registro_id: id,
      descricao: `Senha redefinida para o usu\xE1rio ${targetProfile.full_name} (${targetProfile.email || "Sem email"})`,
      metodo: "ADMIN_ACTION",
      dados_depois: { id, full_name: targetProfile.full_name, role: targetProfile.role }
    });
    if (auditError) {
      console.warn("[DEBUG BACKEND] Erro ao registrar audit log:", auditError.message);
    }
    console.log("[DEBUG BACKEND] Reset de senha conclu\xEDdo com sucesso para:", id);
    return res.json({
      success: true,
      tempPassword,
      message: "Senha redefinida com sucesso!"
    });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro fatal no reset-password:", err);
    return res.status(500).json({ error: err.message });
  }
});
app.post("/api/auth/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const { newPassword, userId } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
  }
  try {
    let targetUserId = userId;
    if (token && token !== "MOCK_TOKEN") {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (user) {
        targetUserId = user.id;
      }
    }
    if (!targetUserId) {
      return res.status(401).json({ error: "Sess\xE3o inv\xE1lida ou ID do usu\xE1rio n\xE3o fornecido." });
    }
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword
    });
    if (authError) {
      console.warn("[DEBUG BACKEND] Erro ao atualizar senha no Auth:", authError.message);
    }
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update({
      must_change_password: false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", targetUserId).select().single();
    if (profileError) {
      console.warn("[DEBUG BACKEND] Erro ao atualizar perfil em profiles:", profileError.message);
    }
    await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: profile?.condominium_id || null,
      usuario_id: targetUserId,
      usuario_nome: profile?.full_name || "Usu\xE1rio",
      usuario_perfil: profile?.role || "user",
      tipo_evento: "SENHA_ALTERADA",
      acao: "UPDATE",
      tabela_afetada: "profiles",
      registro_id: targetUserId,
      descricao: `Senha alterada pelo usu\xE1rio ${profile?.full_name || targetUserId} no primeiro acesso/redefini\xE7\xE3o.`,
      metodo: "USER_ACTION",
      dados_depois: { id: targetUserId, must_change_password: false }
    });
    res.json({ success: true, profile, message: "Senha alterada com sucesso!" });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro ao alterar senha:", err);
    res.status(500).json({ error: err.message || "Erro ao alterar senha." });
  }
});
app.delete("/api/admin/users/:id", async (req, res) => {
  const session = await validateAdminSession(req);
  if ("error" in session) return res.status(session.status).json({ error: session.error });
  const { adminUser, adminProfile } = session;
  const { id } = req.params;
  console.log(`[DEBUG BACKEND] Recebida requisi\xE7\xE3o DELETE para usu\xE1rio ID: "${id}" por admin: ${adminUser.id}`);
  if (id === adminProfile.id || id === adminUser.id) {
    return res.status(400).json({ error: "Voc\xEA n\xE3o pode excluir seu pr\xF3prio usu\xE1rio." });
  }
  try {
    let targetProfile = null;
    let targetTable = "profiles";
    const { data: profileData } = await supabaseAdmin.from("profiles").select("*").eq("id", id).maybeSingle();
    if (profileData) {
      targetProfile = profileData;
      targetTable = "profiles";
    } else {
      const { data: moradorData } = await supabaseAdmin.from("moradores").select("*").eq("id", id).maybeSingle();
      if (moradorData) {
        targetProfile = {
          id: moradorData.id,
          full_name: moradorData.nome,
          email: moradorData.email || "",
          role: "resident",
          condominium_id: moradorData.condominium_id
        };
        targetTable = "moradores";
      }
    }
    if (!targetProfile) {
      console.warn(`[DEBUG BACKEND] Usu\xE1rio com ID "${id}" n\xE3o encontrado nas tabelas profiles e moradores.`);
      return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado no banco de dados." });
    }
    console.log(`[DEBUG BACKEND] Perfil localizado na tabela ${targetTable}: ${targetProfile.full_name} (${targetProfile.role})`);
    if (adminProfile.role === "sindico") {
      if (targetProfile.condominium_id && targetProfile.condominium_id !== adminProfile.condominium_id) {
        console.warn(`[DEBUG BACKEND] S\xEDndico ${adminUser.id} tentou excluir usu\xE1rio de outro condom\xEDnio.`);
        return res.status(403).json({ error: "S\xEDndicos s\xF3 podem excluir usu\xE1rios do seu pr\xF3prio condom\xEDnio." });
      }
      if (targetProfile.role === "admin" || targetProfile.role === "sindico") {
        console.warn(`[DEBUG BACKEND] S\xEDndico ${adminUser.id} tentou excluir outro s\xEDndico/admin.`);
        return res.status(403).json({ error: "S\xEDndicos n\xE3o podem excluir outros s\xEDndicos ou administradores." });
      }
    }
    console.log(`[DEBUG BACKEND] Limpando refer\xEAncias do usu\xE1rio ${id} em tabelas vinculadas...`);
    await Promise.allSettled([
      supabaseAdmin.from("resident_access_tokens").delete().eq("resident_id", id),
      supabaseAdmin.from("notifications").delete().eq("user_id", id),
      supabaseAdmin.from("retrieval_logs").update({ porter_id: null }).eq("porter_id", id),
      supabaseAdmin.from("packages").update({ recipient_id: null }).eq("recipient_id", id),
      supabaseAdmin.from("packages").update({ received_by: null }).eq("received_by", id),
      supabaseAdmin.from("packages").update({ retrieved_by_user_id: null }).eq("retrieved_by_user_id", id),
      supabaseAdmin.from("auditoria_eventos").update({ usuario_id: null }).eq("usuario_id", id)
    ]);
    console.log(`[DEBUG BACKEND] Deletando da tabela ${targetTable} o registro ID ${id}...`);
    const { error: tableDeleteErr } = await supabaseAdmin.from(targetTable).delete().eq("id", id);
    if (tableDeleteErr) {
      console.error(`[DEBUG BACKEND] Erro ao deletar registro da tabela ${targetTable}:`, tableDeleteErr);
      return res.status(500).json({ error: `N\xE3o foi poss\xEDvel excluir do banco de dados: ${tableDeleteErr.message}` });
    }
    console.log(`[DEBUG BACKEND] Deletando usu\xE1rio do Auth ${id}...`);
    try {
      const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authDeleteErr) {
        console.warn("[DEBUG BACKEND] Aviso ao excluir do Supabase Auth:", authDeleteErr.message);
      } else {
        console.log("[DEBUG BACKEND] Usu\xE1rio deletado do Auth com sucesso.");
      }
    } catch (authDeleteExc) {
      console.warn("[DEBUG BACKEND] Exce\xE7\xE3o ao excluir do Auth (pode ser conta local/demo):", authDeleteExc.message);
    }
    const { error: auditError } = await supabaseAdmin.from("auditoria_eventos").insert({
      condominio_id: adminProfile.condominium_id || targetProfile.condominium_id || null,
      usuario_id: adminProfile.id,
      usuario_nome: adminProfile.full_name,
      usuario_perfil: adminProfile.role,
      tipo_evento: "USUARIO_EXCLUIDO",
      acao: "DELETE",
      tabela_afetada: targetTable,
      registro_id: id,
      descricao: `Usu\xE1rio ${targetProfile.full_name} (${targetProfile.role}) foi exclu\xEDdo permanentemente do sistema.`,
      metodo: "ADMIN_ACTION",
      dados_antes: targetProfile
    });
    if (auditError) {
      console.warn("[DEBUG BACKEND] Erro ao gravar log de auditoria:", auditError.message);
    }
    console.log(`[DEBUG BACKEND] Exclus\xE3o de ${id} conclu\xEDda com sucesso.`);
    return res.json({ success: true, message: "Usu\xE1rio exclu\xEDdo com sucesso." });
  } catch (err) {
    console.error("[DEBUG BACKEND] Erro fatal na rota de exclus\xE3o:", err);
    return res.status(500).json({ error: err.message || "Erro interno no servidor ao excluir usu\xE1rio." });
  }
});
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `Rota de API n\xE3o encontrada: ${req.method} ${req.path}` });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
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
  if (supabaseServiceKey && supabaseUrl && !supabaseUrl.includes("placeholder")) {
    supabaseAdmin.storage.listBuckets().then(({ data: buckets }) => {
      if (!buckets?.find((b) => b.name === "packages")) {
        supabaseAdmin.storage.createBucket("packages", {
          public: true,
          allowedMimeTypes: ["image/jpeg", "image/png"],
          fileSizeLimit: 5242880
          // 5MB
        }).then(() => {
          console.log("Created 'packages' storage bucket");
        }).catch((err) => {
          console.warn("Storage bucket creation notice:", err?.message || err);
        });
      }
    }).catch((err) => {
      console.warn("Storage bucket check notice:", err?.message || err);
    });
  }
}
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error("Fatal error starting server:", err);
  });
}
var server_default = app;
export {
  app,
  server_default as default,
  startServer
};
