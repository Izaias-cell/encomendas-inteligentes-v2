// server.ts
import { GoogleGenAI, Type } from "@google/genai";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var supabaseUrl = process.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
var supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "placeholder";
var supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
var defaultSupabase = createClient(supabaseUrl, supabaseAnonKey);
var defaultSupabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
if (!supabaseServiceKey) {
  console.warn("[DEBUG BACKEND] AVISO: SUPABASE_SERVICE_ROLE_KEY n\xE3o encontrada. As a\xE7\xF5es administrativas podem falhar devido ao RLS.");
} else {
  console.log("[DEBUG BACKEND] SUPABASE_SERVICE_ROLE_KEY encontrada. Cliente admin inicializado.");
}
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var toNullableUuid = (val) => {
  return typeof val === "string" && UUID_REGEX.test(val.trim()) ? val.trim() : null;
};
var normalizeRoleValue = (role) => {
  return String(role || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};
function createApp(deps = {}) {
  const supabase = deps.supabase || defaultSupabase;
  const supabaseAdmin = deps.supabaseAdmin || defaultSupabaseAdmin;
  const isProduction = deps.isProduction ?? (process.env.NODE_ENV === "production" || process.env.VERCEL === "1");
  const app2 = express();
  const formatSafeDateTime = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    return isNaN(d.getTime()) ? "-" : d.toLocaleString("pt-BR");
  };
  const formatSafeDate = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
  };
  const PORT = Number(process.env.PORT) || 3e3;
  app2.use(express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  const generateSecureHexToken = (bytes = 16) => {
    return crypto.randomBytes(bytes).toString("hex");
  };
  const generateSecureTempPasswordServer = (length = 12) => {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += charset[bytes[i] % charset.length];
    }
    return out;
  };
  const timingSafeCompare = (a, b) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  };
  const rateLimitStore = /* @__PURE__ */ new Map();
  const getClientIp = (req) => {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.trim()) {
      return fwd.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
  };
  const checkRateLimit = (key, maxRequests, windowMs) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (rateLimitStore.get(key) || []).filter((ts) => ts > cutoff);
    if (recent.length >= maxRequests) {
      const oldest = recent[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1e3));
      rateLimitStore.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    rateLimitStore.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  };
  const serializePortariaCondo = (condo, portariaName, accessCode) => {
    const payload = {
      id: condo.id,
      name: condo.name,
      address: condo.address ?? null,
      city_state: condo.city_state ?? null,
      rules: condo.rules ?? null,
      active: condo.active !== false,
      portaria_name: portariaName || condo.name
    };
    if (accessCode !== void 0) {
      payload.portaria_access_code = accessCode;
    }
    return payload;
  };
  const serializePortariaPorter = (porter) => ({
    id: porter.id,
    full_name: porter.full_name,
    role: porter.role,
    condominium_id: porter.condominium_id,
    active: porter.active !== false,
    horario_inicio: porter.horario_inicio ?? null,
    horario_fim: porter.horario_fim ?? null,
    escala_tipo: porter.escala_tipo ?? null
  });
  const serializePortalResident = (resident) => ({
    id: resident.id,
    nome: resident.nome,
    unidade: resident.unidade,
    unit_type: resident.unit_type ?? null,
    block: resident.block ?? resident.bloco ?? null,
    bloco: resident.bloco ?? resident.block ?? null
  });
  const serializePortalCondo = (condo) => ({
    id: condo.id,
    name: condo.name
  });
  const isMissingColumnSchemaError = (err) => {
    if (!err) return false;
    const code = String(err.code || "");
    const msg = String(err.message || err.details || "").toLowerCase();
    return code === "42703" || code === "PGRST204" || msg.includes("column") && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("schema cache"));
  };
  const serializePortalPackage = (pkg, resident, condo) => ({
    id: pkg.id,
    condominium_id: pkg.condominium_id,
    recipient_id: pkg.recipient_id ?? null,
    unit_number: pkg.unit_number ?? pkg.unit_number_raw ?? "",
    unit_number_raw: pkg.unit_number_raw ?? pkg.unit_number ?? "",
    unit_type: pkg.unit_type ?? null,
    block: pkg.block ?? null,
    bloco: pkg.bloco ?? pkg.block ?? null,
    tower: pkg.tower ?? null,
    complement: pkg.complement ?? null,
    carrier: pkg.carrier ?? null,
    tracking_code: pkg.tracking_code ?? null,
    status: pkg.status,
    photo_url: pkg.photo_url ?? null,
    notes: pkg.notes ?? null,
    received_at: pkg.received_at ?? pkg.created_at ?? null,
    created_at: pkg.created_at ?? pkg.received_at ?? null,
    delivered_at: pkg.delivered_at ?? null,
    pickup_code: pkg.pickup_code ?? null,
    pickup_token: pkg.pickup_token ?? null,
    ...resident ? { moradores: serializePortalResident(resident) } : {},
    ...condo ? { condominiums: serializePortalCondo(condo) } : {}
  });
  const normalizeBrazilPhoneCandidates = (rawPhone) => {
    const digits = String(rawPhone || "").replace(/\D/g, "");
    if (!digits) return [];
    const set = /* @__PURE__ */ new Set([digits]);
    if (digits.startsWith("55") && digits.length >= 12) {
      const local = digits.slice(2);
      set.add(local);
      if (local.length === 10) {
        set.add(`${local.slice(0, 2)}9${local.slice(2)}`);
        set.add(`55${local.slice(0, 2)}9${local.slice(2)}`);
      } else if (local.length === 11 && local[2] === "9") {
        const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
        set.add(withoutNine);
        set.add(`55${withoutNine}`);
      }
    } else if (digits.length === 10 || digits.length === 11) {
      set.add(`55${digits}`);
      if (digits.length === 10) {
        set.add(`${digits.slice(0, 2)}9${digits.slice(2)}`);
        set.add(`55${digits.slice(0, 2)}9${digits.slice(2)}`);
      } else if (digits.length === 11 && digits[2] === "9") {
        const withoutNine = `${digits.slice(0, 2)}${digits.slice(3)}`;
        set.add(withoutNine);
        set.add(`55${withoutNine}`);
      }
    }
    return Array.from(set);
  };
  const recordAuditEvent = async (entries) => {
    const list = (Array.isArray(entries) ? entries : [entries]).map((entry) => ({
      ...entry,
      condominio_id: toNullableUuid(entry.condominio_id),
      usuario_id: toNullableUuid(entry.usuario_id),
      registro_id: toNullableUuid(entry.registro_id)
    }));
    try {
      const { error } = await supabaseAdmin.from("auditoria_eventos").insert(list);
      if (error) {
        console.warn("[Auditoria] Falha ao gravar evento(s) no Supabase:", error.message || error);
        return { ok: false, error };
      }
      return { ok: true, error: null };
    } catch (err) {
      console.warn("[Auditoria] Exce\xE7\xE3o ao gravar evento(s):", err?.message || err);
      return { ok: false, error: err };
    }
  };
  const portariaStore = /* @__PURE__ */ new Map();
  const buildCandidatePortariaCode = (condoName) => {
    const base = (condoName || "CONDO").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^CONDOMINIO\s+/i, "").replace(/[^A-Z0-9]/g, "");
    const prefix = base.length > 0 ? base.substring(0, 10) : "PORTARIA";
    const num = Math.floor(1e3 + Math.random() * 9e3);
    return `${prefix}-${num}`;
  };
  const generateUniquePortariaCode = async (condoName) => {
    const maxAttempts = 25;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = buildCandidatePortariaCode(condoName);
      let usedInCache = false;
      for (const creds of portariaStore.values()) {
        if (creds.portaria_access_code?.toUpperCase() === candidate.toUpperCase()) {
          usedInCache = true;
          break;
        }
      }
      if (usedInCache) continue;
      const { data: existingRow, error: checkErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id").eq("portaria_access_code", candidate).maybeSingle();
      if (checkErr) {
        throw new Error(`Falha ao verificar unicidade do c\xF3digo da portaria no banco: ${checkErr.message || "erro de consulta"}`);
      }
      if (!existingRow) {
        return candidate;
      }
    }
    throw new Error("N\xE3o foi poss\xEDvel gerar um c\xF3digo de portaria \xFAnico ap\xF3s m\xFAltiplas tentativas.");
  };
  const getOrInitPortariaCreds = async (condoId, condoName) => {
    const { data: dbSettings, error: fetchErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").eq("condominium_id", condoId).maybeSingle();
    if (fetchErr) {
      throw new Error(`Falha ao consultar credenciais da portaria no banco de dados: ${fetchErr.message || "erro de consulta"}`);
    }
    if (dbSettings && dbSettings.portaria_access_code && String(dbSettings.portaria_access_code).trim() !== "") {
      const creds = {
        condominium_id: condoId,
        portaria_name: dbSettings.portaria_name || condoName,
        portaria_access_code: String(dbSettings.portaria_access_code).trim(),
        active_token: dbSettings.active_portaria_token || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      portariaStore.set(condoId, creds);
      return creds;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await generateUniquePortariaCode(condoName);
      let savedRow = null;
      let saveErr = null;
      if (dbSettings) {
        const res = await supabaseAdmin.from("condominium_settings").update({
          portaria_name: dbSettings.portaria_name || condoName,
          portaria_access_code: code,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("condominium_id", condoId).select().single();
        savedRow = res.data;
        saveErr = res.error;
      } else {
        const res = await supabaseAdmin.from("condominium_settings").insert({
          condominium_id: condoId,
          portaria_name: condoName,
          portaria_access_code: code,
          notification_template: `\u{1F4E6} Nova encomenda recebida na portaria do ${condoName}`,
          reminder_48h_enabled: false,
          reminder_72h_enabled: false
        }).select().single();
        savedRow = res.data;
        saveErr = res.error;
      }
      if (saveErr) {
        const isUniqueViolation = saveErr.code === "23505" || String(saveErr.message || "").toLowerCase().includes("duplicate");
        if (isUniqueViolation) {
          const { data: raceSettings, error: raceErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").eq("condominium_id", condoId).maybeSingle();
          if (raceErr) {
            throw new Error(`Falha ao verificar concorr\xEAncia de credenciais: ${raceErr.message}`);
          }
          if (raceSettings?.portaria_access_code) {
            const raceCreds = {
              condominium_id: condoId,
              portaria_name: raceSettings.portaria_name || condoName,
              portaria_access_code: String(raceSettings.portaria_access_code).trim(),
              active_token: raceSettings.active_portaria_token || null,
              updated_at: (/* @__PURE__ */ new Date()).toISOString()
            };
            portariaStore.set(condoId, raceCreds);
            return raceCreds;
          }
          continue;
        }
        throw new Error(`Falha ao persistir c\xF3digo de acesso da portaria no banco: ${saveErr.message || "erro ao salvar"}`);
      }
      if (!savedRow || !savedRow.portaria_access_code) {
        throw new Error("Banco de dados n\xE3o confirmou a grava\xE7\xE3o do c\xF3digo de acesso da portaria.");
      }
      const creds = {
        condominium_id: condoId,
        portaria_name: savedRow.portaria_name || condoName,
        portaria_access_code: savedRow.portaria_access_code,
        active_token: savedRow.active_portaria_token || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      portariaStore.set(condoId, creds);
      await recordAuditEvent({
        condominio_id: condoId,
        usuario_nome: "Sistema",
        usuario_perfil: "sistema",
        tipo_evento: "CODIGO_PORTARIA_CRIADO",
        acao: "INSERT",
        tabela_afetada: "condominium_settings",
        registro_id: condoId,
        descricao: `C\xF3digo de acesso da portaria gerado e persistido para ${condoName}.`,
        metodo: "SYSTEM_AUTO"
      });
      return creds;
    }
    throw new Error("Falha ao persistir c\xF3digo \xFAnico de portaria ap\xF3s tentativas de resolu\xE7\xE3o de conflito.");
  };
  const findPersistedPortariaByCode = async (cleanCode) => {
    const { data: settingsList, error: settingsErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").not("portaria_access_code", "is", null);
    if (settingsErr) {
      throw new Error(`Erro ao consultar credenciais da portaria no banco de dados: ${settingsErr.message || "erro de consulta"}`);
    }
    const matchedSetting = (settingsList || []).find(
      (row) => typeof row?.portaria_access_code === "string" && row.portaria_access_code.trim().toUpperCase() === cleanCode
    );
    if (!matchedSetting) {
      return null;
    }
    const { data: condo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, address, city_state, rules, active, created_at").eq("id", matchedSetting.condominium_id).maybeSingle();
    if (condoErr) {
      throw new Error(`Erro ao consultar dados do condom\xEDnio no banco de dados: ${condoErr.message || "erro de consulta"}`);
    }
    if (!condo) {
      return null;
    }
    return {
      condominium: condo,
      setting: matchedSetting
    };
  };
  app2.post("/api/portaria/activate", async (req, res) => {
    const { access_code } = req.body || {};
    if (!access_code || typeof access_code !== "string" || access_code.trim() === "") {
      return res.status(400).json({ error: "Informe o c\xF3digo de acesso da portaria." });
    }
    const cleanCode = access_code.trim().toUpperCase();
    try {
      const match = await findPersistedPortariaByCode(cleanCode);
      if (!match) {
        await recordAuditEvent({
          condominio_id: null,
          usuario_nome: "Portaria (Tentativa)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_ATIVACAO_RECUSADA",
          acao: "LOGIN_FAILED",
          tabela_afetada: "condominium_settings",
          descricao: `Tentativa de ativa\xE7\xE3o da portaria com c\xF3digo inv\xE1lido ou inexistente.`,
          metodo: "PORTARIA_CODE"
        });
        return res.status(404).json({ error: "C\xF3digo de acesso da portaria n\xE3o encontrado. Verifique o c\xF3digo e tente novamente." });
      }
      const { condominium: targetCondo, setting } = match;
      if (targetCondo.active === false) {
        await recordAuditEvent({
          condominio_id: targetCondo.id,
          usuario_nome: "Portaria (Tentativa)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_ATIVACAO_RECUSADA",
          acao: "LOGIN_BLOCKED",
          tabela_afetada: "condominiums",
          registro_id: targetCondo.id,
          descricao: `Tentativa de ativa\xE7\xE3o da portaria recusada: condom\xEDnio ${targetCondo.name} est\xE1 inativo.`,
          metodo: "PORTARIA_CODE"
        });
        return res.status(403).json({ error: "Este condom\xEDnio encontra-se inativo/bloqueado pelo administrador." });
      }
      await recordAuditEvent({
        condominio_id: targetCondo.id,
        usuario_nome: "Portaria (Dispositivo)",
        usuario_perfil: "porteiro",
        tipo_evento: "PORTARIA_ATIVACAO_VALIDADA",
        acao: "VALIDATE_CODE",
        tabela_afetada: "condominium_settings",
        registro_id: targetCondo.id,
        descricao: `C\xF3digo de acesso da portaria validado para o condom\xEDnio ${targetCondo.name}.`,
        metodo: "PORTARIA_CODE"
      });
      res.json({
        success: true,
        condominium: serializePortariaCondo(targetCondo, setting.portaria_name || targetCondo.name)
      });
    } catch (err) {
      console.error("Erro em /api/portaria/activate:", err?.message || err);
      res.status(500).json({ error: err?.message || "Erro interno ao consultar credenciais da portaria." });
    }
  });
  app2.post("/api/portaria/confirm-link", async (req, res) => {
    const { access_code } = req.body || {};
    if (!access_code || typeof access_code !== "string" || access_code.trim() === "") {
      return res.status(400).json({ error: "C\xF3digo de acesso \xE9 obrigat\xF3rio." });
    }
    const cleanCode = access_code.trim().toUpperCase();
    try {
      const match = await findPersistedPortariaByCode(cleanCode);
      if (!match) {
        await recordAuditEvent({
          condominio_id: null,
          usuario_nome: "Portaria (Tentativa)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_ATIVACAO_RECUSADA",
          acao: "CONNECT_FAILED",
          tabela_afetada: "condominium_settings",
          descricao: `Tentativa de vincula\xE7\xE3o com c\xF3digo inv\xE1lido ou inexistente.`,
          metodo: "PORTARIA_CODE"
        });
        return res.status(403).json({ error: "Condom\xEDnio n\xE3o encontrado ou c\xF3digo inv\xE1lido." });
      }
      const { condominium: targetCondo, setting } = match;
      if (targetCondo.active === false) {
        await recordAuditEvent({
          condominio_id: targetCondo.id,
          usuario_nome: "Portaria (Tentativa)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_ATIVACAO_RECUSADA",
          acao: "CONNECT_BLOCKED",
          tabela_afetada: "condominiums",
          registro_id: targetCondo.id,
          descricao: `Vincula\xE7\xE3o recusada: condom\xEDnio ${targetCondo.name} est\xE1 inativo.`,
          metodo: "PORTARIA_CODE"
        });
        return res.status(403).json({ error: "Condom\xEDnio n\xE3o encontrado ou inativo." });
      }
      const hadPreviousSession = Boolean(setting.active_portaria_token);
      const portariaToken = crypto.randomBytes(32).toString("hex");
      const portariaName = setting.portaria_name || targetCondo.name;
      const { data: updatedSetting, error: updateErr } = await supabaseAdmin.from("condominium_settings").update({
        active_portaria_token: portariaToken,
        portaria_name: portariaName,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("condominium_id", targetCondo.id).select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").single();
      if (updateErr || !updatedSetting || updatedSetting.active_portaria_token !== portariaToken) {
        await recordAuditEvent({
          condominio_id: targetCondo.id,
          usuario_nome: "Portaria (Dispositivo)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_SESSAO_ERRO_PERSISTENCIA",
          acao: "CONNECT_ERROR",
          tabela_afetada: "condominium_settings",
          registro_id: targetCondo.id,
          descricao: `Falha ao persistir nova sess\xE3o da portaria para ${targetCondo.name}: ${updateErr?.message || "confirma\xE7\xE3o ausente"}.`,
          metodo: "PERMANENT_SESSION"
        });
        return res.status(500).json({ error: "Falha ao persistir a sess\xE3o da portaria no banco de dados. Tente novamente." });
      }
      const { data: porters, error: portersErr } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active, horario_inicio, horario_fim, escala_tipo").eq("condominium_id", targetCondo.id).eq("role", "porteiro").eq("active", true).order("full_name");
      if (portersErr) {
        return res.status(500).json({ error: "Erro ao consultar porteiros do condom\xEDnio no banco de dados." });
      }
      portariaStore.set(targetCondo.id, {
        condominium_id: targetCondo.id,
        portaria_name: updatedSetting.portaria_name || portariaName,
        portaria_access_code: updatedSetting.portaria_access_code || setting.portaria_access_code,
        active_token: portariaToken,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      const auditEvents = [
        {
          condominio_id: targetCondo.id,
          usuario_nome: "Portaria (Dispositivo)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_PRIMEIRO_ACESSO",
          acao: "LOGIN",
          tabela_afetada: "condominiums",
          registro_id: targetCondo.id,
          descricao: `Acesso \xE0 Portaria do condom\xEDnio ${targetCondo.name} confirmado.`,
          metodo: "PORTARIA_CODE"
        },
        {
          condominio_id: targetCondo.id,
          usuario_nome: "Portaria (Dispositivo)",
          usuario_perfil: "porteiro",
          tipo_evento: "DISPOSITIVO_VINCULADO",
          acao: "CONNECT",
          tabela_afetada: "condominium_settings",
          registro_id: targetCondo.id,
          descricao: hadPreviousSession ? `Novo dispositivo vinculado \xE0 Portaria do condom\xEDnio ${targetCondo.name}; sess\xE3o anterior substitu\xEDda.` : `Dispositivo vinculado permanentemente \xE0 Portaria do condom\xEDnio ${targetCondo.name}.`,
          metodo: "PERMANENT_SESSION"
        }
      ];
      await recordAuditEvent(auditEvents);
      res.json({
        success: true,
        portaria_token: portariaToken,
        condominium: serializePortariaCondo(targetCondo, updatedSetting.portaria_name || portariaName),
        porters: (porters || []).map(serializePortariaPorter)
      });
    } catch (err) {
      console.error("Erro em /api/portaria/confirm-link:", err?.message || err);
      res.status(500).json({ error: err?.message || "Erro ao vincular dispositivo" });
    }
  });
  app2.get("/api/portaria/validate-token/:token", async (req, res) => {
    const rawToken = req.params?.token;
    const token = typeof rawToken === "string" ? rawToken.trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Token n\xE3o informado", code: "PORTARIA_DEACTIVATED" });
    }
    try {
      const { data: dbSetting, error: settingErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").eq("active_portaria_token", token).maybeSingle();
      if (settingErr) {
        console.error("Erro ao consultar sess\xE3o da portaria no Supabase:", settingErr.message || settingErr);
        return res.status(500).json({ error: "Erro ao validar sess\xE3o da portaria no banco de dados.", code: "VALIDATION_ERROR" });
      }
      if (!dbSetting || !dbSetting.active_portaria_token || dbSetting.active_portaria_token !== token) {
        for (const [cId, creds] of portariaStore.entries()) {
          if (creds.active_token === token) {
            creds.active_token = null;
            portariaStore.set(cId, creds);
          }
        }
        await recordAuditEvent({
          condominio_id: null,
          usuario_nome: "Portaria (Valida\xE7\xE3o)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_VALIDACAO_RECUSADA",
          acao: "VALIDATE_REJECTED",
          tabela_afetada: "condominium_settings",
          descricao: `Token de sess\xE3o da portaria inv\xE1lido, inexistente ou revogado.`,
          metodo: "TOKEN_VALIDATION"
        });
        return res.status(401).json({ error: "Sess\xE3o da portaria inv\xE1lida ou desativada pelo administrador.", code: "PORTARIA_DEACTIVATED" });
      }
      const { data: condo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, address, city_state, rules, active, created_at").eq("id", dbSetting.condominium_id).maybeSingle();
      if (condoErr) {
        console.error("Erro ao consultar condom\xEDnio na valida\xE7\xE3o de token:", condoErr.message || condoErr);
        return res.status(500).json({ error: "Erro ao verificar status do condom\xEDnio.", code: "VALIDATION_ERROR" });
      }
      if (!condo || condo.active === false) {
        if (portariaStore.has(dbSetting.condominium_id)) {
          const cached = portariaStore.get(dbSetting.condominium_id);
          cached.active_token = null;
          portariaStore.set(dbSetting.condominium_id, cached);
        }
        await recordAuditEvent({
          condominio_id: dbSetting.condominium_id,
          usuario_nome: "Portaria (Valida\xE7\xE3o)",
          usuario_perfil: "porteiro",
          tipo_evento: "PORTARIA_VALIDACAO_RECUSADA",
          acao: "VALIDATE_BLOCKED",
          tabela_afetada: "condominiums",
          registro_id: dbSetting.condominium_id,
          descricao: `Valida\xE7\xE3o de sess\xE3o recusada: condom\xEDnio inativo ou inexistente.`,
          metodo: "TOKEN_VALIDATION"
        });
        return res.status(401).json({ error: "O condom\xEDnio foi inativado ou bloqueado pelo administrador.", code: "PORTARIA_DEACTIVATED" });
      }
      const { data: porters, error: portersErr } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active, horario_inicio, horario_fim, escala_tipo").eq("condominium_id", condo.id).eq("role", "porteiro").eq("active", true).order("full_name");
      if (portersErr) {
        return res.status(500).json({ error: "Erro ao carregar porteiros autorizados.", code: "VALIDATION_ERROR" });
      }
      portariaStore.set(condo.id, {
        condominium_id: condo.id,
        portaria_name: dbSetting.portaria_name || condo.name,
        portaria_access_code: dbSetting.portaria_access_code || "",
        active_token: dbSetting.active_portaria_token,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({
        success: true,
        condominium: serializePortariaCondo(condo, dbSetting.portaria_name || condo.name),
        porters: (porters || []).map(serializePortariaPorter)
      });
    } catch (err) {
      console.error("Erro na valida\xE7\xE3o do token da portaria:", err?.message || err);
      res.status(500).json({ error: err?.message || "Erro na valida\xE7\xE3o da sess\xE3o", code: "VALIDATION_ERROR" });
    }
  });
  app2.post("/api/admin/condominiums/:id/regenerate-portaria-code", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    const { id } = req.params;
    if (!isGlobalAdmin && adminProfile?.condominium_id !== id) {
      await recordAuditEvent({
        condominio_id: id,
        usuario_id: adminProfile?.id,
        usuario_nome: adminProfile?.full_name || "Usu\xE1rio",
        usuario_perfil: adminProfile?.role || "",
        tipo_evento: "ADMIN_AUTH_RECUSADA",
        acao: "FORBIDDEN",
        tabela_afetada: "condominium_settings",
        registro_id: id,
        descricao: `Tentativa sem permiss\xE3o de regenerar c\xF3digo de outro condom\xEDnio.`,
        metodo: "ADMIN_ACTION"
      });
      return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o possui permiss\xE3o para administrar este condom\xEDnio." });
    }
    try {
      const { data: condo, error: fetchErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
      if (fetchErr) {
        return res.status(500).json({ error: "Erro ao consultar condom\xEDnio no banco de dados." });
      }
      if (!condo) {
        return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
      }
      const { data: existingSettings, error: existingSettingsErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id").eq("condominium_id", id).maybeSingle();
      if (existingSettingsErr) {
        return res.status(500).json({ error: "Erro ao consultar configura\xE7\xF5es atuais da portaria." });
      }
      const portariaName = condo.name;
      let persistedRow = null;
      let lastSaveErr = null;
      let finalCode = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const newCode = await generateUniquePortariaCode(condo.name);
        finalCode = newCode;
        if (existingSettings) {
          const { data, error } = await supabaseAdmin.from("condominium_settings").update({
            portaria_name: portariaName,
            portaria_access_code: newCode,
            active_portaria_token: null,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("condominium_id", id).select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").single();
          persistedRow = data;
          lastSaveErr = error;
        } else {
          const { data, error } = await supabaseAdmin.from("condominium_settings").insert({
            condominium_id: id,
            portaria_name: portariaName,
            portaria_access_code: newCode,
            active_portaria_token: null,
            notification_template: `\u{1F4E6} Nova encomenda recebida na portaria do ${portariaName}`,
            reminder_48h_enabled: false,
            reminder_72h_enabled: false
          }).select("condominium_id, portaria_name, portaria_access_code, active_portaria_token").single();
          persistedRow = data;
          lastSaveErr = error;
        }
        if (!lastSaveErr) break;
        const isUniqueViolation = lastSaveErr.code === "23505" || String(lastSaveErr.message || "").toLowerCase().includes("duplicate");
        if (!isUniqueViolation) break;
      }
      if (lastSaveErr || !persistedRow || persistedRow.portaria_access_code !== finalCode || persistedRow.active_portaria_token !== null) {
        await recordAuditEvent({
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || "Admin",
          usuario_perfil: adminProfile?.role || "admin",
          tipo_evento: "CODIGO_PORTARIA_REGERACAO_FALHA",
          acao: "UPDATE_FAILED",
          tabela_afetada: "condominium_settings",
          registro_id: id,
          descricao: `Falha ao persistir novo c\xF3digo da portaria para ${condo.name}: ${lastSaveErr?.message || "confirma\xE7\xE3o ausente"}.`,
          metodo: "ADMIN_ACTION"
        });
        return res.status(500).json({ error: "Falha ao persistir o novo c\xF3digo de acesso no banco de dados. O c\xF3digo anterior foi mantido." });
      }
      portariaStore.set(id, {
        condominium_id: id,
        portaria_name: persistedRow.portaria_name || portariaName,
        portaria_access_code: persistedRow.portaria_access_code,
        active_token: null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      await recordAuditEvent([
        {
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || "Admin",
          usuario_perfil: adminProfile?.role || "admin",
          tipo_evento: "CODIGO_PORTARIA_REGERADO",
          acao: "UPDATE",
          tabela_afetada: "condominium_settings",
          registro_id: id,
          descricao: `Novo c\xF3digo de acesso da portaria gerado e persistido para ${condo.name}. O token do dispositivo anterior foi revogado.`,
          metodo: "ADMIN_ACTION"
        },
        {
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
        }
      ]);
      res.json({
        success: true,
        portaria_access_code: persistedRow.portaria_access_code,
        portaria_name: persistedRow.portaria_name || portariaName,
        message: `Novo c\xF3digo de acesso gerado com sucesso: ${persistedRow.portaria_access_code}`
      });
    } catch (err) {
      console.error("Erro ao regenerar c\xF3digo da portaria:", err?.message || err);
      res.status(500).json({ error: err?.message || "Erro ao regenerar c\xF3digo" });
    }
  });
  const getOrCreatePortalToken = async (residentId, condominiumId) => {
    try {
      const { data: existing } = await supabaseAdmin.from("resident_access_tokens").select("id, token, expires_at").eq("resident_id", residentId).eq("condominium_id", condominiumId).eq("active", true).gt("expires_at", (/* @__PURE__ */ new Date()).toISOString()).maybeSingle();
      if (existing?.token) return existing.token;
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = /* @__PURE__ */ new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      const { error } = await supabaseAdmin.from("resident_access_tokens").insert([{
        resident_id: residentId,
        condominium_id: condominiumId,
        token,
        expires_at: expiresAt.toISOString(),
        active: true
      }]).select("token").single();
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
  const fetchResidentPackagesForPortal = async (resident, condominiumId) => {
    const { data: byRecipient, error: recErr } = await supabaseAdmin.from("packages").select("*").eq("recipient_id", resident.id).eq("condominium_id", condominiumId).order("received_at", { ascending: false });
    if (recErr) throw recErr;
    if (byRecipient && byRecipient.length > 0) {
      return byRecipient;
    }
    if (resident.unidade) {
      const { data: byUnit, error: unitErr } = await supabaseAdmin.from("packages").select("*").eq("unit_number_raw", resident.unidade).eq("condominium_id", condominiumId).order("received_at", { ascending: false });
      if (!unitErr && byUnit && byUnit.length > 0) {
        return byUnit;
      }
    }
    return [];
  };
  app2.get("/api/portal/validate/:token", async (req, res) => {
    const clientIp = getClientIp(req);
    const rl = checkRateLimit(`portal_token:${clientIp}`, 60, 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Muitas solicita\xE7\xF5es. Aguarde alguns instantes e tente novamente." });
    }
    const token = typeof req.params?.token === "string" ? req.params.token.trim() : "";
    if (!token || token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return res.status(404).json({ error: "Link inv\xE1lido" });
    }
    try {
      const { data: tokenData, error: tokenError } = await supabaseAdmin.from("resident_access_tokens").select("id, resident_id, condominium_id, token, expires_at, active").eq("token", token).eq("active", true).maybeSingle();
      if (tokenError || !tokenData) {
        return res.status(404).json({ error: "Link inv\xE1lido" });
      }
      const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at) : null;
      if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt < /* @__PURE__ */ new Date()) {
        return res.status(403).json({ error: "Link expirado ou inv\xE1lido" });
      }
      const { data: resident, error: resError } = await supabaseAdmin.from("moradores").select("id, nome, unidade, unit_type, block, bloco, condominium_id, ativo").eq("id", tokenData.resident_id).maybeSingle();
      if (resError || !resident) {
        return res.status(404).json({ error: "Morador n\xE3o encontrado ou inativo" });
      }
      const { data: condo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", tokenData.condominium_id).maybeSingle();
      if (condoErr || !condo || condo.active === false) {
        return res.status(403).json({ error: "Condom\xEDnio indispon\xEDvel ou inativo" });
      }
      const packages = await fetchResidentPackagesForPortal(resident, condo.id);
      const hasPendingPackages = (packages || []).some((p) => p.status !== "delivered");
      if (resident.ativo === false && !hasPendingPackages) {
        return res.status(404).json({ error: "Morador n\xE3o encontrado ou inativo" });
      }
      await supabaseAdmin.from("resident_access_tokens").update({ last_accessed_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", tokenData.id);
      res.json({
        resident: serializePortalResident(resident),
        condominium: serializePortalCondo(condo),
        packages: (packages || []).map((p) => serializePortalPackage(p))
      });
    } catch (err) {
      console.error("Portal validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });
  app2.get("/api/portal/validate-code/:code", async (req, res) => {
    const clientIp = getClientIp(req);
    const rl = checkRateLimit(`portal_code:${clientIp}`, 40, 5 * 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Muitas tentativas de valida\xE7\xE3o. Aguarde alguns minutos." });
    }
    try {
      const code = typeof req.params?.code === "string" ? req.params.code.trim() : "";
      if (!code || !/^[A-Za-z0-9]{4,12}$/.test(code)) {
        return res.status(400).json({ error: "C\xF3digo de retirada inv\xE1lido" });
      }
      const { data: pkg, error: pkgError } = await supabaseAdmin.from("packages").select("*").eq("pickup_code", code).neq("status", "delivered").order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (pkgError || !pkg || !pkg.recipient_id || !pkg.condominium_id) {
        return res.status(404).json({ error: "C\xF3digo de retirada inv\xE1lido ou encomenda j\xE1 retirada" });
      }
      const [{ data: resident }, { data: condo }] = await Promise.all([
        supabaseAdmin.from("moradores").select("id, nome, unidade, unit_type, block, bloco, condominium_id, ativo").eq("id", pkg.recipient_id).maybeSingle(),
        supabaseAdmin.from("condominiums").select("id, name, active").eq("id", pkg.condominium_id).maybeSingle()
      ]);
      if (!resident || !condo || condo.active === false) {
        return res.status(404).json({ error: "Dados do morador ou condom\xEDnio n\xE3o encontrados ou inativos" });
      }
      const allPackages = await fetchResidentPackagesForPortal(resident, condo.id);
      const hasPendingPackages = (allPackages || []).some((p) => p.status !== "delivered");
      if (resident.ativo === false && !hasPendingPackages) {
        return res.status(404).json({ error: "Dados do morador ou condom\xEDnio n\xE3o encontrados ou inativos" });
      }
      res.json({
        resident: serializePortalResident(resident),
        condominium: serializePortalCondo(condo),
        packages: (allPackages || []).map((p) => serializePortalPackage(p))
      });
    } catch (err) {
      console.error("Code validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });
  app2.get("/api/portal/package/:token", async (req, res) => {
    const clientIp = getClientIp(req);
    const rl = checkRateLimit(`portal_pkg:${clientIp}`, 60, 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Muitas solicita\xE7\xF5es. Aguarde alguns instantes e tente novamente." });
    }
    try {
      const token = typeof req.params?.token === "string" ? req.params.token.trim() : "";
      if (!token) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
      }
      if (/^[A-Za-z0-9]{4,8}$/.test(token)) {
        const legacyRl = checkRateLimit(`portal_legacy:${clientIp}`, 20, 5 * 6e4);
        if (!legacyRl.allowed) {
          res.setHeader("Retry-After", String(legacyRl.retryAfterSec));
          return res.status(429).json({ error: "Muitas solicita\xE7\xF5es. Aguarde alguns instantes e tente novamente." });
        }
        const { data: legacyPkg } = await supabaseAdmin.from("packages").select("id, condominium_id, status").eq("pickup_code", token).neq("status", "delivered").order("received_at", { ascending: false }).limit(1).maybeSingle();
        if (!legacyPkg) {
          return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
        }
        const { data: legacyCondo } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", legacyPkg.condominium_id).maybeSingle();
        if (!legacyCondo || legacyCondo.active === false) {
          return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
        }
        return res.json({
          valid: false,
          requiresVerification: true,
          legacyCode: true,
          condominium: serializePortalCondo(legacyCondo)
        });
      }
      if (token.length < 10 || !/^[A-Za-z0-9_-]+$/.test(token)) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
      }
      const { data: tokenMatchedPkgs, error: pkgError } = await supabaseAdmin.from("packages").select("*").eq("pickup_token", token).order("received_at", { ascending: false });
      if (pkgError || !tokenMatchedPkgs || tokenMatchedPkgs.length === 0) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada ou link inv\xE1lido" });
      }
      const pkg = tokenMatchedPkgs[0];
      const [residentRes, condoRes] = await Promise.all([
        pkg.recipient_id ? supabaseAdmin.from("moradores").select("id, nome, unidade, unit_type, block, bloco, condominium_id, ativo").eq("id", pkg.recipient_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        supabaseAdmin.from("condominiums").select("id, name, active").eq("id", pkg.condominium_id).maybeSingle()
      ]);
      const resident = residentRes.data;
      const condo = condoRes.data;
      if (!condo || condo.active === false) {
        return res.status(404).json({ error: "Dados do condom\xEDnio n\xE3o encontrados ou inativos" });
      }
      let allPackages = tokenMatchedPkgs;
      if (pkg.recipient_id && pkg.status !== "delivered") {
        const { data: grouped } = await supabaseAdmin.from("packages").select("*").eq("recipient_id", pkg.recipient_id).eq("condominium_id", pkg.condominium_id).neq("status", "delivered").order("received_at", { ascending: false });
        if (grouped && grouped.length > 0) {
          allPackages = grouped;
        }
      }
      const hasPendingPackages = allPackages.some((p) => p.status !== "delivered");
      if (pkg.recipient_id && (!resident || resident.ativo === false && !hasPendingPackages)) {
        return res.status(404).json({ error: "Dados do morador n\xE3o encontrados ou inativos" });
      }
      const safeResident = resident ? serializePortalResident(resident) : {
        id: null,
        nome: pkg.recipient_name_raw || "Morador",
        unidade: pkg.unit_number || pkg.unit_number_raw || "",
        unit_type: pkg.unit_type ?? null,
        block: pkg.block ?? null,
        bloco: pkg.block ?? null
      };
      const safeCondo = serializePortalCondo(condo);
      res.json({
        valid: true,
        package: serializePortalPackage(pkg, resident || safeResident, condo),
        allPackages: allPackages.map((p) => serializePortalPackage(p, resident || safeResident, condo)),
        resident: safeResident,
        condominium: safeCondo
      });
    } catch (err) {
      console.error("Package token validation error:", err);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });
  app2.post("/api/portal/verify-legacy-code", async (req, res) => {
    const clientIp = getClientIp(req);
    const rl = checkRateLimit(`portal_legacy_verify:${clientIp}`, 15, 5 * 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Muitas tentativas de verifica\xE7\xE3o. Aguarde alguns minutos." });
    }
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      const verifier = typeof req.body?.verifier === "string" ? req.body.verifier.trim() : "";
      if (!code || !/^[A-Za-z0-9]{4,8}$/.test(code) || !verifier) {
        return res.status(400).json({ error: "Informe o c\xF3digo e a confirma\xE7\xE3o de unidade ou telefone." });
      }
      const { data: matchedPkgs } = await supabaseAdmin.from("packages").select("*").eq("pickup_code", code).neq("status", "delivered").order("received_at", { ascending: false });
      if (!matchedPkgs || matchedPkgs.length === 0) {
        return res.status(404).json({ error: "C\xF3digo de retirada inv\xE1lido ou encomenda j\xE1 retirada." });
      }
      const normalizeUnitComp = (val) => String(val || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(apartamento|apto|ap|casa|cs|lote|lt|bloco|bl|torre|tr|quadra|qd|unidade)\b/g, "").replace(/[^a-z0-9]/g, "");
      const verifierUnit = normalizeUnitComp(verifier);
      const verifierDigits = verifier.replace(/\D/g, "");
      for (const pkg of matchedPkgs) {
        const [{ data: condo }, residentRes] = await Promise.all([
          supabaseAdmin.from("condominiums").select("id, name, active").eq("id", pkg.condominium_id).maybeSingle(),
          pkg.recipient_id ? supabaseAdmin.from("moradores").select("id, nome, unidade, unit_type, block, bloco, telefone, condominium_id, ativo").eq("id", pkg.recipient_id).maybeSingle() : Promise.resolve({ data: null })
        ]);
        if (!condo || condo.active === false) continue;
        const resident = residentRes.data;
        const unitCandidates = [
          pkg.unit_number,
          pkg.unit_number_raw,
          resident?.unidade
        ].filter(Boolean).map((u) => normalizeUnitComp(String(u)));
        const unitMatch = Boolean(
          verifierUnit && unitCandidates.some((u) => u && (u === verifierUnit || verifierUnit.length >= 2 && u.endsWith(verifierUnit)))
        );
        const phoneDigits = String(resident?.telefone || "").replace(/\D/g, "");
        const phoneMatch = Boolean(
          verifierDigits.length >= 4 && phoneDigits.length >= 4 && (phoneDigits.endsWith(verifierDigits) || phoneDigits === verifierDigits)
        );
        if (unitMatch || phoneMatch) {
          let allPackages = [pkg];
          if (pkg.recipient_id) {
            const { data: grouped } = await supabaseAdmin.from("packages").select("*").eq("recipient_id", pkg.recipient_id).eq("condominium_id", pkg.condominium_id).neq("status", "delivered").order("received_at", { ascending: false });
            if (grouped && grouped.length > 0) allPackages = grouped;
          }
          const safeResident = resident ? serializePortalResident(resident) : {
            id: null,
            nome: pkg.recipient_name_raw || "Morador",
            unidade: pkg.unit_number || pkg.unit_number_raw || "",
            unit_type: pkg.unit_type ?? null,
            block: pkg.block ?? null,
            bloco: pkg.block ?? null
          };
          const safeCondo = serializePortalCondo(condo);
          return res.json({
            valid: true,
            package: serializePortalPackage(pkg, resident || safeResident, condo),
            allPackages: allPackages.map((p) => serializePortalPackage(p, resident || safeResident, condo)),
            resident: safeResident,
            condominium: safeCondo
          });
        }
      }
      return res.status(403).json({ error: "Unidade ou telefone n\xE3o confere com o destinat\xE1rio desta encomenda." });
    } catch (err) {
      console.error("Legacy code verification error:", err);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  });
  app2.get("/api/portal/my-packages", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "N\xE3o autorizado" });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return res.status(401).json({ error: "N\xE3o autorizado" });
    try {
      const { data: authRes, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !authRes?.user) {
        return res.status(401).json({ error: "Sess\xE3o inv\xE1lida" });
      }
      const { data: profile } = await supabaseAdmin.from("profiles").select("id, role, condominium_id, unidade, unit, active").eq("id", authRes.user.id).maybeSingle();
      if (!profile || profile.active === false || !profile.condominium_id) {
        return res.status(403).json({ error: "Perfil inativo ou sem condom\xEDnio vinculado." });
      }
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      let query = supabaseAdmin.from("packages").select("*", { count: "exact" }).eq("condominium_id", profile.condominium_id);
      const userUnit = profile.unit || profile.unidade;
      if (userUnit) {
        query = query.or(`recipient_id.eq.${profile.id},unit_number.eq.${userUnit}`);
      } else {
        query = query.eq("recipient_id", profile.id);
      }
      const { data, count, error } = await query.order("received_at", { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return res.json({ packages: data || [], totalCount: count ?? (data || []).length });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao consultar encomendas" });
    }
  });
  app2.post("/api/condominiums/create", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const user = session.adminUser;
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
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "O nome do condom\xEDnio \xE9 obrigat\xF3rio." });
    }
    const allUsersToCreate = [...users, ...initialUsers];
    try {
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
      const coreInsertData = {
        name: name.trim(),
        address: address || "",
        active: active !== void 0 ? active : true
      };
      const fullInsertData = { ...coreInsertData };
      if (city_state) fullInsertData.city_state = city_state;
      if (manager_name) fullInsertData.manager_name = manager_name;
      if (manager_phone) fullInsertData.manager_phone = manager_phone;
      if (manager_email) fullInsertData.manager_email = manager_email;
      if (rules) fullInsertData.rules = rules;
      if (internal_notes) fullInsertData.internal_notes = internal_notes;
      let resInsert = await supabaseAdmin.from("condominiums").insert([fullInsertData]).select().single();
      if (resInsert.error && isMissingColumnSchemaError(resInsert.error)) {
        console.warn("[POST /api/condominiums/create] Colunas estendidas ausentes no banco, aplicando fallback m\xEDnimo.");
        resInsert = await supabaseAdmin.from("condominiums").insert([coreInsertData]).select().single();
      }
      if (resInsert.error || !resInsert.data) {
        throw resInsert.error || new Error("Erro ao criar condom\xEDnio no banco de dados.");
      }
      const condo = resInsert.data;
      const createdUsersList = [];
      const failedUsersList = [];
      if (allUsersToCreate && allUsersToCreate.length > 0) {
        for (const u of allUsersToCreate) {
          if (!u || !u.full_name) continue;
          const uEmail = u.email && u.email.trim() !== "" ? u.email.trim() : `${(u.role || "usuario").toLowerCase()}.${generateSecureHexToken(4)}@${(name || "condo").toLowerCase().replace(/[^a-z0-9]/g, "") || "condo"}.com`;
          const uPassword = u.password && u.password.trim() !== "" ? u.password.trim() : generateSecureTempPasswordServer(12);
          try {
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: uEmail,
              password: uPassword,
              email_confirm: true,
              user_metadata: { full_name: u.full_name, role: u.role || "sindico" }
            });
            if (authError || !authData?.user) {
              failedUsersList.push({ full_name: u.full_name, email: uEmail, error: authError?.message || "Auth creation failed" });
              continue;
            }
            const { error: profileError } = await supabaseAdmin.from("profiles").insert([{
              id: authData.user.id,
              full_name: u.full_name,
              phone: u.phone || u.contato || "",
              role: u.role || "sindico",
              condominium_id: condo.id,
              active: u.active !== false,
              must_change_password: true,
              horario_inicio: u.horario_inicio || null,
              horario_fim: u.horario_fim || null,
              escala_tipo: u.escala_tipo || null,
              created_by: user.id
            }]).select().single();
            if (profileError) {
              await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
              failedUsersList.push({ full_name: u.full_name, email: uEmail, error: profileError.message });
            } else {
              createdUsersList.push({
                id: authData.user.id,
                full_name: u.full_name,
                email: uEmail,
                role: u.role,
                tempPassword: uPassword
              });
            }
          } catch (uErr) {
            failedUsersList.push({ full_name: u.full_name, email: uEmail, error: uErr?.message || "Erro inesperado" });
          }
        }
      }
      if (manager_email && manager_name && !createdUsersList.some((cu) => cu.email === manager_email)) {
        try {
          const tempPassword = generateSecureTempPasswordServer(12);
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: manager_email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: manager_name, role: "sindico" }
          });
          if (!authError && authData?.user) {
            const { error: mgrProfileErr } = await supabaseAdmin.from("profiles").insert([{
              id: authData.user.id,
              full_name: manager_name,
              phone: manager_phone || "",
              role: "sindico",
              condominium_id: condo.id,
              active: true,
              must_change_password: true,
              created_by: user.id
            }]);
            if (mgrProfileErr) {
              await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
              failedUsersList.push({ full_name: manager_name, email: manager_email, error: mgrProfileErr.message });
            } else {
              createdUsersList.push({
                id: authData.user.id,
                full_name: manager_name,
                email: manager_email,
                role: "sindico",
                tempPassword
              });
            }
          } else {
            failedUsersList.push({ full_name: manager_name, email: manager_email, error: authError?.message || "Auth creation failed" });
          }
        } catch (e) {
          failedUsersList.push({ full_name: manager_name, email: manager_email, error: e?.message || "Erro inesperado" });
        }
      }
      for (const porter of porters) {
        if (porter?.name) {
          try {
            const porterEmail = porter.email || `porteiro.${generateSecureHexToken(4)}@${(name || "condo").toLowerCase().replace(/\s+/g, "")}.com`;
            const tempPassword = generateSecureTempPasswordServer(12);
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
              email: porterEmail,
              password: tempPassword,
              email_confirm: true,
              user_metadata: { full_name: porter.name, role: "porteiro" }
            });
            if (!authError && authData?.user) {
              const { error: porterProfErr } = await supabaseAdmin.from("profiles").insert([{
                id: authData.user.id,
                full_name: porter.name,
                phone: porter.phone || "",
                role: "porteiro",
                condominium_id: condo.id,
                active: true,
                must_change_password: true,
                created_by: user.id
              }]);
              if (porterProfErr) {
                await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
                failedUsersList.push({ full_name: porter.name, email: porterEmail, error: porterProfErr.message });
              } else {
                createdUsersList.push({
                  id: authData.user.id,
                  full_name: porter.name,
                  email: porterEmail,
                  role: "porteiro",
                  tempPassword
                });
              }
            } else {
              failedUsersList.push({ full_name: porter.name, email: porterEmail, error: authError?.message || "Auth creation failed" });
            }
          } catch (e) {
            failedUsersList.push({ full_name: porter.name, error: e?.message || "Erro inesperado" });
          }
        }
      }
      let updatedCreatorProfile = null;
      if (session.adminProfile && !session.adminProfile.condominium_id) {
        const { data: boundProfile, error: bindErr } = await supabaseAdmin.from("profiles").update({ condominium_id: condo.id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", user.id).select("*").maybeSingle();
        if (!bindErr && boundProfile) {
          updatedCreatorProfile = boundProfile;
        }
      }
      await recordAuditEvent({
        condominio_id: condo.id,
        usuario_id: session.adminProfile?.id || user.id,
        usuario_nome: session.adminProfile?.full_name || "Admin",
        usuario_perfil: session.adminProfile?.role || "admin",
        tipo_evento: "CONDOMINIO_CRIADO",
        acao: "CREATE",
        tabela_afetada: "condominiums",
        registro_id: condo.id,
        descricao: `Condom\xEDnio ${condo.name} cadastrado com ${createdUsersList.length} acesso(s) inicial(is).`,
        metodo: "ADMIN_ACTION"
      });
      res.json({
        condo,
        ...updatedCreatorProfile ? { profile: updatedCreatorProfile } : {},
        createdUsersCount: createdUsersList.length,
        createdUsers: createdUsersList,
        ...failedUsersList.length > 0 ? { failedUsers: failedUsersList } : {}
      });
    } catch (err) {
      console.error("Erro ao criar condom\xEDnio:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/profiles/select-condominium", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "N\xE3o autorizado" });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return res.status(401).json({ error: "N\xE3o autorizado" });
    if (token === "MOCK_TOKEN" && (isProduction || process.env.ALLOW_TEST_MOCK_AUTH !== "true")) {
      return res.status(401).json({ error: "Token de simula\xE7\xE3o n\xE3o autorizado." });
    }
    const { condominiumId } = req.body || {};
    const validCondoId = toNullableUuid(condominiumId);
    if (!validCondoId) {
      return res.status(400).json({ error: "ID de condom\xEDnio inv\xE1lido." });
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return res.status(401).json({ error: "Sess\xE3o inv\xE1lida" });
      const { data: currentProfile, error: profFetchErr } = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (profFetchErr) {
        return res.status(500).json({ error: "Erro ao verificar perfil do usu\xE1rio." });
      }
      if (!currentProfile || currentProfile.active === false) {
        return res.status(403).json({ error: "Perfil inativo ou n\xE3o encontrado." });
      }
      const rawRole = normalizeRoleValue(currentProfile.role);
      const isGlobalAdmin = ["admin", "administrador", "super_admin", "master"].includes(rawRole);
      if (!isGlobalAdmin && currentProfile.condominium_id !== validCondoId) {
        await recordAuditEvent({
          condominio_id: validCondoId,
          usuario_id: currentProfile.id,
          usuario_nome: currentProfile.full_name || user.email || "Usu\xE1rio",
          usuario_perfil: currentProfile.role || "",
          tipo_evento: "CONDOMINIO_SELECAO_RECUSADA",
          acao: "FORBIDDEN",
          tabela_afetada: "profiles",
          registro_id: currentProfile.id,
          descricao: `Usu\xE1rio sem privil\xE9gio global tentou vincular seu perfil ao condom\xEDnio ${validCondoId}.`,
          metodo: "USER_ACTION"
        });
        return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o possui permiss\xE3o para alternar para este condom\xEDnio." });
      }
      const { data: targetCondo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", validCondoId).maybeSingle();
      if (condoErr) {
        return res.status(500).json({ error: "Erro ao consultar condom\xEDnio." });
      }
      if (!targetCondo) {
        return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
      }
      if (targetCondo.active === false) {
        return res.status(403).json({ error: "Este condom\xEDnio encontra-se inativo." });
      }
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update({ condominium_id: validCondoId, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", user.id).select().single();
      if (profileError || !profile) {
        throw profileError || new Error("Erro ao atualizar condom\xEDnio selecionado.");
      }
      res.json({ profile });
    } catch (err) {
      console.error("Erro ao selecionar condom\xEDnio:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/auth/create-profile", async (req, res) => {
    return res.status(403).json({ error: "Cadastro p\xFAblico desativado. Somente o administrador pode criar contas de acesso." });
  });
  const validateOperationalSession = async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { error: "N\xE3o autorizado", status: 401 };
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return { error: "N\xE3o autorizado", status: 401 };
    }
    const isMockToken = token === "MOCK_TOKEN";
    if (isMockToken) {
      const allowMockTest = !isProduction && process.env.ALLOW_TEST_MOCK_AUTH === "true";
      if (!allowMockTest) {
        return { error: "Token de simula\xE7\xE3o n\xE3o autorizado.", status: 401 };
      }
    }
    try {
      const { data: authRes, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && authRes?.user) {
        const user = authRes.user;
        const { data: profile, error: profileErr } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active").eq("id", user.id).maybeSingle();
        if (profileErr) {
          return { error: "Erro ao validar perfil operacional.", status: 500 };
        }
        if (!profile || profile.active === false) {
          return { error: "Perfil operacional inativo ou n\xE3o encontrado.", status: 403 };
        }
        const rawRole = normalizeRoleValue(profile.role);
        const isGlobalAdmin = ["admin", "administrador", "super_admin", "master"].includes(rawRole);
        const isSindico = ["sindico", "manager"].includes(rawRole);
        const isPorteiro = ["porteiro", "concierge"].includes(rawRole);
        if (!isGlobalAdmin && !isSindico && !isPorteiro) {
          return { error: "Acesso negado para este perfil de usu\xE1rio.", status: 403 };
        }
        if (!isGlobalAdmin) {
          if (!profile.condominium_id) {
            return { error: "Usu\xE1rio sem condom\xEDnio vinculado.", status: 403 };
          }
          const { data: condo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", profile.condominium_id).maybeSingle();
          if (condoErr) {
            return { error: "Erro ao verificar status do condom\xEDnio.", status: 500 };
          }
          if (!condo || condo.active === false) {
            return { error: "Condom\xEDnio inativo ou n\xE3o encontrado.", status: 403 };
          }
        }
        return {
          authType: "user",
          user,
          profile,
          condominiumId: profile.condominium_id || null,
          portariaName: profile.full_name || "Operador",
          isGlobalAdmin,
          isSindico
        };
      }
      if (!isMockToken) {
        const { data: dbSetting, error: settingErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, active_portaria_token").eq("active_portaria_token", token).maybeSingle();
        if (settingErr) {
          return { error: "Erro ao validar sess\xE3o da portaria.", status: 500 };
        }
        if (dbSetting && dbSetting.active_portaria_token === token) {
          const { data: condo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", dbSetting.condominium_id).maybeSingle();
          if (condoErr) {
            return { error: "Erro ao verificar condom\xEDnio da portaria.", status: 500 };
          }
          if (!condo || condo.active === false) {
            return { error: "Condom\xEDnio inativo ou sess\xE3o da portaria desativada.", status: 401, code: "PORTARIA_DEACTIVATED" };
          }
          return {
            authType: "portaria",
            user: null,
            profile: null,
            condominiumId: condo.id,
            portariaName: dbSetting.portaria_name || condo.name,
            isGlobalAdmin: false,
            isSindico: false
          };
        }
      }
      return { error: "Sess\xE3o inv\xE1lida ou expirada.", status: 401 };
    } catch (err) {
      console.error("[validateOperationalSession Error]:", err?.message || err);
      return { error: err?.message || "Erro na valida\xE7\xE3o da sess\xE3o operacional.", status: 500 };
    }
  };
  const isMissingNotifiedAtError = (err) => {
    if (!err) return false;
    const code = String(err.code || "").toUpperCase();
    const message = String(err.message || err.details || err.hint || "").toLowerCase();
    if (!message.includes("notified_at")) return false;
    return code === "42703" || code === "PGRST204" || message.includes("does not exist") || message.includes("could not find") || message.includes("schema cache") || message.includes("column");
  };
  app2.post("/api/packages/create", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const { packages, recipientId, condominiumId, condominium_id, syncExisting = true } = req.body || {};
      if (!packages || !Array.isArray(packages) || packages.length === 0) {
        return res.status(400).json({ error: "Lista de encomendas inv\xE1lida ou vazia." });
      }
      if (packages.length > 1 && (opSession.authType !== "user" || !opSession.isGlobalAdmin)) {
        return res.status(403).json({
          error: "Acesso negado: o recurso ADICIONAR V\xC1RIAS \xE9 exclusivo para administradores. Para m\xFAltiplos volumes em uma encomenda, utilize QUANTIDADE DE ENCOMENDAS."
        });
      }
      for (const pkg of packages) {
        if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
          return res.status(400).json({ error: "Item de encomenda inv\xE1lido no lote." });
        }
      }
      const parseOptionalCondoField = (val, fieldLabel) => {
        if (val === void 0 || val === null) return { value: null };
        if (typeof val !== "string") return { error: `${fieldLabel} inv\xE1lido.` };
        const trimmed = val.trim();
        return { value: trimmed ? trimmed : null };
      };
      const parsedTopCamel = parseOptionalCondoField(condominiumId, "condominiumId");
      if ("error" in parsedTopCamel) return res.status(400).json({ error: parsedTopCamel.error });
      const parsedTopSnake = parseOptionalCondoField(condominium_id, "condominium_id");
      if ("error" in parsedTopSnake) return res.status(400).json({ error: parsedTopSnake.error });
      const providedCondoIds = [];
      if (parsedTopCamel.value) providedCondoIds.push(parsedTopCamel.value);
      if (parsedTopSnake.value) providedCondoIds.push(parsedTopSnake.value);
      for (const pkg of packages) {
        const parsedItemSnake = parseOptionalCondoField(pkg.condominium_id, "packages[].condominium_id");
        if ("error" in parsedItemSnake) return res.status(400).json({ error: parsedItemSnake.error });
        if (parsedItemSnake.value) providedCondoIds.push(parsedItemSnake.value);
        const parsedItemCamel = parseOptionalCondoField(pkg.condominiumId, "packages[].condominiumId");
        if ("error" in parsedItemCamel) return res.status(400).json({ error: parsedItemCamel.error });
        if (parsedItemCamel.value) providedCondoIds.push(parsedItemCamel.value);
      }
      let authorizedCondoId = null;
      if (!opSession.isGlobalAdmin) {
        if (!opSession.condominiumId) {
          return res.status(403).json({ error: "Sess\xE3o sem condom\xEDnio vinculado." });
        }
        authorizedCondoId = opSession.condominiumId;
        for (const candidateCondoId of providedCondoIds) {
          if (candidateCondoId !== authorizedCondoId) {
            return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o tem permiss\xE3o para registrar encomendas em outro condom\xEDnio." });
          }
        }
      } else {
        const distinctProvidedCondos = Array.from(new Set(providedCondoIds));
        if (distinctProvidedCondos.length > 1) {
          return res.status(403).json({ error: "Conflito entre identificadores de condom\xEDnio informados na requisi\xE7\xE3o." });
        }
        authorizedCondoId = distinctProvidedCondos[0] || opSession.condominiumId;
      }
      if (!authorizedCondoId || typeof authorizedCondoId !== "string") {
        return res.status(400).json({ error: "condominiumId \xE9 obrigat\xF3rio." });
      }
      const { data: targetCondo, error: condoErr } = await supabaseAdmin.from("condominiums").select("id, active").eq("id", authorizedCondoId).maybeSingle();
      if (condoErr) {
        return res.status(500).json({ error: "Erro ao verificar condom\xEDnio no banco de dados." });
      }
      if (!targetCondo || targetCondo.active === false) {
        return res.status(403).json({ error: "Condom\xEDnio n\xE3o encontrado ou inativo." });
      }
      if (recipientId !== void 0 && recipientId !== null && typeof recipientId !== "string") {
        return res.status(400).json({ error: "recipientId inv\xE1lido." });
      }
      const collectedRecipientIds = [];
      if (typeof recipientId === "string" && recipientId.trim()) {
        collectedRecipientIds.push(recipientId.trim());
      }
      for (const pkg of packages) {
        if (pkg.recipient_id !== void 0 && pkg.recipient_id !== null) {
          if (typeof pkg.recipient_id !== "string") {
            return res.status(400).json({ error: "recipient_id inv\xE1lido em um dos itens do lote." });
          }
          const cleanItemRecipient = pkg.recipient_id.trim();
          if (cleanItemRecipient) {
            collectedRecipientIds.push(cleanItemRecipient);
          }
        }
      }
      const distinctRecipientIds = Array.from(new Set(collectedRecipientIds));
      if (distinctRecipientIds.length > 0) {
        const { data: residentRows, error: resErr } = await supabaseAdmin.from("moradores").select("id, condominium_id, ativo").in("id", distinctRecipientIds);
        if (resErr) {
          return res.status(500).json({ error: "Erro ao validar destinat\xE1rios." });
        }
        const residentMap = new Map((residentRows || []).map((r) => [r.id, r]));
        for (const rId of distinctRecipientIds) {
          const residentRow = residentMap.get(rId);
          if (!residentRow) {
            return res.status(404).json({ error: "Morador destinat\xE1rio n\xE3o encontrado." });
          }
          if (residentRow.condominium_id !== authorizedCondoId) {
            return res.status(403).json({ error: "Acesso negado: destinat\xE1rio pertence a outro condom\xEDnio." });
          }
        }
        if (distinctRecipientIds.length > 1) {
          return res.status(400).json({ error: "Todos os itens do lote devem pertencer ao mesmo destinat\xE1rio." });
        }
      }
      const MAX_PACKAGE_PHOTO_BYTES = 5242880;
      const prevalidatedPhotoUploads = [];
      for (const pkg of packages) {
        const rawPhoto = pkg.photo_url;
        if (rawPhoto === void 0 || rawPhoto === null) {
          prevalidatedPhotoUploads.push(null);
          continue;
        }
        if (typeof rawPhoto !== "string") {
          return res.status(400).json({ error: "Formato de imagem inv\xE1lido." });
        }
        const trimmedPhoto = rawPhoto.trim();
        if (!trimmedPhoto) {
          prevalidatedPhotoUploads.push(null);
          continue;
        }
        if (trimmedPhoto.toLowerCase().startsWith("data:")) {
          const matches = trimmedPhoto.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/i);
          if (!matches) {
            return res.status(400).json({ error: "Formato de imagem inv\xE1lido." });
          }
          const mimeSubtype = matches[1].toLowerCase();
          if (mimeSubtype !== "jpeg" && mimeSubtype !== "png") {
            return res.status(400).json({ error: "Formato de imagem n\xE3o suportado. Utilize JPEG ou PNG." });
          }
          const cleanBase64 = matches[2].replace(/\s+/g, "");
          if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64) || cleanBase64.length % 4 !== 0) {
            return res.status(400).json({ error: "Conte\xFAdo base64 da imagem inv\xE1lido." });
          }
          const buffer = Buffer.from(cleanBase64, "base64");
          if (buffer.length === 0) {
            return res.status(400).json({ error: "Imagem vazia ou inv\xE1lida." });
          }
          if (buffer.length > MAX_PACKAGE_PHOTO_BYTES) {
            return res.status(400).json({ error: "Uma das fotos excede o limite m\xE1ximo permitido de 5MB." });
          }
          prevalidatedPhotoUploads.push({
            buffer,
            contentType: `image/${mimeSubtype}`,
            ext: mimeSubtype === "jpeg" ? "jpg" : "png"
          });
        } else {
          let parsedUrl = null;
          try {
            parsedUrl = new URL(trimmedPhoto);
          } catch {
            parsedUrl = null;
          }
          if (!parsedUrl || parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return res.status(400).json({ error: "Formato de imagem inv\xE1lido." });
          }
          prevalidatedPhotoUploads.push(null);
        }
      }
      const targetRecipientId = distinctRecipientIds[0] || null;
      let authoritativeExistingCode = null;
      let authoritativeExistingToken = null;
      let existingPendingRows = [];
      if (targetRecipientId) {
        const { data: existingPending } = await supabaseAdmin.from("packages").select("id, pickup_code, pickup_token, notes").eq("recipient_id", targetRecipientId).eq("condominium_id", authorizedCondoId).neq("status", "delivered").is("delivered_at", null).order("received_at", { ascending: false });
        if (Array.isArray(existingPending) && existingPending.length > 0) {
          existingPendingRows = existingPending;
          authoritativeExistingCode = existingPending.find((p) => p.pickup_code)?.pickup_code || null;
          authoritativeExistingToken = existingPending.find((p) => p.pickup_token)?.pickup_token || null;
        }
      }
      const fallbackNewToken = packages[0]?.pickup_token || generateSecureHexToken(16);
      const fallbackNewCode = packages[0]?.pickup_code || String(Math.floor(1e5 + Math.random() * 9e5));
      const sharedPickupCode = authoritativeExistingCode || fallbackNewCode;
      const sharedPickupToken = authoritativeExistingToken || fallbackNewToken;
      const processedPackages = [];
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        const item = {
          ...pkg,
          condominium_id: authorizedCondoId,
          recipient_id: targetRecipientId,
          pickup_code: sharedPickupCode || pkg.pickup_code,
          pickup_token: sharedPickupToken || pkg.pickup_token || generateSecureHexToken(16)
        };
        if ("condominiumId" in item) {
          delete item.condominiumId;
        }
        const prevalidatedUpload = prevalidatedPhotoUploads[i];
        if (prevalidatedUpload) {
          const fileName = `package-photos/${Date.now()}_${generateSecureHexToken(8)}.${prevalidatedUpload.ext}`;
          const uploadPromise = supabaseAdmin.storage.from("packages").upload(fileName, prevalidatedUpload.buffer, { contentType: prevalidatedUpload.contentType });
          const timeoutPromise = new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Storage upload timeout on server")), 5e3)
          );
          try {
            const { error: uploadErr } = await Promise.race([uploadPromise, timeoutPromise]);
            if (uploadErr) {
              console.error("[API /api/packages/create] Erro no upload da foto:", uploadErr);
              return res.status(500).json({ error: `Falha ao enviar foto da encomenda: ${uploadErr.message || "erro no Storage"}` });
            }
            const { data: { publicUrl } } = supabaseAdmin.storage.from("packages").getPublicUrl(fileName);
            item.photo_url = publicUrl;
          } catch (uploadErr) {
            console.error("[API /api/packages/create] Exce\xE7\xE3o no upload da imagem:", uploadErr);
            return res.status(500).json({ error: `Falha no upload da foto: ${uploadErr?.message || "timeout"}` });
          }
        }
        processedPackages.push(item);
      }
      const targetPickupCode = processedPackages[0]?.pickup_code;
      const targetPickupToken = processedPackages[0]?.pickup_token;
      if (syncExisting && targetRecipientId && targetPickupCode) {
        const { error: syncErr } = await supabaseAdmin.from("packages").update({
          pickup_code: targetPickupCode,
          pickup_token: targetPickupToken
        }).eq("recipient_id", targetRecipientId).eq("condominium_id", authorizedCondoId).neq("status", "delivered").is("delivered_at", null);
        if (syncErr) {
          console.error("[API /api/packages/create] Erro ao sincronizar c\xF3digos existentes:", syncErr);
          return res.status(500).json({ error: `Erro ao sincronizar c\xF3digo das encomendas pendentes: ${syncErr.message}` });
        }
      }
      let itemsToInsert = processedPackages;
      let { data: insertedData, error: insertError } = await supabaseAdmin.from("packages").insert(itemsToInsert).select("*");
      if (insertError && (insertError.code === "23503" || insertError.message?.includes("foreign key constraint"))) {
        console.warn("[API /api/packages/create] Chave estrangeira falhou, removendo chaves de perfil:", insertError.message);
        itemsToInsert = itemsToInsert.map((p) => {
          const cp = { ...p };
          delete cp.received_by;
          delete cp.registered_by;
          return cp;
        });
        const retryResult = await supabaseAdmin.from("packages").insert(itemsToInsert).select("*");
        insertedData = retryResult.data;
        insertError = retryResult.error;
      }
      if (insertError && isMissingNotifiedAtError(insertError)) {
        console.warn("[API /api/packages/create] Coluna notified_at ausente no schema, aplicando fallback compat\xEDvel:", insertError.message);
        itemsToInsert = itemsToInsert.map((p) => {
          const cp = { ...p };
          delete cp.notified_at;
          return cp;
        });
        const retryResult = await supabaseAdmin.from("packages").insert(itemsToInsert).select("*");
        insertedData = retryResult.data;
        insertError = retryResult.error;
      }
      if (insertError) {
        console.error("[API /api/packages/create] Erro no supabaseAdmin.insert:", insertError);
        return res.status(500).json({ error: insertError.message, details: insertError });
      }
      return res.json({
        success: true,
        packages: insertedData || processedPackages,
        existingPendingPackages: existingPendingRows
      });
    } catch (err) {
      console.error("[API /api/packages/create] Erro inesperado:", err);
      return res.status(500).json({ error: err.message || "Erro interno ao salvar encomenda." });
    }
  });
  const resolveTargetCondoId = (opSession, requestedCondoId) => {
    const cleanRequested = typeof requestedCondoId === "string" && requestedCondoId.trim() ? requestedCondoId.trim() : null;
    if (opSession.isGlobalAdmin) {
      const resolved = cleanRequested || opSession.condominiumId;
      if (!resolved) {
        return { error: "condominiumId \xE9 obrigat\xF3rio.", status: 400 };
      }
      return { condominiumId: resolved };
    }
    if (!opSession.condominiumId) {
      return { error: "Sess\xE3o sem condom\xEDnio vinculado.", status: 403 };
    }
    if (cleanRequested && cleanRequested !== opSession.condominiumId) {
      return { error: "Acesso negado: voc\xEA n\xE3o possui permiss\xE3o para acessar dados de outro condom\xEDnio.", status: 403 };
    }
    return { condominiumId: opSession.condominiumId };
  };
  const enrichOperationalPackages = async (pkgs, condominiumId) => {
    if (!Array.isArray(pkgs) || pkgs.length === 0) return [];
    const recipientIds = Array.from(new Set(pkgs.map((p) => p.recipient_id).filter(Boolean)));
    const registrarIds = Array.from(new Set(pkgs.map((p) => p.received_by).filter(Boolean)));
    const [{ data: moradoresList }, { data: registrarList }] = await Promise.all([
      recipientIds.length > 0 ? supabaseAdmin.from("moradores").select("id, nome, unidade, unit_type, block, street").eq("condominium_id", condominiumId).in("id", recipientIds) : Promise.resolve({ data: [] }),
      registrarIds.length > 0 ? supabaseAdmin.from("profiles").select("id, full_name").in("id", registrarIds) : Promise.resolve({ data: [] })
    ]);
    const moradorMap = new Map((moradoresList || []).map((m) => [m.id, m]));
    const registrarMap = new Map((registrarList || []).map((u) => [u.id, u]));
    return pkgs.map((p) => ({
      ...p,
      package_id: p.package_id || p.id,
      unit_label: p.unit_label ?? p.unit_number,
      moradores: p.moradores || (p.recipient_id ? moradorMap.get(p.recipient_id) || null : null),
      registrar: p.registrar || (p.received_by ? registrarMap.get(p.received_by) || null : null)
    }));
  };
  const fetchAllMoradoresForCondo = async (condominiumId, options = {}) => {
    const { includeInactive = true, select = "*", orderCol = "id" } = options;
    const PAGE_SIZE = 1e3;
    const allRows = [];
    const seenIds = /* @__PURE__ */ new Set();
    let offset = 0;
    while (true) {
      let query = supabaseAdmin.from("moradores").select(select).eq("condominium_id", condominiumId);
      if (!includeInactive) {
        query = query.eq("ativo", true);
      }
      const { data, error } = await query.order(orderCol, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = Array.isArray(data) ? data : [];
      for (const row of batch) {
        if (row?.id) {
          if (seenIds.has(row.id)) continue;
          seenIds.add(row.id);
        }
        allRows.push(row);
      }
      if (batch.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }
    return allRows;
  };
  app2.get("/api/operational/context", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.query.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    const includeInactive = req.query.includeInactive === "true";
    try {
      const [condoRes, settingsRes, portersRes, allMoradores] = await Promise.all([
        supabaseAdmin.from("condominiums").select("*").eq("id", targetCondoId).maybeSingle(),
        supabaseAdmin.from("condominium_settings").select("*").eq("condominium_id", targetCondoId).maybeSingle(),
        supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active, horario_inicio, horario_fim, escala_tipo, phone").eq("condominium_id", targetCondoId).eq("role", "porteiro").eq("active", true).order("full_name"),
        fetchAllMoradoresForCondo(targetCondoId, { includeInactive, select: "*", orderCol: "id" })
      ]);
      allMoradores.sort(
        (a, b) => String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" })
      );
      let safeSettings = settingsRes.data || null;
      if (safeSettings && opSession.authType === "portaria") {
        const clone = { ...safeSettings };
        delete clone.portaria_access_code;
        delete clone.active_portaria_token;
        safeSettings = clone;
      }
      return res.json({
        condominium: condoRes.data || null,
        settings: safeSettings,
        porters: portersRes.data || [],
        moradores: allMoradores
      });
    } catch (err) {
      console.error("[GET /api/operational/context] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro ao carregar contexto operacional." });
    }
  });
  app2.get("/api/operational/dashboard", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.query.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    const rawTzOffset = req.query.tzOffset;
    const parsedTzOffset = typeof rawTzOffset === "string" && rawTzOffset.trim() !== "" ? parseInt(rawTzOffset, 10) : NaN;
    const tzOffsetMinutes = !Number.isNaN(parsedTzOffset) && Math.abs(parsedTzOffset) <= 840 ? parsedTzOffset : 180;
    const toLocalDateKey = (value) => {
      if (!value) return null;
      const ms = typeof value === "number" ? value : Date.parse(String(value));
      if (Number.isNaN(ms)) return null;
      const shifted = new Date(ms - tzOffsetMinutes * 6e4);
      const y = shifted.getUTCFullYear();
      const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
      const d = String(shifted.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };
    try {
      const fetchAllProfilesForCondo = async () => {
        const PAGE_SIZE2 = 1e3;
        const rows = [];
        let pOffset = 0;
        while (true) {
          const { data, error } = await supabaseAdmin.from("profiles").select("id, full_name").eq("condominium_id", targetCondoId).order("id", { ascending: true }).range(pOffset, pOffset + PAGE_SIZE2 - 1);
          if (error) throw error;
          const batch = Array.isArray(data) ? data : [];
          rows.push(...batch);
          if (batch.length < PAGE_SIZE2) break;
          pOffset += PAGE_SIZE2;
        }
        return rows;
      };
      const [condoRes, allMoradores, messageLogsRes, allProfiles, latestPkgRes] = await Promise.all([
        supabaseAdmin.from("condominiums").select("*").eq("id", targetCondoId).maybeSingle(),
        fetchAllMoradoresForCondo(targetCondoId, { includeInactive: true, select: "id, nome, ativo, observacoes", orderCol: "id" }),
        supabaseAdmin.from("message_logs").select("*").eq("condominium_id", targetCondoId).order("data_envio", { ascending: false }).limit(100),
        fetchAllProfilesForCondo(),
        supabaseAdmin.from("packages").select("id, condominium_id, recipient_id, recipient_name, unit_number, unit_type, block, street, carrier, tracking_code, status, notes, received_at, delivered_at, received_by, recebido_por, porter_name, delivery_method").eq("condominium_id", targetCondoId).order("received_at", { ascending: false }).range(0, 0)
      ]);
      const nowMs = Date.now();
      const todayKey = toLocalDateKey(nowMs);
      const last7Days = [];
      const dayBucketMap = /* @__PURE__ */ new Map();
      for (let i = 6; i >= 0; i--) {
        const dayMs = nowMs - i * 864e5;
        const shifted = new Date(dayMs - tzOffsetMinutes * 6e4);
        const y = shifted.getUTCFullYear();
        const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
        const d = String(shifted.getUTCDate()).padStart(2, "0");
        const dateKey = `${y}-${m}-${d}`;
        const bucket = { dateKey, name: `${d}/${m}`, recebidas: 0, retiradas: 0 };
        last7Days.push(bucket);
        dayBucketMap.set(dateKey, bucket);
      }
      const PAGE_SIZE = 1e3;
      let offset = 0;
      let total = 0;
      let pending = 0;
      let delivered = 0;
      let rowAll = 0;
      let rowPending = 0;
      let rowDelivered = 0;
      let receivedToday = 0;
      let deliveredToday = 0;
      let qrRetrievals = 0;
      let manualRetrievals = 0;
      let oldestDate = null;
      let oldestTs = null;
      let newestDate = null;
      let newestTs = null;
      let undatedPackagesCount = 0;
      const seenPackageIds = /* @__PURE__ */ new Set();
      while (true) {
        const { data: batch, error: pkgsErr } = await supabaseAdmin.from("packages").select("id, status, notes, received_at, delivered_at, delivery_method").eq("condominium_id", targetCondoId).order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
        if (pkgsErr) {
          throw new Error(`Erro ao carregar encomendas do painel: ${pkgsErr.message || "falha no banco de dados"}`);
        }
        const rows = Array.isArray(batch) ? batch : [];
        for (const pkg of rows) {
          if (pkg?.id) {
            if (seenPackageIds.has(pkg.id)) continue;
            seenPackageIds.add(pkg.id);
          }
          let count = 1;
          const notesStr = String(pkg.notes || "");
          const qtdMatch = notesStr.match(/\[QTD:\s*(\d+)\]/i) || notesStr.match(/Lote de\s*(\d+)\s*encomendas/i);
          if (qtdMatch && qtdMatch[1]) {
            const parsed = parseInt(qtdMatch[1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) count = parsed;
          }
          total += count;
          rowAll += 1;
          const isDelivered = pkg.status === "delivered";
          if (isDelivered) {
            delivered += count;
            rowDelivered += 1;
          } else {
            pending += count;
            rowPending += 1;
          }
          if (pkg.delivery_method === "qr_code") {
            qrRetrievals += 1;
          } else if (isDelivered) {
            manualRetrievals += 1;
          }
          const recDateKey = toLocalDateKey(pkg.received_at);
          if (recDateKey) {
            if (recDateKey === todayKey) receivedToday += 1;
            const recBucket = dayBucketMap.get(recDateKey);
            if (recBucket) recBucket.recebidas += 1;
          }
          const delDateKey = toLocalDateKey(pkg.delivered_at);
          if (delDateKey) {
            if (delDateKey === todayKey) deliveredToday += 1;
            const delBucket = dayBucketMap.get(delDateKey);
            if (delBucket) delBucket.retiradas += 1;
          }
          if (!pkg.received_at) {
            undatedPackagesCount += 1;
          } else {
            const parsedTs = Date.parse(pkg.received_at);
            if (!Number.isNaN(parsedTs)) {
              if (oldestTs === null || parsedTs < oldestTs) {
                oldestTs = parsedTs;
                oldestDate = pkg.received_at;
              }
              if (newestTs === null || parsedTs > newestTs) {
                newestTs = parsedTs;
                newestDate = pkg.received_at;
              }
            } else {
              if (!oldestDate || pkg.received_at < oldestDate) oldestDate = pkg.received_at;
              if (!newestDate || pkg.received_at > newestDate) newestDate = pkg.received_at;
            }
          }
        }
        if (rows.length < PAGE_SIZE) {
          break;
        }
        offset += PAGE_SIZE;
      }
      let lastPackage = null;
      const latestRaw = Array.isArray(latestPkgRes?.data) && latestPkgRes.data.length > 0 ? latestPkgRes.data[0] : null;
      if (latestRaw) {
        const enrichedLatest = await enrichOperationalPackages([latestRaw], targetCondoId);
        lastPackage = enrichedLatest[0] || latestRaw;
      }
      const activeMoradores = allMoradores.filter((m) => m.ativo !== false);
      const testResidentsCount = allMoradores.filter(
        (m) => `${m.nome || ""} ${m.observacoes || ""}`.toLowerCase().includes("teste")
      ).length;
      const testPortersCount = allProfiles.filter(
        (p) => String(p.full_name || "").toLowerCase().includes("teste")
      ).length;
      return res.json({
        condominium: condoRes.data || null,
        stats: { total, pending, delivered },
        periodRange: { start: oldestDate, end: newestDate },
        undatedPackagesCount,
        messageLogs: messageLogsRes.data || [],
        counts: {
          all: rowAll,
          pending: rowPending,
          delivered: rowDelivered
        },
        syndicStats: {
          receivedToday,
          pending: rowPending,
          deliveredToday,
          qrRetrievals,
          manualRetrievals,
          lastPackage,
          residentsCount: activeMoradores.length,
          chartData: last7Days.map(({ name, recebidas, retiradas }) => ({ name, recebidas, retiradas }))
        },
        testCounts: {
          residents: testResidentsCount,
          porters: testPortersCount,
          packages: rowAll,
          testPending: rowPending,
          testDelivered: rowDelivered
        }
      });
    } catch (err) {
      console.error("[GET /api/operational/dashboard] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro ao carregar painel." });
    }
  });
  app2.get("/api/operational/packages", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.query.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "all";
      const lookup = typeof req.query.lookup === "string" ? req.query.lookup.trim() : "";
      const recipientId = typeof req.query.recipientId === "string" ? req.query.recipientId.trim() : "";
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const limit = Math.min(1e3, Math.max(1, parseInt(String(req.query.limit || "200"), 10) || 200));
      let query = supabaseAdmin.from("packages").select("*", { count: "exact" }).eq("condominium_id", targetCondoId);
      if (recipientId) {
        query = query.eq("recipient_id", recipientId);
      }
      if (lookup) {
        let extractedId = "";
        let extractedCode = "";
        let extractedToken = "";
        const rawLookup = lookup.trim();
        if (rawLookup.startsWith("{")) {
          try {
            const parsed = JSON.parse(rawLookup);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              if (typeof parsed.id === "string") extractedId = parsed.id.trim();
              if (parsed.code !== void 0 && parsed.code !== null) extractedCode = String(parsed.code).trim();
              if (typeof parsed.token === "string") extractedToken = parsed.token.trim();
            }
          } catch {
          }
        } else if (/^https?:\/\//i.test(rawLookup) || rawLookup.includes("/retirada")) {
          try {
            const normalizedUrl = /^https?:\/\//i.test(rawLookup) ? rawLookup : `https://local.invalid${rawLookup.startsWith("/") ? rawLookup : `/${rawLookup}`}`;
            const parsedUrl = new URL(normalizedUrl);
            extractedToken = parsedUrl.searchParams.get("token")?.trim() || "";
            extractedCode = parsedUrl.searchParams.get("code")?.trim() || "";
          } catch {
          }
        } else {
          extractedToken = rawLookup;
          extractedCode = rawLookup;
          extractedId = rawLookup;
        }
        const safeTerm = /^[A-Za-z0-9_-]{1,128}$/;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const parts = [];
        if (extractedToken && safeTerm.test(extractedToken)) {
          parts.push(`pickup_token.eq.${extractedToken}`);
        }
        if (extractedCode && safeTerm.test(extractedCode)) {
          parts.push(`pickup_code.eq.${extractedCode}`);
        }
        if (extractedId && uuidRegex.test(extractedId)) {
          parts.push(`id.eq.${extractedId}`);
        }
        if (parts.length === 0) {
          return res.json({ packages: [], totalCount: 0 });
        }
        query = query.or(parts.join(","));
      }
      if (status === "pending") {
        query = query.neq("status", "delivered").is("delivered_at", null).order("received_at", { ascending: false });
      } else if (status === "delivered") {
        query = query.eq("status", "delivered").order("delivered_at", { ascending: false });
      } else {
        query = query.order("received_at", { ascending: false });
      }
      const { data, count, error } = await query.range(offset, offset + limit - 1);
      if (error) throw error;
      const enriched = await enrichOperationalPackages(data || [], targetCondoId);
      return res.json({
        packages: enriched,
        totalCount: count ?? enriched.length
      });
    } catch (err) {
      console.error("[GET /api/operational/packages] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro ao listar encomendas." });
    }
  });
  app2.post("/api/operational/upload-photo", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const { imageBase64, folder = "package-photos" } = req.body || {};
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return res.status(400).json({ error: "Imagem inv\xE1lida." });
      }
      const matches = imageBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: "Formato de imagem inv\xE1lido." });
      }
      const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
      const buffer = Buffer.from(matches[2], "base64");
      const safeFolder = folder === "delivery-photos" ? "delivery-photos" : "package-photos";
      const fileName = `${safeFolder}/${Date.now()}_${generateSecureHexToken(8)}.${ext}`;
      const { error: uploadErr } = await supabaseAdmin.storage.from("packages").upload(fileName, buffer, { contentType: `image/${matches[1]}`, cacheControl: "3600", upsert: false });
      if (uploadErr) {
        return res.status(500).json({ error: uploadErr.message || "Falha ao enviar foto para o Storage." });
      }
      const { data: { publicUrl } } = supabaseAdmin.storage.from("packages").getPublicUrl(fileName);
      return res.json({ success: true, publicUrl });
    } catch (err) {
      console.error("[POST /api/operational/upload-photo] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro no upload da foto." });
    }
  });
  app2.post("/api/operational/packages/deliver", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const {
        packageId,
        packageIds,
        condominiumId,
        pickupToken,
        pickupCode,
        recipientId,
        deliveryMethod = "manual",
        deliveredToName = "Morador (Confirmado)",
        porterName,
        photoBase64,
        deliveryPhotoUrl
      } = req.body || {};
      const resolved = resolveTargetCondoId(opSession, condominiumId);
      if ("error" in resolved) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const targetCondoId = resolved.condominiumId;
      const requestedIds = Array.isArray(packageIds) ? packageIds.filter((id) => typeof id === "string" && id.trim()) : [];
      if (typeof packageId === "string" && packageId.trim() && !requestedIds.includes(packageId.trim())) {
        requestedIds.push(packageId.trim());
      }
      if (requestedIds.length === 0) {
        return res.status(400).json({ error: "ID da encomenda \xE9 obrigat\xF3rio." });
      }
      const { data: targetRows, error: fetchErr } = await supabaseAdmin.from("packages").select("*").in("id", requestedIds);
      if (fetchErr) {
        return res.status(500).json({ error: "Erro ao consultar encomenda." });
      }
      if (!targetRows || targetRows.length === 0) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada." });
      }
      if (targetRows.some((r) => r.condominium_id !== targetCondoId)) {
        return res.status(403).json({ error: "Acesso negado: encomenda pertence a outro condom\xEDnio." });
      }
      const pendingRequestedRows = targetRows.filter((r) => r.status !== "delivered" && !r.delivered_at);
      if (pendingRequestedRows.length === 0) {
        return res.status(409).json({
          error: "Encomenda j\xE1 foi entregue anteriormente.",
          alreadyDelivered: true
        });
      }
      const requestedMethod = String(deliveryMethod || "manual");
      const hasServerNotificationConfirmed = (row) => {
        if (!row) return false;
        if (row.whatsapp_notified === true || row.whatsapp_sent === true) return true;
        const waStatus = String(row.whatsapp_status || "").trim().toLowerCase();
        if (["sent", "enviado", "delivered", "read"].includes(waStatus)) return true;
        if (String(row.status || "").trim().toLowerCase() === "notified") return true;
        const isFailedOrPendingWa = [
          "pending",
          "pending_configuration",
          "error",
          "failed",
          "no_recipient",
          "cancelled",
          "canceled"
        ].includes(waStatus);
        return !isFailedOrPendingWa && Boolean(row.notified_at || row.whatsapp_sent_at);
      };
      if (requestedMethod === "qr_code") {
        if (pendingRequestedRows.every((r) => r.pickup_qr_code === "used")) {
          return res.status(409).json({
            error: "Este QR Code j\xE1 foi utilizado.",
            alreadyDelivered: true
          });
        }
        if (typeof pickupToken === "string" && pickupToken.trim()) {
          const cleanToken = pickupToken.trim();
          if (pendingRequestedRows.some((r) => r.pickup_token && r.pickup_token !== cleanToken)) {
            return res.status(403).json({ error: "Token do QR Code inv\xE1lido ou incompat\xEDvel com a encomenda." });
          }
        }
        if (typeof pickupCode === "string" && pickupCode.trim()) {
          const cleanCode = pickupCode.trim();
          if (pendingRequestedRows.some((r) => r.pickup_code && r.pickup_code !== cleanCode)) {
            return res.status(403).json({ error: "C\xF3digo do QR Code inv\xE1lido ou incompat\xEDvel com a encomenda." });
          }
        }
        if (!pendingRequestedRows.every(hasServerNotificationConfirmed)) {
          return res.status(403).json({
            error: "POR FAVOR ENVIE A NOTIFICA\xC7\xC3O PARA DAR BAIXA DA ENCOMENDA",
            requiresNotification: true
          });
        }
      }
      const idSet = new Set(pendingRequestedRows.map((r) => r.id));
      const effectiveToken = pickupToken || targetRows[0]?.pickup_token;
      const effectiveCode = pickupCode || targetRows[0]?.pickup_code;
      const effectiveRecipient = recipientId || targetRows[0]?.recipient_id;
      if (effectiveToken) {
        let { data: related, error: relatedErr } = await supabaseAdmin.from("packages").select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, notified_at, whatsapp_sent_at, status").eq("condominium_id", targetCondoId).eq("pickup_token", effectiveToken).neq("status", "delivered").is("delivered_at", null);
        if (relatedErr && isMissingNotifiedAtError(relatedErr)) {
          const retryRelated = await supabaseAdmin.from("packages").select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, whatsapp_sent_at, status").eq("condominium_id", targetCondoId).eq("pickup_token", effectiveToken).neq("status", "delivered").is("delivered_at", null);
          related = retryRelated.data;
        }
        (related || []).forEach((r) => {
          if (requestedMethod !== "qr_code" || hasServerNotificationConfirmed(r)) {
            idSet.add(r.id);
          }
        });
      } else if (effectiveCode && effectiveRecipient) {
        let { data: related, error: relatedErr } = await supabaseAdmin.from("packages").select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, notified_at, whatsapp_sent_at, status").eq("condominium_id", targetCondoId).eq("pickup_code", effectiveCode).eq("recipient_id", effectiveRecipient).neq("status", "delivered").is("delivered_at", null);
        if (relatedErr && isMissingNotifiedAtError(relatedErr)) {
          const retryRelated = await supabaseAdmin.from("packages").select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, whatsapp_sent_at, status").eq("condominium_id", targetCondoId).eq("pickup_code", effectiveCode).eq("recipient_id", effectiveRecipient).neq("status", "delivered").is("delivered_at", null);
          related = retryRelated.data;
        }
        (related || []).forEach((r) => {
          if (requestedMethod !== "qr_code" || hasServerNotificationConfirmed(r)) {
            idSet.add(r.id);
          }
        });
      }
      const idsToUpdate = Array.from(idSet);
      let finalPhotoUrl = typeof deliveryPhotoUrl === "string" && deliveryPhotoUrl ? deliveryPhotoUrl : null;
      let finalMethod = requestedMethod;
      if (!finalPhotoUrl && typeof photoBase64 === "string" && photoBase64.startsWith("data:image/")) {
        const matches = photoBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!matches) {
          return res.status(400).json({ error: "Formato de imagem inv\xE1lido." });
        }
        const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const fileName = `delivery-photos/delivery_${Date.now()}_${generateSecureHexToken(8)}.${ext}`;
        const { error: uploadErr } = await supabaseAdmin.storage.from("packages").upload(fileName, buffer, { contentType: `image/${matches[1]}`, cacheControl: "3600", upsert: false });
        if (uploadErr) {
          return res.status(500).json({ error: `Erro no upload da foto: ${uploadErr.message}` });
        }
        const { data: { publicUrl } } = supabaseAdmin.storage.from("packages").getPublicUrl(fileName);
        finalPhotoUrl = publicUrl;
        finalMethod = "foto";
      }
      const validDeliveredBy = opSession.authType === "user" && opSession.profile?.id ? opSession.profile.id : null;
      const effectivePorterName = typeof porterName === "string" && porterName.trim() && porterName !== "Selecione o Porteiro" ? porterName.trim().slice(0, 120) : opSession.portariaName;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const updatePatch = {
        status: "delivered",
        delivered_at: nowIso,
        delivery_method: finalMethod,
        delivered_by: validDeliveredBy,
        entregue_por: effectivePorterName,
        pickup_qr_code: "used",
        delivered_to_name: deliveredToName,
        ...finalPhotoUrl ? { delivery_photo_url: finalPhotoUrl } : {}
      };
      const { data: updatedRows, error: updateErr } = await supabaseAdmin.from("packages").update(updatePatch).eq("condominium_id", targetCondoId).in("id", idsToUpdate).neq("status", "delivered").is("delivered_at", null).select("id");
      if (updateErr) {
        return res.status(500).json({ error: updateErr.message || "Erro ao registrar baixa da encomenda." });
      }
      const actuallyUpdatedIds = (updatedRows || []).map((r) => r.id).filter(Boolean);
      if (actuallyUpdatedIds.length === 0) {
        return res.status(409).json({
          error: "Encomenda j\xE1 foi entregue anteriormente.",
          alreadyDelivered: true
        });
      }
      try {
        await supabaseAdmin.from("retrieval_logs").insert(
          actuallyUpdatedIds.map((pid) => ({
            package_id: pid,
            porter_id: validDeliveredBy,
            condominium_id: targetCondoId,
            delivery_method: finalMethod,
            token_used: effectiveToken || null,
            status: "success"
          }))
        );
      } catch (logErr) {
        console.warn("[POST /api/operational/packages/deliver] retrieval_logs aviso:", logErr);
      }
      await recordAuditEvent(
        actuallyUpdatedIds.map((pid) => ({
          condominio_id: targetCondoId,
          usuario_id: validDeliveredBy,
          usuario_nome: effectivePorterName,
          usuario_perfil: opSession.authType === "user" ? opSession.profile?.role || "porteiro" : "porteiro",
          tipo_evento: "ENCOMENDA_ENTREGUE",
          acao: "UPDATE",
          tabela_afetada: "packages",
          registro_id: pid,
          descricao: `Encomenda ${pid} baixada (${finalMethod}) para ${deliveredToName}.`,
          metodo: finalMethod.toUpperCase()
        }))
      );
      return res.json({
        success: true,
        updatedIds: actuallyUpdatedIds,
        delivered_at: nowIso,
        delivery_method: finalMethod,
        delivery_photo_url: finalPhotoUrl,
        delivered_by: validDeliveredBy,
        entregue_por: effectivePorterName,
        delivered_to_name: deliveredToName
      });
    } catch (err) {
      console.error("[POST /api/operational/packages/deliver] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro ao dar baixa na encomenda." });
    }
  });
  app2.post("/api/operational/packages/whatsapp-status", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const { packageIds, fields, condominiumId } = req.body || {};
      const resolved = resolveTargetCondoId(opSession, condominiumId);
      if ("error" in resolved) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const targetCondoId = resolved.condominiumId;
      const cleanIds = Array.isArray(packageIds) ? packageIds.filter((id) => typeof id === "string" && id.trim()) : [];
      if (cleanIds.length === 0 || !fields || typeof fields !== "object") {
        return res.status(400).json({ error: "packageIds e fields s\xE3o obrigat\xF3rios." });
      }
      const ALLOWED_WA_FIELDS = /* @__PURE__ */ new Set([
        "whatsapp_notified",
        "whatsapp_sent",
        "whatsapp_status",
        "notified_at",
        "whatsapp_sent_at",
        "last_notification_at",
        "whatsapp_message",
        "pickup_code",
        "pickup_token"
      ]);
      const safePatch = {};
      for (const [k, v] of Object.entries(fields)) {
        if (ALLOWED_WA_FIELDS.has(k) && v !== void 0) {
          safePatch[k] = v;
        }
      }
      if (Object.keys(safePatch).length === 0) {
        return res.status(400).json({ error: "Nenhum campo v\xE1lido informado para atualiza\xE7\xE3o." });
      }
      const { data: existingRows, error: fetchErr } = await supabaseAdmin.from("packages").select("id, condominium_id").in("id", cleanIds);
      if (fetchErr) {
        return res.status(500).json({ error: "Erro ao validar encomendas." });
      }
      if (!existingRows || existingRows.length === 0) {
        return res.status(404).json({ error: "Encomendas n\xE3o encontradas." });
      }
      if (existingRows.some((r) => r.condominium_id !== targetCondoId)) {
        return res.status(403).json({ error: "Acesso negado: tentativa de atualizar encomendas de outro condom\xEDnio." });
      }
      let { data: updated, error: updateErr } = await supabaseAdmin.from("packages").update(safePatch).eq("condominium_id", targetCondoId).in("id", cleanIds).select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, notified_at, whatsapp_sent_at, last_notification_at");
      if (updateErr && isMissingNotifiedAtError(updateErr)) {
        console.warn("[POST /api/operational/packages/whatsapp-status] Coluna notified_at ausente no schema, salvando campos compat\xEDveis:", updateErr.message);
        const fallbackPatch = { ...safePatch };
        delete fallbackPatch.notified_at;
        if (Object.keys(fallbackPatch).length === 0) {
          return res.status(500).json({ error: "Nenhum campo compat\xEDvel dispon\xEDvel para atualizar status do WhatsApp." });
        }
        const retryUpdate = await supabaseAdmin.from("packages").update(fallbackPatch).eq("condominium_id", targetCondoId).in("id", cleanIds).select("id, whatsapp_notified, whatsapp_sent, whatsapp_status, whatsapp_sent_at, last_notification_at");
        updated = retryUpdate.data;
        updateErr = retryUpdate.error;
      }
      if (updateErr) {
        return res.status(500).json({ error: updateErr.message || "Erro ao atualizar status do WhatsApp." });
      }
      if (!updated || updated.length === 0) {
        return res.status(404).json({ error: "Nenhuma encomenda foi atualizada no banco de dados." });
      }
      return res.json({ success: true, data: updated });
    } catch (err) {
      console.error("[POST /api/operational/packages/whatsapp-status] Erro:", err);
      return res.status(500).json({ error: err?.message || "Erro ao atualizar status WhatsApp." });
    }
  });
  app2.get("/api/operational/moradores", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.query.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    try {
      const includeInactive = req.query.includeInactive === "true";
      const allMoradores = await fetchAllMoradoresForCondo(resolved.condominiumId, {
        includeInactive,
        select: "*",
        orderCol: "id"
      });
      allMoradores.sort(
        (a, b) => String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" })
      );
      return res.json({ moradores: allMoradores });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao listar moradores." });
    }
  });
  app2.post("/api/operational/moradores", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominium_id || req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    try {
      const {
        nome,
        unidade,
        unit_type,
        block,
        bloco,
        street,
        lote,
        telefone,
        observacoes,
        ativo = true
      } = req.body || {};
      if (!nome || typeof nome !== "string" || !nome.trim()) {
        return res.status(400).json({ error: "Nome do morador \xE9 obrigat\xF3rio." });
      }
      const payload = {
        nome: nome.trim(),
        unidade: typeof unidade === "string" ? unidade : "",
        telefone: typeof telefone === "string" ? telefone : "",
        condominium_id: targetCondoId,
        ativo: ativo !== false
      };
      if (unit_type !== void 0) payload.unit_type = unit_type;
      if (block !== void 0) payload.block = block;
      if (bloco !== void 0) payload.bloco = bloco;
      if (street !== void 0) payload.street = street;
      if (lote !== void 0) payload.lote = lote;
      if (observacoes !== void 0) payload.observacoes = observacoes;
      const { data: created, error } = await supabaseAdmin.from("moradores").insert([payload]).select("*").single();
      if (error) throw error;
      return res.json({ success: true, morador: created });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao cadastrar morador." });
    }
  });
  app2.patch("/api/operational/moradores/:id", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominium_id || req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    const { id } = req.params;
    try {
      const { data: existing, error: fetchErr } = await supabaseAdmin.from("moradores").select("*").eq("id", id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) {
        return res.status(404).json({ error: "Morador n\xE3o encontrado." });
      }
      if (existing.condominium_id !== targetCondoId) {
        return res.status(403).json({ error: "Acesso negado: morador pertence a outro condom\xEDnio." });
      }
      const ALLOWED_MORADOR_FIELDS = /* @__PURE__ */ new Set([
        "nome",
        "unidade",
        "unit_type",
        "block",
        "bloco",
        "street",
        "lote",
        "telefone",
        "observacoes",
        "ativo"
      ]);
      const patch = {};
      for (const [k, v] of Object.entries(req.body || {})) {
        if (ALLOWED_MORADOR_FIELDS.has(k) && v !== void 0) {
          patch[k] = v;
        }
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nenhum campo v\xE1lido informado." });
      }
      const { data: updated, error: updErr } = await supabaseAdmin.from("moradores").update(patch).eq("id", id).eq("condominium_id", targetCondoId).select("*").single();
      if (updErr) throw updErr;
      if (typeof patch.ativo === "boolean") {
        try {
          await supabaseAdmin.from("profiles").update({ active: patch.ativo }).eq("id", id).eq("condominium_id", targetCondoId);
        } catch {
        }
      }
      return res.json({ success: true, morador: updated });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao atualizar morador." });
    }
  });
  app2.post("/api/operational/moradores/batch", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    try {
      const inserts = Array.isArray(req.body?.inserts) ? req.body.inserts : [];
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      let insertedCount = 0;
      let updatedCount = 0;
      const errors = [];
      if (inserts.length > 0) {
        const sanitizedInserts = inserts.map((item) => ({
          nome: String(item.nome || "").trim(),
          unidade: String(item.unidade || "").trim(),
          telefone: String(item.telefone || "").trim(),
          ativo: item.ativo !== false,
          observacoes: item.observacoes || null,
          condominium_id: targetCondoId
        }));
        const { error: insErr } = await supabaseAdmin.from("moradores").insert(sanitizedInserts);
        if (insErr) {
          errors.push(`Erro ao inserir lote: ${insErr.message}`);
        } else {
          insertedCount = sanitizedInserts.length;
        }
      }
      for (const upd of updates) {
        if (!upd?.id) continue;
        const { data: existing } = await supabaseAdmin.from("moradores").select("id, condominium_id").eq("id", upd.id).maybeSingle();
        if (!existing || existing.condominium_id !== targetCondoId) {
          errors.push(`Morador ${upd.id} ignorado: pertence a outro condom\xEDnio ou n\xE3o encontrado.`);
          continue;
        }
        const patch = {};
        if (upd.telefone !== void 0) patch.telefone = upd.telefone;
        if (upd.observacoes !== void 0) patch.observacoes = upd.observacoes;
        if (upd.nome !== void 0) patch.nome = upd.nome;
        if (upd.unidade !== void 0) patch.unidade = upd.unidade;
        const { error: uErr } = await supabaseAdmin.from("moradores").update(patch).eq("id", upd.id).eq("condominium_id", targetCondoId);
        if (uErr) errors.push(`Erro ao atualizar ${upd.id}: ${uErr.message}`);
        else updatedCount++;
      }
      return res.json({ success: errors.length === 0, insertedCount, updatedCount, errors });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro na importa\xE7\xE3o em lote de moradores." });
    }
  });
  app2.post("/api/operational/moradores/fix-unit-type", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    if (!opSession.isGlobalAdmin && !opSession.isSindico) {
      return res.status(403).json({ error: "Acesso negado." });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    try {
      const { error } = await supabaseAdmin.from("moradores").update({ unit_type: "Casa" }).eq("condominium_id", resolved.condominiumId).eq("unit_type", "apto");
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao corrigir tipo de unidade." });
    }
  });
  app2.post("/api/operational/audit", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const body = req.body || {};
    const resolved = resolveTargetCondoId(opSession, body.condominio_id || body.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    try {
      const result = await recordAuditEvent({
        condominio_id: resolved.condominiumId,
        usuario_id: opSession.authType === "user" ? opSession.profile?.id : null,
        usuario_nome: typeof body.usuario_nome === "string" && body.usuario_nome.trim() ? body.usuario_nome.trim().slice(0, 120) : opSession.portariaName,
        usuario_perfil: opSession.authType === "user" ? opSession.profile?.role || "porteiro" : "porteiro",
        tipo_evento: String(body.tipo_evento || "OPERATIONAL_EVENT").slice(0, 80),
        acao: String(body.acao || "UPDATE").slice(0, 40),
        tabela_afetada: String(body.tabela_afetada || "packages").slice(0, 80),
        registro_id: body.registro_id || null,
        descricao: String(body.descricao || "").slice(0, 1e3),
        metodo: String(body.metodo || "MANUAL").slice(0, 60),
        ...body.dados_antes !== void 0 ? { dados_antes: body.dados_antes } : {},
        ...body.dados_depois !== void 0 ? { dados_depois: body.dados_depois } : {}
      });
      return res.json({ success: result.ok });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao registrar auditoria." });
    }
  });
  app2.get("/api/operational/audit", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    if (!opSession.isGlobalAdmin && !opSession.isSindico) {
      return res.status(403).json({ error: "Apenas administradores ou s\xEDndicos podem consultar os logs de auditoria." });
    }
    const resolved = resolveTargetCondoId(opSession, req.query.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    try {
      let query = supabaseAdmin.from("auditoria_eventos").select("*").eq("condominio_id", resolved.condominiumId);
      if (typeof req.query.start === "string" && req.query.start) {
        query = query.gte("criado_em", req.query.start);
      }
      if (typeof req.query.end === "string" && req.query.end) {
        query = query.lte("criado_em", req.query.end);
      }
      const { data, error } = await query.order("criado_em", { ascending: false }).limit(500);
      if (error) throw error;
      return res.json({ logs: data || [] });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao consultar auditoria." });
    }
  });
  app2.post("/api/operational/message-logs", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const body = req.body || {};
    const resolved = resolveTargetCondoId(opSession, body.condominium_id || body.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    try {
      const { error } = await supabaseAdmin.from("message_logs").insert([{
        condominium_id: toNullableUuid(resolved.condominiumId),
        telefone: String(body.telefone || "").slice(0, 40),
        mensagem: body.mensagem ? String(body.mensagem).slice(0, 2e3) : null,
        status: String(body.status || "sent").slice(0, 40),
        status_envio: body.status_envio ? String(body.status_envio).slice(0, 40) : null,
        erro_api: body.erro_api ? String(body.erro_api).slice(0, 1e3) : null,
        data_envio: body.data_envio || (/* @__PURE__ */ new Date()).toISOString()
      }]);
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao gravar log de mensagem." });
    }
  });
  app2.put("/api/operational/condominium-settings", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    if (!opSession.isGlobalAdmin && !opSession.isSindico) {
      return res.status(403).json({ error: "Apenas administradores ou s\xEDndicos podem alterar configura\xE7\xF5es." });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    try {
      const { condoName, condoAddress, settings } = req.body || {};
      if (typeof condoName === "string" && condoName.trim()) {
        await supabaseAdmin.from("condominiums").update({
          name: condoName.trim(),
          ...condoAddress !== void 0 ? { address: String(condoAddress || "") } : {}
        }).eq("id", targetCondoId);
      }
      if (settings && typeof settings === "object") {
        const ALLOWED_SETTINGS_FIELDS = /* @__PURE__ */ new Set([
          "notification_template",
          "whatsapp_mode",
          "whatsapp_provider",
          "instance_id",
          "api_token",
          "api_url",
          "modo_leve"
        ]);
        const safeSettings = {
          condominium_id: targetCondoId,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        for (const [k, v] of Object.entries(settings)) {
          if (ALLOWED_SETTINGS_FIELDS.has(k) && v !== void 0) {
            safeSettings[k] = v;
          }
        }
        const { data: existing } = await supabaseAdmin.from("condominium_settings").select("condominium_id").eq("condominium_id", targetCondoId).maybeSingle();
        if (existing) {
          const { error: updErr } = await supabaseAdmin.from("condominium_settings").update(safeSettings).eq("condominium_id", targetCondoId);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabaseAdmin.from("condominium_settings").insert([safeSettings]);
          if (insErr) throw insErr;
        }
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao salvar configura\xE7\xF5es." });
    }
  });
  app2.post("/api/operational/packages/clear", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    if (!opSession.isGlobalAdmin) {
      return res.status(403).json({ error: "Apenas administradores globais podem limpar dados do condom\xEDnio." });
    }
    const resolved = resolveTargetCondoId(opSession, req.body?.condominiumId);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    const mode = req.body?.mode || "test";
    try {
      if (mode === "inactive") {
        const { error } = await supabaseAdmin.from("moradores").delete().eq("condominium_id", targetCondoId).eq("ativo", false);
        if (error) throw error;
        return res.json({ success: true, mode });
      }
      if (mode === "all_packages") {
        const { data: pkgs2 } = await supabaseAdmin.from("packages").select("id").eq("condominium_id", targetCondoId);
        const pkgIds = (pkgs2 || []).map((p) => p.id);
        if (pkgIds.length > 0) {
          await supabaseAdmin.from("retrieval_logs").delete().in("package_id", pkgIds);
        }
        const { error } = await supabaseAdmin.from("packages").delete().eq("condominium_id", targetCondoId);
        if (error) throw error;
        return res.json({ success: true, mode, removedPackages: pkgIds.length });
      }
      await supabaseAdmin.from("retrieval_logs").delete().eq("condominium_id", targetCondoId);
      const { data: pkgs } = await supabaseAdmin.from("packages").delete().eq("condominium_id", targetCondoId).eq("is_teste", true).select("id");
      const { data: residents } = await supabaseAdmin.from("moradores").delete().eq("condominium_id", targetCondoId).or("nome.ilike.%teste%,observacoes.ilike.%teste%").select("id");
      const { data: porters } = await supabaseAdmin.from("profiles").delete().eq("condominium_id", targetCondoId).ilike("full_name", "%teste%").select("id");
      return res.json({
        success: true,
        mode,
        report: {
          residents: residents?.length || 0,
          porters: porters?.length || 0,
          packages: pkgs?.length || 0
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao limpar dados." });
    }
  });
  app2.delete("/api/operational/packages/:id", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    if (!opSession.isGlobalAdmin && !opSession.isSindico) {
      return res.status(403).json({ error: "Apenas administradores ou s\xEDndicos podem excluir encomendas." });
    }
    const { id } = req.params;
    const requestedCondo = req.query.condominiumId || req.body?.condominiumId;
    const resolved = resolveTargetCondoId(opSession, requestedCondo);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const targetCondoId = resolved.condominiumId;
    try {
      const { data: existing, error: fetchErr } = await supabaseAdmin.from("packages").select("id, condominium_id").eq("id", id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada." });
      }
      if (existing.condominium_id !== targetCondoId) {
        return res.status(403).json({ error: "Acesso negado: encomenda pertence a outro condom\xEDnio." });
      }
      try {
        await supabaseAdmin.from("retrieval_logs").delete().eq("package_id", id);
      } catch {
      }
      const { error: delErr } = await supabaseAdmin.from("packages").delete().eq("id", id).eq("condominium_id", targetCondoId);
      if (delErr) throw delErr;
      return res.json({ success: true, id });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao excluir encomenda." });
    }
  });
  const sendWhatsAppMessage = async (to, message, condominiumId, packageId, isTemplate = false, templateData) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    let cleanPhone = String(to || "").replace(/\D/g, "");
    if ((cleanPhone.length === 10 || cleanPhone.length === 11) && !cleanPhone.startsWith("55")) {
      cleanPhone = "55" + cleanPhone;
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, error: "N\xFAmero de telefone inv\xE1lido para envio." };
    }
    if (!accessToken || !phoneNumberId) {
      console.log(`[WhatsApp Mock] [Condo: ${condominiumId}] Para ${cleanPhone}: ${message}`);
      if (packageId) {
        const { error: pkgUpdErr } = await supabaseAdmin.from("packages").update({
          whatsapp_status: "pending_configuration",
          last_notification_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", packageId);
        if (pkgUpdErr) {
          console.warn("[sendWhatsAppMessage] Falha ao atualizar status pending_configuration:", pkgUpdErr.message);
        }
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1e4);
      let response;
      try {
        response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await response.json().catch(() => ({}));
      const messageId = Array.isArray(data?.messages) ? data.messages[0]?.id : null;
      const sendOk = Boolean(response.ok && messageId);
      const status = sendOk ? "sent" : "failed";
      const errorDetail = !sendOk ? JSON.stringify(data?.error || { status: response.status, statusText: response.statusText }) : null;
      const { error: logErr } = await supabaseAdmin.from("message_logs").insert([{
        condominium_id: toNullableUuid(condominiumId),
        telefone: cleanPhone,
        status,
        status_envio: sendOk ? "sucesso" : "erro",
        erro_api: errorDetail,
        data_envio: (/* @__PURE__ */ new Date()).toISOString()
      }]);
      if (logErr) {
        console.warn("[sendWhatsAppMessage] Erro ao gravar message_logs:", logErr.message);
      }
      if (packageId) {
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const pkgUpdatePatch = {
          whatsapp_status: status,
          last_notification_at: nowIso,
          ...sendOk ? { whatsapp_sent: true, whatsapp_notified: true, whatsapp_sent_at: nowIso } : {}
        };
        const { error: pkgErr } = await supabaseAdmin.from("packages").update(pkgUpdatePatch).eq("id", packageId);
        if (pkgErr) {
          console.warn("[sendWhatsAppMessage] Erro ao atualizar packages.whatsapp_status:", pkgErr.message);
        }
        const { data: pkgRow } = await supabaseAdmin.from("packages").select("recipient_id").eq("id", packageId).maybeSingle();
        if (pkgRow?.recipient_id) {
          const { data: residentProfile } = await supabaseAdmin.from("profiles").select("id").eq("id", pkgRow.recipient_id).maybeSingle();
          if (residentProfile?.id) {
            const { error: notifErr } = await supabaseAdmin.from("notifications").insert([{
              user_id: residentProfile.id,
              message,
              status,
              delivery_channel: "whatsapp"
            }]);
            if (notifErr) {
              console.warn("[sendWhatsAppMessage] Erro ao gravar notifications:", notifErr.message);
            }
          }
        }
      }
      return { success: sendOk, messageId, data, ...errorDetail ? { error: errorDetail } : {} };
    } catch (error) {
      console.error("Erro ao enviar WhatsApp:", error);
      return { success: false, error: error?.message || String(error) };
    }
  };
  app2.post("/api/notify-resident", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    const { packageId } = req.body || {};
    if (!packageId || typeof packageId !== "string" || packageId.trim() === "") {
      return res.status(400).json({ error: "packageId \xE9 obrigat\xF3rio para envio seguro de notifica\xE7\xE3o." });
    }
    try {
      const { data: pkg, error: pkgError } = await supabaseAdmin.from("packages").select("*").eq("id", packageId.trim()).maybeSingle();
      if (pkgError) {
        return res.status(500).json({ error: "Erro ao consultar encomenda." });
      }
      if (!pkg) {
        return res.status(404).json({ error: "Encomenda n\xE3o encontrada" });
      }
      if (!opSession.isGlobalAdmin && opSession.condominiumId !== pkg.condominium_id) {
        return res.status(403).json({ error: "Acesso negado: esta encomenda pertence a outro condom\xEDnio." });
      }
      const authoritativeCondoId = pkg.condominium_id;
      const { data: condo } = await supabaseAdmin.from("condominiums").select("id, name, active").eq("id", authoritativeCondoId).maybeSingle();
      if (!condo || condo.active === false) {
        return res.status(403).json({ error: "Condom\xEDnio inativo ou n\xE3o encontrado." });
      }
      let dbResident = null;
      if (pkg.recipient_id) {
        const { data: rRow } = await supabaseAdmin.from("moradores").select("id, nome, telefone, unidade, condominium_id, ativo").eq("id", pkg.recipient_id).eq("condominium_id", authoritativeCondoId).maybeSingle();
        dbResident = rRow;
      }
      const residentName = dbResident?.nome || pkg.recipient_name_raw || "Morador";
      const phone = dbResident?.telefone || null;
      const unitNumber = dbResident?.unidade || pkg.unit_number_raw || pkg.unit_number || "";
      const carrier = pkg.carrier || "";
      const trackingNumber = pkg.tracking_code || "";
      if (!phone) {
        return res.status(400).json({ error: "Telefone do morador n\xE3o encontrado no cadastro do condom\xEDnio" });
      }
      const residentId = dbResident?.id || pkg.recipient_id;
      const BASE_URL = process.env.APP_URL || "https://encomendas-inteligentes-v2.vercel.app";
      let portalLink = "";
      let directPickupLink = "";
      if (residentId) {
        const token = await getOrCreatePortalToken(residentId, authoritativeCondoId);
        if (token) {
          portalLink = `${BASE_URL}/portal/${token}`;
        }
      }
      if (pkg.pickup_token) {
        directPickupLink = `${BASE_URL}/retirada?token=${pkg.pickup_token}`;
      }
      const { data: settings } = await supabaseAdmin.from("condominium_settings").select("notification_template").eq("condominium_id", authoritativeCondoId).maybeSingle();
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
${directPickupLink || portalLink || ""}

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
      const result = await sendWhatsAppMessage(phone, message, authoritativeCondoId, packageId, true, templateData);
      if (!result.success && !result.notConfigured) {
        return res.status(502).json(result);
      }
      res.json(result);
    } catch (err) {
      console.error("Erro no endpoint de notifica\xE7\xE3o:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/system-status", (req, res) => {
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
  app2.get("/api/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.VITE_SUPABASE_URL || "",
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || ""
    });
  });
  const condominiumActivityStore = /* @__PURE__ */ new Map();
  app2.post("/api/portaria/activity", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const { condominiumId, action, userName, packageId, timestamp } = req.body || {};
      const cleanCondoId = typeof condominiumId === "string" && condominiumId.trim() ? condominiumId.trim() : opSession.condominiumId || "";
      if (!cleanCondoId) {
        return res.status(400).json({ error: "condominiumId \xE9 obrigat\xF3rio." });
      }
      if (!opSession.isGlobalAdmin && opSession.condominiumId !== cleanCondoId) {
        return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o tem permiss\xE3o para registrar atividade neste condom\xEDnio." });
      }
      const allowedActions = [
        "WHATSAPP_ABERTO",
        "WHATSAPP_RETORNO",
        "WHATSAPP_CONFIRMADO",
        "WHATSAPP_CANCELADO",
        "ENCOMENDA_CADASTRADA",
        "FILA_ACAO"
      ];
      const safeAction = allowedActions.includes(action) ? action : "FILA_ACAO";
      const nowMs = Date.now();
      const parsedTs = typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : nowMs;
      const prev = condominiumActivityStore.get(cleanCondoId);
      const effectiveTs = Math.max(prev?.lastActivityTimestamp || 0, parsedTs);
      const derivedUserId = opSession.authType === "user" ? opSession.profile?.id : null;
      const derivedUserName = opSession.authType === "user" ? opSession.profile?.full_name || "Operador" : typeof userName === "string" && userName.trim() ? userName.trim().slice(0, 80) : opSession.portariaName;
      const derivedUserRole = opSession.authType === "user" ? opSession.profile?.role || "porteiro" : "porteiro";
      const { error: auditErr } = await supabaseAdmin.from("auditoria_eventos").insert({
        condominio_id: toNullableUuid(cleanCondoId),
        usuario_id: toNullableUuid(derivedUserId),
        usuario_nome: derivedUserName,
        usuario_perfil: derivedUserRole,
        tipo_evento: `PORTARIA_${safeAction}`,
        acao: "ACTIVITY_SYNC",
        tabela_afetada: "packages",
        registro_id: toNullableUuid(packageId),
        descricao: `Atividade sincronizada da portaria: ${safeAction}`,
        metodo: "PORTARIA_SYNC",
        dados_depois: {
          condominiumId: cleanCondoId,
          action: safeAction,
          timestamp: effectiveTs
        }
      });
      if (auditErr) {
        console.error("[ActivitySync] Erro ao persistir atividade em auditoria_eventos:", auditErr.message || auditErr);
        return res.status(500).json({ error: "Falha ao persistir atividade da portaria no banco de dados." });
      }
      condominiumActivityStore.set(cleanCondoId, {
        lastActivityTimestamp: effectiveTs,
        lastAction: safeAction
      });
      return res.json({
        success: true,
        condominiumId: cleanCondoId,
        lastActivityTimestamp: effectiveTs,
        action: safeAction
      });
    } catch (err) {
      console.error("Erro em POST /api/portaria/activity:", err);
      return res.status(500).json({ error: err?.message || "Erro ao registrar atividade" });
    }
  });
  app2.get("/api/portaria/activity", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) {
      return res.status(opSession.status).json({ error: opSession.error, ...opSession.code ? { code: opSession.code } : {} });
    }
    try {
      const rawCondoId = req.query.condominiumId;
      const cleanCondoId = typeof rawCondoId === "string" && rawCondoId.trim() ? rawCondoId.trim() : opSession.condominiumId || "";
      if (!cleanCondoId) {
        return res.status(400).json({ error: "condominiumId \xE9 obrigat\xF3rio." });
      }
      if (!opSession.isGlobalAdmin && opSession.condominiumId !== cleanCondoId) {
        return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o tem permiss\xE3o para consultar atividade de outro condom\xEDnio." });
      }
      const mem = condominiumActivityStore.get(cleanCondoId);
      let latestTs = mem?.lastActivityTimestamp || null;
      let latestAction = mem?.lastAction || null;
      const validCondoUuid = toNullableUuid(cleanCondoId);
      if (validCondoUuid) {
        let [auditRes, pkgRes] = await Promise.all([
          supabaseAdmin.from("auditoria_eventos").select("criado_em, tipo_evento, dados_depois").eq("condominio_id", validCondoUuid).order("criado_em", { ascending: false }).limit(5),
          supabaseAdmin.from("packages").select("received_at, notified_at, whatsapp_sent_at, last_notification_at").eq("condominium_id", validCondoUuid).order("received_at", { ascending: false }).limit(5)
        ]);
        if (pkgRes.error && isMissingNotifiedAtError(pkgRes.error)) {
          pkgRes = await supabaseAdmin.from("packages").select("received_at, whatsapp_sent_at, last_notification_at").eq("condominium_id", validCondoUuid).order("received_at", { ascending: false }).limit(5);
        }
        const candidates = [];
        if (latestTs) candidates.push(latestTs);
        if (Array.isArray(auditRes.data)) {
          for (const d of auditRes.data) {
            if (typeof d?.dados_depois?.timestamp === "number" && Number.isFinite(d.dados_depois.timestamp)) {
              candidates.push(d.dados_depois.timestamp);
            }
            if (d?.criado_em) {
              const t = new Date(d.criado_em).getTime();
              if (Number.isFinite(t) && t > 0) candidates.push(t);
            }
          }
        } else if (auditRes.data) {
          const d = auditRes.data;
          if (typeof d.dados_depois?.timestamp === "number" && Number.isFinite(d.dados_depois.timestamp)) {
            candidates.push(d.dados_depois.timestamp);
          }
          if (d.criado_em) {
            const t = new Date(d.criado_em).getTime();
            if (Number.isFinite(t) && t > 0) candidates.push(t);
          }
        }
        if (Array.isArray(pkgRes.data)) {
          for (const p of pkgRes.data) {
            for (const col of [p.received_at, p.notified_at, p.whatsapp_sent_at, p.last_notification_at]) {
              if (col) {
                const t = new Date(col).getTime();
                if (Number.isFinite(t) && t > 0) candidates.push(t);
              }
            }
          }
        }
        if (candidates.length > 0) {
          latestTs = Math.max(...candidates);
          condominiumActivityStore.set(cleanCondoId, {
            lastActivityTimestamp: latestTs,
            lastAction: latestAction || "SYNC"
          });
        }
      }
      return res.json({
        success: true,
        condominiumId: cleanCondoId,
        lastActivityTimestamp: latestTs,
        action: latestAction
      });
    } catch (err) {
      console.error("Erro em GET /api/portaria/activity:", err);
      return res.status(500).json({ error: err?.message || "Erro ao consultar atividade" });
    }
  });
  app2.all("/api/cron/reminders", (_req, res) => {
    return res.status(410).json({
      success: false,
      disabled: true,
      processed: 0,
      sent: 0,
      message: "Funcionalidade de lembretes autom\xE1ticos ap\xF3s 48h e 72h foi removida/desativada."
    });
  });
  const processedWebhookEvents = /* @__PURE__ */ new Set();
  app2.get("/api/whatsapp/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";
    if (!mode || !token || typeof challenge !== "string") {
      return res.sendStatus(400);
    }
    if (!verifyToken) {
      return res.sendStatus(403);
    }
    if (mode === "subscribe" && typeof token === "string" && timingSafeCompare(token, verifyToken)) {
      console.log("WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });
  app2.post("/api/whatsapp/webhook", async (req, res) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET || "";
    if (!appSecret) {
      if (isProduction) {
        return res.status(503).json({ error: "WHATSAPP_APP_SECRET n\xE3o configurado no servidor." });
      }
      return res.status(401).json({ error: "Assinatura do webhook n\xE3o configurada." });
    }
    const signatureHeader = req.headers["x-hub-signature-256"];
    const rawBody = req.rawBody;
    if (!signatureHeader || typeof signatureHeader !== "string" || !rawBody) {
      return res.status(401).json({ error: "Assinatura X-Hub-Signature-256 ausente." });
    }
    const expectedSig = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    if (!timingSafeCompare(signatureHeader.trim(), expectedSig)) {
      return res.status(401).json({ error: "Assinatura do webhook inv\xE1lida." });
    }
    const body = req.body;
    if (!body || body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }
    try {
      const entries = Array.isArray(body.entry) ? body.entry : [];
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          if (!value) continue;
          if (Array.isArray(value.statuses)) {
            for (const statusUpdate of value.statuses) {
              const whatsappId = statusUpdate?.id;
              const status = statusUpdate?.status;
              if (!whatsappId || !status) continue;
              const statusEventKey = `status:${whatsappId}:${status}`;
              if (processedWebhookEvents.has(statusEventKey)) continue;
              const { data: existingStatusLog } = await supabaseAdmin.from("auditoria_eventos").select("id").eq("tipo_evento", "WHATSAPP_WEBHOOK_STATUS").eq("descricao", statusEventKey).maybeSingle();
              if (existingStatusLog) {
                processedWebhookEvents.add(statusEventKey);
                continue;
              }
              processedWebhookEvents.add(statusEventKey);
              await recordAuditEvent({
                condominio_id: null,
                usuario_nome: "WhatsApp Webhook",
                usuario_perfil: "sistema",
                tipo_evento: "WHATSAPP_WEBHOOK_STATUS",
                acao: "WEBHOOK",
                tabela_afetada: "message_logs",
                descricao: statusEventKey,
                metodo: "WEBHOOK",
                dados_depois: { whatsappId, status, recipient_id: statusUpdate?.recipient_id || null }
              });
            }
          }
          if (Array.isArray(value.messages)) {
            for (const message of value.messages) {
              const from = String(message?.from || "").trim();
              const msgId = message?.id ? String(message.id) : "";
              const msgEventKey = msgId ? `msg:${msgId}` : "";
              if (msgEventKey) {
                if (processedWebhookEvents.has(msgEventKey)) continue;
                const { data: existingMsgLog } = await supabaseAdmin.from("auditoria_eventos").select("id").eq("tipo_evento", "WHATSAPP_WEBHOOK_MSG").eq("descricao", msgEventKey).maybeSingle();
                if (existingMsgLog) {
                  processedWebhookEvents.add(msgEventKey);
                  continue;
                }
                processedWebhookEvents.add(msgEventKey);
              }
              const text = String(message?.text?.body || "").toLowerCase().trim();
              const phoneCandidates = normalizeBrazilPhoneCandidates(from);
              let resident = null;
              if (phoneCandidates.length > 0) {
                const { data: matchedResidents } = await supabaseAdmin.from("moradores").select("id, nome, unidade, telefone, condominium_id, ativo").in("telefone", phoneCandidates).eq("ativo", true).limit(1);
                resident = matchedResidents?.[0] || null;
              }
              let responseMessage = "";
              if (!resident) {
                responseMessage = "Desculpe, seu n\xFAmero n\xE3o est\xE1 cadastrado como morador em nosso sistema. Por favor, procure a administra\xE7\xE3o do condom\xEDnio.";
              } else {
                const { error: inboundErr } = await supabaseAdmin.from("whatsapp_conversations").insert([{
                  condominium_id: resident.condominium_id,
                  phone: from,
                  message: text,
                  direction: "inbound",
                  created_at: (/* @__PURE__ */ new Date()).toISOString()
                }]);
                if (inboundErr) {
                  console.warn("[Webhook] Erro ao registrar mensagem recebida:", inboundErr.message);
                }
                if (text.includes("oi") || text.includes("ol\xE1") || text.includes("menu")) {
                  responseMessage = `Ol\xE1, ${resident.nome.split(" ")[0]}! Bem-vindo ao Sistema de Encomendas Inteligentes.

Como posso ajudar hoje?
1. Ver minhas encomendas pendentes
2. Ver hist\xF3rico de entregas
3. Falar com a administra\xE7\xE3o

Voc\xEA tamb\xE9m pode perguntar 'tem encomenda?' ou 'minhas encomendas'.`;
                } else if (text === "1" || text.includes("encomenda")) {
                  const { data: packages } = await supabaseAdmin.from("packages").select("carrier, received_at").eq("recipient_id", resident.id).eq("condominium_id", resident.condominium_id).in("status", ["received", "notified"]).order("received_at", { ascending: false });
                  if (packages && packages.length > 0) {
                    responseMessage = `\u{1F4E6} Voc\xEA possui ${packages.length} encomenda${packages.length > 1 ? "s" : ""} aguardando retirada.

`;
                    packages.forEach((p) => {
                      responseMessage += `\u{1F4CD} Transportadora: ${p.carrier || "Portaria"}
\u{1F552} Recebido em: ${formatSafeDateTime(p.received_at)}

`;
                    });
                    responseMessage += "Retire na portaria quando desejar. Obrigado!";
                  } else {
                    responseMessage = "Voc\xEA n\xE3o tem encomendas pendentes no momento. \u{1F389}";
                  }
                } else if (text === "2" || text.includes("hist\xF3rico")) {
                  const { data: history } = await supabaseAdmin.from("packages").select("carrier, delivered_at").eq("recipient_id", resident.id).eq("condominium_id", resident.condominium_id).eq("status", "delivered").order("delivered_at", { ascending: false }).limit(5);
                  if (history && history.length > 0) {
                    responseMessage = "\u{1F552} Seu hist\xF3rico recente de retiradas:\n\n";
                    history.forEach((p) => {
                      responseMessage += `\u2705 ${p.carrier || "Encomenda"} - Entregue em ${formatSafeDate(p.delivered_at)}
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
              if (msgEventKey) {
                await recordAuditEvent({
                  condominio_id: resident?.condominium_id || null,
                  usuario_nome: "WhatsApp Webhook",
                  usuario_perfil: "sistema",
                  tipo_evento: "WHATSAPP_WEBHOOK_MSG",
                  acao: "WEBHOOK",
                  tabela_afetada: "whatsapp_conversations",
                  descricao: msgEventKey,
                  metodo: "WEBHOOK",
                  dados_depois: { from, msgId }
                });
              }
              if (responseMessage && resident) {
                await sendWhatsAppMessage(from, responseMessage, resident.condominium_id);
                const { error: outboundErr } = await supabaseAdmin.from("whatsapp_conversations").insert([{
                  condominium_id: resident.condominium_id,
                  phone: from,
                  message: responseMessage,
                  direction: "outbound",
                  created_at: (/* @__PURE__ */ new Date()).toISOString()
                }]);
                if (outboundErr) {
                  console.warn("[Webhook] Erro ao registrar resposta enviada:", outboundErr.message);
                }
              } else if (responseMessage) {
                await sendWhatsAppMessage(from, responseMessage, "");
              }
            }
          }
        }
      }
      return res.sendStatus(200);
    } catch (err) {
      console.error("[Webhook] Erro ao processar evento WhatsApp:", err);
      return res.status(500).json({ error: err?.message || "Erro ao processar webhook" });
    }
  });
  const validateAdminSession = async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { error: "N\xE3o autorizado", status: 401 };
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return { error: "N\xE3o autorizado", status: 401 };
    }
    if (token === "MOCK_TOKEN") {
      const allowMockTest = !isProduction && process.env.ALLOW_TEST_MOCK_AUTH === "true";
      if (!allowMockTest) {
        await recordAuditEvent({
          condominio_id: null,
          usuario_nome: "Desconhecido",
          usuario_perfil: "desconhecido",
          tipo_evento: "ADMIN_AUTH_RECUSADA",
          acao: "UNAUTHORIZED",
          tabela_afetada: "profiles",
          descricao: `Tentativa de acesso administrativo com token de simula\xE7\xE3o recusada.`,
          metodo: "ADMIN_AUTH"
        });
        return { error: "Token de simula\xE7\xE3o n\xE3o autorizado.", status: 401 };
      }
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        await recordAuditEvent({
          condominio_id: null,
          usuario_nome: "Desconhecido",
          usuario_perfil: "desconhecido",
          tipo_evento: "ADMIN_AUTH_RECUSADA",
          acao: "UNAUTHORIZED",
          tabela_afetada: "profiles",
          descricao: `Falha na verifica\xE7\xE3o de token administrativo no Supabase Auth.`,
          metodo: "ADMIN_AUTH"
        });
        return { error: "Sess\xE3o inv\xE1lida ou expirada.", status: 401 };
      }
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (profileError) {
        console.error("[validateAdminSession] Erro ao consultar perfil:", profileError.message || profileError);
        return { error: "Erro ao validar perfil administrativo.", status: 500 };
      }
      if (!profile) {
        await recordAuditEvent({
          condominio_id: null,
          usuario_id: user.id,
          usuario_nome: user.email || "Usu\xE1rio sem perfil",
          usuario_perfil: "sem_perfil",
          tipo_evento: "ADMIN_AUTH_RECUSADA",
          acao: "FORBIDDEN",
          tabela_afetada: "profiles",
          registro_id: user.id,
          descricao: `Acesso administrativo negado: usu\xE1rio autenticado n\xE3o possui perfil vinculado.`,
          metodo: "ADMIN_AUTH"
        });
        return { error: "Perfil administrativo n\xE3o encontrado.", status: 403 };
      }
      if (profile.active === false) {
        return { error: "Usu\xE1rio administrativo inativo.", status: 403 };
      }
      const rawRole = normalizeRoleValue(profile.role);
      if (!rawRole || rawRole === "porteiro" || rawRole === "concierge" || rawRole === "resident" || rawRole === "morador") {
        await recordAuditEvent({
          condominio_id: profile.condominium_id || null,
          usuario_id: profile.id,
          usuario_nome: profile.full_name || user.email || "Usu\xE1rio",
          usuario_perfil: profile.role || "porteiro",
          tipo_evento: "ADMIN_AUTH_RECUSADA",
          acao: "FORBIDDEN",
          tabela_afetada: "profiles",
          registro_id: profile.id,
          descricao: `Tentativa de opera\xE7\xE3o administrativa recusada para perfil "${profile.role}".`,
          metodo: "ADMIN_AUTH"
        });
        return { error: "Acesso negado. Apenas administradores e s\xEDndicos possuem permiss\xE3o administrativa.", status: 403 };
      }
      const isGlobalAdmin = rawRole === "admin" || rawRole === "administrador" || rawRole === "super_admin" || rawRole === "master";
      const isSindico = rawRole === "sindico" || rawRole === "manager";
      if (!isGlobalAdmin && !isSindico) {
        await recordAuditEvent({
          condominio_id: profile.condominium_id || null,
          usuario_id: profile.id,
          usuario_nome: profile.full_name || user.email || "Usu\xE1rio",
          usuario_perfil: profile.role || "",
          tipo_evento: "ADMIN_AUTH_RECUSADA",
          acao: "FORBIDDEN",
          tabela_afetada: "profiles",
          registro_id: profile.id,
          descricao: `Acesso administrativo negado para perfil n\xE3o autorizado: "${profile.role}".`,
          metodo: "ADMIN_AUTH"
        });
        return { error: "Acesso negado.", status: 403 };
      }
      return { adminUser: user, adminProfile: profile, isGlobalAdmin, isSindico };
    } catch (err) {
      console.error("[validateAdminSession Error]:", err?.message || err);
      return { error: err?.message || "Erro na valida\xE7\xE3o da sess\xE3o administrativa", status: 500 };
    }
  };
  app2.get("/api/admin/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin && !adminProfile?.condominium_id) {
      return res.status(403).json({ error: "Acesso negado: perfil administrativo sem condom\xEDnio vinculado." });
    }
    try {
      let query = supabaseAdmin.from("profiles").select("*").order("full_name");
      if (!isGlobalAdmin) {
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
  app2.get(["/api/admin/condominiums", "/api/admin/condominiums/"], async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin && !adminProfile?.condominium_id) {
      return res.status(403).json({ error: "Acesso negado: perfil administrativo sem condom\xEDnio vinculado." });
    }
    try {
      let query = supabaseAdmin.from("condominiums").select("*").order("created_at", { ascending: false });
      if (!isGlobalAdmin && adminProfile?.condominium_id) {
        query = query.eq("id", adminProfile.condominium_id);
      }
      const { data: condominiums, error } = await query;
      if (error) {
        console.error("Erro ao consultar condom\xEDnios:", error);
        throw error;
      }
      let profilesQuery = supabaseAdmin.from("profiles").select("id, condominium_id");
      let moradoresQuery = supabaseAdmin.from("moradores").select("id, condominium_id");
      let packagesQuery = supabaseAdmin.from("packages").select("id, condominium_id");
      let settingsQuery = supabaseAdmin.from("condominium_settings").select("condominium_id, portaria_name, portaria_access_code, active_portaria_token");
      if (!isGlobalAdmin && adminProfile?.condominium_id) {
        profilesQuery = profilesQuery.eq("condominium_id", adminProfile.condominium_id);
        moradoresQuery = moradoresQuery.eq("condominium_id", adminProfile.condominium_id);
        packagesQuery = packagesQuery.eq("condominium_id", adminProfile.condominium_id);
        settingsQuery = settingsQuery.eq("condominium_id", adminProfile.condominium_id);
      }
      const { data: allProfiles } = await profilesQuery;
      const { data: allMoradores } = await moradoresQuery;
      const { data: allPackages } = await packagesQuery;
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
      const { data: allSettings, error: settingsBatchErr } = await settingsQuery;
      if (settingsBatchErr) {
        console.error("Erro ao consultar configura\xE7\xF5es de portaria:", settingsBatchErr);
        return res.status(500).json({ error: "Erro ao consultar credenciais da portaria." });
      }
      const settingsMap = /* @__PURE__ */ new Map();
      (allSettings || []).forEach((s) => {
        if (s && s.condominium_id) settingsMap.set(s.condominium_id, s);
      });
      const enriched = await Promise.all((condominiums || []).map(async (c) => {
        const existingSetting = settingsMap.get(c.id);
        let creds;
        if (existingSetting && existingSetting.portaria_access_code && String(existingSetting.portaria_access_code).trim() !== "") {
          creds = {
            condominium_id: c.id,
            portaria_name: existingSetting.portaria_name || c.name,
            portaria_access_code: String(existingSetting.portaria_access_code).trim(),
            active_token: existingSetting.active_portaria_token || null,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          portariaStore.set(c.id, creds);
        } else {
          creds = await getOrInitPortariaCreds(c.id, c.name);
        }
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
  app2.get("/api/admin/condominiums/:id/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { id } = req.params;
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin && adminProfile?.condominium_id !== id) {
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
  app2.put("/api/admin/condominiums/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile, isGlobalAdmin } = session;
    const { id } = req.params;
    if (!isGlobalAdmin && adminProfile?.condominium_id !== id) {
      return res.status(403).json({ error: "Acesso negado: voc\xEA n\xE3o possui permiss\xE3o para atualizar este condom\xEDnio." });
    }
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
      const { data: currentCondo, error: curCondoErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
      if (curCondoErr) {
        return res.status(500).json({ error: curCondoErr.message || "Erro ao consultar condom\xEDnio." });
      }
      if (!currentCondo) {
        return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
      }
      const updateData = {
        name: name.trim(),
        address: address || ""
      };
      const resolvedCityState = city_state || (city && state ? `${city}/${state}` : void 0);
      if (resolvedCityState !== void 0) updateData.city_state = resolvedCityState;
      if (manager_name !== void 0) updateData.manager_name = manager_name;
      if (manager_phone !== void 0) updateData.manager_phone = manager_phone;
      if (manager_email !== void 0) updateData.manager_email = manager_email;
      if (rules !== void 0) updateData.rules = rules;
      if (internal_notes !== void 0) updateData.internal_notes = internal_notes;
      if (typeof active === "boolean") {
        const currentActive = currentCondo.active !== false;
        if (active !== currentActive && !isGlobalAdmin) {
          return res.status(403).json({ error: "Acesso negado: apenas administradores globais podem ativar ou bloquear condom\xEDnios." });
        }
        if (isGlobalAdmin) {
          updateData.active = active;
        }
      }
      let updateRes = await supabaseAdmin.from("condominiums").update(updateData).eq("id", id).select().single();
      if (updateRes.error && isMissingColumnSchemaError(updateRes.error)) {
        console.warn("[PUT /api/admin/condominiums/:id] Colunas estendidas ausentes no banco, aplicando fallback m\xEDnimo.");
        const minimalPatch = {
          name: updateData.name,
          address: updateData.address,
          ...updateData.active !== void 0 ? { active: updateData.active } : {}
        };
        updateRes = await supabaseAdmin.from("condominiums").update(minimalPatch).eq("id", id).select().single();
      }
      const { data: updatedCondo, error: updateErr } = updateRes;
      if (updateErr || !updatedCondo) {
        return res.status(500).json({ error: updateErr?.message || "Erro ao atualizar condom\xEDnio no banco de dados." });
      }
      if (updateData.active === false) {
        const { error: revokeErr } = await supabaseAdmin.from("condominium_settings").update({ active_portaria_token: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("condominium_id", id);
        if (!revokeErr) {
          const cached = portariaStore.get(id);
          if (cached) {
            portariaStore.set(id, { ...cached, active_token: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
          }
        }
      }
      const { error: auditErr } = await supabaseAdmin.from("auditoria_eventos").insert({
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: "CONDOMINIO_ATUALIZADO",
        acao: "UPDATE",
        tabela_afetada: "condominiums",
        registro_id: id,
        descricao: `Condom\xEDnio ${name.trim()} atualizado pelo administrador.`,
        metodo: "ADMIN_ACTION",
        dados_depois: updateData
      });
      if (auditErr) {
        console.warn("[DEBUG BACKEND] Erro ao registrar auditoria (PUT condom\xEDnio):", auditErr.message);
      }
      res.json({ success: true, condominium: updatedCondo });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro ao atualizar condom\xEDnio:", err);
      res.status(500).json({ error: err.message || "Erro ao atualizar condom\xEDnio" });
    }
  });
  app2.patch("/api/admin/condominiums/:id/status", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    const { id } = req.params;
    const { active } = req.body || {};
    if (!isGlobalAdmin) {
      await recordAuditEvent({
        condominio_id: id,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Usu\xE1rio",
        usuario_perfil: adminProfile?.role || "",
        tipo_evento: "ADMIN_AUTH_RECUSADA",
        acao: "FORBIDDEN",
        tabela_afetada: "condominiums",
        registro_id: id,
        descricao: `Tentativa sem permiss\xE3o global de alterar status do condom\xEDnio.`,
        metodo: "ADMIN_ACTION"
      });
      return res.status(403).json({ error: "Acesso negado: apenas administradores globais podem ativar ou bloquear condom\xEDnios." });
    }
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "Informe um valor booleano v\xE1lido para 'active'." });
    }
    try {
      const { data: existingCondo, error: fetchErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
      if (fetchErr) {
        return res.status(500).json({ error: `Erro ao consultar condom\xEDnio: ${fetchErr.message}` });
      }
      if (!existingCondo) {
        return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
      }
      const previousActive = existingCondo.active !== false;
      const { data: updatedCondo, error: updateErr } = await supabaseAdmin.from("condominiums").update({ active }).eq("id", id).select("*").single();
      if (updateErr || !updatedCondo) {
        return res.status(500).json({ error: `Erro ao atualizar status do condom\xEDnio no banco de dados: ${updateErr?.message || "registro n\xE3o confirmado"}` });
      }
      if (!active) {
        const { data: existingSettings, error: settingsCheckErr } = await supabaseAdmin.from("condominium_settings").select("condominium_id").eq("condominium_id", id).maybeSingle();
        if (settingsCheckErr) {
          await supabaseAdmin.from("condominiums").update({ active: previousActive }).eq("id", id);
          await recordAuditEvent({
            condominio_id: id,
            usuario_id: adminProfile?.id || null,
            usuario_nome: adminProfile?.full_name || "Admin",
            usuario_perfil: adminProfile?.role || "admin",
            tipo_evento: "CONDOMINIO_INATIVACAO_FALHA_REVOGACAO",
            acao: "ROLLBACK",
            tabela_afetada: "condominium_settings",
            registro_id: id,
            descricao: `Falha ao verificar sess\xE3o da portaria durante inativa\xE7\xE3o de ${updatedCondo.name}. Status revertido.`,
            metodo: "ADMIN_ACTION"
          });
          return res.status(500).json({ error: "Falha ao verificar sess\xE3o da portaria para revoga\xE7\xE3o. O bloqueio n\xE3o foi conclu\xEDdo." });
        }
        if (existingSettings) {
          const { data: revokedSetting, error: revokeErr } = await supabaseAdmin.from("condominium_settings").update({
            active_portaria_token: null,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("condominium_id", id).select("condominium_id, active_portaria_token").single();
          if (revokeErr || !revokedSetting || revokedSetting.active_portaria_token !== null) {
            await supabaseAdmin.from("condominiums").update({ active: previousActive }).eq("id", id);
            await recordAuditEvent({
              condominio_id: id,
              usuario_id: adminProfile?.id || null,
              usuario_nome: adminProfile?.full_name || "Admin",
              usuario_perfil: adminProfile?.role || "admin",
              tipo_evento: "CONDOMINIO_INATIVACAO_FALHA_REVOGACAO",
              acao: "ROLLBACK",
              tabela_afetada: "condominium_settings",
              registro_id: id,
              descricao: `Falha ao revogar sess\xE3o da portaria de ${updatedCondo.name}: ${revokeErr?.message || "token n\xE3o revogado"}. Status do condom\xEDnio revertido.`,
              metodo: "ADMIN_ACTION"
            });
            return res.status(500).json({ error: "Falha ao revogar a sess\xE3o da portaria no banco de dados. O bloqueio do condom\xEDnio foi revertido." });
          }
        }
        if (portariaStore.has(id)) {
          const creds = portariaStore.get(id);
          creds.active_token = null;
          portariaStore.set(id, creds);
        }
        await recordAuditEvent([
          {
            condominio_id: id,
            usuario_id: adminProfile?.id || null,
            usuario_nome: adminProfile?.full_name || "Admin",
            usuario_perfil: adminProfile?.role || "admin",
            tipo_evento: "PORTARIA_BLOQUEIO_REMOTO",
            acao: "DISCONNECT",
            tabela_afetada: "condominium_settings",
            registro_id: id,
            descricao: `Desativa\xE7\xE3o remota confirmada para o condom\xEDnio ${updatedCondo.name}. Sess\xE3o de portaria revogada no banco.`,
            metodo: "ADMIN_ACTION"
          },
          {
            condominio_id: id,
            usuario_id: adminProfile?.id || null,
            usuario_nome: adminProfile?.full_name || "Admin",
            usuario_perfil: adminProfile?.role || "admin",
            tipo_evento: "CONDOMINIO_INATIVADO",
            acao: "UPDATE",
            tabela_afetada: "condominiums",
            registro_id: id,
            descricao: `Status do condom\xEDnio ${updatedCondo.name} alterado para INATIVO com revoga\xE7\xE3o da Portaria confirmada.`,
            metodo: "ADMIN_ACTION"
          }
        ]);
      } else {
        if (portariaStore.has(id)) {
          const creds = portariaStore.get(id);
          creds.active_token = null;
          portariaStore.set(id, creds);
        }
        await recordAuditEvent({
          condominio_id: id,
          usuario_id: adminProfile?.id || null,
          usuario_nome: adminProfile?.full_name || "Admin",
          usuario_perfil: adminProfile?.role || "admin",
          tipo_evento: "CONDOMINIO_ATIVADO",
          acao: "UPDATE",
          tabela_afetada: "condominiums",
          registro_id: id,
          descricao: `Condom\xEDnio ${updatedCondo.name} reativado. C\xF3digo de acesso preservado e nova autentica\xE7\xE3o da portaria exigida.`,
          metodo: "ADMIN_ACTION"
        });
      }
      res.json({ success: true, condominium: updatedCondo });
    } catch (err) {
      res.status(500).json({ error: err?.message || "Erro ao alterar status" });
    }
  });
  app2.delete("/api/admin/condominiums/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin) {
      return res.status(403).json({ error: "Acesso negado: apenas administradores globais podem excluir condom\xEDnios." });
    }
    const { id } = req.params;
    const forceDelete = req.query.force === "true";
    try {
      const { data: condo, error: fetchErr } = await supabaseAdmin.from("condominiums").select("*").eq("id", id).maybeSingle();
      if (fetchErr) {
        return res.status(500).json({ error: `Erro ao consultar condom\xEDnio: ${fetchErr.message}` });
      }
      if (!condo) {
        return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
      }
      const [
        { count: userCount, error: userCountErr },
        { count: packageCount, error: pkgCountErr },
        { count: residentCount, error: resCountErr },
        { count: convCount, error: convCountErr }
      ] = await Promise.all([
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("condominium_id", id),
        supabaseAdmin.from("packages").select("id", { count: "exact", head: true }).eq("condominium_id", id),
        supabaseAdmin.from("moradores").select("id", { count: "exact", head: true }).eq("condominium_id", id),
        supabaseAdmin.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("condominium_id", id)
      ]);
      if (userCountErr || pkgCountErr || resCountErr || convCountErr) {
        return res.status(500).json({
          error: "Erro ao verificar depend\xEAncias do condom\xEDnio antes da exclus\xE3o."
        });
      }
      const uCount = userCount || 0;
      const pCount = packageCount || 0;
      const rCount = residentCount || 0;
      const cCount = convCount || 0;
      if (!forceDelete && (uCount > 0 || pCount > 0 || rCount > 0 || cCount > 0)) {
        return res.status(400).json({
          error: `Este condom\xEDnio possui ${uCount} usu\xE1rio(s), ${rCount} morador(es) e ${pCount} encomenda(s) vinculada(s). Confirme para remover o condom\xEDnio e desvincular os registros.`,
          hasDependencies: true,
          userCount: uCount,
          packageCount: pCount,
          residentCount: rCount,
          conversationCount: cCount
        });
      }
      const { error: settingsDelErr } = await supabaseAdmin.from("condominium_settings").delete().eq("condominium_id", id);
      if (settingsDelErr) {
        return res.status(500).json({ error: `Erro ao remover configura\xE7\xF5es do condom\xEDnio: ${settingsDelErr.message}` });
      }
      if (cCount > 0) {
        const { error: convDelErr } = await supabaseAdmin.from("whatsapp_conversations").delete().eq("condominium_id", id);
        if (convDelErr) {
          return res.status(500).json({ error: `Erro ao remover conversas WhatsApp do condom\xEDnio: ${convDelErr.message}` });
        }
      }
      if (rCount > 0) {
        const { data: condoResidents, error: resFetchErr } = await supabaseAdmin.from("moradores").select("id").eq("condominium_id", id);
        if (resFetchErr) {
          return res.status(500).json({ error: `Erro ao listar moradores do condom\xEDnio: ${resFetchErr.message}` });
        }
        const residentIds = (condoResidents || []).map((r) => r.id).filter(Boolean);
        if (residentIds.length > 0) {
          const { error: tokDelErr } = await supabaseAdmin.from("resident_access_tokens").delete().in("resident_id", residentIds);
          if (tokDelErr) {
            return res.status(500).json({ error: `Erro ao remover tokens dos moradores: ${tokDelErr.message}` });
          }
        }
      }
      if (pCount > 0) {
        const { error: pkgDelErr } = await supabaseAdmin.from("packages").delete().eq("condominium_id", id);
        if (pkgDelErr) {
          return res.status(500).json({ error: `Erro ao remover encomendas do condom\xEDnio: ${pkgDelErr.message}` });
        }
      }
      if (rCount > 0) {
        const { error: resDelErr } = await supabaseAdmin.from("moradores").delete().eq("condominium_id", id);
        if (resDelErr) {
          return res.status(500).json({ error: `Erro ao remover moradores do condom\xEDnio: ${resDelErr.message}` });
        }
      }
      if (uCount > 0) {
        const { error: profUnlinkErr } = await supabaseAdmin.from("profiles").update({ condominium_id: null }).eq("condominium_id", id);
        if (profUnlinkErr) {
          return res.status(500).json({ error: `Erro ao desvincular usu\xE1rios do condom\xEDnio: ${profUnlinkErr.message}` });
        }
      }
      const { error: auditUnlinkErr } = await supabaseAdmin.from("auditoria_eventos").update({ condominio_id: null }).eq("condominio_id", id);
      if (auditUnlinkErr) {
        return res.status(500).json({ error: `Erro ao desvincular auditoria do condom\xEDnio: ${auditUnlinkErr.message}` });
      }
      const { error: deleteErr } = await supabaseAdmin.from("condominiums").delete().eq("id", id);
      if (deleteErr) {
        return res.status(500).json({ error: `Erro ao excluir condom\xEDnio: ${deleteErr.message}` });
      }
      portariaStore.delete(id);
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
      if (auditError) {
        console.warn("[DEBUG BACKEND] Erro ao gravar auditoria de exclus\xE3o de condom\xEDnio:", auditError.message);
      }
      res.json({ success: true, message: `Condom\xEDnio "${condo.name}" foi exclu\xEDdo com sucesso.` });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro ao excluir condom\xEDnio:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/integrity-check", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    if (!session.isGlobalAdmin) {
      return res.status(403).json({ error: "Acesso negado: apenas administradores globais podem consultar a integridade da base." });
    }
    if (req.query.repair === "true") {
      return res.status(405).json({
        error: "GET /api/admin/integrity-check \xE9 estritamente somente leitura. Utilize POST /api/admin/integrity-repair com confirma\xE7\xE3o expl\xEDcita."
      });
    }
    try {
      const [
        { count: totalCondos, error: err1 },
        { count: totalProfiles, error: err2 },
        { count: totalMoradores, error: err3 },
        { count: totalPackages, error: err4 },
        { data: allCondos, error: err5 }
      ] = await Promise.all([
        supabaseAdmin.from("condominiums").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("moradores").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("packages").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("condominiums").select("id, name")
      ]);
      if (err1 || err2 || err3 || err4 || err5) {
        return res.status(500).json({ error: "Erro ao consultar m\xE9tricas de integridade." });
      }
      const validCondoIds = new Set((allCondos || []).map((c) => c.id));
      const [
        { data: profiles, error: pErr },
        { data: moradores, error: mErr },
        { data: packages, error: pkErr }
      ] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name, condominium_id"),
        supabaseAdmin.from("moradores").select("id, nome, condominium_id"),
        supabaseAdmin.from("packages").select("id, tracking_code, condominium_id")
      ]);
      if (pErr || mErr || pkErr) {
        return res.status(500).json({ error: "Erro ao analisar refer\xEAncias \xF3rf\xE3s no banco." });
      }
      const orphanedProfiles = (profiles || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
      const orphanedMoradores = (moradores || []).filter((m) => m.condominium_id && !validCondoIds.has(m.condominium_id));
      const orphanedPackages = (packages || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
      const totalInconsistencies = orphanedProfiles.length + orphanedMoradores.length + orphanedPackages.length;
      const healthStatus = totalInconsistencies === 0 ? "HEALTHY" : "INCONSISTENCY_DETECTED";
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
        repaired: null
      });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro ao verificar integridade:", err);
      res.status(500).json({ error: err.message || "Erro na verifica\xE7\xE3o de integridade" });
    }
  });
  app2.post("/api/admin/integrity-repair", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin) {
      return res.status(403).json({ error: "Acesso negado: apenas administradores globais podem executar reparo de integridade." });
    }
    const {
      confirm,
      repairProfiles = true,
      repairMoradores = false,
      repairPackages = false
    } = req.body || {};
    if (confirm !== true) {
      return res.status(400).json({
        error: "Confirma\xE7\xE3o expl\xEDcita obrigat\xF3ria: envie { confirm: true } para executar o reparo."
      });
    }
    try {
      const [
        { data: allCondos, error: cErr },
        { data: profiles, error: pErr },
        { data: moradores, error: mErr },
        { data: packages, error: pkErr }
      ] = await Promise.all([
        supabaseAdmin.from("condominiums").select("id"),
        supabaseAdmin.from("profiles").select("id, condominium_id"),
        supabaseAdmin.from("moradores").select("id, condominium_id"),
        supabaseAdmin.from("packages").select("id, condominium_id")
      ]);
      if (cErr || pErr || mErr || pkErr) {
        return res.status(500).json({ error: "Erro ao consultar registros antes do reparo." });
      }
      const validCondoIds = new Set((allCondos || []).map((c) => c.id));
      const orphanedProfiles = (profiles || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
      const orphanedMoradores = (moradores || []).filter((m) => m.condominium_id && !validCondoIds.has(m.condominium_id));
      const orphanedPackages = (packages || []).filter((p) => p.condominium_id && !validCondoIds.has(p.condominium_id));
      const beforeCounts = {
        orphanedProfiles: orphanedProfiles.length,
        orphanedMoradores: orphanedMoradores.length,
        orphanedPackages: orphanedPackages.length
      };
      const repairedCount = { profiles: 0, moradores: 0, packages: 0 };
      if (repairProfiles && orphanedProfiles.length > 0) {
        const orphanIds = orphanedProfiles.map((p) => p.id);
        const { error: updErr } = await supabaseAdmin.from("profiles").update({ condominium_id: null }).in("id", orphanIds);
        if (updErr) {
          return res.status(500).json({ error: `Falha ao desvincular perfis \xF3rf\xE3os: ${updErr.message}` });
        }
        repairedCount.profiles = orphanIds.length;
      }
      if (repairMoradores && orphanedMoradores.length > 0) {
        const orphanIds = orphanedMoradores.map((m) => m.id);
        const { error: tokErr } = await supabaseAdmin.from("resident_access_tokens").delete().in("resident_id", orphanIds);
        if (tokErr) {
          return res.status(500).json({ error: `Falha ao limpar tokens de moradores \xF3rf\xE3os: ${tokErr.message}` });
        }
        const { error: delErr } = await supabaseAdmin.from("moradores").delete().in("id", orphanIds);
        if (delErr) {
          return res.status(500).json({ error: `Falha ao remover moradores \xF3rf\xE3os: ${delErr.message}` });
        }
        repairedCount.moradores = orphanIds.length;
      }
      if (repairPackages && orphanedPackages.length > 0) {
        const orphanIds = orphanedPackages.map((p) => p.id);
        const { error: delPkgErr } = await supabaseAdmin.from("packages").delete().in("id", orphanIds);
        if (delPkgErr) {
          return res.status(500).json({ error: `Falha ao remover encomendas \xF3rf\xE3s: ${delPkgErr.message}` });
        }
        repairedCount.packages = orphanIds.length;
      }
      await recordAuditEvent({
        condominio_id: null,
        usuario_id: adminProfile?.id || null,
        usuario_nome: adminProfile?.full_name || "Admin",
        usuario_perfil: adminProfile?.role || "admin",
        tipo_evento: "INTEGRIDADE_REPARADA",
        acao: "REPAIR",
        tabela_afetada: "profiles",
        descricao: `Reparo de integridade executado com confirma\xE7\xE3o expl\xEDcita.`,
        metodo: "ADMIN_ACTION",
        dados_antes: beforeCounts,
        dados_depois: repairedCount
      });
      return res.json({
        success: true,
        before: beforeCounts,
        repaired: repairedCount
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Erro ao reparar integridade." });
    }
  });
  app2.post("/api/admin/backup-snapshot", async (req, res) => {
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
  app2.get("/api/admin/backup-history", async (req, res) => {
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
  app2.post("/api/admin/users", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin) {
      return res.status(403).json({ error: "Acesso negado. Apenas o administrador pode criar novos acessos de usu\xE1rios." });
    }
    const { email, password, full_name, phone, role, condominium_id, horario_inicio, horario_fim, escala_tipo } = req.body || {};
    if (!full_name || String(full_name).trim() === "") {
      return res.status(400).json({ error: "O nome completo \xE9 obrigat\xF3rio." });
    }
    const validRoles = ["admin", "sindico", "porteiro", "resident"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: "Perfil de usu\xE1rio inv\xE1lido." });
    }
    if ((role === "sindico" || role === "porteiro") && !condominium_id) {
      return res.status(400).json({ error: "O condom\xEDnio vinculado \xE9 obrigat\xF3rio para s\xEDndicos e porteiros." });
    }
    let cleanEmail = email ? String(email).trim().toLowerCase() : "";
    if (!cleanEmail) {
      if (role === "porteiro") {
        const slugName = String(full_name).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        const randomSuffix = generateSecureHexToken(2);
        cleanEmail = `porteiro.${slugName || "operacional"}.${Date.now().toString(36)}.${randomSuffix}@sistema.encomendas`;
      } else {
        return res.status(400).json({ error: "O e-mail \xE9 obrigat\xF3rio para criar este tipo de usu\xE1rio." });
      }
    }
    try {
      if (phone && String(phone).trim() !== "") {
        const { data: existingPhone, error: phoneErr } = await supabaseAdmin.from("profiles").select("id, phone").eq("phone", String(phone).trim()).maybeSingle();
        if (phoneErr) {
          return res.status(500).json({ error: "Erro ao verificar duplicidade de telefone." });
        }
        if (existingPhone) {
          return res.status(409).json({ error: "Este telefone j\xE1 est\xE1 cadastrado para outro usu\xE1rio." });
        }
      }
      if (condominium_id) {
        const { data: condoExist, error: condoErr } = await supabaseAdmin.from("condominiums").select("id").eq("id", condominium_id).maybeSingle();
        if (condoErr) {
          return res.status(500).json({ error: "Erro ao validar o condom\xEDnio informado." });
        }
        if (!condoExist) {
          return res.status(400).json({ error: "O condom\xEDnio informado n\xE3o existe." });
        }
      }
      const tempPassword = password && String(password).trim() !== "" ? String(password).trim() : generateSecureTempPasswordServer(12);
      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: String(full_name).trim(), role }
      });
      if (createError) {
        if (createError.message.includes("already registered") || createError.message.includes("already exists") || createError.message.includes("unique constraint")) {
          return res.status(409).json({ error: "Este e-mail j\xE1 est\xE1 cadastrado no sistema de autentica\xE7\xE3o." });
        }
        throw createError;
      }
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").insert([{
        id: authData.user.id,
        full_name: String(full_name).trim(),
        phone: phone ? String(phone).trim() : null,
        role,
        condominium_id: condominium_id || null,
        active: true,
        must_change_password: true,
        horario_inicio: horario_inicio || null,
        horario_fim: horario_fim || null,
        escala_tipo: escala_tipo || null,
        created_by: adminUser.id
      }]).select().single();
      if (profileError) {
        console.error("[DEBUG BACKEND] Erro ao criar perfil, executando rollback no Auth:", profileError);
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {
        });
        throw profileError;
      }
      const profileWithEmail = { ...profile, email: cleanEmail };
      const { error: auditErr } = await supabaseAdmin.from("auditoria_eventos").insert({
        condominio_id: condominium_id || adminProfile.condominium_id || null,
        usuario_id: adminUser.id,
        usuario_nome: adminProfile.full_name || "Admin",
        usuario_perfil: adminProfile.role || "admin",
        tipo_evento: "USUARIO_CRIADO",
        acao: "CREATE",
        tabela_afetada: "profiles",
        registro_id: authData.user.id,
        descricao: `Usu\xE1rio ${String(full_name).trim()} (${cleanEmail}) cadastrado com perfil ${role} e senha tempor\xE1ria gerada.`,
        metodo: "ADMIN_ACTION",
        dados_depois: { id: authData.user.id, email: cleanEmail, full_name: String(full_name).trim(), role, condominium_id }
      });
      if (auditErr) {
        console.warn("[DEBUG BACKEND] Erro ao registrar auditoria de cria\xE7\xE3o de usu\xE1rio:", auditErr.message);
      }
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
  const handleUpdateAdminUser = async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile, isGlobalAdmin } = session;
    const { id } = req.params;
    const { full_name, phone, role, condominium_id, active, horario_inicio, horario_fim, escala_tipo } = req.body || {};
    if (role !== void 0 && !["admin", "sindico", "porteiro", "resident"].includes(role)) {
      return res.status(400).json({ error: "Perfil de usu\xE1rio inv\xE1lido." });
    }
    const { data: targetProfile, error: targetErr } = await supabaseAdmin.from("profiles").select("id, role, condominium_id, full_name, active").eq("id", id).maybeSingle();
    if (targetErr) {
      return res.status(500).json({ error: `Erro ao consultar usu\xE1rio: ${targetErr.message}` });
    }
    if (!targetProfile) return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado." });
    if (!isGlobalAdmin) {
      if (!adminProfile.condominium_id || targetProfile.condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "S\xEDndicos s\xF3 podem editar usu\xE1rios do seu pr\xF3prio condom\xEDnio." });
      }
      const targetNormRole = normalizeRoleValue(targetProfile.role);
      if (["admin", "administrador", "super_admin", "master", "sindico", "manager"].includes(targetNormRole)) {
        return res.status(403).json({ error: "S\xEDndicos n\xE3o podem editar outros s\xEDndicos ou administradores." });
      }
      if (condominium_id !== void 0 && condominium_id !== adminProfile.condominium_id) {
        return res.status(403).json({ error: "S\xEDndicos n\xE3o podem mover usu\xE1rios para outros condom\xEDnios." });
      }
      if (role !== void 0 && role !== "porteiro" && role !== "resident") {
        return res.status(403).json({ error: "S\xEDndicos s\xF3 podem atribuir perfis de porteiro ou morador." });
      }
    }
    try {
      if (condominium_id) {
        const { data: condoExist, error: condoErr } = await supabaseAdmin.from("condominiums").select("id").eq("id", condominium_id).maybeSingle();
        if (condoErr) {
          return res.status(500).json({ error: "Erro ao validar o condom\xEDnio informado." });
        }
        if (!condoExist) {
          return res.status(400).json({ error: "O condom\xEDnio informado n\xE3o existe." });
        }
      }
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
      if (escala_tipo !== void 0) updateData.escala_tipo = escala_tipo || null;
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update(updateData).eq("id", id).select().single();
      if (profileError || !profile) {
        return res.status(500).json({ error: profileError?.message || "Erro ao atualizar perfil no banco." });
      }
      if (active === false) {
        try {
          await supabaseAdmin.auth.admin.signOut(id);
        } catch {
        }
      }
      await recordAuditEvent({
        condominio_id: profile.condominium_id || adminProfile.condominium_id || null,
        usuario_id: adminUser.id,
        usuario_nome: adminProfile.full_name || "Admin",
        usuario_perfil: adminProfile.role || "admin",
        tipo_evento: "USUARIO_EDITADO",
        acao: "UPDATE",
        tabela_afetada: "profiles",
        registro_id: id,
        descricao: `Usu\xE1rio ${profile.full_name || id} atualizado pelo administrador.`,
        metodo: "ADMIN_ACTION",
        dados_antes: targetProfile,
        dados_depois: profile
      });
      res.json({ profile });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro fatal no PATCH/PUT /api/admin/users/:id:", err);
      res.status(500).json({ error: err.message });
    }
  };
  app2.patch("/api/admin/users/:id", handleUpdateAdminUser);
  app2.put("/api/admin/users/:id", handleUpdateAdminUser);
  app2.post("/api/admin/users/:id/reset-password", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminProfile, isGlobalAdmin } = session;
    if (!isGlobalAdmin) {
      return res.status(403).json({ error: "Acesso negado. Apenas o administrador pode gerar ou redefinir credenciais de acesso." });
    }
    const { id } = req.params;
    const { newPassword } = req.body || {};
    if (newPassword !== void 0 && String(newPassword).trim().length > 0 && String(newPassword).trim().length < 6) {
      return res.status(400).json({ error: "A senha tempor\xE1ria deve ter pelo menos 6 caracteres." });
    }
    const tempPassword = newPassword && String(newPassword).trim().length >= 6 ? String(newPassword).trim() : generateSecureTempPasswordServer(12);
    try {
      const { data: pData, error: pErr } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id").eq("id", id).maybeSingle();
      if (pErr) {
        return res.status(500).json({ error: `Erro ao consultar usu\xE1rio: ${pErr.message}` });
      }
      if (!pData) {
        const { data: mData } = await supabaseAdmin.from("moradores").select("id, nome").eq("id", id).maybeSingle();
        if (mData) {
          return res.status(400).json({
            error: "Este morador n\xE3o possui conta de autentica\xE7\xE3o vinculada em profiles/Auth."
          });
        }
        return res.status(404).json({ error: "Este usu\xE1rio n\xE3o possui conta de acesso." });
      }
      const targetProfile = { ...pData, email: "" };
      try {
        const { data: { user: aUser } } = await supabaseAdmin.auth.admin.getUserById(id);
        if (aUser?.email) targetProfile.email = aUser.email;
      } catch {
      }
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        password: tempPassword
      });
      if (authError) {
        return res.status(500).json({
          error: `Falha ao redefinir senha no sistema de autentica\xE7\xE3o: ${authError.message}`
        });
      }
      try {
        await supabaseAdmin.auth.admin.signOut(id);
      } catch (soErr) {
        console.warn("[DEBUG BACKEND] Aviso ao invalidar sess\xF5es ap\xF3s reset:", soErr?.message);
      }
      const { error: profileError } = await supabaseAdmin.from("profiles").update({
        must_change_password: true,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", id);
      if (profileError) {
        return res.status(500).json({
          error: `Senha atualizada no Auth, mas falhou ao atualizar perfil: ${profileError.message}`
        });
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
  app2.post("/api/auth/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    }
    const isMockToken = token === "MOCK_TOKEN";
    if (!token || isMockToken && !(!isProduction && process.env.ALLOW_TEST_MOCK_AUTH === "true")) {
      return res.status(401).json({ error: "Sess\xE3o inv\xE1lida. Fa\xE7a login novamente." });
    }
    try {
      const { data: authData, error: authUserErr } = await supabase.auth.getUser(token);
      if (authUserErr || !authData?.user) {
        return res.status(401).json({ error: "Sess\xE3o inv\xE1lida ou expirada." });
      }
      const targetUserId = authData.user.id;
      const { data: existingProfile, error: profCheckErr } = await supabaseAdmin.from("profiles").select("id, full_name, role, condominium_id, active").eq("id", targetUserId).maybeSingle();
      if (profCheckErr) {
        return res.status(500).json({ error: `Erro ao validar perfil: ${profCheckErr.message}` });
      }
      if (!existingProfile || existingProfile.active === false) {
        return res.status(403).json({ error: "Usu\xE1rio inativo ou sem perfil ativo no sistema." });
      }
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password: newPassword
      });
      if (authError) {
        return res.status(500).json({ error: `Erro ao atualizar senha no sistema de autentica\xE7\xE3o: ${authError.message}` });
      }
      const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").update({
        must_change_password: false,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", targetUserId).select().single();
      if (profileError || !profile) {
        return res.status(500).json({ error: `Erro ao atualizar status da senha no perfil: ${profileError?.message || "registro n\xE3o atualizado"}` });
      }
      const { error: auditErr } = await supabaseAdmin.from("auditoria_eventos").insert({
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
      if (auditErr) {
        console.warn("[DEBUG BACKEND] Erro ao registrar auditoria de troca de senha:", auditErr.message);
      }
      res.json({ success: true, profile, message: "Senha alterada com sucesso!" });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro ao alterar senha:", err);
      res.status(500).json({ error: err.message || "Erro ao alterar senha." });
    }
  });
  app2.delete("/api/admin/users/:id", async (req, res) => {
    const session = await validateAdminSession(req);
    if ("error" in session) return res.status(session.status).json({ error: session.error });
    const { adminUser, adminProfile, isGlobalAdmin } = session;
    const { id } = req.params;
    if (id === adminProfile.id || id === adminUser.id) {
      return res.status(400).json({ error: "Voc\xEA n\xE3o pode excluir seu pr\xF3prio usu\xE1rio." });
    }
    try {
      let targetProfile = null;
      let targetTable = "profiles";
      const { data: profileData, error: pErr } = await supabaseAdmin.from("profiles").select("*").eq("id", id).maybeSingle();
      if (pErr) {
        return res.status(500).json({ error: `Erro ao consultar usu\xE1rio: ${pErr.message}` });
      }
      if (profileData) {
        targetProfile = profileData;
        targetTable = "profiles";
      } else {
        const { data: moradorData, error: mErr } = await supabaseAdmin.from("moradores").select("*").eq("id", id).maybeSingle();
        if (mErr) {
          return res.status(500).json({ error: `Erro ao consultar morador: ${mErr.message}` });
        }
        if (moradorData) {
          targetProfile = {
            id: moradorData.id,
            full_name: moradorData.nome,
            email: moradorData.email || "",
            role: "resident",
            condominium_id: moradorData.condominium_id,
            ativo: moradorData.ativo
          };
          targetTable = "moradores";
        }
      }
      if (!targetProfile) {
        return res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado no banco de dados." });
      }
      if (!isGlobalAdmin) {
        if (!adminProfile.condominium_id || targetProfile.condominium_id !== adminProfile.condominium_id) {
          return res.status(403).json({ error: "S\xEDndicos s\xF3 podem excluir usu\xE1rios do seu pr\xF3prio condom\xEDnio." });
        }
        const targetNormRole = normalizeRoleValue(targetProfile.role);
        if (["admin", "administrador", "super_admin", "master", "sindico", "manager"].includes(targetNormRole)) {
          return res.status(403).json({ error: "S\xEDndicos n\xE3o podem excluir outros s\xEDndicos ou administradores." });
        }
      }
      const [
        { count: recipientPkgCount, error: cErr1 },
        { count: receivedPkgCount, error: cErr2 },
        { count: retrievedPkgCount, error: cErr3 },
        { count: retrievalLogCount, error: cErr4 }
      ] = await Promise.all([
        supabaseAdmin.from("packages").select("id", { count: "exact", head: true }).eq("recipient_id", id),
        supabaseAdmin.from("packages").select("id", { count: "exact", head: true }).eq("received_by", id),
        supabaseAdmin.from("packages").select("id", { count: "exact", head: true }).eq("retrieved_by_user_id", id),
        supabaseAdmin.from("retrieval_logs").select("id", { count: "exact", head: true }).eq("porter_id", id)
      ]);
      if (cErr1 || cErr2 || cErr3 || cErr4) {
        return res.status(500).json({ error: "Erro ao verificar hist\xF3rico operacional do usu\xE1rio antes da exclus\xE3o." });
      }
      const historyCount = (recipientPkgCount || 0) + (receivedPkgCount || 0) + (retrievedPkgCount || 0) + (retrievalLogCount || 0);
      if (historyCount > 0) {
        if (targetTable === "profiles") {
          const { error: inactErr } = await supabaseAdmin.from("profiles").update({
            active: false,
            updated_by: adminUser.id,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", id);
          if (inactErr) {
            return res.status(500).json({ error: `N\xE3o foi poss\xEDvel inativar o usu\xE1rio: ${inactErr.message}` });
          }
          try {
            await supabaseAdmin.auth.admin.signOut(id);
            const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
            if (banErr && !String(banErr.message || "").toLowerCase().includes("not found")) {
              return res.status(500).json({ error: `Perfil inativado, mas falhou ao revogar credencial no Auth: ${banErr.message}` });
            }
          } catch (authExc) {
            if (!String(authExc?.message || "").toLowerCase().includes("not found")) {
              return res.status(500).json({ error: `Falha ao bloquear conta no Auth: ${authExc?.message}` });
            }
          }
        } else {
          const { error: inactMorErr } = await supabaseAdmin.from("moradores").update({ ativo: false }).eq("id", id);
          if (inactMorErr) {
            return res.status(500).json({ error: `N\xE3o foi poss\xEDvel inativar o morador: ${inactMorErr.message}` });
          }
        }
        const { error: auditInactErr } = await supabaseAdmin.from("auditoria_eventos").insert({
          condominio_id: adminProfile.condominium_id || targetProfile.condominium_id || null,
          usuario_id: adminProfile.id,
          usuario_nome: adminProfile.full_name,
          usuario_perfil: adminProfile.role,
          tipo_evento: "USUARIO_INATIVADO_HISTORICO",
          acao: "INACTIVATE",
          tabela_afetada: targetTable,
          registro_id: id,
          descricao: `Usu\xE1rio ${targetProfile.full_name} (${targetProfile.role}) possui ${historyCount} registro(s) operacionais; acesso inativado preservando integralmente o hist\xF3rico.`,
          metodo: "ADMIN_ACTION",
          dados_antes: targetProfile
        });
        if (auditInactErr) {
          console.warn("[DEBUG BACKEND] Erro ao gravar log de auditoria:", auditInactErr.message);
        }
        return res.json({
          success: true,
          softDeleted: true,
          inactivated: true,
          message: "Usu\xE1rio possui hist\xF3rico operacional; acesso inativado com preserva\xE7\xE3o integral dos registros."
        });
      }
      const { error: tokDelErr } = await supabaseAdmin.from("resident_access_tokens").delete().eq("resident_id", id);
      if (tokDelErr) {
        return res.status(500).json({ error: `Erro ao limpar tokens de acesso do usu\xE1rio: ${tokDelErr.message}` });
      }
      const { error: notifDelErr } = await supabaseAdmin.from("notifications").delete().eq("user_id", id);
      if (notifDelErr) {
        return res.status(500).json({ error: `Erro ao limpar notifica\xE7\xF5es do usu\xE1rio: ${notifDelErr.message}` });
      }
      const { error: auditUnlinkErr } = await supabaseAdmin.from("auditoria_eventos").update({ usuario_id: null }).eq("usuario_id", id);
      if (auditUnlinkErr) {
        return res.status(500).json({ error: `Erro ao desvincular auditoria do usu\xE1rio: ${auditUnlinkErr.message}` });
      }
      const { error: tableDeleteErr } = await supabaseAdmin.from(targetTable).delete().eq("id", id);
      if (tableDeleteErr) {
        return res.status(500).json({ error: `N\xE3o foi poss\xEDvel excluir do banco de dados: ${tableDeleteErr.message}` });
      }
      if (targetTable === "profiles") {
        const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(id);
        if (authDeleteErr && !String(authDeleteErr.message || "").toLowerCase().includes("not found")) {
          return res.status(500).json({ error: `Perfil exclu\xEDdo, mas falhou ao remover credencial no Auth: ${authDeleteErr.message}` });
        }
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
      return res.json({ success: true, softDeleted: false, message: "Usu\xE1rio exclu\xEDdo com sucesso." });
    } catch (err) {
      console.error("[DEBUG BACKEND] Erro fatal na rota de exclus\xE3o:", err);
      return res.status(500).json({ error: err.message || "Erro interno no servidor ao excluir usu\xE1rio." });
    }
  });
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  };
  function cleanAndParseJsonServer(text) {
    if (!text) return null;
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const jsonSub = cleaned.substring(start, end + 1);
        try {
          return JSON.parse(jsonSub);
        } catch (innerErr) {
          console.warn("[OCR Backend] Falha ao analisar substring JSON:", innerErr);
        }
      }
      return null;
    }
  }
  app2.post("/api/ocr/extract-basic", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) return res.status(opSession.status).json({ error: opSession.error });
    const rl = checkRateLimit(`ocr:${opSession.condominiumId || opSession.user?.id || getClientIp(req)}`, 60, 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Limite tempor\xE1rio de requisi\xE7\xF5es de OCR excedido. Aguarde alguns instantes." });
    }
    try {
      const { image } = req.body || {};
      if (!image) {
        return res.status(400).json({ error: "Imagem n\xE3o fornecida" });
      }
      const ai = getGeminiClient();
      if (!ai) {
        console.warn("[OCR Backend] GEMINI_API_KEY n\xE3o configurada no servidor.");
        return res.status(503).json({ error: "Servi\xE7o de IA n\xE3o configurado no servidor" });
      }
      const model = "gemini-3-flash-preview";
      const prompt = `Analise esta etiqueta ou marca\xE7\xE3o manual. REGRAS CR\xCDTICAS:
1. FOCO NO N\xDAMERO DA CASA: Procure por n\xFAmeros GRANDES e isolados.
2. IGNORE: C\xF3digos de barras, endere\xE7os da transportadora, textos min\xFAsculos de termos e condi\xE7\xF5es.
3. MARCA\xC7\xC3O MANUAL: Se houver algo escrito \xE0 caneta/pincel, use isso como verdade absoluta.
MODO A (Transportadora): Extraia destinat\xE1rio e n\xFAmero da casa.
MODO B (Manual): Extraia o n\xFAmero GRANDE (casa) e inicial isolada.
Retorne APENAS o JSON:
{
  "casa": "n\xFAmero identificado ou vazio",
  "inicial": "letra mai\xFAscula identificada ou vazio",
  "destinatario": "nome completo identificado ou vazio",
  "confianca": "alta | media | baixa"
}`;
      const rawBase64 = image.includes(",") ? image.split(",")[1] : image;
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: rawBase64
                }
              }
            ]
          }
        ],
        config: {
          temperature: 0,
          maxOutputTokens: 150,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              casa: { type: Type.STRING },
              inicial: { type: Type.STRING },
              destinatario: { type: Type.STRING },
              confianca: { type: Type.STRING, enum: ["alta", "media", "baixa"] }
            },
            required: ["casa", "inicial", "destinatario", "confianca"]
          }
        }
      });
      const parsed = cleanAndParseJsonServer(response.text);
      return res.json({ success: true, data: parsed });
    } catch (err) {
      const isQuotaOrDemand = err.status === 429 || err.status === 503 || err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("quota");
      if (isQuotaOrDemand) {
        console.warn("[OCR Backend] Quota da API Gemini atingida ou alta demanda tempor\xE1ria. Retornando fallback amig\xE1vel.");
        return res.status(200).json({
          success: false,
          quotaExceeded: true,
          message: "Limite tempor\xE1rio de leitura por IA atingido. O cadastro manual continua funcionando normalmente.",
          data: null
        });
      }
      console.error("[OCR Backend] Erro no extractBasicText:", err);
      return res.status(500).json({ error: err.message || "Erro no processamento OCR" });
    }
  });
  app2.post("/api/ocr/analyze-label", async (req, res) => {
    const opSession = await validateOperationalSession(req);
    if ("error" in opSession) return res.status(opSession.status).json({ error: opSession.error });
    const rl = checkRateLimit(`ocr:${opSession.condominiumId || opSession.user?.id || getClientIp(req)}`, 60, 6e4);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Limite tempor\xE1rio de requisi\xE7\xF5es de OCR excedido. Aguarde alguns instantes." });
    }
    try {
      const { image, residentList } = req.body || {};
      if (!image) {
        return res.status(400).json({ error: "Imagem n\xE3o fornecida" });
      }
      const ai = getGeminiClient();
      if (!ai) {
        console.warn("[OCR Backend] GEMINI_API_KEY n\xE3o configurada no servidor.");
        return res.status(503).json({ error: "Servi\xE7o de IA n\xE3o configurado no servidor" });
      }
      const model = "gemini-3-flash-preview";
      const residentContext = residentList && residentList.length > 0 ? `
CONTEXTO: Os seguintes moradores est\xE3o cadastrados neste condom\xEDnio. Use esta lista para tentar encontrar o melhor match, mesmo que o nome na etiqueta esteja abreviado ou com pequenos erros:
${residentList.join("\n")}` : "";
      const prompt = `Analise esta etiqueta de encomenda e identifique o morador destinat\xE1rio.
    OBJETIVO PRINCIPAL: ENCONTRAR O N\xDAMERO DA CASA/UNIDADE.
    REGRAS DE PRIORIDADE:
  1. MARCA\xC7\xD5ES MANUAIS: Procure por n\xFAmeros GRANDES escritos \xE0 m\xE3o. Se houver "C123" ou "123" isolado e grande, considere como a casa.
  2. NOME DO DESTINAT\xC1RIO: Identifique o nome principal.
  3. IGNORE TOTALMENTE: C\xF3digos de barras, logos de transportadoras (Amazon, Mercado Livre), textos legais min\xFAsculos.
    ${residentContext}
    Retorne o JSON conforme o esquema.`;
      const rawBase64 = image.includes(",") ? image.split(",")[1] : image;
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: rawBase64
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recipientName: {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING },
                  confidence: { type: Type.NUMBER }
                }
              },
              unitDetails: {
                type: Type.OBJECT,
                properties: {
                  full_string: { type: Type.STRING },
                  type: { type: Type.STRING },
                  number: { type: Type.STRING },
                  block: { type: Type.STRING },
                  tower: { type: Type.STRING },
                  complement: { type: Type.STRING },
                  confidence: { type: Type.NUMBER }
                }
              },
              carrier: {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING }
                }
              },
              trackingNumber: {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING }
                }
              }
            }
          }
        }
      });
      const parsed = cleanAndParseJsonServer(response.text);
      if (parsed && parsed.recipientName?.value) {
        parsed.recipientName.value = parsed.recipientName.value.replace(/\s+/g, " ").trim();
      }
      return res.json({ success: true, data: parsed });
    } catch (err) {
      const isQuotaOrDemand = err.status === 429 || err.status === 503 || err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("quota");
      if (isQuotaOrDemand) {
        console.warn("[OCR Backend] Quota da API Gemini atingida ou alta demanda tempor\xE1ria no analyze-label. Retornando fallback amig\xE1vel.");
        return res.status(200).json({
          success: false,
          quotaExceeded: true,
          message: "Limite tempor\xE1rio de leitura por IA atingido. O cadastro manual continua funcionando normalmente.",
          data: null
        });
      }
      console.error("[OCR Backend] Erro no analyzePackageLabel:", err);
      return res.status(500).json({ error: err.message || "Erro no processamento OCR" });
    }
  });
  app2.get("/api/download-zip", (_req, res) => {
    const zipPath = path.join(process.cwd(), "public", "encomendas-inteligentes-versao-homologacao-final-20261119.zip");
    if (fs.existsSync(zipPath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="encomendas-inteligentes-versao-homologacao-final-20261119.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(zipPath);
    }
    return res.status(404).json({ error: "Arquivo ZIP n\xE3o encontrado" });
  });
  app2.get("/api/download/encomendas-inteligentes-versao-homologacao-final-20261119.zip", (_req, res) => {
    const zipPath = path.join(process.cwd(), "public", "encomendas-inteligentes-versao-homologacao-final-20261119.zip");
    if (fs.existsSync(zipPath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="encomendas-inteligentes-versao-homologacao-final-20261119.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(zipPath);
    }
    return res.status(404).json({ error: "Arquivo ZIP n\xE3o encontrado" });
  });
  app2.get("/api/download/encomendas-inteligentes-versao-homologada-final-20261109.zip", (_req, res) => {
    const zipPath = path.join(process.cwd(), "public", "encomendas-inteligentes-versao-homologada-final-20261109.zip");
    if (fs.existsSync(zipPath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="encomendas-inteligentes-versao-homologada-final-20261109.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(zipPath);
    }
    return res.status(404).json({ error: "Arquivo ZIP n\xE3o encontrado" });
  });
  app2.get("/api/download/encomendas-inteligentes-deploy-final.zip", (_req, res) => {
    const zipPath = path.join(process.cwd(), "public", "encomendas-inteligentes-deploy-final.zip");
    if (fs.existsSync(zipPath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="encomendas-inteligentes-deploy-final.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(zipPath);
    }
    return res.status(404).json({ error: "Arquivo ZIP n\xE3o encontrado" });
  });
  app2.all("/api/*", (req, res) => {
    res.status(404).json({ error: `Rota de API n\xE3o encontrada: ${req.method} ${req.path}` });
  });
  return app2;
}
var app = createApp();
async function startServer() {
  const supabaseAdmin = defaultSupabaseAdmin;
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
  const PORT = Number(process.env.PORT) || 3e3;
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
  createApp,
  server_default as default,
  startServer
};
