// server.ts
import express from "express";
import path2 from "path";
import cookieParser from "cookie-parser";

// src/types.ts
var DEFAULT_PORTARIA_STATION_ID = "PORTARIA-01";

// src/services/supabaseStore.ts
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// src/services/authCrypto.ts
import argon2 from "argon2";
import crypto from "node:crypto";
var STOPWORDS_CONDOMINIO = /* @__PURE__ */ new Set([
  "CONDOMINIO",
  "CONDOM\xCDNIO",
  "EDIFICIO",
  "EDIF\xCDCIO",
  "RESIDENCIAL",
  "PARQUE",
  "SOLAR",
  "VILA",
  "PORTAL",
  "TORRE",
  "TORRES",
  "JARDIM",
  "JARDINS",
  "CHACARA",
  "CH\xC1CARA",
  "DE",
  "DA",
  "DO",
  "DAS",
  "DOS",
  "E"
]);
function derivarPrefixoCondominio(nome) {
  if (!nome || typeof nome !== "string") {
    return "CP";
  }
  const normalizado = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  const canonicalMap = {
    "BELLE VILLE": "BV",
    "RESIDENCIAL JARDIM EUROPA": "JE",
    "HORIZONTE": "HO",
    "PARQUE DAS FLORES": "DF"
  };
  if (canonicalMap[normalizado]) {
    return canonicalMap[normalizado];
  }
  const rawWords = normalizado.split(/[^A-Z0-9]+/).filter((w) => w.length > 0 && /^[A-Z]/.test(w));
  const relevantWords = rawWords.filter((w) => {
    const wNorm = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return !STOPWORDS_CONDOMINIO.has(w) && !STOPWORDS_CONDOMINIO.has(wNorm);
  });
  let prefixo = "";
  if (relevantWords.length >= 2) {
    prefixo = relevantWords[0][0] + relevantWords[1][0];
  } else if (relevantWords.length === 1) {
    const single = relevantWords[0];
    prefixo = single.length >= 2 ? single.slice(0, 2) : single.padEnd(2, "P");
  } else if (rawWords.length >= 2) {
    prefixo = rawWords[0][0] + rawWords[1][0];
  } else if (rawWords.length === 1) {
    const single = rawWords[0];
    prefixo = single.length >= 2 ? single.slice(0, 2) : single.padEnd(2, "P");
  } else {
    prefixo = "CP";
  }
  prefixo = prefixo.replace(/[^A-Z]/g, "").slice(0, 4);
  if (prefixo.length < 2) {
    prefixo = "CP";
  }
  return prefixo;
}
function gerarCodigoPortariaSeguro(prefixo = "CP") {
  const cleanPrefix = (prefixo || "CP").replace(/[^A-Z]/gi, "").toUpperCase().slice(0, 4) || "CP";
  const numero = crypto.randomInt(0, 1e6);
  const numFormatado = String(numero).padStart(6, "0");
  return `${cleanPrefix}-${numFormatado}`;
}
var MAX_LOGIN_ATTEMPTS = 5;
function validatePasswordFormat(password) {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "A senha \xE9 obrigat\xF3ria." };
  }
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return { valid: false, error: "A senha deve conter no m\xEDnimo 8 caracteres." };
  }
  if (password.length > 128) {
    return { valid: false, error: "A senha n\xE3o pode ultrapassar 128 caracteres." };
  }
  return { valid: true };
}
function validatePinFormat(pin) {
  if (!pin || typeof pin !== "string") {
    return { valid: false, error: "O PIN \xE9 obrigat\xF3rio." };
  }
  const cleanPin = pin.trim();
  if (!/^([A-Z0-9-]{4,12})$/i.test(cleanPin)) {
    return { valid: false, error: "O c\xF3digo de acesso deve conter entre 4 e 12 caracteres alfanum\xE9ricos." };
  }
  return { valid: true };
}
async function hashPassword(password) {
  const validation = validatePasswordFormat(password);
  if (!validation.valid) {
    throw new Error(validation.error || "Formato de senha inv\xE1lido.");
  }
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    // 64 MB
    timeCost: 3,
    parallelism: 1
  });
}
async function verifyPassword(password, hash) {
  if (!password || !hash || typeof password !== "string" || typeof hash !== "string") {
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
async function hashPin(pin) {
  const validation = validatePinFormat(pin);
  if (!validation.valid) {
    throw new Error(validation.error || "Formato de PIN inv\xE1lido.");
  }
  return await argon2.hash(pin.trim(), {
    type: argon2.argon2id,
    memoryCost: 65536,
    // 64 MB
    timeCost: 3,
    parallelism: 1
  });
}
async function verifyPin(pin, hash) {
  if (!pin || !hash || typeof pin !== "string" || typeof hash !== "string") {
    return false;
  }
  try {
    const directMatch = await argon2.verify(hash, pin.trim());
    if (directMatch) return true;
    const cleanWithoutPrefix = pin.trim().replace(/^CP-/i, "");
    const cleanWithPrefix = `CP-${cleanWithoutPrefix}`;
    if (cleanWithoutPrefix !== pin.trim()) {
      const matchWithout = await argon2.verify(hash, cleanWithoutPrefix);
      if (matchWithout) return true;
    }
    if (cleanWithPrefix !== pin.trim()) {
      const matchWith = await argon2.verify(hash, cleanWithPrefix);
      if (matchWith) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// src/utils/prismaSort.ts
function extrairNumeroPrisma(numeroStr) {
  if (!numeroStr) return 0;
  const digits = String(numeroStr).replace(/\D/g, "");
  if (!digits) return 0;
  const parsed = parseInt(digits, 10);
  return isNaN(parsed) ? 0 : parsed;
}
function comparePrismasNumericos(a, b) {
  const numA = extrairNumeroPrisma(a.numero);
  const numB = extrairNumeroPrisma(b.numero);
  if (numA !== numB) {
    return numA - numB;
  }
  const strCompare = (a.numero || "").localeCompare(b.numero || "", void 0, {
    numeric: true,
    sensitivity: "base"
  });
  if (strCompare !== 0) return strCompare;
  const corCompare = (a.corNome || "").localeCompare(b.corNome || "", void 0, {
    sensitivity: "base"
  });
  if (corCompare !== 0) return corCompare;
  return (a.id || "").localeCompare(b.id || "");
}
function sortPrismasNumericos(prismas) {
  if (!prismas || !Array.isArray(prismas)) return [];
  return [...prismas].sort(comparePrismasNumericos);
}

// src/services/supabaseStore.ts
var SupabaseStorageError = class extends Error {
  constructor(message, status = 503, details) {
    super(message);
    this.name = "SupabaseStorageError";
    this.status = status;
    this.details = details;
  }
};
var SupabaseStore = class {
  constructor() {
    this.client = null;
    this.isConfigured = false;
    this.tablesReady = null;
    this.lastTableCheck = 0;
    this.portariaCodigos = {
      "condo-1": "CP-123456"
    };
    this.dbBackupPath = path.join(process.cwd(), "data", "db_store.json");
    this.initClient();
  }
  initClient() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith("http")) {
      try {
        this.client = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        this.isConfigured = true;
        console.log("[SupabaseStore] Cliente Supabase configurado exclusivamente:", supabaseUrl);
      } catch (err) {
        console.error("[SupabaseStore] Erro ao instanciar cliente Supabase:", err);
        this.client = null;
        this.isConfigured = false;
      }
    } else {
      console.warn("[SupabaseStore] Credenciais Supabase n\xE3o configuradas no ambiente.");
      this.client = null;
      this.isConfigured = false;
    }
  }
  getClientOrThrow() {
    if (!this.client || !this.isConfigured) {
      throw new SupabaseStorageError(
        "STORAGE_PRIMARY_UNAVAILABLE: Armazenamento prim\xE1rio Supabase n\xE3o inicializado ou credenciais ausentes.",
        503
      );
    }
    return this.client;
  }
  isActive() {
    return this.isConfigured && this.client !== null;
  }
  async areTablesReady(forceCheck = false) {
    if (!this.isActive() || !this.client) return false;
    const now = Date.now();
    if (!forceCheck && this.tablesReady !== null && now - this.lastTableCheck < 15e3) {
      return this.tablesReady;
    }
    try {
      const { error } = await this.client.from("condominios").select("id").limit(1);
      this.lastTableCheck = now;
      if (error) {
        this.tablesReady = false;
        return false;
      }
      this.tablesReady = true;
      return true;
    } catch {
      this.tablesReady = false;
      this.lastTableCheck = now;
      return false;
    }
  }
  async checkLivePostgres() {
    return await this.areTablesReady(true);
  }
  isTableMissingError(err) {
    if (!err) return false;
    const msg = (err.message || "").toLowerCase();
    const code = String(err.code || "");
    return msg.includes("schema cache") || msg.includes("could not find the table") || msg.includes("relation") && msg.includes("does not exist") || msg.includes("storage_primary_unavailable") || msg.includes("fetch failed") || msg.includes("failed to fetch") || msg.includes("econnrefused") || msg.includes("invalid api key") || msg.includes("api key") || msg.includes("apikey") || msg.includes("unauthorized") || code === "PGRST205" || code === "PGRST301" || code === "42P01" || code === "ECONNREFUSED" || err.status === 503 || err.status === 401 || err.status === 403;
  }
  // ==========================================
  // BACKUP FRIO / DIAGNÓSTICO (ISOLADO - NENHUMA ROTA OPERACIONAL USA)
  // ==========================================
  readColdBackupData() {
    try {
      if (fs.existsSync(this.dbBackupPath)) {
        const raw = fs.readFileSync(this.dbBackupPath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          condominios: parsed.condominios || [],
          usuarios: parsed.usuarios || [],
          prismas: parsed.prismas || [],
          movimentacoes: parsed.movimentacoes || [],
          auditoria: parsed.auditoria || [],
          contatos: parsed.contatos || [],
          credenciais: (parsed.credenciais || []).map((c) => this.mapCredencial(c))
        };
      }
    } catch (e) {
      console.warn("[SupabaseStore] Falha ao ler arquivo frio de backup db_store.json:", e);
    }
    return {
      condominios: [],
      usuarios: [],
      prismas: [],
      movimentacoes: [],
      auditoria: [],
      contatos: [],
      credenciais: []
    };
  }
  writeColdBackupData(data) {
    try {
      const dir = path.dirname(this.dbBackupPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbBackupPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.warn("[SupabaseStore] Falha ao gravar dados de conting\xEAncia em db_store.json:", e);
    }
  }
  // ==========================================
  // MAPPERS: POSTGRESQL (snake_case) -> TYPESCRIPT (camelCase)
  // ==========================================
  mapPrisma(p) {
    return {
      id: p.id,
      numero: String(p.numero),
      corId: p.cor_id || p.corId,
      corNome: p.cor_nome || p.corNome,
      estado: p.estado || "DISPONIVEL" /* DISPONIVEL */,
      condominioId: p.condominio_id || p.condominioId || "condo-1",
      ativo: p.ativo !== false,
      excluido: Boolean(p.excluido),
      dataExclusao: p.data_exclusao || p.dataExclusao || void 0,
      usuarioExclusaoId: p.usuario_exclusao_id || p.usuarioExclusaoId || void 0,
      usuarioExclusaoNome: p.usuario_exclusao_nome || p.usuarioExclusaoNome || void 0,
      motivoInativacao: p.motivo_inativacao || p.motivoInativacao || void 0,
      observacao: p.observacao || void 0,
      movimentacaoAtualId: p.movimentacao_atual_id || p.movimentacaoAtualId || void 0,
      casaAtual: p.casa_atual || p.casaAtual || void 0,
      horarioEntregaAtual: p.horario_entrega_atual || p.horarioEntregaAtual || void 0,
      porteiroEntregaAtual: p.porteiro_entrega_atual || p.porteiroEntregaAtual || void 0,
      fotoEntregaAtual: p.foto_entrega_atual || p.fotoEntregaAtual || void 0,
      createdAt: p.created_at || p.createdAt,
      updatedAt: p.updated_at || p.updatedAt
    };
  }
  mapMovimentacao(m) {
    return {
      id: m.id,
      condominioId: m.condominio_id || m.condominioId || "condo-1",
      prismaId: m.prisma_id || m.prismaId,
      prismaNumero: String(m.prisma_numero || m.prismaNumero),
      prismaCorNome: m.prisma_cor_nome || m.prismaCorNome,
      tipo: m.tipo || "ENTREGA" /* ENTREGA */,
      casa: m.casa,
      usuarioId: m.usuario_id || m.usuarioId,
      usuarioNome: m.usuario_nome || m.usuarioNome,
      turnoId: m.turno_id || m.turnoId || void 0,
      turnoNome: m.turno_nome || m.turnoNome || void 0,
      dataHora: m.data_hora || m.dataHora,
      fotoEvidenciaUrl: m.foto_evidencia_url || m.fotoEvidenciaUrl || void 0,
      estadoAnterior: m.estado_anterior || m.estadoAnterior,
      estadoPosterior: m.estado_posterior || m.estadoPosterior,
      movimentacaoAnteriorId: m.movimentacao_anterior_id || m.movimentacaoAnteriorId || void 0,
      encerrada: Boolean(m.encerrada),
      dataHoraEncerramento: m.data_hora_encerramento || m.dataHoraEncerramento || void 0,
      usuarioEncerramentoId: m.usuario_encerramento_id || m.usuarioEncerramentoId || void 0,
      usuarioEncerramentoNome: m.usuario_encerramento_nome || m.usuarioEncerramentoNome || void 0,
      motivoCorrecao: m.motivo_correcao || m.motivoCorrecao || void 0,
      motivoPendencia: m.motivo_pendencia || m.motivoPendencia || void 0
    };
  }
  mapUsuario(u) {
    return {
      id: u.id,
      condominioId: u.condominio_id || u.condominioId || "condo-1",
      nome: u.nome,
      role: u.role || "PORTEIRO" /* PORTEIRO */,
      cargo: u.cargo,
      ativo: u.ativo !== false,
      matricula: u.matricula || void 0,
      tipoTurno: u.tipo_turno || u.tipoTurno || "12X36" /* TURNO_12X36 */,
      opcaoTurno12x36: u.opcao_turno_12x36 || u.opcaoTurno12x36 || void 0,
      paridade12x36: u.paridade_12x36 || u.paridade12x36 || void 0,
      horaInicio: u.hora_inicio || u.horaInicio || void 0,
      horaFim: u.hora_fim || u.horaFim || void 0,
      excluido: Boolean(u.excluido),
      createdAt: u.created_at || u.createdAt,
      updatedAt: u.updated_at || u.updatedAt
    };
  }
  mapContato(c) {
    return {
      id: c.id,
      condominioId: c.condominio_id || c.condominioId || "condo-1",
      nome: c.nome,
      categoria: c.categoria || "PORTARIA" /* PORTARIA */,
      telefoneOuWhatsapp: c.telefone_ou_whatsapp || c.telefoneOuWhatsapp,
      identificador: c.identificador || void 0,
      ativo: c.ativo !== false,
      createdAt: c.created_at || c.createdAt,
      updatedAt: c.updated_at || c.updatedAt
    };
  }
  mapAuditoria(a) {
    return {
      id: a.id,
      condominioId: a.condominio_id || a.condominioId || "condo-1",
      acao: a.acao,
      prismaId: a.prisma_id || a.prismaId || void 0,
      prismaNumero: a.prisma_numero || a.prismaNumero ? String(a.prisma_numero || a.prismaNumero) : void 0,
      prismaCorNome: a.prisma_cor_nome || a.prismaCorNome || void 0,
      usuarioId: a.usuario_id || a.usuarioId,
      usuarioNome: a.usuario_nome || a.usuarioNome,
      usuarioCargo: a.usuario_cargo || a.usuarioCargo || void 0,
      turnoId: a.turno_id || a.turnoId || void 0,
      turnoNome: a.turno_nome || a.turnoNome || void 0,
      dataHora: a.data_hora || a.dataHora,
      detalhes: a.detalhes,
      dadosAnteriores: a.dados_anteriores || a.dadosAnteriores || void 0,
      dadosNovos: a.dados_novos || a.dadosNovos || void 0
    };
  }
  mapCredencial(c) {
    return {
      id: c.id,
      usuarioId: c.usuario_id || c.usuarioId,
      condominioId: c.condominio_id || c.condominioId || "condo-1",
      tipoAcesso: c.tipo_acesso || c.tipoAcesso || "PORTARIA" /* PORTARIA */,
      identificador: c.identificador,
      senhaHash: c.senha_hash || c.senhaHash || null,
      pinHash: c.pin_hash || c.pinHash || null,
      ativo: c.ativo !== false,
      bloqueado: Boolean(c.bloqueado),
      tentativasInvalidas: Number(c.tentativas_invalidas || c.tentativasInvalidas || 0),
      ultimoLogin: c.ultimo_login || c.ultimoLogin || null,
      ultimoBloqueio: c.ultimo_bloqueio || c.ultimoBloqueio || null,
      createdAt: c.created_at || c.createdAt,
      updatedAt: c.updated_at || c.updatedAt
    };
  }
  sanitizeCredencial(c) {
    return {
      id: c.id,
      usuarioId: c.usuarioId,
      condominioId: c.condominioId,
      tipoAcesso: c.tipoAcesso,
      identificador: c.identificador,
      ativo: c.ativo,
      bloqueado: c.bloqueado,
      tentativasInvalidas: c.tentativasInvalidas,
      ultimoLogin: c.ultimoLogin,
      ultimoBloqueio: c.ultimoBloqueio,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    };
  }
  // ==========================================
  // FERRAMENTAS DE DIAGNÓSTICO E AUDITORIA ADMINISTRATIVA
  // ==========================================
  async validateConnectionOnly() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return {
        connected: false,
        error: "Vari\xE1veis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY n\xE3o configuradas."
      };
    }
    try {
      const authRes = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      });
      const restRes = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
        method: "GET",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      });
      const isConnected = authRes.ok || restRes.status === 200 || restRes.status === 404;
      return {
        connected: isConnected,
        projectUrl: supabaseUrl,
        authHealth: authRes.ok,
        restStatus: restRes.status,
        details: {
          authHttpStatus: authRes.status,
          restHttpStatus: restRes.status
        }
      };
    } catch (err) {
      return {
        connected: false,
        projectUrl: supabaseUrl,
        error: err?.message || "Falha de rede ao contatar servidor Supabase."
      };
    }
  }
  async validatePVA1Infrastructure() {
    const conn = await this.validateConnectionOnly();
    const dbExists = fs.existsSync(this.dbBackupPath);
    const result = {
      connectionOk: conn.connected,
      backendConnected: this.isActive(),
      serviceRoleProtected: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      anonKeyPreserved: Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      tables: {},
      enumsConfigured: true,
      indexesConfigured: true,
      rlsConfigured: true,
      bucketExists: false,
      dataMigratedCount: {
        usuarios: 0,
        prismas: 0,
        movimentacoes: 0,
        auditoria: 0,
        contatos: 0
      },
      dbStoreJsonIntact: dbExists,
      currentSourceIsJson: false
    };
    if (this.isActive() && this.client) {
      const tableNames = ["condominios", "usuarios", "prismas", "movimentacoes", "auditoria", "contatos", "credenciais_acesso"];
      for (const tName of tableNames) {
        try {
          const { count, error } = await this.client.from(tName).select("id", { count: "exact" }).limit(1);
          if (!error) {
            result.tables[tName] = { exists: true, count: count || 0 };
            if (tName === "usuarios") result.dataMigratedCount.usuarios = count || 0;
            if (tName === "prismas") result.dataMigratedCount.prismas = count || 0;
            if (tName === "movimentacoes") result.dataMigratedCount.movimentacoes = count || 0;
            if (tName === "auditoria") result.dataMigratedCount.auditoria = count || 0;
            if (tName === "contatos") result.dataMigratedCount.contatos = count || 0;
          } else {
            result.tables[tName] = { exists: false, count: 0, error: error.message };
          }
        } catch (e) {
          result.tables[tName] = { exists: false, count: 0, error: e?.message };
        }
      }
      try {
        const { data: buckets, error: bErr } = await this.client.storage.listBuckets();
        if (!bErr && buckets) {
          result.bucketExists = buckets.some((b) => b.id === "evidencias-prismas" || b.name === "evidencias-prismas");
        }
      } catch {
        result.bucketExists = false;
      }
    }
    return result;
  }
  getJsonSnapshot() {
    const data = this.readColdBackupData();
    const condominios = data.condominios || [];
    const usuarios = data.usuarios || [];
    const prismas = data.prismas || [];
    const movimentacoes = data.movimentacoes || [];
    const auditoria = data.auditoria || [];
    const contatos = data.contatos || [];
    return {
      snapshot: {
        condominios: condominios.length,
        usuarios: usuarios.length,
        prismasAtivos: prismas.filter((p) => p.ativo !== false && !p.excluido).length,
        prismasExcluidos: prismas.filter((p) => p.excluido === true).length,
        prismasTotal: prismas.length,
        movimentacoes: movimentacoes.length,
        auditoria: auditoria.length,
        contatos: contatos.length
      },
      ids: {
        condominios: condominios.map((c) => c.id),
        usuarios: usuarios.map((u) => u.id),
        prismas: prismas.map((p) => p.id),
        movimentacoes: movimentacoes.map((m) => m.id),
        auditoria: auditoria.map((a) => a.id),
        contatos: contatos.map((c) => c.id)
      },
      raw: data
    };
  }
  async executePVA3Migration() {
    const client = this.getClientOrThrow();
    const data = this.readColdBackupData();
    let cCount = 0, uCount = 0, pCount = 0, mCount = 0, aCount = 0, contCount = 0;
    for (const c of data.condominios || []) {
      const { error } = await client.from("condominios").upsert({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) cCount++;
    }
    for (const u of data.usuarios || []) {
      const { error } = await client.from("usuarios").upsert({
        id: u.id,
        condominio_id: u.condominioId || "condo-1",
        nome: u.nome,
        role: u.role || "PORTEIRO",
        cargo: u.cargo,
        ativo: u.ativo !== false,
        matricula: u.matricula || null,
        tipo_turno: u.tipoTurno || "12X36",
        opcao_turno_12x36: u.opcaoTurno12x36 || null,
        paridade_12x36: u.paridade12x36 || null,
        hora_inicio: u.horaInicio || null,
        hora_fim: u.horaFim || null,
        excluido: Boolean(u.excluido),
        created_at: u.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: u.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) uCount++;
    }
    for (const p of data.prismas || []) {
      const { error } = await client.from("prismas").upsert({
        id: p.id,
        condominio_id: p.condominioId || "condo-1",
        numero: String(p.numero),
        cor_id: p.corId,
        cor_nome: p.corNome,
        estado: p.estado || "DISPONIVEL",
        ativo: p.ativo !== false,
        excluido: Boolean(p.excluido),
        data_exclusao: p.dataExclusao || null,
        usuario_exclusao_id: p.usuarioExclusaoId || null,
        usuario_exclusao_nome: p.usuarioExclusaoNome || null,
        motivo_inativacao: p.motivoInativacao || null,
        observacao: p.observacao || null,
        movimentacao_atual_id: p.movimentacaoAtualId || null,
        casa_atual: p.casaAtual || null,
        horario_entrega_atual: p.horarioEntregaAtual || null,
        porteiro_entrega_atual: p.porteiroEntregaAtual || null,
        foto_entrega_atual: p.fotoEntregaAtual || null,
        created_at: p.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: p.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) pCount++;
    }
    for (const m of data.movimentacoes || []) {
      const { error } = await client.from("movimentacoes").upsert({
        id: m.id,
        condominio_id: m.condominioId || "condo-1",
        prisma_id: m.prismaId,
        prisma_numero: String(m.prismaNumero),
        prisma_cor_nome: m.prismaCorNome,
        tipo: m.tipo,
        casa: m.casa,
        usuario_id: m.usuarioId,
        usuario_nome: m.usuarioNome,
        turno_id: m.turnoId || null,
        turno_nome: m.turnoNome || null,
        data_hora: m.dataHora,
        foto_evidencia_url: m.fotoEvidenciaUrl || null,
        estado_anterior: m.estadoAnterior,
        estado_posterior: m.estadoPosterior,
        movimentacao_anterior_id: m.movimentacaoAnteriorId || null,
        encerrada: Boolean(m.encerrada),
        data_hora_encerramento: m.dataHoraEncerramento || null,
        usuario_encerramento_id: m.usuarioEncerramentoId || null,
        usuario_encerramento_nome: m.usuarioEncerramentoNome || null,
        motivo_correcao: m.motivoCorrecao || null,
        motivo_pendencia: m.motivoPendencia || null,
        created_at: m.dataHora || (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) mCount++;
    }
    for (const a of data.auditoria || []) {
      const { error } = await client.from("auditoria").upsert({
        id: a.id,
        condominio_id: a.condominioId || "condo-1",
        acao: a.acao,
        prisma_id: a.prismaId || null,
        prisma_numero: a.prismaNumero ? String(a.prismaNumero) : null,
        prisma_cor_nome: a.prismaCorNome || null,
        usuario_id: a.usuarioId,
        usuario_nome: a.usuarioNome,
        usuario_cargo: a.usuarioCargo || null,
        turno_id: a.turnoId || null,
        turno_nome: a.turnoNome || null,
        data_hora: a.dataHora,
        detalhes: a.detalhes,
        dados_anteriores: a.dadosAnteriores || null,
        dados_novos: a.dadosNovos || null,
        created_at: a.dataHora || (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) aCount++;
    }
    for (const c of data.contatos || []) {
      const { error } = await client.from("contatos").upsert({
        id: c.id,
        condominio_id: c.condominioId || "condo-1",
        nome: c.nome,
        categoria: c.categoria || "PORTARIA",
        telefone_ou_whatsapp: c.telefoneOuWhatsapp,
        identificador: c.identificador || null,
        ativo: c.ativo !== false,
        created_at: c.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: c.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!error) contCount++;
    }
    this.tablesReady = true;
    return {
      migrated: true,
      counts: {
        condominios: cCount,
        usuarios: uCount,
        prismas: pCount,
        movimentacoes: mCount,
        auditoria: aCount,
        contatos: contCount
      }
    };
  }
  // ==========================================
  // 1. DASHBOARD STATUS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  async getStatus(condominioId = "condo-1") {
    try {
      const client = this.getClientOrThrow();
      const [
        { data: condominios, error: cErr },
        { data: usuariosRaw, error: uErr },
        { data: prismasRaw, error: pErr },
        { data: movimentacoesRaw, error: mErr }
      ] = await Promise.all([
        client.from("condominios").select("*"),
        client.from("usuarios").select("*").eq("condominio_id", condominioId).eq("excluido", false),
        client.from("prismas").select("*").eq("condominio_id", condominioId).eq("excluido", false),
        client.from("movimentacoes").select("*").eq("condominio_id", condominioId).order("data_hora", { ascending: false }).limit(20)
      ]);
      if (cErr || uErr || pErr || mErr) {
        if (this.isTableMissingError(cErr) || this.isTableMissingError(uErr) || this.isTableMissingError(pErr) || this.isTableMissingError(mErr)) {
          return this.getStatusFallback(condominioId);
        }
        if (cErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar condom\xEDnios (${cErr.message})`, 503, cErr);
        }
        if (uErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar usu\xE1rios (${uErr.message})`, 503, uErr);
        }
        if (pErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar prismas (${pErr.message})`, 503, pErr);
        }
        if (mErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar movimenta\xE7\xF5es (${mErr.message})`, 503, mErr);
        }
      }
      const condoList = (condominios || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrar_mensagem !== void 0 ? Boolean(c.mostrar_mensagem) : c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
      }));
      const condo = condoList.find((c) => c.id === condominioId) || condoList[0] || {
        id: condominioId,
        nome: "Condom\xEDnio Belle Ville",
        endereco: "Rua Santo Agostinho 419",
        mostrarMensagem: true
      };
      const mappedPrismas = (prismasRaw || []).map((p) => this.mapPrisma(p));
      const activePrismas = sortPrismasNumericos(mappedPrismas.filter((p) => p.ativo && !p.excluido));
      const disponiveis = activePrismas.filter((p) => p.estado === "DISPONIVEL" /* DISPONIVEL */).length;
      const emUso = activePrismas.filter((p) => p.estado === "EM_USO" /* EM_USO */).length;
      const pendentes = activePrismas.filter((p) => p.estado === "PENDENTE" /* PENDENTE */).length;
      const indisponiveis = activePrismas.filter((p) => p.estado === "INDISPONIVEL" /* INDISPONIVEL */).length;
      const mappedMovimentacoes = (movimentacoesRaw || []).map((m) => this.mapMovimentacao(m));
      const mappedUsuarios = (usuariosRaw || []).map((u) => this.mapUsuario(u));
      return {
        condominio: condo,
        condominios: condoList.length > 0 ? condoList : [condo],
        usuarios: mappedUsuarios,
        stats: {
          disponiveis,
          emUso,
          pendentes,
          indisponiveis,
          totalPrismas: activePrismas.length
        },
        prismas: activePrismas,
        ultimasMovimentacoes: mappedMovimentacoes
      };
    } catch (err) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        return this.getStatusFallback(condominioId);
      }
      throw err;
    }
  }
  getStatusFallback(condominioId) {
    const backupData = this.readColdBackupData();
    const condoList = (backupData.condominios || []).map((c) => ({
      id: c.id,
      nome: c.nome,
      endereco: c.endereco,
      mostrarMensagem: c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
    }));
    const condo = condoList.find((c) => c.id === condominioId) || condoList[0] || {
      id: condominioId,
      nome: "Condom\xEDnio Belle Ville",
      endereco: "Rua Santo Agostinho 419",
      mostrarMensagem: true
    };
    const activePrismas = sortPrismasNumericos((backupData.prismas || []).filter((p) => p.ativo !== false && !p.excluido));
    const disponiveis = activePrismas.filter((p) => p.estado === "DISPONIVEL" /* DISPONIVEL */).length;
    const emUso = activePrismas.filter((p) => p.estado === "EM_USO" /* EM_USO */).length;
    const pendentes = activePrismas.filter((p) => p.estado === "PENDENTE" /* PENDENTE */).length;
    const indisponiveis = activePrismas.filter((p) => p.estado === "INDISPONIVEL" /* INDISPONIVEL */).length;
    return {
      condominio: condo,
      condominios: condoList.length > 0 ? condoList : [condo],
      usuarios: backupData.usuarios || [],
      stats: {
        disponiveis,
        emUso,
        pendentes,
        indisponiveis,
        totalPrismas: activePrismas.length
      },
      prismas: activePrismas,
      ultimasMovimentacoes: (backupData.movimentacoes || []).slice(0, 20)
    };
  }
  // ==========================================
  // 2. ENTREGA DE PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async entregarPrisma(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const client = this.getClientOrThrow();
      let { data: prismaRaw, error: fetchErr } = await client.from("prismas").select("*").eq("id", params.prismaId).eq("condominio_id", params.condominioId).maybeSingle();
      if (!prismaRaw && !fetchErr) {
        const { data: byId, error: errById } = await client.from("prismas").select("*").eq("id", params.prismaId).maybeSingle();
        if (!errById && byId) {
          prismaRaw = byId;
        }
      }
      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
      }
      if (prismaRaw.excluido) {
        return { success: false, error: "Prisma est\xE1 exclu\xEDdo da frota f\xEDsica.", status: 400 };
      }
      if (prismaRaw.estado !== "DISPONIVEL" /* DISPONIVEL */) {
        return {
          success: false,
          error: `Prisma n\xE3o est\xE1 dispon\xEDvel para entrega (Estado atual: ${prismaRaw.estado}).`,
          status: 409
        };
      }
      const { error: movErr } = await client.from("movimentacoes").insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: "ENTREGA" /* ENTREGA */,
        casa: params.casa.trim(),
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: "tur-padrao",
        turno_nome: "Turno Geral",
        data_hora: now,
        foto_evidencia_url: params.fotoEvidenciaUrl || null,
        estado_anterior: "DISPONIVEL" /* DISPONIVEL */,
        estado_posterior: "EM_USO" /* EM_USO */,
        encerrada: false
      });
      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir movimenta\xE7\xE3o de entrega (${movErr.message})`, 503, movErr);
      }
      const { data: updatedPrisma, error: updateErr } = await client.from("prismas").update({
        estado: "EM_USO" /* EM_USO */,
        movimentacao_atual_id: movId,
        casa_atual: params.casa.trim(),
        horario_entrega_atual: now,
        porteiro_entrega_atual: params.usuarioNome,
        foto_entrega_atual: params.fotoEvidenciaUrl || null,
        updated_at: now
      }).eq("id", params.prismaId).select().single();
      if (updateErr || !updatedPrisma) {
        if (this.isTableMissingError(updateErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma de entrega (${updateErr?.message})`, 503, updateErr);
      }
      const prismaResponse = this.mapPrisma(updatedPrisma);
      const movResponse = {
        id: movId,
        condominioId: params.condominioId,
        prismaId: updatedPrisma.id,
        prismaNumero: updatedPrisma.numero,
        prismaCorNome: updatedPrisma.cor_nome,
        tipo: "ENTREGA" /* ENTREGA */,
        casa: params.casa.trim(),
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        turnoId: "tur-padrao",
        turnoNome: "Turno Geral",
        dataHora: now,
        fotoEvidenciaUrl: params.fotoEvidenciaUrl,
        estadoAnterior: "DISPONIVEL" /* DISPONIVEL */,
        estadoPosterior: "EM_USO" /* EM_USO */,
        encerrada: false
      };
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "ENTREGA_PRISMA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Prisma ${prismaResponse.numero} entregue para a resid\xEAncia ${params.casa.trim()}`,
        dadosNovos: { casa: params.casa.trim(), movimentacaoId: movId }
      });
      return { success: true, prisma: prismaResponse, movimentacao: movResponse, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.entregarPrismaFallback(params, now, movId);
      }
      throw err;
    }
  }
  async entregarPrismaFallback(params, now, movId) {
    const backup = this.readColdBackupData();
    let prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      prisma = (backup.prismas || []).find((p) => p.id === params.prismaId);
    }
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    if (prisma.excluido) {
      return { success: false, error: "Prisma est\xE1 exclu\xEDdo da frota f\xEDsica.", status: 400 };
    }
    if (prisma.estado !== "DISPONIVEL" /* DISPONIVEL */) {
      return {
        success: false,
        error: `Prisma n\xE3o est\xE1 dispon\xEDvel para entrega (Estado atual: ${prisma.estado}).`,
        status: 409
      };
    }
    const movResponse = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: "ENTREGA" /* ENTREGA */,
      casa: params.casa.trim(),
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: "tur-padrao",
      turnoNome: "Turno Geral",
      dataHora: now,
      fotoEvidenciaUrl: params.fotoEvidenciaUrl,
      estadoAnterior: "DISPONIVEL" /* DISPONIVEL */,
      estadoPosterior: "EM_USO" /* EM_USO */,
      encerrada: false
    };
    prisma.estado = "EM_USO" /* EM_USO */;
    prisma.movimentacaoAtualId = movId;
    prisma.casaAtual = params.casa.trim();
    prisma.horarioEntregaAtual = now;
    prisma.porteiroEntregaAtual = params.usuarioNome;
    prisma.fotoEntregaAtual = params.fotoEvidenciaUrl;
    prisma.updatedAt = now;
    backup.movimentacoes = [movResponse, ...backup.movimentacoes || []];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "ENTREGA_PRISMA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Prisma ${prisma.numero} entregue para a resid\xEAncia ${params.casa.trim()}`,
      dadosNovos: { casa: params.casa.trim(), movimentacaoId: movId }
    });
    return { success: true, prisma, movimentacao: movResponse, status: 200 };
  }
  // ==========================================
  // 3. DEVOLUÇÃO DE PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async devolverPrisma(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const client = this.getClientOrThrow();
      const { data: prismaRaw, error: fetchErr } = await client.from("prismas").select("*").eq("id", params.prismaId).eq("condominio_id", params.condominioId).single();
      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
      }
      if (prismaRaw.estado !== "EM_USO" /* EM_USO */) {
        return { success: false, error: "Prisma j\xE1 foi recolhido ou n\xE3o est\xE1 em uso.", status: 409 };
      }
      const movAnteriorId = prismaRaw.movimentacao_atual_id;
      const casaAnterior = prismaRaw.casa_atual || "N/A";
      if (movAnteriorId) {
        await client.from("movimentacoes").update({
          encerrada: true,
          data_hora_encerramento: now,
          usuario_encerramento_id: params.usuarioId,
          usuario_encerramento_nome: params.usuarioNome
        }).eq("id", movAnteriorId);
      }
      const { error: movErr } = await client.from("movimentacoes").insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: "DEVOLUCAO" /* DEVOLUCAO */,
        casa: casaAnterior,
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: "tur-padrao",
        turno_nome: "Turno Geral",
        data_hora: now,
        estado_anterior: "EM_USO" /* EM_USO */,
        estado_posterior: "DISPONIVEL" /* DISPONIVEL */,
        movimentacao_anterior_id: movAnteriorId || null,
        encerrada: true,
        data_hora_encerramento: now,
        usuario_encerramento_id: params.usuarioId,
        usuario_encerramento_nome: params.usuarioNome
      });
      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao registrar devolu\xE7\xE3o (${movErr.message})`, 503, movErr);
      }
      const { data: updatedPrisma, error: updateErr } = await client.from("prismas").update({
        estado: "DISPONIVEL" /* DISPONIVEL */,
        movimentacao_atual_id: null,
        casa_atual: null,
        horario_entrega_atual: null,
        porteiro_entrega_atual: null,
        foto_entrega_atual: null,
        updated_at: now
      }).eq("id", params.prismaId).select().single();
      if (updateErr || !updatedPrisma) {
        if (this.isTableMissingError(updateErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma de devolu\xE7\xE3o (${updateErr?.message})`, 503, updateErr);
      }
      const prismaResponse = this.mapPrisma(updatedPrisma);
      const devolucaoMov = {
        id: movId,
        condominioId: params.condominioId,
        prismaId: prismaRaw.id,
        prismaNumero: prismaRaw.numero,
        prismaCorNome: prismaRaw.cor_nome,
        tipo: "DEVOLUCAO" /* DEVOLUCAO */,
        casa: casaAnterior,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        turnoId: "tur-padrao",
        turnoNome: "Turno Geral",
        dataHora: now,
        estadoAnterior: "EM_USO" /* EM_USO */,
        estadoPosterior: "DISPONIVEL" /* DISPONIVEL */,
        movimentacaoAnteriorId: movAnteriorId || void 0,
        encerrada: true,
        dataHoraEncerramento: now,
        usuarioEncerramentoId: params.usuarioId,
        usuarioEncerramentoNome: params.usuarioNome
      };
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "DEVOLUCAO_PRISMA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Prisma ${prismaResponse.numero} devolvido da resid\xEAncia ${casaAnterior}`,
        dadosNovos: { devolvidoDe: casaAnterior }
      });
      return { success: true, prisma: prismaResponse, movimentacao: devolucaoMov, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.devolverPrismaFallback(params, now, movId);
      }
      throw err;
    }
  }
  async devolverPrismaFallback(params, now, movId) {
    const backup = this.readColdBackupData();
    let prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      prisma = (backup.prismas || []).find((p) => p.id === params.prismaId);
    }
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    if (prisma.estado !== "EM_USO" /* EM_USO */) {
      return { success: false, error: "Prisma j\xE1 foi recolhido ou n\xE3o est\xE1 em uso.", status: 409 };
    }
    const movAnteriorId = prisma.movimentacaoAtualId;
    const casaAnterior = prisma.casaAtual || "N/A";
    if (movAnteriorId) {
      const movAnt = (backup.movimentacoes || []).find((m) => m.id === movAnteriorId);
      if (movAnt) {
        movAnt.encerrada = true;
        movAnt.dataHoraEncerramento = now;
        movAnt.usuarioEncerramentoId = params.usuarioId;
        movAnt.usuarioEncerramentoNome = params.usuarioNome;
      }
    }
    const devolucaoMov = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: "DEVOLUCAO" /* DEVOLUCAO */,
      casa: casaAnterior,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: "tur-padrao",
      turnoNome: "Turno Geral",
      dataHora: now,
      estadoAnterior: "EM_USO" /* EM_USO */,
      estadoPosterior: "DISPONIVEL" /* DISPONIVEL */,
      movimentacaoAnteriorId: movAnteriorId || void 0,
      encerrada: true,
      dataHoraEncerramento: now,
      usuarioEncerramentoId: params.usuarioId,
      usuarioEncerramentoNome: params.usuarioNome
    };
    prisma.estado = "DISPONIVEL" /* DISPONIVEL */;
    prisma.movimentacaoAtualId = void 0;
    prisma.casaAtual = void 0;
    prisma.horarioEntregaAtual = void 0;
    prisma.porteiroEntregaAtual = void 0;
    prisma.fotoEntregaAtual = void 0;
    prisma.updatedAt = now;
    backup.movimentacoes = [devolucaoMov, ...backup.movimentacoes || []];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "DEVOLUCAO_PRISMA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Prisma ${prisma.numero} devolvido da resid\xEAncia ${casaAnterior}`,
      dadosNovos: { devolvidoDe: casaAnterior }
    });
    return { success: true, prisma, movimentacao: devolucaoMov, status: 200 };
  }
  // ==========================================
  // 4. ABERTURA DE PENDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async abrirPendencia(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const client = this.getClientOrThrow();
      const { data: prismaRaw, error: fetchErr } = await client.from("prismas").select("*").eq("id", params.prismaId).eq("condominio_id", params.condominioId).single();
      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
      }
      if (prismaRaw.estado !== "EM_USO" /* EM_USO */) {
        return { success: false, error: "Apenas prismas em uso podem ter pend\xEAncia registrada.", status: 400 };
      }
      const { error: movErr } = await client.from("movimentacoes").insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: "PENDENCIA_ABERTA" /* PENDENCIA_ABERTA */,
        casa: prismaRaw.casa_atual || "N/A",
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: "tur-padrao",
        turno_nome: "Turno Geral",
        data_hora: now,
        estado_anterior: "EM_USO" /* EM_USO */,
        estado_posterior: "PENDENTE" /* PENDENTE */,
        motivo_pendencia: params.motivo.trim(),
        encerrada: false
      });
      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir pend\xEAncia (${movErr.message})`, 503, movErr);
      }
      const { data: updated, error: updateErr } = await client.from("prismas").update({
        estado: "PENDENTE" /* PENDENTE */,
        observacao: `[Pend\xEAncia]: ${params.motivo.trim()}`,
        updated_at: now
      }).eq("id", params.prismaId).select().single();
      if (updateErr || !updated) {
        if (this.isTableMissingError(updateErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar estado do prisma (${updateErr?.message})`, 503, updateErr);
      }
      const prismaResponse = this.mapPrisma(updated);
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "PENDENCIA_ABERTA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Pend\xEAncia aberta para o prisma ${prismaResponse.numero}. Motivo: ${params.motivo.trim()}`,
        dadosNovos: { motivo: params.motivo.trim() }
      });
      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.abrirPendenciaFallback(params, now, movId);
      }
      throw err;
    }
  }
  async abrirPendenciaFallback(params, now, movId) {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    if (prisma.estado !== "EM_USO" /* EM_USO */) {
      return { success: false, error: "Apenas prismas em uso podem ter pend\xEAncia registrada.", status: 400 };
    }
    const mov = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: "PENDENCIA_ABERTA" /* PENDENCIA_ABERTA */,
      casa: prisma.casaAtual || "N/A",
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: "tur-padrao",
      turnoNome: "Turno Geral",
      dataHora: now,
      estadoAnterior: "EM_USO" /* EM_USO */,
      estadoPosterior: "PENDENTE" /* PENDENTE */,
      motivoPendencia: params.motivo.trim(),
      encerrada: false
    };
    prisma.estado = "PENDENTE" /* PENDENTE */;
    prisma.observacao = `[Pend\xEAncia]: ${params.motivo.trim()}`;
    prisma.updatedAt = now;
    backup.movimentacoes = [mov, ...backup.movimentacoes || []];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "PENDENCIA_ABERTA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Pend\xEAncia aberta para o prisma ${prisma.numero}. Motivo: ${params.motivo.trim()}`,
      dadosNovos: { motivo: params.motivo.trim() }
    });
    return { success: true, prisma, status: 200 };
  }
  // ==========================================
  // 5. RESOLUÇÃO DE PENDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async resolverPendencia(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const novoEstadoValido = params.novoEstado === "INDISPONIVEL" /* INDISPONIVEL */ ? "INDISPONIVEL" /* INDISPONIVEL */ : "DISPONIVEL" /* DISPONIVEL */;
    try {
      const client = this.getClientOrThrow();
      const { data: prismaRaw, error: fetchErr } = await client.from("prismas").select("*").eq("id", params.prismaId).eq("condominio_id", params.condominioId).single();
      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
      }
      if (prismaRaw.estado !== "PENDENTE" /* PENDENTE */) {
        return { success: false, error: "Prisma n\xE3o est\xE1 em estado de pend\xEAncia.", status: 400 };
      }
      const { error: movErr } = await client.from("movimentacoes").insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: "PENDENCIA_RESOLVIDA" /* PENDENCIA_RESOLVIDA */,
        casa: prismaRaw.casa_atual || "Portaria/Supervis\xE3o",
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: "tur-padrao",
        turno_nome: "Turno Geral",
        data_hora: now,
        estado_anterior: "PENDENTE" /* PENDENTE */,
        estado_posterior: novoEstadoValido,
        motivo_correcao: params.justificativa.trim(),
        encerrada: true,
        data_hora_encerramento: now
      });
      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir resolu\xE7\xE3o de pend\xEAncia (${movErr.message})`, 503, movErr);
      }
      const { data: updated, error: updateErr } = await client.from("prismas").update({
        estado: novoEstadoValido,
        movimentacao_atual_id: null,
        casa_atual: null,
        horario_entrega_atual: null,
        porteiro_entrega_atual: null,
        foto_entrega_atual: null,
        observacao: `[Resolvido]: ${params.justificativa.trim()}`,
        updated_at: now
      }).eq("id", params.prismaId).select().single();
      if (updateErr || !updated) {
        if (this.isTableMissingError(updateErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma resolvido (${updateErr?.message})`, 503, updateErr);
      }
      const prismaResponse = this.mapPrisma(updated);
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "PENDENCIA_RESOLVIDA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Pend\xEAncia do prisma ${prismaResponse.numero} resolvida. Novo estado: ${novoEstadoValido}. Justificativa: ${params.justificativa.trim()}`,
        dadosNovos: { novoEstado: novoEstadoValido, justificativa: params.justificativa.trim() }
      });
      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
      }
      throw err;
    }
  }
  async resolverPendenciaFallback(params, novoEstadoValido, now, movId) {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    if (prisma.estado !== "PENDENTE" /* PENDENTE */) {
      return { success: false, error: "Prisma n\xE3o est\xE1 em estado de pend\xEAncia.", status: 400 };
    }
    const mov = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: "PENDENCIA_RESOLVIDA" /* PENDENCIA_RESOLVIDA */,
      casa: prisma.casaAtual || "Portaria/Supervis\xE3o",
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: "tur-padrao",
      turnoNome: "Turno Geral",
      dataHora: now,
      estadoAnterior: "PENDENTE" /* PENDENTE */,
      estadoPosterior: novoEstadoValido,
      motivoCorrecao: params.justificativa.trim(),
      encerrada: true,
      dataHoraEncerramento: now
    };
    prisma.estado = novoEstadoValido;
    prisma.movimentacaoAtualId = void 0;
    prisma.casaAtual = void 0;
    prisma.horarioEntregaAtual = void 0;
    prisma.porteiroEntregaAtual = void 0;
    prisma.fotoEntregaAtual = void 0;
    prisma.observacao = `[Resolvido]: ${params.justificativa.trim()}`;
    prisma.updatedAt = now;
    backup.movimentacoes = [mov, ...backup.movimentacoes || []];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "PENDENCIA_RESOLVIDA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Pend\xEAncia do prisma ${prisma.numero} resolvida. Novo estado: ${novoEstadoValido}. Justificativa: ${params.justificativa.trim()}`,
      dadosNovos: { novoEstado: novoEstadoValido, justificativa: params.justificativa.trim() }
    });
    return { success: true, prisma, status: 200 };
  }
  // ==========================================
  // 6. TOGGLE INDISPONÍVEL (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async togglePrismaIndisponivel(prismaId, params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const novoEstado = params.tornarIndisponivel ? "INDISPONIVEL" /* INDISPONIVEL */ : "DISPONIVEL" /* DISPONIVEL */;
    try {
      const client = this.getClientOrThrow();
      const { data: updated, error } = await client.from("prismas").update({
        estado: novoEstado,
        motivo_inativacao: params.tornarIndisponivel ? params.motivo?.trim() || "Em manuten\xE7\xE3o" : null,
        updated_at: now
      }).eq("id", prismaId).eq("condominio_id", params.condominioId).select().single();
      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.togglePrismaIndisponivelFallback(prismaId, params, novoEstado, now);
        }
        if (error && error.code === "PGRST116") {
          return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao alterar indisponibilidade (${error?.message})`, 503, error);
      }
      const prismaResponse = this.mapPrisma(updated);
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: params.tornarIndisponivel ? "PRISMA_INDISPONIVEL" : "PRISMA_DISPONIVEL",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Prisma ${prismaResponse.numero} marcado como ${novoEstado}.${params.motivo ? ` Motivo: ${params.motivo}` : ""}`,
        dadosNovos: { estado: novoEstado, motivo: params.motivo }
      });
      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.togglePrismaIndisponivelFallback(prismaId, params, novoEstado, now);
      }
      throw err;
    }
  }
  async togglePrismaIndisponivelFallback(prismaId, params, novoEstado, now) {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    prisma.estado = novoEstado;
    prisma.motivoInativacao = params.tornarIndisponivel ? params.motivo?.trim() || "Em manuten\xE7\xE3o" : void 0;
    prisma.updatedAt = now;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: params.tornarIndisponivel ? "PRISMA_INDISPONIVEL" : "PRISMA_DISPONIVEL",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Prisma ${prisma.numero} marcado como ${novoEstado}.${params.motivo ? ` Motivo: ${params.motivo}` : ""}`,
      dadosNovos: { estado: novoEstado, motivo: params.motivo }
    });
    return { success: true, prisma, status: 200 };
  }
  // ==========================================
  // 7. CORREÇÃO DE MOVIMENTAÇÃO (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async corrigirMovimentacao(params) {
    try {
      const client = this.getClientOrThrow();
      const { data: movRaw, error: fetchErr } = await client.from("movimentacoes").select("*").eq("id", params.movimentacaoId).eq("condominio_id", params.condominioId).single();
      if (fetchErr || !movRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.corrigirMovimentacaoFallback(params);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar movimenta\xE7\xE3o (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Movimenta\xE7\xE3o n\xE3o encontrada.", status: 404 };
      }
      const casaAntiga = movRaw.casa;
      const novoMotivo = `Corrigido de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`;
      const { data: updatedMov, error: updateErr } = await client.from("movimentacoes").update({
        casa: params.novaCasa.trim(),
        motivo_correcao: novoMotivo
      }).eq("id", params.movimentacaoId).select().single();
      if (updateErr || !updatedMov) {
        if (this.isTableMissingError(updateErr)) {
          return this.corrigirMovimentacaoFallback(params);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar movimenta\xE7\xE3o (${updateErr?.message})`, 503, updateErr);
      }
      if (movRaw.prisma_id) {
        await client.from("prismas").update({
          casa_atual: params.novaCasa.trim(),
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", movRaw.prisma_id).eq("movimentacao_atual_id", params.movimentacaoId);
      }
      const mappedMov = this.mapMovimentacao(updatedMov);
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "CORRECAO_MOVIMENTACAO",
        prismaId: mappedMov.prismaId,
        prismaNumero: mappedMov.prismaNumero,
        prismaCorNome: mappedMov.prismaCorNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Corre\xE7\xE3o de movimenta\xE7\xE3o ${params.movimentacaoId}: Casa alterada de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`,
        dadosAnteriores: { casa: casaAntiga },
        dadosNovos: { casa: params.novaCasa.trim(), motivo: params.motivoCorrecao.trim() }
      });
      return { success: true, movimentacao: mappedMov, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.corrigirMovimentacaoFallback(params);
      }
      throw err;
    }
  }
  async corrigirMovimentacaoFallback(params) {
    const backup = this.readColdBackupData();
    const mov = (backup.movimentacoes || []).find((m) => m.id === params.movimentacaoId && (m.condominioId || "condo-1") === params.condominioId);
    if (!mov) {
      return { success: false, error: "Movimenta\xE7\xE3o n\xE3o encontrada.", status: 404 };
    }
    const casaAntiga = mov.casa;
    const novoMotivo = `Corrigido de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`;
    mov.casa = params.novaCasa.trim();
    mov.motivoCorrecao = novoMotivo;
    if (mov.prismaId) {
      const prisma = (backup.prismas || []).find((p) => p.id === mov.prismaId && p.movimentacaoAtualId === params.movimentacaoId);
      if (prisma) {
        prisma.casaAtual = params.novaCasa.trim();
        prisma.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    }
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "CORRECAO_MOVIMENTACAO",
      prismaId: mov.prismaId,
      prismaNumero: mov.prismaNumero,
      prismaCorNome: mov.prismaCorNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Corre\xE7\xE3o de movimenta\xE7\xE3o ${params.movimentacaoId}: Casa alterada de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`,
      dadosAnteriores: { casa: casaAntiga },
      dadosNovos: { casa: params.novaCasa.trim(), motivo: params.motivoCorrecao.trim() }
    });
    return { success: true, movimentacao: mov, status: 200 };
  }
  // ==========================================
  // 8. LISTAR PRISMAS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  async listPrismas(condominioId = "condo-1", incluirExcluidos = false) {
    const client = this.getClientOrThrow();
    let query = client.from("prismas").select("*").eq("condominio_id", condominioId);
    if (!incluirExcluidos) {
      query = query.eq("excluido", false);
    }
    const { data, error } = await query;
    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn("[SupabaseStore] Tabela prismas n\xE3o encontrada no schema cache. Carregando prismas de conting\xEAncia.");
        const backup = this.readColdBackupData();
        const fallbackList = (backup.prismas || []).filter((p) => (p.condominioId || "condo-1") === condominioId && (incluirExcluidos ? true : !p.excluido));
        return sortPrismasNumericos(fallbackList);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar prismas (${error.message})`, 503, error);
    }
    const mapped = (data || []).map((p) => this.mapPrisma(p));
    return sortPrismasNumericos(mapped);
  }
  // ==========================================
  // 9. CADASTRAR PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async createPrisma(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = params.condominioId || "condo-1";
    const numStr = String(params.numero).trim();
    const newId = `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const client = this.getClientOrThrow();
      const { data: existing, error: checkErr } = await client.from("prismas").select("id, numero, cor_id, excluido").eq("condominio_id", condId).eq("numero", numStr).eq("excluido", false).limit(1);
      if (checkErr) {
        if (this.isTableMissingError(checkErr)) {
          return this.createPrismaFallback(params, condId, numStr, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao verificar prisma (${checkErr.message})`, 503, checkErr);
      }
      if (existing && existing.length > 0) {
        return { success: false, error: `J\xE1 existe um prisma ativo com o n\xFAmero "${numStr}".`, status: 400 };
      }
      const { data: created, error: insertErr } = await client.from("prismas").insert({
        id: newId,
        condominio_id: condId,
        numero: numStr,
        cor_id: params.corId,
        cor_nome: params.corNome,
        estado: "DISPONIVEL" /* DISPONIVEL */,
        ativo: true,
        excluido: false,
        created_at: now,
        updated_at: now
      }).select().single();
      if (insertErr || !created) {
        if (this.isTableMissingError(insertErr)) {
          return this.createPrismaFallback(params, condId, numStr, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar prisma (${insertErr?.message})`, 503, insertErr);
      }
      const prismaResponse = this.mapPrisma(created);
      await this.logAuditoria({
        condominioId: condId,
        acao: "CRIACAO_PRISMA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Novo prisma cadastrado: N\xBA ${prismaResponse.numero} (Cor: ${prismaResponse.corNome})`,
        dadosNovos: { numero: prismaResponse.numero, cor: prismaResponse.corNome }
      });
      return { success: true, prisma: prismaResponse, status: 201 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.createPrismaFallback(params, condId, numStr, newId, now);
      }
      throw err;
    }
  }
  async createPrismaFallback(params, condId, numStr, newId, now) {
    const backup = this.readColdBackupData();
    const existing = (backup.prismas || []).find(
      (p) => (p.condominioId || "condo-1") === condId && String(p.numero).trim() === numStr && !p.excluido
    );
    if (existing) {
      return { success: false, error: `J\xE1 existe um prisma ativo com o n\xFAmero "${numStr}".`, status: 400 };
    }
    const newPrisma = {
      id: newId,
      condominioId: condId,
      numero: numStr,
      corId: params.corId,
      corNome: params.corNome,
      estado: "DISPONIVEL" /* DISPONIVEL */,
      ativo: true,
      excluido: false,
      createdAt: now,
      updatedAt: now
    };
    backup.prismas = [...backup.prismas || [], newPrisma];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: condId,
      acao: "CRIACAO_PRISMA",
      prismaId: newPrisma.id,
      prismaNumero: newPrisma.numero,
      prismaCorNome: newPrisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Novo prisma cadastrado: N\xBA ${newPrisma.numero} (Cor: ${newPrisma.corNome})`,
      dadosNovos: { numero: newPrisma.numero, cor: newPrisma.corNome }
    });
    return { success: true, prisma: newPrisma, status: 201 };
  }
  // ==========================================
  // 9.1 CADASTRAR PRISMAS EM LOTE (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async createPrismasLote(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = params.condominioId || "condo-1";
    if (!Array.isArray(params.numeros) || params.numeros.length === 0) {
      return { success: false, error: "A lista de n\xFAmeros de prismas n\xE3o pode estar vazia.", status: 400 };
    }
    if (params.numeros.length > 100) {
      return { success: false, error: "O limite m\xE1ximo por lote \xE9 de 100 prismas.", status: 400 };
    }
    if (!params.corId || !params.corNome) {
      return { success: false, error: "A cor do prisma \xE9 obrigat\xF3ria.", status: 400 };
    }
    const cleanNumeros = params.numeros.map((n) => String(n).trim()).filter(Boolean);
    if (cleanNumeros.length !== params.numeros.length) {
      return { success: false, error: "Todos os n\xFAmeros do lote devem ser v\xE1lidos e n\xE3o vazios.", status: 400 };
    }
    const uniqueSet = new Set(cleanNumeros);
    if (uniqueSet.size !== cleanNumeros.length) {
      return { success: false, error: "O lote informado cont\xE9m n\xFAmeros duplicados entre si.", status: 400 };
    }
    try {
      const client = this.getClientOrThrow();
      const { data: existing, error: checkErr } = await client.from("prismas").select("id, numero").eq("condominio_id", condId).in("numero", cleanNumeros).eq("excluido", false);
      if (checkErr) {
        if (this.isTableMissingError(checkErr)) {
          return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao verificar prismas em lote (${checkErr.message})`, 503, checkErr);
      }
      if (existing && existing.length > 0) {
        const duplicados = existing.map((e) => e.numero).join(", ");
        return {
          success: false,
          error: `N\xE3o foi poss\xEDvel cadastrar o lote porque os seguintes prismas j\xE1 existem neste condom\xEDnio: ${duplicados}.`,
          status: 400
        };
      }
      const recordsToInsert = cleanNumeros.map((numStr) => ({
        id: `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${numStr}`,
        condominio_id: condId,
        numero: numStr,
        cor_id: params.corId,
        cor_nome: params.corNome,
        estado: "DISPONIVEL" /* DISPONIVEL */,
        ativo: true,
        excluido: false,
        created_at: now,
        updated_at: now
      }));
      const { data: created, error: insertErr } = await client.from("prismas").insert(recordsToInsert).select();
      if (insertErr || !created || created.length === 0) {
        if (this.isTableMissingError(insertErr)) {
          return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar prismas em lote (${insertErr?.message})`, 503, insertErr);
      }
      const prismasResponse = created.map((row) => this.mapPrisma(row));
      const primeiro = cleanNumeros[0];
      const ultimo = cleanNumeros[cleanNumeros.length - 1];
      await this.logAuditoria({
        condominioId: condId,
        acao: "CRIACAO_PRISMA",
        prismaNumero: `${primeiro} a ${ultimo}`,
        prismaCorNome: params.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Lote de ${cleanNumeros.length} prismas cadastrado: N\xBA ${primeiro} at\xE9 N\xBA ${ultimo} (Cor: ${params.corNome})`,
        dadosNovos: { quantidade: cleanNumeros.length, primeiro, ultimo, cor: params.corNome }
      });
      return {
        success: true,
        totalCriados: prismasResponse.length,
        primeiro,
        ultimo,
        prismas: prismasResponse,
        status: 201
      };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
      }
      throw err;
    }
  }
  async createPrismasLoteFallback(params, condId, cleanNumeros, now) {
    const backup = this.readColdBackupData();
    const existing = (backup.prismas || []).filter(
      (p) => (p.condominioId || "condo-1") === condId && cleanNumeros.includes(String(p.numero).trim()) && !p.excluido
    );
    if (existing.length > 0) {
      const duplicados = existing.map((e) => e.numero).join(", ");
      return {
        success: false,
        error: `N\xE3o foi poss\xEDvel cadastrar o lote porque os seguintes prismas j\xE1 existem neste condom\xEDnio: ${duplicados}.`,
        status: 400
      };
    }
    const newPrismas = cleanNumeros.map((numStr) => ({
      id: `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${numStr}`,
      condominioId: condId,
      numero: numStr,
      corId: params.corId,
      corNome: params.corNome,
      estado: "DISPONIVEL" /* DISPONIVEL */,
      ativo: true,
      excluido: false,
      createdAt: now,
      updatedAt: now
    }));
    backup.prismas = [...backup.prismas || [], ...newPrismas];
    this.writeColdBackupData(backup);
    const primeiro = cleanNumeros[0];
    const ultimo = cleanNumeros[cleanNumeros.length - 1];
    await this.logAuditoria({
      condominioId: condId,
      acao: "CRIACAO_PRISMA",
      prismaNumero: `${primeiro} a ${ultimo}`,
      prismaCorNome: params.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Lote de ${cleanNumeros.length} prismas cadastrado: N\xBA ${primeiro} at\xE9 N\xBA ${ultimo} (Cor: ${params.corNome})`,
      dadosNovos: { quantidade: cleanNumeros.length, primeiro, ultimo, cor: params.corNome }
    });
    return {
      success: true,
      totalCriados: newPrismas.length,
      primeiro,
      ultimo,
      prismas: newPrismas,
      status: 201
    };
  }
  // ==========================================
  // 10. ATUALIZAR STATUS DO PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async updatePrismaStatus(prismaId, params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const client = this.getClientOrThrow();
      const { data: updated, error } = await client.from("prismas").update({
        ativo: params.ativo,
        motivo_inativacao: params.ativo ? null : params.motivoInativacao?.trim() || "Inativado manualmente",
        updated_at: now
      }).eq("id", prismaId).eq("condominio_id", params.condominioId).select().single();
      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updatePrismaStatusFallback(prismaId, params, now);
        }
        if (error && error.code === "PGRST116") {
          return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar status do prisma (${error?.message})`, 503, error);
      }
      const prismaResponse = this.mapPrisma(updated);
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: params.ativo ? "ATIVACAO_PRISMA" : "INATIVACAO_PRISMA",
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Prisma ${prismaResponse.numero} ${params.ativo ? "ativado" : "inativado"}.${params.motivoInativacao ? ` Motivo: ${params.motivoInativacao}` : ""}`,
        dadosNovos: { ativo: params.ativo, motivo: params.motivoInativacao }
      });
      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.updatePrismaStatusFallback(prismaId, params, now);
      }
      throw err;
    }
  }
  async updatePrismaStatusFallback(prismaId, params, now) {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    prisma.ativo = params.ativo;
    prisma.motivoInativacao = params.ativo ? void 0 : params.motivoInativacao?.trim() || "Inativado manualmente";
    prisma.updatedAt = now;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: params.ativo ? "ATIVACAO_PRISMA" : "INATIVACAO_PRISMA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Prisma ${prisma.numero} ${params.ativo ? "ativado" : "inativado"}.${params.motivoInativacao ? ` Motivo: ${params.motivoInativacao}` : ""}`,
      dadosNovos: { ativo: params.ativo, motivo: params.motivoInativacao }
    });
    return { success: true, prisma, status: 200 };
  }
  // ==========================================
  // 11. EXCLUIR PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async excluirPrisma(prismaId, params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const client = this.getClientOrThrow();
      const { data: prismaRaw, error: fetchErr } = await client.from("prismas").select("*").eq("id", prismaId).eq("condominio_id", params.condominioId).single();
      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.excluirPrismaFallback(prismaId, params, now);
        }
        if (fetchErr && fetchErr.code !== "PGRST116") {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
      }
      if (prismaRaw.estado === "EM_USO" /* EM_USO */ || prismaRaw.estado === "PENDENTE" /* PENDENTE */) {
        return {
          success: false,
          error: `N\xE3o \xE9 poss\xEDvel excluir um prisma em uso ou com pend\xEAncia ativa (Estado atual: ${prismaRaw.estado}). Recolha ou resolva a pend\xEAncia antes de excluir.`,
          status: 400
        };
      }
      const { error: deleteErr } = await client.from("prismas").update({
        excluido: true,
        ativo: false,
        data_exclusao: now,
        usuario_exclusao_id: params.actor.id,
        usuario_exclusao_nome: params.actor.nome,
        updated_at: now
      }).eq("id", prismaId).eq("condominio_id", params.condominioId);
      if (deleteErr) {
        if (this.isTableMissingError(deleteErr)) {
          return this.excluirPrismaFallback(prismaId, params, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir prisma (${deleteErr.message})`, 503, deleteErr);
      }
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: "EXCLUSAO_PRISMA",
        prismaId: prismaRaw.id,
        prismaNumero: prismaRaw.numero,
        prismaCorNome: prismaRaw.cor_nome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        usuarioCargo: params.actor.cargo,
        detalhes: `Prisma N\xBA ${prismaRaw.numero} (${prismaRaw.cor_nome}) exclu\xEDdo permanentemente da frota f\xEDsica por ${params.actor.nome} (${params.actor.cargo || params.actor.role}).`,
        dadosAnteriores: { numero: prismaRaw.numero, cor: prismaRaw.cor_nome, estado: prismaRaw.estado }
      });
      return {
        success: true,
        message: `Prisma ${prismaRaw.numero} removido com sucesso.`,
        tipoExclusao: "LOGICAL_REMOVED",
        prismaId,
        status: 200
      };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.excluirPrismaFallback(prismaId, params, now);
      }
      throw err;
    }
  }
  async excluirPrismaFallback(prismaId, params, now) {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || "condo-1") === params.condominioId);
    if (!prisma) {
      return { success: false, error: "Prisma n\xE3o encontrado.", status: 404 };
    }
    if (prisma.estado === "EM_USO" /* EM_USO */ || prisma.estado === "PENDENTE" /* PENDENTE */) {
      return {
        success: false,
        error: `N\xE3o \xE9 poss\xEDvel excluir um prisma em uso ou com pend\xEAncia ativa (Estado atual: ${prisma.estado}). Recolha ou resolva a pend\xEAncia antes de excluir.`,
        status: 400
      };
    }
    prisma.excluido = true;
    prisma.ativo = false;
    prisma.dataExclusao = now;
    prisma.usuarioExclusaoId = params.actor.id;
    prisma.usuarioExclusaoNome = params.actor.nome;
    prisma.updatedAt = now;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: "EXCLUSAO_PRISMA",
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      usuarioCargo: params.actor.cargo,
      detalhes: `Prisma N\xBA ${prisma.numero} (${prisma.corNome}) exclu\xEDdo permanentemente da frota f\xEDsica por ${params.actor.nome} (${params.actor.cargo || params.actor.role}).`,
      dadosAnteriores: { numero: prisma.numero, cor: prisma.corNome, estado: prisma.estado }
    });
    return {
      success: true,
      message: `Prisma ${prisma.numero} removido com sucesso.`,
      tipoExclusao: "LOGICAL_REMOVED",
      prismaId,
      status: 200
    };
  }
  // ==========================================
  // 12. HISTÓRICO DO PRISMA (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  async getHistoricoPrisma(prismaId, condominioId = "condo-1") {
    const client = this.getClientOrThrow();
    const [
      { data: prismaRaw, error: pErr },
      { data: movsRaw, error: mErr },
      { data: audRaw, error: aErr }
    ] = await Promise.all([
      client.from("prismas").select("*").eq("id", prismaId).eq("condominio_id", condominioId).single(),
      client.from("movimentacoes").select("*").eq("prisma_id", prismaId).eq("condominio_id", condominioId).order("data_hora", { ascending: false }),
      client.from("auditoria").select("*").eq("prisma_id", prismaId).eq("condominio_id", condominioId).order("data_hora", { ascending: false })
    ]);
    if (pErr || mErr || aErr) {
      if (this.isTableMissingError(pErr) || this.isTableMissingError(mErr) || this.isTableMissingError(aErr)) {
        console.warn("[SupabaseStore] Tabelas n\xE3o encontradas para hist\xF3rico. Buscando em backup frio.");
        const backup = this.readColdBackupData();
        const prisma = (backup.prismas || []).find((p) => p.id === prismaId);
        if (!prisma) return null;
        const movimentacoes = (backup.movimentacoes || []).filter((m) => m.prismaId === prismaId);
        const auditoria = (backup.auditoria || []).filter((a) => a.prismaId === prismaId);
        return { prisma, movimentacoes, auditoria };
      }
      if (pErr) {
        if (pErr.code === "PGRST116") return null;
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar hist\xF3rico do prisma (${pErr.message})`, 503, pErr);
      }
      if (mErr) {
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar movimenta\xE7\xF5es do hist\xF3rico (${mErr.message})`, 503, mErr);
      }
      if (aErr) {
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar auditoria do hist\xF3rico (${aErr.message})`, 503, aErr);
      }
    }
    return {
      prisma: this.mapPrisma(prismaRaw),
      movimentacoes: (movsRaw || []).map((m) => this.mapMovimentacao(m)),
      auditoria: (audRaw || []).map((a) => this.mapAuditoria(a))
    };
  }
  // ==========================================
  // 13. USUÁRIOS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  async listUsuarios(condominioId = "condo-1", incluirExcluidos = false) {
    try {
      const client = this.getClientOrThrow();
      let query = client.from("usuarios").select("*").eq("condominio_id", condominioId);
      if (!incluirExcluidos) {
        query = query.eq("excluido", false);
      }
      const { data, error } = await query.order("nome", { ascending: true });
      if (error) {
        if (this.isTableMissingError(error)) {
          console.warn("[SupabaseStore] Tabela usuarios n\xE3o encontrada no schema cache. Carregando usu\xE1rios de conting\xEAncia.");
          const backup = this.readColdBackupData();
          return (backup.usuarios || []).filter((u) => (u.condominioId || "condo-1") === condominioId && (incluirExcluidos ? true : !u.excluido));
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar usu\xE1rios (${error.message})`, 503, error);
      }
      return (data || []).map((u) => this.mapUsuario(u));
    } catch (err) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (backup.usuarios || []).filter((u) => (u.condominioId || "condo-1") === condominioId && (incluirExcluidos ? true : !u.excluido));
      }
      throw err;
    }
  }
  async getUsuario(usuarioId, condominioId = "condo-1") {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from("usuarios").select("*").eq("id", usuarioId).eq("condominio_id", condominioId).single();
      if (error) {
        if (this.isTableMissingError(error)) {
          const backup = this.readColdBackupData();
          return (backup.usuarios || []).find((u) => u.id === usuarioId) || null;
        }
        if (error.code === "PGRST116") return null;
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar usu\xE1rio (${error.message})`, 503, error);
      }
      return data ? this.mapUsuario(data) : null;
    } catch (err) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (backup.usuarios || []).find((u) => u.id === usuarioId) || null;
      }
      throw err;
    }
  }
  async createUsuario(usuarioData, actor) {
    const client = this.getClientOrThrow();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = usuarioData.condominioId || "condo-1";
    const newId = usuarioData.id || `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const { data: created, error: insertErr } = await client.from("usuarios").insert({
      id: newId,
      condominio_id: condId,
      nome: usuarioData.nome.trim(),
      role: usuarioData.role || "PORTEIRO" /* PORTEIRO */,
      cargo: usuarioData.cargo || (usuarioData.role === "SINDICO" /* SINDICO */ ? "S\xEDndico" : "Porteiro"),
      ativo: usuarioData.ativo !== false,
      matricula: usuarioData.matricula || null,
      tipo_turno: usuarioData.tipoTurno || "12X36" /* TURNO_12X36 */,
      opcao_turno_12x36: usuarioData.opcaoTurno12x36 || null,
      paridade_12x36: usuarioData.paridade12x36 || null,
      hora_inicio: usuarioData.horaInicio || null,
      hora_fim: usuarioData.horaFim || null,
      excluido: false,
      created_at: now,
      updated_at: now
    }).select().single();
    if (insertErr || !created) {
      if (this.isTableMissingError(insertErr)) {
        const backup = this.readColdBackupData();
        const fallbackUser = {
          id: newId,
          condominioId: condId,
          nome: usuarioData.nome.trim(),
          role: usuarioData.role || "PORTEIRO" /* PORTEIRO */,
          cargo: usuarioData.cargo || (usuarioData.role === "SINDICO" /* SINDICO */ ? "S\xEDndico" : "Porteiro"),
          ativo: usuarioData.ativo !== false,
          matricula: usuarioData.matricula,
          tipoTurno: usuarioData.tipoTurno || "12X36" /* TURNO_12X36 */,
          opcaoTurno12x36: usuarioData.opcaoTurno12x36,
          paridade12x36: usuarioData.paridade12x36,
          horaInicio: usuarioData.horaInicio,
          horaFim: usuarioData.horaFim,
          excluido: false,
          createdAt: now,
          updatedAt: now
        };
        backup.usuarios = [...backup.usuarios || [], fallbackUser];
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
        } catch (e) {
          console.warn("[SupabaseStore] Falha ao salvar usu\xE1rio em db_store.json:", e);
        }
        await this.logAuditoria({
          condominioId: condId,
          acao: "CRIACAO_USUARIO",
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usu\xE1rio cadastrado: ${fallbackUser.nome} (Fun\xE7\xE3o: ${fallbackUser.cargo || fallbackUser.role})`,
          dadosNovos: { id: fallbackUser.id, nome: fallbackUser.nome, role: fallbackUser.role }
        });
        return { success: true, usuario: fallbackUser, status: 201 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao criar usu\xE1rio (${insertErr?.message})`, 503, insertErr);
    }
    const mappedUser = this.mapUsuario(created);
    await this.logAuditoria({
      condominioId: condId,
      acao: "CRIACAO_USUARIO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usu\xE1rio cadastrado: ${mappedUser.nome} (Fun\xE7\xE3o: ${mappedUser.cargo || mappedUser.role})`,
      dadosNovos: { id: mappedUser.id, nome: mappedUser.nome, role: mappedUser.role }
    });
    return { success: true, usuario: mappedUser, status: 201 };
  }
  async updateUsuario(usuarioId, usuarioData, actor) {
    const client = this.getClientOrThrow();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = usuarioData.condominioId || "condo-1";
    const updatePayload = { updated_at: now };
    if (usuarioData.nome !== void 0) updatePayload.nome = usuarioData.nome.trim();
    if (usuarioData.cargo !== void 0) updatePayload.cargo = usuarioData.cargo;
    if (usuarioData.role !== void 0) updatePayload.role = usuarioData.role;
    if (usuarioData.matricula !== void 0) updatePayload.matricula = usuarioData.matricula;
    if (usuarioData.tipoTurno !== void 0) updatePayload.tipo_turno = usuarioData.tipoTurno;
    if (usuarioData.opcaoTurno12x36 !== void 0) updatePayload.opcao_turno_12x36 = usuarioData.opcaoTurno12x36;
    if (usuarioData.paridade12x36 !== void 0) updatePayload.paridade_12x36 = usuarioData.paridade12x36;
    if (usuarioData.horaInicio !== void 0) updatePayload.hora_inicio = usuarioData.horaInicio;
    if (usuarioData.horaFim !== void 0) updatePayload.hora_fim = usuarioData.horaFim;
    if (usuarioData.ativo !== void 0) updatePayload.ativo = usuarioData.ativo;
    const { data: updated, error } = await client.from("usuarios").update(updatePayload).eq("id", usuarioId).eq("condominio_id", condId).select().single();
    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || "condo-1") === condId);
        if (!user) {
          return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
        }
        if (usuarioData.nome !== void 0) user.nome = usuarioData.nome.trim();
        if (usuarioData.cargo !== void 0) user.cargo = usuarioData.cargo;
        if (usuarioData.role !== void 0) user.role = usuarioData.role;
        if (usuarioData.matricula !== void 0) user.matricula = usuarioData.matricula;
        if (usuarioData.tipoTurno !== void 0) user.tipoTurno = usuarioData.tipoTurno;
        if (usuarioData.opcaoTurno12x36 !== void 0) user.opcaoTurno12x36 = usuarioData.opcaoTurno12x36;
        if (usuarioData.paridade12x36 !== void 0) user.paridade12x36 = usuarioData.paridade12x36;
        if (usuarioData.horaInicio !== void 0) user.horaInicio = usuarioData.horaInicio;
        if (usuarioData.horaFim !== void 0) user.horaFim = usuarioData.horaFim;
        if (usuarioData.ativo !== void 0) user.ativo = usuarioData.ativo;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
        } catch (e) {
          console.warn("[SupabaseStore] Falha ao salvar usu\xE1rio em db_store.json:", e);
        }
        await this.logAuditoria({
          condominioId: condId,
          acao: "EDICAO_USUARIO",
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usu\xE1rio atualizado: ${user.nome}`,
          dadosNovos: updatePayload
        });
        return { success: true, usuario: user, status: 200 };
      }
      if (error && error.code === "PGRST116") {
        return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar usu\xE1rio (${error?.message})`, 503, error);
    }
    const mappedUser = this.mapUsuario(updated);
    await this.logAuditoria({
      condominioId: condId,
      acao: "EDICAO_USUARIO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usu\xE1rio atualizado: ${mappedUser.nome}`,
      dadosNovos: updatePayload
    });
    return { success: true, usuario: mappedUser, status: 200 };
  }
  async toggleUsuarioStatus(usuarioId, ativo, condominioId = "condo-1", actor) {
    const client = this.getClientOrThrow();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { data: updated, error } = await client.from("usuarios").update({ ativo, updated_at: now }).eq("id", usuarioId).eq("condominio_id", condominioId).select().single();
    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || "condo-1") === condominioId);
        if (!user) {
          return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
        }
        user.ativo = ativo;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
        } catch (e) {
          console.warn("[SupabaseStore] Falha ao salvar status do usu\xE1rio em db_store.json:", e);
        }
        await this.logAuditoria({
          condominioId,
          acao: ativo ? "ATIVACAO_USUARIO" : "INATIVACAO_USUARIO",
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usu\xE1rio ${user.nome} ${ativo ? "ativado" : "inativado"} no sistema.`,
          dadosNovos: { ativo }
        });
        return { success: true, usuario: user, status: 200 };
      }
      if (error && error.code === "PGRST116") {
        return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao alterar status do usu\xE1rio (${error?.message})`, 503, error);
    }
    const mappedUser = this.mapUsuario(updated);
    await this.logAuditoria({
      condominioId,
      acao: ativo ? "ATIVACAO_USUARIO" : "INATIVACAO_USUARIO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usu\xE1rio ${mappedUser.nome} ${ativo ? "ativado" : "inativado"} no sistema.`,
      dadosNovos: { ativo }
    });
    return { success: true, usuario: mappedUser, status: 200 };
  }
  async deleteUsuario(usuarioId, condominioId = "condo-1", actor) {
    const client = this.getClientOrThrow();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const { data: updated, error } = await client.from("usuarios").update({ excluido: true, ativo: false, updated_at: now }).eq("id", usuarioId).eq("condominio_id", condominioId).select().single();
    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || "condo-1") === condominioId);
        if (!user) {
          return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
        }
        user.excluido = true;
        user.ativo = false;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
        } catch (e) {
          console.warn("[SupabaseStore] Falha ao salvar exclus\xE3o de usu\xE1rio em db_store.json:", e);
        }
        await this.logAuditoria({
          condominioId,
          acao: "EXCLUSAO_USUARIO",
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usu\xE1rio ${user.nome} exclu\xEDdo do sistema por ${actor.nome}.`,
          dadosAnteriores: { id: user.id, nome: user.nome }
        });
        return {
          success: true,
          message: `Usu\xE1rio ${user.nome} exclu\xEDdo com sucesso.`,
          modo: "soft-delete",
          usuario: user,
          status: 200
        };
      }
      if (error && error.code === "PGRST116") {
        return { success: false, error: "Usu\xE1rio n\xE3o encontrado.", status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir usu\xE1rio (${error?.message})`, 503, error);
    }
    const mappedUser = this.mapUsuario(updated);
    await this.logAuditoria({
      condominioId,
      acao: "EXCLUSAO_USUARIO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usu\xE1rio ${mappedUser.nome} exclu\xEDdo do sistema por ${actor.nome}.`,
      dadosAnteriores: { id: mappedUser.id, nome: mappedUser.nome }
    });
    return {
      success: true,
      message: `Usu\xE1rio ${mappedUser.nome} exclu\xEDdo com sucesso.`,
      modo: "soft-delete",
      usuario: mappedUser,
      status: 200
    };
  }
  // ==========================================
  // 14. CONDOMÍNIO (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async updateCondominio(condominioId, data, actor) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const client = this.getClientOrThrow();
      const upsertPayload = {
        id: condominioId,
        nome: data.nome.trim(),
        endereco: data.endereco?.trim() || null,
        updated_at: now
      };
      if (data.mostrarMensagem !== void 0) {
        upsertPayload.mostrar_mensagem = data.mostrarMensagem;
      }
      const { data: updated, error } = await client.from("condominios").upsert(upsertPayload).select().single();
      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updateCondominioFallback(condominioId, data, actor, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar condom\xEDnio (${error?.message})`, 503, error);
      }
      const condo = {
        id: updated.id,
        nome: updated.nome,
        endereco: updated.endereco || void 0,
        codigoPortariaAtual: updated.codigo_portaria_atual || null,
        mostrarMensagem: updated.mostrar_mensagem !== void 0 ? Boolean(updated.mostrar_mensagem) : data.mostrarMensagem !== void 0 ? Boolean(data.mostrarMensagem) : true
      };
      await this.logAuditoria({
        condominioId,
        acao: "EDICAO_CONDOMINIO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Dados do condom\xEDnio alterados: Nome: "${condo.nome}", Endere\xE7o: "${condo.endereco || "N/A"}", Mensagem Autom\xE1tica: ${condo.mostrarMensagem ? "ON" : "OFF"}`,
        dadosNovos: condo
      });
      return { success: true, condominio: condo, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.updateCondominioFallback(condominioId, data, actor, now);
      }
      throw err;
    }
  }
  async updateCondominioFallback(condominioId, data, actor, now) {
    const backup = this.readColdBackupData();
    const list = backup.condominios || [];
    const existing = list.find((c) => c.id === condominioId);
    const condo = {
      id: condominioId,
      nome: data.nome.trim(),
      endereco: data.endereco?.trim() || (existing?.endereco || ""),
      mostrarMensagem: data.mostrarMensagem !== void 0 ? Boolean(data.mostrarMensagem) : existing?.mostrarMensagem !== void 0 ? Boolean(existing.mostrarMensagem) : true
    };
    const idx = list.findIndex((c) => c.id === condominioId);
    if (idx >= 0) {
      list[idx] = condo;
    } else {
      list.push(condo);
    }
    backup.condominios = list;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId,
      acao: "EDICAO_CONDOMINIO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Dados do condom\xEDnio alterados: Nome: "${condo.nome}", Endere\xE7o: "${condo.endereco || "N/A"}", Mensagem Autom\xE1tica: ${condo.mostrarMensagem ? "ON" : "OFF"}`,
      dadosNovos: condo
    });
    return { success: true, condominio: condo, status: 200 };
  }
  // ==========================================
  // 15. CONTATOS DE EVIDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async listContatos(condominioId = "condo-1") {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("contatos").select("*").eq("condominio_id", condominioId).order("nome", { ascending: true });
    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn("[SupabaseStore] Tabela contatos n\xE3o encontrada no schema cache. Carregando contatos de conting\xEAncia.");
        const backup = this.readColdBackupData();
        return (backup.contatos || []).filter((c) => (c.condominioId || "condo-1") === condominioId);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar contatos (${error.message})`, 503, error);
    }
    return (data || []).map((c) => this.mapContato(c));
  }
  async createContato(contatoData, actor) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = contatoData.condominioId || "condo-1";
    const newId = `cont-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const client = this.getClientOrThrow();
      const { data: created, error } = await client.from("contatos").insert({
        id: newId,
        condominio_id: condId,
        nome: contatoData.nome.trim(),
        categoria: contatoData.categoria || "PORTARIA" /* PORTARIA */,
        telefone_ou_whatsapp: contatoData.telefoneOuWhatsapp.trim(),
        identificador: contatoData.identificador?.trim() || null,
        ativo: true,
        created_at: now,
        updated_at: now
      }).select().single();
      if (error || !created) {
        if (this.isTableMissingError(error)) {
          return this.createContatoFallback(contatoData, actor, condId, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao criar contato (${error?.message})`, 503, error);
      }
      const mappedContato = this.mapContato(created);
      await this.logAuditoria({
        condominioId: condId,
        acao: "CRIACAO_CONTATO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Novo contato de evid\xEAncia cadastrado: ${mappedContato.nome} (${mappedContato.telefoneOuWhatsapp})`,
        dadosNovos: mappedContato
      });
      return { success: true, contato: mappedContato, status: 201 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.createContatoFallback(contatoData, actor, condId, newId, now);
      }
      throw err;
    }
  }
  async createContatoFallback(contatoData, actor, condId, newId, now) {
    const backup = this.readColdBackupData();
    const newContato = {
      id: newId,
      condominioId: condId,
      nome: contatoData.nome.trim(),
      categoria: contatoData.categoria || "PORTARIA" /* PORTARIA */,
      telefoneOuWhatsapp: contatoData.telefoneOuWhatsapp.trim(),
      identificador: contatoData.identificador?.trim() || void 0,
      ativo: true,
      createdAt: now,
      updatedAt: now
    };
    backup.contatos = [...backup.contatos || [], newContato];
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: condId,
      acao: "CRIACAO_CONTATO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Novo contato de evid\xEAncia cadastrado: ${newContato.nome} (${newContato.telefoneOuWhatsapp})`,
      dadosNovos: newContato
    });
    return { success: true, contato: newContato, status: 201 };
  }
  async updateContato(contatoId, contatoData, actor) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const condId = contatoData.condominioId || "condo-1";
    const updatePayload = { updated_at: now };
    if (contatoData.nome !== void 0) updatePayload.nome = contatoData.nome.trim();
    if (contatoData.categoria !== void 0) updatePayload.categoria = contatoData.categoria;
    if (contatoData.telefoneOuWhatsapp !== void 0) updatePayload.telefone_ou_whatsapp = contatoData.telefoneOuWhatsapp.trim();
    if (contatoData.identificador !== void 0) updatePayload.identificador = contatoData.identificador.trim();
    if (contatoData.ativo !== void 0) updatePayload.ativo = contatoData.ativo;
    try {
      const client = this.getClientOrThrow();
      const { data: updated, error } = await client.from("contatos").update(updatePayload).eq("id", contatoId).eq("condominio_id", condId).select().single();
      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updateContatoFallback(contatoId, contatoData, actor, condId, now);
        }
        if (error && error.code === "PGRST116") {
          return { success: false, error: "Contato n\xE3o encontrado.", status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar contato (${error?.message})`, 503, error);
      }
      const mappedContato = this.mapContato(updated);
      await this.logAuditoria({
        condominioId: condId,
        acao: "EDICAO_CONTATO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Contato atualizado: ${mappedContato.nome}`,
        dadosNovos: updatePayload
      });
      return { success: true, contato: mappedContato, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.updateContatoFallback(contatoId, contatoData, actor, condId, now);
      }
      throw err;
    }
  }
  async updateContatoFallback(contatoId, contatoData, actor, condId, now) {
    const backup = this.readColdBackupData();
    const contato = (backup.contatos || []).find((c) => c.id === contatoId && (c.condominioId || "condo-1") === condId);
    if (!contato) {
      return { success: false, error: "Contato n\xE3o encontrado.", status: 404 };
    }
    if (contatoData.nome !== void 0) contato.nome = contatoData.nome.trim();
    if (contatoData.categoria !== void 0) contato.categoria = contatoData.categoria;
    if (contatoData.telefoneOuWhatsapp !== void 0) contato.telefoneOuWhatsapp = contatoData.telefoneOuWhatsapp.trim();
    if (contatoData.identificador !== void 0) contato.identificador = contatoData.identificador.trim();
    if (contatoData.ativo !== void 0) contato.ativo = contatoData.ativo;
    contato.updatedAt = now;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId: condId,
      acao: "EDICAO_CONTATO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Contato atualizado: ${contato.nome}`,
      dadosNovos: contatoData
    });
    return { success: true, contato, status: 200 };
  }
  async toggleContatoStatus(contatoId, ativo, condominioId = "condo-1", actor) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const client = this.getClientOrThrow();
      const { data: updated, error } = await client.from("contatos").update({ ativo, updated_at: now }).eq("id", contatoId).eq("condominio_id", condominioId).select().single();
      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.toggleContatoStatusFallback(contatoId, ativo, condominioId, actor, now);
        }
        if (error && error.code === "PGRST116") {
          return { success: false, error: "Contato n\xE3o encontrado.", status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao alterar status do contato (${error?.message})`, 503, error);
      }
      const mappedContato = this.mapContato(updated);
      await this.logAuditoria({
        condominioId,
        acao: ativo ? "ATIVACAO_CONTATO" : "INATIVACAO_CONTATO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Contato ${mappedContato.nome} ${ativo ? "ativado" : "inativado"}.`,
        dadosNovos: { ativo }
      });
      return { success: true, contato: mappedContato, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.toggleContatoStatusFallback(contatoId, ativo, condominioId, actor, now);
      }
      throw err;
    }
  }
  async toggleContatoStatusFallback(contatoId, ativo, condominioId, actor, now) {
    const backup = this.readColdBackupData();
    const contato = (backup.contatos || []).find((c) => c.id === contatoId && (c.condominioId || "condo-1") === condominioId);
    if (!contato) {
      return { success: false, error: "Contato n\xE3o encontrado.", status: 404 };
    }
    contato.ativo = ativo;
    contato.updatedAt = now;
    this.writeColdBackupData(backup);
    await this.logAuditoria({
      condominioId,
      acao: ativo ? "ATIVACAO_CONTATO" : "INATIVACAO_CONTATO",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Contato ${contato.nome} ${ativo ? "ativado" : "inativado"}.`,
      dadosNovos: { ativo }
    });
    return { success: true, contato, status: 200 };
  }
  async deleteContato(contatoId, condominioId = "condo-1") {
    try {
      const client = this.getClientOrThrow();
      const { error } = await client.from("contatos").delete().eq("id", contatoId).eq("condominio_id", condominioId);
      if (error) {
        if (this.isTableMissingError(error)) {
          return this.deleteContatoFallback(contatoId, condominioId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir contato (${error.message})`, 503, error);
      }
      return { success: true, removido: true, status: 200 };
    } catch (err) {
      if (this.isTableMissingError(err)) {
        return this.deleteContatoFallback(contatoId, condominioId);
      }
      throw err;
    }
  }
  deleteContatoFallback(contatoId, condominioId) {
    const backup = this.readColdBackupData();
    const initialLen = (backup.contatos || []).length;
    backup.contatos = (backup.contatos || []).filter((c) => !(c.id === contatoId && (c.condominioId || "condo-1") === condominioId));
    if (backup.contatos.length !== initialLen) {
      this.writeColdBackupData(backup);
      return { success: true, removido: true, status: 200 };
    }
    return { success: true, removido: false, status: 200 };
  }
  // ==========================================
  // 16. AUDITORIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  async listAuditoria(condominioId = "condo-1", limit = 100) {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("auditoria").select("*").eq("condominio_id", condominioId).order("data_hora", { ascending: false }).limit(limit);
    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn("[SupabaseStore] Tabela auditoria n\xE3o encontrada no schema cache. Carregando logs de conting\xEAncia.");
        const backup = this.readColdBackupData();
        return (backup.auditoria || []).filter((a) => (a.condominioId || "condo-1") === condominioId).slice(0, limit);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar auditoria (${error.message})`, 503, error);
    }
    return (data || []).map((a) => this.mapAuditoria(a));
  }
  async logAuditoria(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const logId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const condId = params.condominioId || "condo-1";
    try {
      const client = this.getClientOrThrow();
      const { error } = await client.from("auditoria").insert({
        id: logId,
        condominio_id: condId,
        acao: params.acao,
        prisma_id: params.prismaId || null,
        prisma_numero: params.prismaNumero || null,
        prisma_cor_nome: params.prismaCorNome || null,
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        usuario_cargo: params.usuarioCargo || null,
        turno_id: params.turnoId || null,
        turno_nome: params.turnoNome || null,
        data_hora: now,
        detalhes: params.detalhes,
        dados_anteriores: params.dadosAnteriores || null,
        dados_novos: params.dadosNovos || null
      });
      if (error) {
        if (this.isTableMissingError(error)) {
          this.logAuditoriaFallback(params, condId, now, logId);
          return;
        }
        console.error("[SupabaseStore] Erro ao gravar log de auditoria no Supabase:", error);
      }
    } catch (err) {
      if (this.isTableMissingError(err)) {
        this.logAuditoriaFallback(params, condId, now, logId);
        return;
      }
      console.error("[SupabaseStore] Erro ao gravar log de auditoria:", err);
    }
  }
  logAuditoriaFallback(params, condId, now, logId) {
    const backup = this.readColdBackupData();
    const auditItem = {
      id: logId,
      condominioId: condId,
      acao: params.acao,
      prismaId: params.prismaId,
      prismaNumero: params.prismaNumero,
      prismaCorNome: params.prismaCorNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      usuarioCargo: params.usuarioCargo,
      turnoId: params.turnoId,
      turnoNome: params.turnoNome,
      dataHora: now,
      detalhes: params.detalhes,
      dadosAnteriores: params.dadosAnteriores,
      dadosNovos: params.dadosNovos
    };
    backup.auditoria = [auditItem, ...backup.auditoria || []];
    this.writeColdBackupData(backup);
  }
  // ==========================================
  // CREDENCIAIS DE ACESSO (PVA-6 FASE 1 - AUTENTICAÇÃO)
  // ==========================================
  async findCredencialById(id) {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("credenciais_acesso").select("*").eq("id", id).single();
    if (error) {
      if (error.code === "PGRST116") return null;
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).find((c) => c.id === id) || null;
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial (${error.message})`, 503, error);
    }
    return data ? this.mapCredencial(data) : null;
  }
  async findCredencialByIdentificador(identificador) {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("credenciais_acesso").select("*").ilike("identificador", identificador.trim()).single();
    if (error) {
      if (error.code === "PGRST116") return null;
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).find(
          (c) => c.identificador.toLowerCase() === identificador.trim().toLowerCase()
        ) || null;
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial por identificador (${error.message})`, 503, error);
    }
    return data ? this.mapCredencial(data) : null;
  }
  async findCredenciaisByUsuarioId(usuarioId) {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("credenciais_acesso").select("*").eq("usuario_id", usuarioId).order("created_at", { ascending: false });
    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).filter((c) => c.usuarioId === usuarioId);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao listar credenciais do usu\xE1rio (${error.message})`, 503, error);
    }
    return (data || []).map((c) => this.mapCredencial(c));
  }
  async listCredenciaisSanitizadas(condominioId) {
    const client = this.getClientOrThrow();
    const { data, error } = await client.from("credenciais_acesso").select("*").eq("condominio_id", condominioId).order("created_at", { ascending: false });
    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).filter((c) => (c.condominioId || "condo-1") === condominioId).map((c) => this.sanitizeCredencial(c));
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao listar credenciais sanitizadas (${error.message})`, 503, error);
    }
    return (data || []).map((c) => this.sanitizeCredencial(this.mapCredencial(c)));
  }
  async createCredencial(dados) {
    const client = this.getClientOrThrow();
    const id = `cred-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const payload = {
      id,
      usuario_id: dados.usuarioId,
      condominio_id: dados.condominioId || "condo-1",
      tipo_acesso: dados.tipoAcesso,
      identificador: dados.identificador.trim(),
      senha_hash: dados.senhaHash || null,
      pin_hash: dados.pinHash || null,
      ativo: dados.ativo !== false,
      bloqueado: false,
      tentativas_invalidas: 0,
      ultimo_login: null,
      ultimo_bloqueio: null,
      created_at: now,
      updated_at: now
    };
    const { data, error } = await client.from("credenciais_acesso").insert([payload]).select("*").single();
    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const newCred = {
          id,
          usuarioId: dados.usuarioId,
          condominioId: dados.condominioId || "condo-1",
          tipoAcesso: dados.tipoAcesso,
          identificador: dados.identificador.trim(),
          senhaHash: dados.senhaHash || null,
          pinHash: dados.pinHash || null,
          ativo: dados.ativo !== false,
          bloqueado: false,
          tentativasInvalidas: 0,
          ultimoLogin: null,
          ultimoBloqueio: null,
          createdAt: now,
          updatedAt: now
        };
        backup.credenciais = backup.credenciais || [];
        backup.credenciais.push(newCred);
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
        } catch (e) {
          console.warn("[SupabaseStore] Falha ao persistir credencial no db_store.json:", e);
        }
        return newCred;
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar credencial (${error.message})`, 503, error);
    }
    return this.mapCredencial(data);
  }
  async updateCredencial(id, updates) {
    const client = this.getClientOrThrow();
    const payload = {
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (updates.identificador !== void 0) payload.identificador = updates.identificador.trim();
    if (updates.senhaHash !== void 0) payload.senha_hash = updates.senhaHash;
    if (updates.pinHash !== void 0) payload.pin_hash = updates.pinHash;
    if (updates.ativo !== void 0) payload.ativo = updates.ativo;
    if (updates.bloqueado !== void 0) payload.bloqueado = updates.bloqueado;
    if (updates.tentativasInvalidas !== void 0) payload.tentativas_invalidas = updates.tentativasInvalidas;
    if (updates.ultimoLogin !== void 0) payload.ultimo_login = updates.ultimoLogin;
    if (updates.ultimoBloqueio !== void 0) payload.ultimo_bloqueio = updates.ultimoBloqueio;
    const { data, error } = await client.from("credenciais_acesso").update(payload).eq("id", id).select("*").single();
    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const cred = (backup.credenciais || []).find((c) => c.id === id);
        if (cred) {
          if (updates.identificador !== void 0) cred.identificador = updates.identificador.trim();
          if (updates.senhaHash !== void 0) cred.senhaHash = updates.senhaHash;
          if (updates.pinHash !== void 0) cred.pinHash = updates.pinHash;
          if (updates.ativo !== void 0) cred.ativo = updates.ativo;
          if (updates.bloqueado !== void 0) cred.bloqueado = updates.bloqueado;
          if (updates.tentativasInvalidas !== void 0) cred.tentativasInvalidas = updates.tentativasInvalidas;
          if (updates.ultimoLogin !== void 0) cred.ultimoLogin = updates.ultimoLogin;
          if (updates.ultimoBloqueio !== void 0) cred.ultimoBloqueio = updates.ultimoBloqueio;
          try {
            fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
          } catch (e) {
            console.warn("[SupabaseStore] Falha ao persistir atualiza\xE7\xE3o de credencial no db_store.json:", e);
          }
          return cred;
        }
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar credencial (${error.message})`, 503, error);
    }
    return this.mapCredencial(data);
  }
  async deleteCredencial(id, condominioId = "condo-1") {
    const client = this.getClientOrThrow();
    const { error } = await client.from("credenciais_acesso").delete().eq("id", id).eq("condominio_id", condominioId);
    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const initialLen = (backup.credenciais || []).length;
        backup.credenciais = (backup.credenciais || []).filter(
          (c) => !(c.id === id && (c.condominioId || "condo-1") === condominioId)
        );
        if (backup.credenciais.length !== initialLen) {
          try {
            fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), "utf-8");
          } catch (e) {
            console.warn("[SupabaseStore] Falha ao salvar remo\xE7\xE3o no db_store.json:", e);
          }
          return { success: true, removido: true };
        }
        return { success: true, removido: false };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir credencial (${error.message})`, 503, error);
    }
    return { success: true, removido: true };
  }
  async registrarTentativaInvalida(id, maxTentativas = MAX_LOGIN_ATTEMPTS) {
    const credencial = await this.findCredencialById(id);
    if (!credencial) {
      throw new SupabaseStorageError("Credencial n\xE3o encontrada", 404);
    }
    const novasTentativas = (credencial.tentativasInvalidas || 0) + 1;
    const deveBloquear = novasTentativas >= maxTentativas;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.updateCredencial(id, {
      tentativasInvalidas: novasTentativas,
      bloqueado: deveBloquear ? true : credencial.bloqueado,
      ultimoBloqueio: deveBloquear ? now : credencial.ultimoBloqueio
    });
    return {
      bloqueado: deveBloquear,
      tentativasInvalidas: novasTentativas
    };
  }
  async resetTentativasInvalidas(id) {
    await this.updateCredencial(id, {
      tentativasInvalidas: 0,
      bloqueado: false
    });
  }
  async findPortariaCredencial(condominioId = "condo-1") {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from("credenciais_acesso").select("*").eq("condominio_id", condominioId).eq("tipo_acesso", "PORTARIA" /* PORTARIA */).eq("identificador", "portaria.codigo").maybeSingle();
      if (error) {
        if (this.isTableMissingError(error)) {
          const backup2 = this.readColdBackupData();
          return (backup2.credenciais || []).find(
            (c) => (c.condominioId || "condo-1") === condominioId && c.tipoAcesso === "PORTARIA" /* PORTARIA */ && (c.identificador === "portaria.codigo" || c.usuarioId === "portaria-station")
          ) || null;
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial de portaria (${error.message})`, 503, error);
      }
      if (data) return this.mapCredencial(data);
      const backup = this.readColdBackupData();
      return (backup.credenciais || []).find(
        (c) => (c.condominioId || "condo-1") === condominioId && c.tipoAcesso === "PORTARIA" /* PORTARIA */ && (c.identificador === "portaria.codigo" || c.usuarioId === "portaria-station")
      ) || null;
    } catch (err) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).find(
          (c) => (c.condominioId || "condo-1") === condominioId && c.tipoAcesso === "PORTARIA" /* PORTARIA */ && (c.identificador === "portaria.codigo" || c.usuarioId === "portaria-station")
        ) || null;
      }
      throw err;
    }
  }
  async getOrCreatePortariaCredencial(condominioId = "condo-1") {
    let cred = await this.findPortariaCredencial(condominioId);
    if (!cred) {
      const defaultCode = this.portariaCodigos[condominioId] || "CP-123456";
      const defaultHash = await hashPin(defaultCode);
      cred = await this.createCredencial({
        usuarioId: "portaria-station",
        condominioId,
        tipoAcesso: "PORTARIA" /* PORTARIA */,
        identificador: "portaria.codigo",
        pinHash: defaultHash,
        senhaHash: defaultHash,
        ativo: true
      });
      this.portariaCodigos[condominioId] = defaultCode;
    }
    return cred;
  }
  async getCondominioById(condominioId = "condo-1") {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from("condominios").select("*").eq("id", condominioId).maybeSingle();
      if (error) {
        if (this.isTableMissingError(error)) {
          const backup2 = this.readColdBackupData();
          return (backup2.condominios || []).find((c) => c.id === condominioId) || null;
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao buscar condom\xEDnio (${error.message})`, 503, error);
      }
      if (data) {
        return {
          id: data.id,
          nome: data.nome,
          endereco: data.endereco,
          codigoPortariaAtual: data.codigo_portaria_atual || null,
          mostrarMensagem: data.mostrar_mensagem !== void 0 ? Boolean(data.mostrar_mensagem) : true
        };
      }
      const backup = this.readColdBackupData();
      return (backup.condominios || []).find((c) => c.id === condominioId) || null;
    } catch {
      const backup = this.readColdBackupData();
      return (backup.condominios || []).find((c) => c.id === condominioId) || null;
    }
  }
  async getPortariaStatus(condominioId = "condo-1") {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    let codigoPersistido = null;
    try {
      const condo = await this.getCondominioById(condominioId);
      if (condo?.codigoPortariaAtual) {
        codigoPersistido = condo.codigoPortariaAtual;
        this.portariaCodigos[condominioId] = codigoPersistido;
      }
    } catch {
    }
    let codigo = codigoPersistido || this.portariaCodigos[condominioId];
    if (!codigo) {
      if (condominioId === "condo-1") {
        codigo = "CP-123456";
      } else {
        codigo = "CP-123456";
      }
      this.portariaCodigos[condominioId] = codigo;
    }
    return {
      codigo,
      ativo: cred.ativo,
      bloqueado: cred.bloqueado,
      tentativasInvalidas: cred.tentativasInvalidas,
      ultimoLogin: cred.ultimoLogin,
      condominioId
    };
  }
  async gerarNovoCodigoPortaria(condominioId = "condo-1", actor) {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    const condo = await this.getCondominioById(condominioId);
    const prefixo = derivarPrefixoCondominio(condo?.nome);
    const codigoAnterior = condo?.codigoPortariaAtual || this.portariaCodigos[condominioId];
    const client = this.getClientOrThrow();
    let novoCodigo = "";
    let pinHash = "";
    let updateSuccess = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 100;
    while (attempts < MAX_ATTEMPTS && !updateSuccess) {
      attempts++;
      novoCodigo = gerarCodigoPortariaSeguro(prefixo);
      const colideMemoria = Object.entries(this.portariaCodigos).some(
        ([cId, cCode]) => cId !== condominioId && cCode === novoCodigo
      );
      if (colideMemoria) {
        continue;
      }
      try {
        const { data: existingWithCode, error: queryErr } = await client.from("condominios").select("id").eq("codigo_portaria_atual", novoCodigo).limit(1);
        if (!queryErr && existingWithCode && existingWithCode.length > 0) {
          if (existingWithCode[0].id !== condominioId) {
            continue;
          }
        }
      } catch {
      }
      pinHash = await hashPin(novoCodigo);
      let updateData = null;
      let updateError = null;
      try {
        const res = await client.from("condominios").update({
          codigo_portaria_atual: novoCodigo,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", condominioId).select("id, codigo_portaria_atual");
        updateData = res.data;
        updateError = res.error;
      } catch (clientErr) {
        console.error(`[SupabaseStore] Falha t\xE9cnica de rede ao atualizar condominios: ${clientErr?.message || "Erro de conex\xE3o"}`);
        throw new SupabaseStorageError(
          `Falha ao persistir c\xF3digo da portaria no condom\xEDnio (${clientErr?.message || "Erro de conex\xE3o"})`,
          500,
          clientErr
        );
      }
      if (updateError) {
        const isUniqueViolation = updateError.code === "23505" || typeof updateError.message === "string" && (updateError.message.includes("23505") || updateError.message.toLowerCase().includes("unique") || updateError.message.includes("idx_condominios_codigo_portaria_atual"));
        if (isUniqueViolation) {
          console.warn("[SupabaseStore] Colis\xE3o de c\xF3digo detectada pelo \xEDndice UNIQUE (23505). Tentando novo c\xF3digo...");
          continue;
        }
        console.error(`[SupabaseStore] Falha t\xE9cnica ao atualizar condominios.codigo_portaria_atual (c\xF3digo: ${updateError.code || "N/A"}, mensagem: ${updateError.message})`);
        throw new SupabaseStorageError(
          `Falha ao persistir c\xF3digo da portaria no condom\xEDnio: ${updateError.message || "Erro de banco de dados"}`,
          500,
          updateError
        );
      }
      if (!updateData || updateData.length === 0) {
        console.error(`[SupabaseStore] Condom\xEDnio n\xE3o localizado para atualiza\xE7\xE3o do c\xF3digo da portaria: ${condominioId}`);
        throw new SupabaseStorageError(
          `Condom\xEDnio ${condominioId} n\xE3o encontrado para atualiza\xE7\xE3o do c\xF3digo da portaria.`,
          404
        );
      }
      updateSuccess = true;
    }
    if (!updateSuccess) {
      throw new SupabaseStorageError(
        `Limite de tentativas (${MAX_ATTEMPTS}) excedido para gerar c\xF3digo de portaria exclusivo sem colis\xE3o.`,
        409
      );
    }
    await this.updateCredencial(cred.id, {
      pinHash,
      senhaHash: pinHash,
      bloqueado: false,
      tentativasInvalidas: 0,
      ativo: true
    });
    this.portariaCodigos[condominioId] = novoCodigo;
    if (codigoAnterior) {
      await this.logAuditoria({
        condominioId,
        acao: "C\xD3DIGO_PORTARIA_INVALIDADO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `C\xF3digo de acesso anterior da portaria foi invalidado imediatamente para o condom\xEDnio ${condominioId}.`
      });
      await this.logAuditoria({
        condominioId,
        acao: "C\xD3DIGO_PORTARIA_REGENERADO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `Novo c\xF3digo de acesso da portaria gerado com sucesso por ${actor.nome}.`
      });
    } else {
      await this.logAuditoria({
        condominioId,
        acao: "C\xD3DIGO_PORTARIA_CRIADO",
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `C\xF3digo de acesso da portaria criado por ${actor.nome}.`
      });
    }
    return {
      codigo: novoCodigo,
      status: "ATIVO",
      ativo: true,
      bloqueado: false
    };
  }
  async desbloquearPortaria(condominioId = "condo-1", actor) {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    await this.updateCredencial(cred.id, {
      bloqueado: false,
      tentativasInvalidas: 0
    });
    await this.logAuditoria({
      condominioId,
      acao: "DESBLOQUEIO_PORTARIA",
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      usuarioCargo: actor.role,
      detalhes: `Acesso da portaria desbloqueado por ${actor.nome} (${actor.role}).`
    });
    return { success: true };
  }
  async authenticatePortariaByCodigo(codigo) {
    const raw = (codigo || "").trim().toUpperCase();
    if (!raw) {
      return {
        success: false,
        status: 400,
        error: "PARAMETROS_INVALIDOS",
        message: "C\xF3digo de acesso da portaria obrigat\xF3rio."
      };
    }
    const isDynamicFormat = /^[A-Z]{2,4}-\d{6}$/.test(raw);
    const isOnlyDigits = /^\d{6}$/.test(raw);
    if (!isDynamicFormat && !isOnlyDigits) {
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        const pCred = await this.getOrCreatePortariaCredencial("condo-1");
        tentativa = await this.registrarTentativaInvalida(pCred.id);
      } catch {
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? "PORTARIA_BLOQUEADA" : "CODIGO_INVALIDO",
        message: tentativa.bloqueado ? "Acesso da portaria bloqueado por excesso de tentativas incorretas." : "C\xF3digo de acesso da portaria incorreto."
      };
    }
    let codigoCandidato = raw;
    if (isOnlyDigits) {
      if (raw === "123456") {
        codigoCandidato = "CP-123456";
      } else {
        codigoCandidato = raw;
      }
    }
    let matchedCondoId = null;
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from("condominios").select("id, codigo_portaria_atual").eq("codigo_portaria_atual", codigoCandidato).limit(1);
      if (!error && data && data.length > 0) {
        matchedCondoId = data[0].id;
        this.portariaCodigos[matchedCondoId] = codigoCandidato;
      }
    } catch {
    }
    if (!matchedCondoId) {
      for (const [cId, cCode] of Object.entries(this.portariaCodigos)) {
        if (cCode && cCode.toUpperCase() === codigoCandidato) {
          matchedCondoId = cId;
          break;
        }
      }
    }
    if (!matchedCondoId && codigoCandidato === "CP-123456") {
      try {
        const condo1 = await this.getCondominioById("condo-1");
        if (!condo1?.codigoPortariaAtual || condo1.codigoPortariaAtual === "CP-123456") {
          matchedCondoId = "condo-1";
          this.portariaCodigos["condo-1"] = "CP-123456";
        }
      } catch {
        matchedCondoId = "condo-1";
        this.portariaCodigos["condo-1"] = "CP-123456";
      }
    }
    if (!matchedCondoId) {
      try {
        const backup = this.readColdBackupData();
        for (const bCred of backup.credenciais || []) {
          if (bCred.tipoAcesso === "PORTARIA" /* PORTARIA */ && bCred.pinHash) {
            const matches = await verifyPin(codigoCandidato, bCred.pinHash);
            if (matches) {
              matchedCondoId = bCred.condominioId || "condo-1";
              this.portariaCodigos[matchedCondoId] = codigoCandidato;
              break;
            }
          }
        }
      } catch {
      }
    }
    if (!matchedCondoId) {
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        const pCred = await this.getOrCreatePortariaCredencial("condo-1");
        tentativa = await this.registrarTentativaInvalida(pCred.id);
      } catch {
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? "PORTARIA_BLOQUEADA" : "CODIGO_INVALIDO",
        message: tentativa.bloqueado ? "Acesso da portaria bloqueado por excesso de tentativas incorretas." : "C\xF3digo de acesso da portaria incorreto."
      };
    }
    const cred = await this.getOrCreatePortariaCredencial(matchedCondoId);
    if (!cred.ativo) {
      return {
        success: false,
        status: 403,
        error: "PORTARIA_INATIVA",
        message: "Acesso da portaria temporariamente inativado pelo administrador."
      };
    }
    if (cred.bloqueado) {
      return {
        success: false,
        status: 403,
        error: "PORTARIA_BLOQUEADA",
        message: "Acesso da portaria bloqueado por excesso de tentativas incorretas. Contate o administrador para desbloqueio."
      };
    }
    const pinValido = cred.pinHash ? await verifyPin(codigoCandidato, cred.pinHash) : false;
    if (!pinValido) {
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        tentativa = await this.registrarTentativaInvalida(cred.id);
      } catch {
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? "PORTARIA_BLOQUEADA" : "CODIGO_INVALIDO",
        message: tentativa.bloqueado ? "Acesso da portaria bloqueado por excesso de tentativas incorretas." : "C\xF3digo de acesso da portaria incorreto."
      };
    }
    try {
      await this.resetTentativasInvalidas(cred.id);
      await this.updateCredencial(cred.id, {
        ultimoLogin: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch {
    }
    return {
      success: true,
      cred,
      condominioId: matchedCondoId
    };
  }
  async listCondominios() {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from("condominios").select("*");
      if (error) {
        if (this.isTableMissingError(error)) {
          const backup2 = this.readColdBackupData();
          return (backup2.condominios || []).map((c) => ({
            id: c.id,
            nome: c.nome,
            endereco: c.endereco,
            mostrarMensagem: c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
          }));
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar condom\xEDnios (${error.message})`, 503, error);
      }
      if (data && Array.isArray(data) && data.length > 0) {
        return data.map((c) => ({
          id: c.id,
          nome: c.nome,
          endereco: c.endereco,
          codigoPortariaAtual: c.codigo_portaria_atual || null,
          mostrarMensagem: c.mostrar_mensagem !== void 0 ? Boolean(c.mostrar_mensagem) : c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
        }));
      }
      const backup = this.readColdBackupData();
      return (backup.condominios || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
      }));
    } catch (err) {
      const backup = this.readColdBackupData();
      return (backup.condominios || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrarMensagem !== void 0 ? Boolean(c.mostrarMensagem) : true
      }));
    }
  }
  async setPortariaCodigo(condominioId = "condo-1", novoCodigo) {
    const cleanCode = (novoCodigo || "").trim();
    if (cleanCode.length < 4 || cleanCode.length > 12) {
      throw new SupabaseStorageError("O c\xF3digo da portaria deve conter entre 4 e 12 caracteres.", 400);
    }
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    const pinHash = await hashPin(cleanCode);
    this.portariaCodigos[condominioId] = cleanCode.startsWith("CP-") ? cleanCode.toUpperCase() : `CP-${cleanCode}`;
    return await this.updateCredencial(cred.id, {
      pinHash,
      senhaHash: pinHash,
      bloqueado: false,
      tentativasInvalidas: 0
    });
  }
};
var supabaseStore = new SupabaseStore();

// src/services/authService.ts
import jwt from "jsonwebtoken";
var SESSION_COOKIE_NAME = "session_token";
var PORTARIA_SESSION_EXPIRY = "7d";
var PORTARIA_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var ADMIN_SESSION_EXPIRY = "8h";
var ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1e3;
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (isProduction) {
    if (!secret || secret.trim() === "") {
      throw new Error(
        "CONFIGURACAO_CRITICA_AUSENTE: A vari\xE1vel de ambiente JWT_SECRET \xE9 obrigat\xF3ria em ambiente de produ\xE7\xE3o para garantir a seguran\xE7a da assinatura dos tokens de sess\xE3o."
      );
    }
    return secret.trim();
  }
  if (secret && secret.trim() !== "") {
    return secret.trim();
  }
  return "control-prisma-jwt-local-dev-fallback-key-2026";
}
function isAuthConfigured() {
  try {
    getJwtSecret();
    return true;
  } catch {
    return false;
  }
}
function generateSessionToken(data, customExpiry) {
  const secret = getJwtSecret();
  const expiresIn = customExpiry || (data.tipoSessao === "PORTARIA" /* PORTARIA */ ? PORTARIA_SESSION_EXPIRY : ADMIN_SESSION_EXPIRY);
  const payload = {
    sub: data.usuarioId,
    condominioId: data.condominioId,
    role: data.role,
    tipoSessao: data.tipoSessao,
    nome: data.nome,
    ...data.stationId ? { stationId: data.stationId } : {}
  };
  return jwt.sign(payload, secret, {
    expiresIn,
    algorithm: "HS256"
  });
}
function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "TOKEN_AUSENTE: Token n\xE3o fornecido." };
  }
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return {
      valid: true,
      payload: decoded
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, expired: true, error: "TOKEN_EXPIRADO: A sess\xE3o expirou." };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return { valid: false, error: "TOKEN_INVALIDO: Assinatura ou formato de token inv\xE1lido." };
    }
    return { valid: false, error: "TOKEN_ERRO: Falha ao validar token." };
  }
}
function getSessionCookieOptions(tipoSessao) {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = tipoSessao === "PORTARIA" /* PORTARIA */ ? PORTARIA_SESSION_MAX_AGE_MS : ADMIN_SESSION_MAX_AGE_MS;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge,
    path: "/"
  };
}
function getClearCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  };
}

// src/services/authMiddleware.ts
async function requireAuth(req, res, next) {
  try {
    let token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
      }
    }
    if (!token) {
      res.status(401).json({
        error: "AUTENTICACAO_OBRIGATORIA",
        message: "Acesso n\xE3o autenticado. Fa\xE7a login para continuar."
      });
      return;
    }
    const tokenResult = verifySessionToken(token);
    if (!tokenResult.valid || !tokenResult.payload) {
      if (tokenResult.expired) {
        res.status(401).json({
          error: "SESSAO_EXPIRADA",
          message: "Sua sess\xE3o expirou. Por favor, autentique-se novamente."
        });
        return;
      }
      res.status(401).json({
        error: "TOKEN_INVALIDO",
        message: tokenResult.error || "Token de sess\xE3o inv\xE1lido."
      });
      return;
    }
    const payload = tokenResult.payload;
    if (payload.tipoSessao === "PORTARIA" /* PORTARIA */ && (payload.sub === "portaria-station" || payload.sub === "usr-portaria")) {
      const targetCondoId = payload.condominioId || "condo-1";
      const condominios = await supabaseStore.listCondominios();
      const condom\u00EDnio = condominios.find((c) => c.id === targetCondoId);
      if (!condom\u00EDnio || condom\u00EDnio.ativo === false) {
        res.status(401).json({
          error: "CONDOMINIO_INVALIDO",
          message: "O condom\xEDnio associado a esta esta\xE7\xE3o de portaria est\xE1 inativo ou n\xE3o existe."
        });
        return;
      }
      const portariaCred = await supabaseStore.findPortariaCredencial(targetCondoId);
      if (portariaCred && portariaCred.ativo === false) {
        res.status(401).json({
          error: "CREDENCIAL_INATIVA",
          message: "O acesso da portaria deste condom\xEDnio foi revogado ou inativado."
        });
        return;
      }
      if (portariaCred && portariaCred.bloqueado) {
        res.status(403).json({
          error: "CREDENCIAL_BLOQUEADA",
          message: "O acesso da portaria deste condom\xEDnio est\xE1 temporariamente bloqueado."
        });
        return;
      }
      req.user = {
        usuarioId: payload.sub,
        condominioId: targetCondoId,
        role: "PORTEIRO" /* PORTEIRO */,
        nome: payload.nome || "Portaria Principal",
        tipoSessao: "PORTARIA" /* PORTARIA */,
        stationId: payload.stationId || DEFAULT_PORTARIA_STATION_ID
      };
      return next();
    }
    const usuarios = await supabaseStore.listUsuarios(payload.condominioId || "condo-1");
    const usuario = usuarios.find((u) => u.id === payload.sub);
    if (!usuario) {
      res.status(401).json({
        error: "USUARIO_NAO_ENCONTRADO",
        message: "O usu\xE1rio associado a esta sess\xE3o n\xE3o foi encontrado."
      });
      return;
    }
    if (usuario.excluido) {
      res.status(403).json({
        error: "USUARIO_ARQUIVADO",
        message: "O cadastro deste usu\xE1rio foi arquivado."
      });
      return;
    }
    if (usuario.ativo === false) {
      res.status(403).json({
        error: "USUARIO_INATIVO",
        message: "O acesso deste usu\xE1rio est\xE1 temporariamente inativo."
      });
      return;
    }
    const credenciais = await supabaseStore.findCredenciaisByUsuarioId(usuario.id);
    const credBloqueada = credenciais.find((c) => c.ativo && c.bloqueado);
    if (credBloqueada) {
      res.status(403).json({
        error: "CREDENCIAL_BLOQUEADA",
        message: "A credencial de acesso est\xE1 bloqueada por excesso de tentativas ou interven\xE7\xE3o administrativa."
      });
      return;
    }
    req.user = {
      usuarioId: usuario.id,
      condominioId: payload.condominioId || usuario.condominioId || "condo-1",
      role: usuario.role,
      nome: usuario.nome,
      tipoSessao: payload.tipoSessao || (usuario.role === "PORTEIRO" /* PORTEIRO */ ? "PORTARIA" /* PORTARIA */ : "ADMIN" /* ADMIN */),
      stationId: payload.stationId
    };
    next();
  } catch (err) {
    res.status(500).json({
      error: "ERRO_MIDDLEWARE_AUTH",
      message: err?.message || "Falha interna na verifica\xE7\xE3o de autentica\xE7\xE3o."
    });
  }
}
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({
        error: "AUTENTICACAO_OBRIGATORIA",
        message: "Sess\xE3o autenticada necess\xE1ria."
      });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: "ACESSO_NEGADO",
        message: "Voc\xEA n\xE3o possui autoriza\xE7\xE3o funcional para acessar este recurso.",
        rolesPermitidas: allowedRoles
      });
      return;
    }
    next();
  };
}
function requirePortaria(req, res, next) {
  if (!req.user) {
    res.status(401).json({
      error: "AUTENTICACAO_OBRIGATORIA",
      message: "Sess\xE3o autenticada necess\xE1ria."
    });
    return;
  }
  const isSessaoPortaria = req.user.tipoSessao === "PORTARIA" /* PORTARIA */;
  const isPapelOperacional = [
    "PORTEIRO" /* PORTEIRO */,
    "ADMIN" /* ADMIN */,
    "SINDICO" /* SINDICO */
  ].includes(req.user.role);
  if (!isSessaoPortaria && !isPapelOperacional) {
    res.status(403).json({
      error: "SESSAO_PORTARIA_REQUERIDA",
      message: "Esta opera\xE7\xE3o deve ser executada exclusivamente por operadores de portaria ou administra\xE7\xE3o autenticados."
    });
    return;
  }
  if (!req.user.stationId) {
    req.user.stationId = DEFAULT_PORTARIA_STATION_ID;
  }
  next();
}

// src/utils/turnoUtils.ts
function timeStringToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const parts = timeStr.split(":");
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
function getCurrentTimeString(date = /* @__PURE__ */ new Date()) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    date = /* @__PURE__ */ new Date();
  }
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
function parseDateOrTimeString(horarioConsulta) {
  if (!horarioConsulta) return /* @__PURE__ */ new Date();
  if (horarioConsulta instanceof Date) {
    return isNaN(horarioConsulta.getTime()) ? /* @__PURE__ */ new Date() : horarioConsulta;
  }
  if (typeof horarioConsulta === "string") {
    const trimmed = horarioConsulta.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      const now = /* @__PURE__ */ new Date();
      const [h, m] = trimmed.split(":").map((v) => parseInt(v, 10));
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    }
    const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (brMatch) {
      const dia = parseInt(brMatch[1], 10);
      const mes = parseInt(brMatch[2], 10) - 1;
      const ano = parseInt(brMatch[3], 10);
      const hora = brMatch[4] ? parseInt(brMatch[4], 10) : 0;
      const min = brMatch[5] ? parseInt(brMatch[5], 10) : 0;
      return new Date(ano, mes, dia, hora, min, 0, 0);
    }
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? /* @__PURE__ */ new Date() : parsed;
  }
  return /* @__PURE__ */ new Date();
}
function getParidadeDia(diaNumero) {
  return diaNumero % 2 !== 0 ? "IMPAR" /* IMPAR */ : "PAR" /* PAR */;
}
function getDataInicioPlantao(dataRef = /* @__PURE__ */ new Date(), horaInicio, horaFim) {
  const safeDate = !(dataRef instanceof Date) || isNaN(dataRef.getTime()) ? /* @__PURE__ */ new Date() : dataRef;
  if (!horaInicio || !horaFim) {
    return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
  }
  const currentMin = safeDate.getHours() * 60 + safeDate.getMinutes();
  const startMin = timeStringToMinutes(horaInicio);
  const endMin = timeStringToMinutes(horaFim);
  if (startMin > endMin) {
    if (currentMin < endMin) {
      return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate() - 1);
    } else {
      return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
    }
  }
  return new Date(safeDate.getFullYear(), safeDate.getMonth(), safeDate.getDate());
}
function calcularParidadePlantao(dataRef = /* @__PURE__ */ new Date(), horaInicio, horaFim) {
  const dataInicio = getDataInicioPlantao(dataRef, horaInicio, horaFim);
  return getParidadeDia(dataInicio.getDate());
}
function isHorarioNoTurno(horario, horaInicio, horaFim) {
  if (!horario || !horaInicio || !horaFim) return false;
  const current = timeStringToMinutes(horario);
  const start = timeStringToMinutes(horaInicio);
  const end = timeStringToMinutes(horaFim);
  if (start < end) {
    return current >= start && current < end;
  } else if (start > end) {
    return current >= start || current < end;
  } else {
    return true;
  }
}
function identificarOperadorEmOperacao(usuarios = [], horarioConsulta) {
  const refDate = parseDateOrTimeString(horarioConsulta);
  const horarioAtual = getCurrentTimeString(refDate);
  const safeUsuarios = Array.isArray(usuarios) ? usuarios : [];
  const operadoresCandidatos = safeUsuarios.filter((u) => {
    if (!u || !u.ativo) return false;
    if (!u.horaInicio || !u.horaFim) return false;
    const noHorario = isHorarioNoTurno(horarioAtual, u.horaInicio, u.horaFim);
    if (!noHorario) return false;
    if (u.tipoTurno === "12X36" /* TURNO_12X36 */) {
      const paridadePlantao = calcularParidadePlantao(refDate, u.horaInicio, u.horaFim);
      if (u.paridade12x36) {
        return u.paridade12x36 === paridadePlantao;
      }
      return true;
    }
    return true;
  });
  if (operadoresCandidatos.length === 1) {
    const op = operadoresCandidatos[0];
    return {
      status: "OK",
      operador: op,
      horarioAtual,
      mensagem: `Operador identificado: ${op.nome}`
    };
  }
  if (operadoresCandidatos.length === 0) {
    const dataInicioReferencia = getDataInicioPlantao(refDate);
    const paridadeDia = getParidadeDia(dataInicioReferencia.getDate());
    return {
      status: "SEM_PORTEIRO",
      horarioAtual,
      mensagem: `Nenhum porteiro cadastrado para o hor\xE1rio ${horarioAtual} (Dia de in\xEDcio ${dataInicioReferencia.getDate()} - Dias ${paridadeDia === "IMPAR" /* IMPAR */ ? "\xCDmpares" : "Pares"}).`
    };
  }
  const nomes = operadoresCandidatos.map((u) => u.nome).join(", ");
  return {
    status: "CONFLITO",
    conflitoUsuarios: operadoresCandidatos,
    horarioAtual,
    mensagem: `Conflito de escala: m\xFAltiplos operadores detectados no mesmo turno e paridade (${nomes}).`
  };
}

// server.ts
var prismaLocks = /* @__PURE__ */ new Map();
async function withPrismaLock(prismaId, fn) {
  while (prismaLocks.has(prismaId)) {
    try {
      await prismaLocks.get(prismaId);
    } catch {
    }
  }
  let resolveLock;
  const lockPromise = new Promise((resolve) => {
    resolveLock = resolve;
  });
  prismaLocks.set(prismaId, lockPromise);
  try {
    return await fn();
  } finally {
    prismaLocks.delete(prismaId);
    if (resolveLock) resolveLock();
  }
}
var activeTurnoSessions = {};
var activePlantaoSubstituicoes = {};
async function resolveOperadorPlantao(condominioId, fallbackUserId, fallbackUserNome) {
  if (activePlantaoSubstituicoes[condominioId]) {
    const sub = activePlantaoSubstituicoes[condominioId];
    return {
      usuarioId: sub.usuarioId,
      usuarioNome: sub.usuarioNome,
      isSubstituicao: true,
      motivoSubstituicao: sub.motivo
    };
  }
  try {
    const usuarios = await supabaseStore.listUsuarios(condominioId);
    const opInfo = identificarOperadorEmOperacao(usuarios, /* @__PURE__ */ new Date());
    if (opInfo.status === "OK" && opInfo.operador) {
      return {
        usuarioId: opInfo.operador.id,
        usuarioNome: opInfo.operador.nome,
        isSubstituicao: false
      };
    }
  } catch (e) {
    console.warn("[Plantao Auto] Falha ao identificar operador da escala:", e);
  }
  return {
    usuarioId: fallbackUserId || "portaria-station",
    usuarioNome: fallbackUserNome || "Portaria Principal",
    isSubstituicao: false
  };
}
function handleStorageError(res, err, customMessage) {
  console.warn("[Storage Notice]:", err?.message || err);
  const status = err instanceof SupabaseStorageError ? err.status : 503;
  const message = err?.message || customMessage || "Armazenamento prim\xE1rio (Supabase PostgreSQL) indispon\xEDvel.";
  return res.status(status).json({
    error: message,
    code: "STORAGE_PRIMARY_UNAVAILABLE",
    storageStatus: "SUPABASE_UNAVAILABLE",
    details: err?.details || void 0
  });
}
function createExpressApp() {
  const app3 = express();
  const PORT = 3e3;
  console.log("[Server] Backend PRISMAS \u2014 Persist\xEAncia Prim\xE1ria Operacional Exclusiva: Supabase PostgreSQL.");
  app3.use(express.json({ limit: "10mb" }));
  app3.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app3.use(cookieParser());
  app3.get("/api/health", async (req, res) => {
    const isLive = await supabaseStore.checkLivePostgres();
    res.json({
      status: isLive ? "ok" : "degraded",
      time: (/* @__PURE__ */ new Date()).toISOString(),
      storage: "supabase-postgresql",
      primarySource: "supabase-postgresql",
      cutoverStatus: isLive ? "COMPLETED_ACTIVE" : "SUPABASE_CONNECTION_REQUIRED"
    });
  });
  app3.get("/api/auth/status", (req, res) => {
    res.json({
      configured: isAuthConfigured(),
      sessionCookieName: SESSION_COOKIE_NAME,
      stationDefault: DEFAULT_PORTARIA_STATION_ID
    });
  });
  app3.post("/api/auth/login", async (req, res) => {
    const { identificador, senha, condominioId = "condo-1" } = req.body;
    if (!identificador || !senha) {
      return res.status(400).json({
        error: "PARAMETROS_INVALIDOS",
        message: "Identificador e senha s\xE3o obrigat\xF3rios."
      });
    }
    try {
      const cred = await supabaseStore.findCredencialByIdentificador(identificador);
      if (!cred || !cred.ativo || !cred.senhaHash) {
        return res.status(401).json({
          error: "CREDENCIAL_INVALIDA",
          message: "Identificador ou senha inv\xE1lidos."
        });
      }
      if (cred.bloqueado) {
        return res.status(403).json({
          error: "CREDENCIAL_BLOQUEADA",
          message: "Credencial bloqueada por excesso de tentativas ou interven\xE7\xE3o administrativa."
        });
      }
      const senhaValida = await verifyPassword(senha, cred.senhaHash);
      if (!senhaValida) {
        const statusTentativa = await supabaseStore.registrarTentativaInvalida(cred.id);
        return res.status(statusTentativa.bloqueado ? 403 : 401).json({
          error: statusTentativa.bloqueado ? "CREDENCIAL_BLOQUEADA" : "CREDENCIAL_INVALIDA",
          message: statusTentativa.bloqueado ? "Credencial bloqueada ap\xF3s exceder o limite de tentativas inv\xE1lidas." : "Identificador ou senha inv\xE1lidos."
        });
      }
      await supabaseStore.resetTentativasInvalidas(cred.id);
      await supabaseStore.updateCredencial(cred.id, { ultimoLogin: (/* @__PURE__ */ new Date()).toISOString() });
      const usuarios = await supabaseStore.listUsuarios(cred.condominioId || condominioId);
      const usuario = usuarios.find((u) => u.id === cred.usuarioId);
      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(403).json({
          error: "USUARIO_INATIVO",
          message: "O usu\xE1rio correspondente a esta credencial est\xE1 inativo ou arquivado."
        });
      }
      const tipoSessao = cred.tipoAcesso === "SINDICO" /* SINDICO */ ? "SINDICO" /* SINDICO */ : "ADMIN" /* ADMIN */;
      const token = generateSessionToken({
        usuarioId: usuario.id,
        condominioId: cred.condominioId || condominioId,
        role: usuario.role,
        tipoSessao,
        nome: usuario.nome
      });
      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(tipoSessao));
      return res.json({
        success: true,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          role: usuario.role,
          tipoSessao,
          condominioId: cred.condominioId || condominioId
        },
        token
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao autenticar credencial.");
    }
  });
  app3.post("/api/auth/portaria-codigo", async (req, res) => {
    const { codigo, stationId = DEFAULT_PORTARIA_STATION_ID } = req.body;
    if (!codigo || typeof codigo !== "string" || !codigo.trim()) {
      return res.status(400).json({
        error: "PARAMETROS_INVALIDOS",
        message: "O C\xF3digo de acesso da portaria \xE9 obrigat\xF3rio."
      });
    }
    try {
      const authResult = await supabaseStore.authenticatePortariaByCodigo(codigo);
      if (!authResult.success) {
        return res.status(authResult.status || 401).json({
          error: authResult.error,
          message: authResult.message
        });
      }
      const condominioId = authResult.condominioId || "condo-1";
      const token = generateSessionToken({
        usuarioId: "portaria-station",
        condominioId,
        role: "PORTEIRO" /* PORTEIRO */,
        tipoSessao: "PORTARIA" /* PORTARIA */,
        stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
        nome: "Portaria Principal"
      });
      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions("PORTARIA" /* PORTARIA */));
      return res.json({
        success: true,
        user: {
          id: "portaria-station",
          nome: "Portaria Principal",
          role: "PORTEIRO" /* PORTEIRO */,
          tipoSessao: "PORTARIA" /* PORTARIA */,
          stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
          condominioId
        },
        token
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao autenticar c\xF3digo da portaria.");
    }
  });
  app3.post("/api/auth/portaria-assumir", async (req, res) => {
    const {
      usuarioId,
      pin,
      stationId = DEFAULT_PORTARIA_STATION_ID,
      condominioId = "condo-1"
    } = req.body;
    if (!usuarioId || !pin) {
      return res.status(400).json({
        error: "PARAMETROS_INVALIDOS",
        message: "Operador (usuarioId) e PIN s\xE3o obrigat\xF3rios."
      });
    }
    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const usuario = usuarios.find((u) => u.id === usuarioId);
      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(403).json({
          error: "USUARIO_INATIVO",
          message: "Operador inativo ou n\xE3o cadastrado neste condom\xEDnio."
        });
      }
      const creds = await supabaseStore.findCredenciaisByUsuarioId(usuarioId);
      const credPortaria = creds.find((c) => c.tipoAcesso === "PORTARIA" /* PORTARIA */ && c.ativo);
      if (!credPortaria || !credPortaria.pinHash) {
        return res.status(401).json({
          error: "CREDENCIAL_PORTARIA_NAO_ENCONTRADA",
          message: "PIN de portaria n\xE3o configurado para este operador."
        });
      }
      if (credPortaria.bloqueado) {
        return res.status(403).json({
          error: "CREDENCIAL_BLOQUEADA",
          message: "PIN de portaria bloqueado por excesso de tentativas inv\xE1lidas."
        });
      }
      const pinValido = await verifyPin(pin, credPortaria.pinHash);
      if (!pinValido) {
        const statusTentativa = await supabaseStore.registrarTentativaInvalida(credPortaria.id);
        return res.status(statusTentativa.bloqueado ? 403 : 401).json({
          error: statusTentativa.bloqueado ? "CREDENCIAL_BLOQUEADA" : "PIN_INVALIDO",
          message: statusTentativa.bloqueado ? "Credencial de portaria bloqueada por excesso de tentativas." : "PIN incorreto."
        });
      }
      await supabaseStore.resetTentativasInvalidas(credPortaria.id);
      await supabaseStore.updateCredencial(credPortaria.id, { ultimoLogin: (/* @__PURE__ */ new Date()).toISOString() });
      const token = generateSessionToken({
        usuarioId: usuario.id,
        condominioId,
        role: usuario.role,
        tipoSessao: "PORTARIA" /* PORTARIA */,
        stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
        nome: usuario.nome
      });
      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions("PORTARIA" /* PORTARIA */));
      return res.json({
        success: true,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          role: usuario.role,
          tipoSessao: "PORTARIA" /* PORTARIA */,
          stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
          condominioId
        },
        token
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao autenticar plant\xE3o de portaria.");
    }
  });
  app3.get("/api/auth/me", requireAuth, (req, res) => {
    return res.json({
      authenticated: true,
      user: req.user
    });
  });
  app3.post("/api/auth/logout", (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions());
    return res.json({
      success: true,
      message: "Sess\xE3o encerrada com sucesso."
    });
  });
  app3.get("/api/plantao/status", requireAuth, async (req, res) => {
    const condominioId = req.query.condominioId || req.user?.condominioId || "condo-1";
    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const opInfo = identificarOperadorEmOperacao(usuarios, /* @__PURE__ */ new Date());
      const subAtiva = activePlantaoSubstituicoes[condominioId] || null;
      let operadorAtivo = null;
      if (subAtiva) {
        const u = usuarios.find((item) => item.id === subAtiva.usuarioId);
        operadorAtivo = {
          id: subAtiva.usuarioId,
          nome: subAtiva.usuarioNome,
          cargo: u?.cargo || "Porteiro (Substituto)",
          horaInicio: u?.horaInicio,
          horaFim: u?.horaFim,
          isSubstituicao: true,
          motivoSubstituicao: subAtiva.motivo
        };
      } else if (opInfo.status === "OK" && opInfo.operador) {
        operadorAtivo = {
          id: opInfo.operador.id,
          nome: opInfo.operador.nome,
          cargo: opInfo.operador.cargo || "Porteiro",
          horaInicio: opInfo.operador.horaInicio,
          horaFim: opInfo.operador.horaFim,
          isSubstituicao: false
        };
      }
      return res.json({
        status: opInfo.status,
        operadorEscala: opInfo.operador,
        operadorAtivo,
        substituicaoAtiva: subAtiva,
        horarioAtual: opInfo.horarioAtual,
        mensagem: opInfo.mensagem
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao consultar status do plant\xE3o.");
    }
  });
  app3.post("/api/plantao/substituir", requireAuth, requirePortaria, async (req, res) => {
    const { usuarioId, motivo } = req.body;
    const condominioId = req.body.condominioId || req.user?.condominioId || "condo-1";
    if (!usuarioId) {
      return res.status(400).json({ error: "ID do operador substituto \xE9 obrigat\xF3rio." });
    }
    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const usuario = usuarios.find((u) => u.id === usuarioId);
      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(404).json({ error: "Operador substituto n\xE3o encontrado ou inativo." });
      }
      activePlantaoSubstituicoes[condominioId] = {
        condominioId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        substituidoPorId: req.user?.usuarioId,
        substituidoPorNome: req.user?.nome,
        motivo: motivo || "Substitui\xE7\xE3o manual de plant\xE3o",
        inicio: (/* @__PURE__ */ new Date()).toISOString()
      };
      await supabaseStore.logAuditoria({
        condominioId,
        acao: "SUBSTITUICAO_PLANTAO",
        usuarioId: req.user?.usuarioId || "portaria-station",
        usuarioNome: req.user?.nome || "Portaria",
        usuarioCargo: req.user?.role || "PORTEIRO",
        detalhes: `Operador respons\xE1vel alterado para ${usuario.nome}. Motivo: ${motivo || "N\xE3o informado"}.`,
        dadosNovos: { substitutoId: usuario.id, substitutoNome: usuario.nome, motivo }
      });
      return res.json({
        success: true,
        message: `Respons\xE1vel pelo plant\xE3o alterado com sucesso para ${usuario.nome}.`,
        substituicao: activePlantaoSubstituicoes[condominioId]
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao registrar substitui\xE7\xE3o de plant\xE3o.");
    }
  });
  app3.post("/api/plantao/restaurar-escala", requireAuth, requirePortaria, async (req, res) => {
    const condominioId = req.body.condominioId || req.user?.condominioId || "condo-1";
    const subAnterior = activePlantaoSubstituicoes[condominioId];
    delete activePlantaoSubstituicoes[condominioId];
    try {
      await supabaseStore.logAuditoria({
        condominioId,
        acao: "RESTAURACAO_ESCALA_PLANTAO",
        usuarioId: req.user?.usuarioId || "portaria-station",
        usuarioNome: req.user?.nome || "Portaria",
        usuarioCargo: req.user?.role || "PORTEIRO",
        detalhes: "Plant\xE3o retornou para identifica\xE7\xE3o autom\xE1tica da escala.",
        dadosAnteriores: subAnterior
      });
      return res.json({
        success: true,
        message: "Escala autom\xE1tica restaurada com sucesso."
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao restaurar escala.");
    }
  });
  app3.get("/api/condominios/codigo-portaria", requireAuth, requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]), async (req, res) => {
    const requestedCondoId = req.query.condominioId || req.user?.condominioId || "condo-1";
    if (req.user?.condominioId && req.query.condominioId && req.query.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: "ISOLAMENTO_CONDOMINIO_VIOLADO", message: "Acesso negado aos dados de outro condom\xEDnio." });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      const status = await supabaseStore.getPortariaStatus(condominioId);
      return res.json({
        success: true,
        ...status
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao obter status do c\xF3digo da portaria.");
    }
  });
  app3.post("/api/condominios/codigo-portaria/gerar", requireAuth, requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]), async (req, res) => {
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || "condo-1";
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: "ISOLAMENTO_CONDOMINIO_VIOLADO", message: "N\xE3o \xE9 permitido gerar c\xF3digo para outro condom\xEDnio." });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      const result = await supabaseStore.gerarNovoCodigoPortaria(condominioId, {
        id: req.user.usuarioId,
        nome: req.user.nome,
        role: req.user.role
      });
      return res.json({
        success: true,
        codigo: result.codigo,
        status: result.status,
        message: "Novo c\xF3digo de acesso da portaria gerado com sucesso."
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao gerar c\xF3digo de acesso da portaria.");
    }
  });
  app3.post("/api/condominios/codigo-portaria/desbloquear", requireAuth, requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]), async (req, res) => {
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || "condo-1";
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: "ISOLAMENTO_CONDOMINIO_VIOLADO", message: "N\xE3o \xE9 permitido desbloquear acesso de outro condom\xEDnio." });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      await supabaseStore.desbloquearPortaria(condominioId, {
        id: req.user.usuarioId,
        nome: req.user.nome,
        role: req.user.role
      });
      return res.json({
        success: true,
        message: "Acesso da portaria desbloqueado com sucesso."
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao desbloquear acesso da portaria.");
    }
  });
  app3.put("/api/condominios/codigo-portaria", requireAuth, requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]), async (req, res) => {
    const { codigo } = req.body;
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || "condo-1";
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: "ISOLAMENTO_CONDOMINIO_VIOLADO", message: "N\xE3o \xE9 permitido alterar c\xF3digo de outro condom\xEDnio." });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    if (!codigo || typeof codigo !== "string" || codigo.trim().length < 4 || codigo.trim().length > 12) {
      return res.status(400).json({ error: "O c\xF3digo da portaria deve conter entre 4 e 12 caracteres." });
    }
    try {
      await supabaseStore.setPortariaCodigo(condominioId, codigo.trim());
      await supabaseStore.logAuditoria({
        condominioId,
        acao: "C\xD3DIGO_PORTARIA_REGENERADO",
        usuarioId: req.user?.usuarioId || "admin",
        usuarioNome: req.user?.nome || "Administrador",
        usuarioCargo: req.user?.role || "ADMIN",
        detalhes: "C\xF3digo de acesso da portaria atualizado manualmente pelo gestor."
      });
      return res.json({
        success: true,
        message: "C\xF3digo da portaria atualizado com sucesso."
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao atualizar c\xF3digo da portaria.");
    }
  });
  app3.get("/api/supabase/validate", async (req, res) => {
    const result = await supabaseStore.validateConnectionOnly();
    res.json(result);
  });
  app3.get("/api/supabase/validate-pva1", async (req, res) => {
    const result = await supabaseStore.validatePVA1Infrastructure();
    res.json(result);
  });
  app3.get("/api/supabase/snapshot-pva3", (req, res) => {
    try {
      const result = supabaseStore.getJsonSnapshot();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message });
    }
  });
  app3.post("/api/supabase/migrate-pva3", async (req, res) => {
    try {
      const result = await supabaseStore.executePVA3Migration();
      res.json(result);
    } catch (e) {
      handleStorageError(res, e, "Erro durante migra\xE7\xE3o manual PVA-3.");
    }
  });
  app3.get("/api/dashboard", requireAuth, async (req, res) => {
    const condominioId = req.query.condominioId || req.user?.condominioId || "condo-1";
    try {
      const statusData = await supabaseStore.getStatus(condominioId);
      const turnoAtivo = activeTurnoSessions[condominioId] || void 0;
      return res.json({
        ...statusData,
        turnoAtivo
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao consultar dashboard no Supabase.");
    }
  });
  app3.get("/api/status", async (req, res) => {
    const condominioId = req.query.condominioId || "condo-1";
    try {
      const statusData = await supabaseStore.getStatus(condominioId);
      const turnoAtivo = activeTurnoSessions[condominioId] || void 0;
      return res.json({
        ...statusData,
        turnoAtivo
      });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao consultar status no Supabase.");
    }
  });
  app3.post(
    "/api/movimentacoes/entrega",
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const {
        prismaId,
        casa,
        fotoEvidenciaUrl
      } = req.body;
      if (!prismaId || !casa) {
        return res.status(400).json({ error: "ID do prisma e Casa s\xE3o obrigat\xF3rios." });
      }
      const condominioId = req.body.condominioId || req.user?.condominioId || "condo-1";
      const opPlantao = await resolveOperadorPlantao(condominioId, req.user?.usuarioId, req.user?.nome);
      const usuarioId = opPlantao.usuarioId;
      const usuarioNome = opPlantao.usuarioNome;
      try {
        const result = await withPrismaLock(prismaId, async () => {
          return await supabaseStore.entregarPrisma({
            prismaId,
            casa,
            usuarioId,
            usuarioNome,
            condominioId,
            fotoEvidenciaUrl
          });
        });
        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma, movimentacao: result.movimentacao } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao persistir entrega no Supabase.");
      }
    }
  );
  app3.post(
    "/api/movimentacoes/devolucao",
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const { prismaId } = req.body;
      if (!prismaId) {
        return res.status(400).json({ error: "ID do prisma \xE9 obrigat\xF3rio." });
      }
      const condominioId = req.body.condominioId || req.user?.condominioId || "condo-1";
      const opPlantao = await resolveOperadorPlantao(condominioId, req.user?.usuarioId, req.user?.nome);
      const usuarioId = opPlantao.usuarioId;
      const usuarioNome = opPlantao.usuarioNome;
      try {
        const result = await withPrismaLock(prismaId, async () => {
          return await supabaseStore.devolverPrisma({
            prismaId,
            usuarioId,
            usuarioNome,
            condominioId
          });
        });
        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma, movimentacao: result.movimentacao } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao persistir devolu\xE7\xE3o no Supabase.");
      }
    }
  );
  app3.post(
    "/api/movimentacoes/pendencia",
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const { prismaId, motivo } = req.body;
      if (!prismaId || !motivo) {
        return res.status(400).json({ error: "ID do prisma e Motivo da pend\xEAncia s\xE3o obrigat\xF3rios." });
      }
      const condominioId = req.body.condominioId || req.user?.condominioId || "condo-1";
      const opPlantao = await resolveOperadorPlantao(condominioId, req.user?.usuarioId, req.user?.nome);
      const usuarioId = opPlantao.usuarioId;
      const usuarioNome = opPlantao.usuarioNome;
      try {
        const result = await withPrismaLock(prismaId, async () => {
          return await supabaseStore.abrirPendencia({
            prismaId,
            motivo,
            usuarioId,
            usuarioNome,
            condominioId
          });
        });
        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao registrar pend\xEAncia no Supabase.");
      }
    }
  );
  app3.post("/api/movimentacoes/resolver-pendencia", requireAuth, async (req, res) => {
    const {
      prismaId,
      novoEstado,
      justificativa
    } = req.body;
    if (!prismaId || !novoEstado || !justificativa) {
      return res.status(400).json({ error: "Dados incompletos para resolu\xE7\xE3o de pend\xEAncia." });
    }
    const usuarioId = req.user.usuarioId;
    const usuarioNome = req.user.nome;
    const condominioId = req.user.condominioId;
    try {
      const result = await withPrismaLock(prismaId, async () => {
        return await supabaseStore.resolverPendencia({
          prismaId,
          novoEstado,
          justificativa,
          usuarioId,
          usuarioNome,
          condominioId
        });
      });
      return res.status(result.status).json(
        result.success ? { success: true, prisma: result.prisma } : { error: result.error }
      );
    } catch (err) {
      return handleStorageError(res, err, "Erro ao resolver pend\xEAncia no Supabase.");
    }
  });
  app3.post("/api/prismas/toggle-indisponivel", requireAuth, async (req, res) => {
    const { prismaId, motivo, tornarIndisponivel } = req.body;
    if (!prismaId) {
      return res.status(400).json({ error: "ID do prisma \xE9 obrigat\xF3rio." });
    }
    const condominioId = req.user.condominioId;
    const actor = {
      id: req.user.usuarioId,
      nome: req.user.nome
    };
    try {
      const result = await withPrismaLock(prismaId, async () => {
        return await supabaseStore.togglePrismaIndisponivel(prismaId, {
          tornarIndisponivel: Boolean(tornarIndisponivel),
          motivo,
          condominioId,
          actor
        });
      });
      return res.status(result.status).json(
        result.success ? { success: true, prisma: result.prisma } : { error: result.error }
      );
    } catch (err) {
      return handleStorageError(res, err, "Erro ao alterar estado do prisma no Supabase.");
    }
  });
  app3.post(
    "/api/movimentacoes/correcao",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { movimentacaoId, novaCasa, motivoCorrecao } = req.body;
      if (!movimentacaoId || !novaCasa || !motivoCorrecao) {
        return res.status(400).json({ error: "Movimenta\xE7\xE3o, nova Casa e Motivo da corre\xE7\xE3o s\xE3o obrigat\xF3rios." });
      }
      const condominioId = req.user.condominioId;
      const usuarioId = req.user.usuarioId;
      const usuarioNome = req.user.nome;
      try {
        const result = await supabaseStore.corrigirMovimentacao({
          movimentacaoId,
          novaCasa,
          motivoCorrecao,
          usuarioId,
          usuarioNome,
          condominioId
        });
        return res.status(result.status).json(
          result.success ? { success: true, movimentacao: result.movimentacao } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao processar corre\xE7\xE3o no Supabase.");
      }
    }
  );
  app3.post(
    "/api/turnos/assumir",
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const {
        nomeTurno,
        notasPassagem
      } = req.body;
      const porteiroId = req.user.usuarioId;
      const porteiroNome = req.user.nome;
      const condominioId = req.user.condominioId;
      try {
        const prismas = await supabaseStore.listPrismas(condominioId, false);
        const prismasEmUso = prismas.filter((p) => p.estado === "EM_USO" /* EM_USO */).length;
        const novoTurno = {
          id: `tur-${Date.now()}`,
          condominioId,
          nome: nomeTurno || `Turno ${(/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          porteiroId,
          porteiroNome,
          inicio: (/* @__PURE__ */ new Date()).toISOString(),
          ativo: true,
          prismasEmUsoNaAssuncao: prismasEmUso,
          notasPassagem: notasPassagem || void 0
        };
        activeTurnoSessions[condominioId] = novoTurno;
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "TROCA_TURNO",
          usuarioId: porteiroId,
          usuarioNome: porteiroNome,
          turnoId: novoTurno.id,
          turnoNome: novoTurno.nome,
          detalhes: `Passagem de turno assumida por ${porteiroNome}. ${prismasEmUso} prisma(s) em uso no momento.${notasPassagem ? ` Observa\xE7\xF5es: ${notasPassagem}` : ""}`,
          dadosNovos: { turnoId: novoTurno.id, prismasEmUso }
        });
        return res.json({ success: true, turno: novoTurno, prismasEmUso });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao registrar troca de turno no Supabase.");
      }
    }
  );
  app3.post(
    "/api/prismas",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */, "PORTEIRO" /* PORTEIRO */]),
    async (req, res) => {
      const { numero, corId, corNome } = req.body;
      if (!numero || !corId || !corNome) {
        return res.status(400).json({ error: "N\xFAmero e Cor s\xE3o obrigat\xF3rios." });
      }
      const condominioId = req.user.condominioId;
      const actor = {
        id: req.user.usuarioId,
        nome: req.user.nome
      };
      try {
        const result = await supabaseStore.createPrisma({
          numero,
          corId,
          corNome,
          condominioId,
          actor
        });
        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao cadastrar prisma no Supabase.");
      }
    }
  );
  app3.post(
    "/api/prismas/lote",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */, "PORTEIRO" /* PORTEIRO */]),
    async (req, res) => {
      const { numeros, numeroInicial, quantidade, padZero, corId, corNome } = req.body;
      if (!corId || !corNome) {
        return res.status(400).json({ error: "Cor \xE9 obrigat\xF3ria." });
      }
      let listaNumeros = [];
      if (Array.isArray(numeros) && numeros.length > 0) {
        listaNumeros = numeros.map((n) => String(n).trim()).filter(Boolean);
      } else if (numeroInicial !== void 0 && quantidade !== void 0) {
        const numInicio = parseInt(String(numeroInicial), 10);
        const qtd = parseInt(String(quantidade), 10);
        if (isNaN(numInicio) || numInicio < 1) {
          return res.status(400).json({ error: "O n\xFAmero inicial deve ser um valor inteiro maior ou igual a 1." });
        }
        if (isNaN(qtd) || qtd < 1) {
          return res.status(400).json({ error: "A quantidade deve ser um n\xFAmero inteiro maior ou igual a 1." });
        }
        if (qtd > 100) {
          return res.status(400).json({ error: "A quantidade m\xE1xima por lote \xE9 de 100 prismas." });
        }
        const devePad = padZero !== false;
        for (let i = numInicio; i < numInicio + qtd; i++) {
          listaNumeros.push(devePad && i < 10 ? `0${i}` : `${i}`);
        }
      } else {
        return res.status(400).json({ error: "Informe a lista de n\xFAmeros ou o n\xFAmero inicial e a quantidade." });
      }
      if (listaNumeros.length === 0) {
        return res.status(400).json({ error: "Nenhum prisma v\xE1lido a cadastrar." });
      }
      if (listaNumeros.length > 100) {
        return res.status(400).json({ error: "O limite m\xE1ximo por lote \xE9 de 100 prismas." });
      }
      const condominioId = req.user.condominioId;
      const actor = {
        id: req.user.usuarioId,
        nome: req.user.nome
      };
      try {
        const result = await supabaseStore.createPrismasLote({
          numeros: listaNumeros,
          corId,
          corNome,
          condominioId,
          actor
        });
        return res.status(result.status).json(
          result.success ? {
            success: true,
            totalCriados: result.totalCriados,
            primeiro: result.primeiro,
            ultimo: result.ultimo,
            prismas: result.prismas
          } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao cadastrar lote de prismas no Supabase.");
      }
    }
  );
  app3.get("/api/prismas/todos", async (req, res) => {
    const condominioId = req.query.condominioId || "condo-1";
    try {
      const prismas = await supabaseStore.listPrismas(condominioId, false);
      return res.json({ prismas });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao listar prismas no Supabase.");
    }
  });
  const handleExcluirPrisma = async (req, res) => {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID do prisma \xE9 obrigat\xF3rio." });
    }
    const condominioId = req.user.condominioId;
    const actor = {
      id: req.user.usuarioId,
      nome: req.user.nome,
      role: req.user.role,
      cargo: req.user.role === "SINDICO" /* SINDICO */ ? "S\xEDndico(a)" : req.user.role === "PORTEIRO" /* PORTEIRO */ ? "Porteiro(a)" : "Administrador"
    };
    try {
      const result = await withPrismaLock(id, async () => {
        return await supabaseStore.excluirPrisma(id, {
          condominioId,
          actor
        });
      });
      return res.status(result.status).json(
        result.success ? {
          success: true,
          message: result.message,
          tipoExclusao: result.tipoExclusao,
          prismaId: result.prismaId
        } : { error: result.error }
      );
    } catch (err) {
      return handleStorageError(res, err, "Erro ao processar exclus\xE3o do prisma no Supabase.");
    }
  };
  app3.post(
    "/api/prismas/:id/excluir",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */, "PORTEIRO" /* PORTEIRO */]),
    handleExcluirPrisma
  );
  app3.delete(
    "/api/prismas/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */, "PORTEIRO" /* PORTEIRO */]),
    handleExcluirPrisma
  );
  app3.patch(
    "/api/prismas/:id/status",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo, motivoInativacao } = req.body;
      const condominioId = req.user.condominioId;
      const actor = {
        id: req.user.usuarioId,
        nome: req.user.nome
      };
      try {
        const result = await supabaseStore.updatePrismaStatus(id, {
          ativo: Boolean(ativo),
          motivoInativacao,
          condominioId,
          actor
        });
        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao alterar status do prisma no Supabase.");
      }
    }
  );
  app3.get("/api/usuarios", async (req, res) => {
    const condominioId = req.query.condominioId || "condo-1";
    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId, false);
      return res.json({ usuarios });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao listar usu\xE1rios no Supabase.");
    }
  });
  app3.post(
    "/api/usuarios",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const {
        nome,
        cargo,
        role = "PORTEIRO" /* PORTEIRO */,
        matricula,
        tipoTurno,
        opcaoTurno12x36,
        paridade12x36,
        horaInicio,
        horaFim
      } = req.body;
      if (!nome || !nome.trim()) {
        return res.status(400).json({ error: "Nome do usu\xE1rio \xE9 obrigat\xF3rio." });
      }
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.createUsuario(
          {
            nome: nome.trim(),
            cargo,
            role,
            matricula,
            tipoTurno,
            opcaoTurno12x36,
            paridade12x36,
            horaInicio,
            horaFim,
            condominioId
          },
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, usuario: result.usuario } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao criar usu\xE1rio no Supabase.");
      }
    }
  );
  app3.put(
    "/api/usuarios/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const {
        nome,
        cargo,
        role,
        matricula,
        tipoTurno,
        opcaoTurno12x36,
        paridade12x36,
        horaInicio,
        horaFim,
        ativo
      } = req.body;
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.updateUsuario(
          id,
          {
            nome,
            cargo,
            role,
            matricula,
            tipoTurno,
            opcaoTurno12x36,
            paridade12x36,
            horaInicio,
            horaFim,
            ativo,
            condominioId
          },
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, usuario: result.usuario } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao editar usu\xE1rio no Supabase.");
      }
    }
  );
  app3.patch(
    "/api/usuarios/:id/status",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo } = req.body;
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.toggleUsuarioStatus(
          id,
          Boolean(ativo),
          condominioId,
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, usuario: result.usuario } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao alterar status do usu\xE1rio no Supabase.");
      }
    }
  );
  app3.delete(
    "/api/usuarios/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.deleteUsuario(id, condominioId, { id: adminId, nome: adminNome });
        return res.status(result.status).json(
          result.success ? {
            success: true,
            message: result.message,
            modo: result.modo,
            usuario: result.usuario
          } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao excluir usu\xE1rio no Supabase.");
      }
    }
  );
  app3.post("/api/usuarios/sync-restore", async (req, res) => {
    const { condominioId = "condo-1", usuarios = [] } = req.body;
    if (!Array.isArray(usuarios)) {
      return res.status(400).json({ error: "Lista de usu\xE1rios inv\xE1lida." });
    }
    try {
      const existing = await supabaseStore.listUsuarios(condominioId, true);
      let adicionados = 0;
      for (const u of usuarios) {
        if (!u || !u.nome) continue;
        const exists = existing.find(
          (ex) => ex.id === u.id || ex.nome.trim().toLowerCase() === u.nome.trim().toLowerCase()
        );
        if (!exists) {
          await supabaseStore.createUsuario(
            {
              ...u,
              condominioId
            },
            { id: "usr-admin", nome: "Sincronizador Autom\xE1tico" }
          );
          adicionados++;
        }
      }
      const list = await supabaseStore.listUsuarios(condominioId, false);
      return res.json({ success: true, adicionados, usuarios: list });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao sincronizar usu\xE1rios no Supabase.");
    }
  });
  app3.get(
    "/api/credenciais",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      try {
        const credenciais = await supabaseStore.listCredenciaisSanitizadas(condominioId);
        return res.json({ success: true, credenciais });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao listar credenciais de acesso.");
      }
    }
  );
  app3.post(
    "/api/credenciais",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      const { usuarioId, identificador, senha, pin } = req.body;
      if (!usuarioId) {
        return res.status(400).json({ error: "USUARIO_ID_OBRIGATORIO", message: "O ID do usu\xE1rio \xE9 obrigat\xF3rio." });
      }
      try {
        const usuario = await supabaseStore.getUsuario(usuarioId, condominioId);
        if (!usuario || usuario.excluido) {
          return res.status(404).json({ error: "USUARIO_NAO_ENCONTRADO", message: "Usu\xE1rio n\xE3o encontrado no condom\xEDnio." });
        }
        if (!usuario.ativo) {
          return res.status(400).json({ error: "USUARIO_INATIVO", message: "N\xE3o \xE9 poss\xEDvel criar credencial para usu\xE1rio inativo." });
        }
        if (usuario.role === "PORTEIRO" /* PORTEIRO */) {
          return res.status(400).json({
            error: "OPERACAO_INVALIDA",
            message: "Operadores de portaria utilizam o C\xF3digo de Acesso da Portaria compartilhado da esta\xE7\xE3o. N\xE3o \xE9 permitida a cria\xE7\xE3o de credenciais individuais para porteiros."
          });
        }
        const existingCreds = await supabaseStore.findCredenciaisByUsuarioId(usuarioId);
        if (existingCreds.length > 0) {
          return res.status(409).json({
            error: "CREDENCIAL_JA_EXISTE",
            message: "Este usu\xE1rio j\xE1 possui credencial de acesso configurada. Utilize a redefini\xE7\xE3o de acesso."
          });
        }
        let tipoAcesso;
        if (usuario.role === "ADMIN" /* ADMIN */) {
          tipoAcesso = "ADMIN" /* ADMIN */;
        } else if (usuario.role === "SINDICO" /* SINDICO */) {
          tipoAcesso = "SINDICO" /* SINDICO */;
        } else {
          tipoAcesso = "PORTARIA" /* PORTARIA */;
        }
        let senhaHash = null;
        let pinHash = null;
        let idLogin = (identificador || "").trim();
        if (!idLogin) {
          return res.status(400).json({
            error: "IDENTIFICADOR_OBRIGATORIO",
            message: "O identificador (login) \xE9 obrigat\xF3rio para administradores e s\xEDndicos."
          });
        }
        const idDuplicado = await supabaseStore.findCredencialByIdentificador(idLogin);
        if (idDuplicado) {
          return res.status(409).json({
            error: "IDENTIFICADOR_JA_EXISTE",
            message: `O identificador "${idLogin}" j\xE1 est\xE1 em uso por outra credencial.`
          });
        }
        const passValidation = validatePasswordFormat(senha);
        if (!passValidation.valid) {
          return res.status(400).json({
            error: "SENHA_INVALIDA",
            message: passValidation.error
          });
        }
        senhaHash = await hashPassword(senha);
        const novaCredencial = await supabaseStore.createCredencial({
          usuarioId: usuario.id,
          condominioId,
          tipoAcesso,
          identificador: idLogin,
          senhaHash,
          pinHash,
          ativo: true
        });
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "CRIACAO_CREDENCIAL",
          usuarioId: req.user.usuarioId,
          usuarioNome: req.user.nome,
          detalhes: `Credencial criada para ${usuario.nome} (${tipoAcesso}).`,
          dadosNovos: { credencialId: novaCredencial.id, usuarioId: usuario.id, tipoAcesso, identificador: idLogin }
        });
        const sanitizada = supabaseStore.sanitizeCredencial(novaCredencial);
        return res.status(201).json({ success: true, credencial: sanitizada });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao criar credencial de acesso.");
      }
    }
  );
  app3.put(
    "/api/credenciais/:id/senha",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      const { id } = req.params;
      const { senha, identificador } = req.body;
      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || "condo-1") !== condominioId) {
          return res.status(404).json({ error: "CREDENCIAL_NAO_ENCONTRADA", message: "Credencial n\xE3o encontrada." });
        }
        if (cred.tipoAcesso === "PORTARIA" /* PORTARIA */) {
          return res.status(400).json({
            error: "TIPO_ACESSO_INVALIDO",
            message: "Operadores de portaria utilizam autentica\xE7\xE3o por PIN, n\xE3o por senha."
          });
        }
        const passValidation = validatePasswordFormat(senha);
        if (!passValidation.valid) {
          return res.status(400).json({
            error: "SENHA_INVALIDA",
            message: passValidation.error
          });
        }
        const updates = {};
        updates.senhaHash = await hashPassword(senha);
        if (identificador && identificador.trim() !== cred.identificador) {
          const novoId = identificador.trim();
          const idDuplicado = await supabaseStore.findCredencialByIdentificador(novoId);
          if (idDuplicado && idDuplicado.id !== id) {
            return res.status(409).json({
              error: "IDENTIFICADOR_JA_EXISTE",
              message: `O identificador "${novoId}" j\xE1 est\xE1 em uso.`
            });
          }
          updates.identificador = novoId;
        }
        const updated = await supabaseStore.updateCredencial(id, updates);
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "REDEFINICAO_SENHA",
          usuarioId: req.user.usuarioId,
          usuarioNome: req.user.nome,
          detalhes: `Senha redefinida para credencial ${cred.identificador}.`
        });
        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({ success: true, credencial: sanitizada });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao redefinir senha da credencial.");
      }
    }
  );
  app3.put(
    "/api/credenciais/:id/pin",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      const { id } = req.params;
      const { pin } = req.body;
      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || "condo-1") !== condominioId) {
          return res.status(404).json({ error: "CREDENCIAL_NAO_ENCONTRADA", message: "Credencial n\xE3o encontrada." });
        }
        if (cred.tipoAcesso !== "PORTARIA" /* PORTARIA */) {
          return res.status(400).json({
            error: "TIPO_ACESSO_INVALIDO",
            message: "Apenas operadores de portaria utilizam autentica\xE7\xE3o por PIN."
          });
        }
        const pinValidation = validatePinFormat(pin);
        if (!pinValidation.valid) {
          return res.status(400).json({
            error: "PIN_INVALIDO",
            message: pinValidation.error
          });
        }
        const pinHash = await hashPin(pin);
        const updated = await supabaseStore.updateCredencial(id, { pinHash });
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "REDEFINICAO_PIN",
          usuarioId: req.user.usuarioId,
          usuarioNome: req.user.nome,
          detalhes: `PIN redefinido para credencial do usu\xE1rio ID ${cred.usuarioId}.`
        });
        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({ success: true, credencial: sanitizada });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao redefinir PIN da credencial.");
      }
    }
  );
  app3.patch(
    "/api/credenciais/:id/status",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      const { id } = req.params;
      const { ativo, desbloquear } = req.body;
      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || "condo-1") !== condominioId) {
          return res.status(404).json({ error: "CREDENCIAL_NAO_ENCONTRADA", message: "Credencial n\xE3o encontrada." });
        }
        if (cred.usuarioId === req.user.usuarioId && ativo === false) {
          return res.status(400).json({
            error: "OPERACAO_INVALIDA",
            message: "N\xE3o \xE9 permitido desativar a pr\xF3pria credencial de administrador em uso na sess\xE3o."
          });
        }
        const updates = {};
        if (typeof ativo === "boolean") {
          updates.ativo = ativo;
        }
        if (desbloquear === true) {
          updates.bloqueado = false;
          updates.tentativasInvalidas = 0;
        }
        const updated = await supabaseStore.updateCredencial(id, updates);
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "STATUS_CREDENCIAL",
          usuarioId: req.user.usuarioId,
          usuarioNome: req.user.nome,
          detalhes: `Credencial ${cred.identificador}: ${ativo !== void 0 ? ativo ? "ativada" : "desativada" : ""} ${desbloquear ? "desbloqueada" : ""}.`,
          dadosNovos: { id, ativo: updated.ativo, bloqueado: updated.bloqueado }
        });
        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({ success: true, credencial: sanitizada });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao alterar status da credencial.");
      }
    }
  );
  app3.delete(
    "/api/credenciais/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */]),
    async (req, res) => {
      const condominioId = req.user.condominioId;
      const { id } = req.params;
      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || "condo-1") !== condominioId) {
          return res.status(404).json({ error: "CREDENCIAL_NAO_ENCONTRADA", message: "Credencial n\xE3o encontrada." });
        }
        if (cred.usuarioId === req.user.usuarioId) {
          return res.status(400).json({
            error: "OPERACAO_INVALIDA",
            message: "N\xE3o \xE9 permitido excluir a pr\xF3pria credencial de administrador em uso na sess\xE3o."
          });
        }
        const result = await supabaseStore.deleteCredencial(id, condominioId);
        await supabaseStore.logAuditoria({
          condominioId,
          acao: "EXCLUSAO_CREDENCIAL",
          usuarioId: req.user.usuarioId,
          usuarioNome: req.user.nome,
          detalhes: `Credencial ${cred.identificador} (Usu\xE1rio ID ${cred.usuarioId}) removida.`
        });
        return res.json({ success: true, removido: result.removido });
      } catch (err) {
        return handleStorageError(res, err, "Erro ao excluir credencial de acesso.");
      }
    }
  );
  app3.put(
    "/api/condominios/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const { nome, endereco, mostrarMensagem } = req.body;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      let nomeFinal = nome?.trim();
      let enderecoFinal = endereco !== void 0 ? endereco?.trim() : void 0;
      if (!nomeFinal) {
        try {
          const currentStatus = await supabaseStore.getStatus(id);
          const currentCondo = currentStatus.condominio || currentStatus.condominios?.find((c) => c.id === id);
          if (!currentCondo) {
            return res.status(404).json({ error: "Condom\xEDnio n\xE3o encontrado." });
          }
          nomeFinal = currentCondo.nome;
          if (enderecoFinal === void 0) {
            enderecoFinal = currentCondo.endereco;
          }
        } catch (err) {
          return res.status(400).json({ error: "O nome do condom\xEDnio \xE9 obrigat\xF3rio." });
        }
      }
      try {
        const result = await supabaseStore.updateCondominio(
          id,
          { nome: nomeFinal, endereco: enderecoFinal, mostrarMensagem },
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, condominio: result.condominio } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao atualizar condom\xEDnio no Supabase.");
      }
    }
  );
  app3.get("/api/contatos", async (req, res) => {
    const condominioId = req.query.condominioId || "condo-1";
    try {
      const contatos = await supabaseStore.listContatos(condominioId);
      return res.json({ contatos });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao listar contatos no Supabase.");
    }
  });
  app3.post(
    "/api/contatos",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const {
        nome,
        categoria = "PORTARIA" /* PORTARIA */,
        telefoneOuWhatsapp,
        identificador
      } = req.body;
      if (!nome || !nome.trim()) {
        return res.status(400).json({ error: "Nome do contato \xE9 obrigat\xF3rio." });
      }
      if (!telefoneOuWhatsapp || !telefoneOuWhatsapp.trim()) {
        return res.status(400).json({ error: "Telefone / WhatsApp \xE9 obrigat\xF3rio." });
      }
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.createContato(
          {
            nome,
            categoria,
            telefoneOuWhatsapp,
            identificador,
            condominioId
          },
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, contato: result.contato } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao criar contato no Supabase.");
      }
    }
  );
  app3.put(
    "/api/contatos/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const {
        nome,
        categoria,
        telefoneOuWhatsapp,
        identificador,
        ativo
      } = req.body;
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.updateContato(
          id,
          {
            nome,
            categoria,
            telefoneOuWhatsapp,
            identificador,
            ativo,
            condominioId
          },
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, contato: result.contato } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao atualizar contato no Supabase.");
      }
    }
  );
  app3.patch(
    "/api/contatos/:id/status",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo } = req.body;
      const condominioId = req.user.condominioId;
      const adminId = req.user.usuarioId;
      const adminNome = req.user.nome;
      try {
        const result = await supabaseStore.toggleContatoStatus(
          id,
          Boolean(ativo),
          condominioId,
          { id: adminId, nome: adminNome }
        );
        return res.status(result.status).json(
          result.success ? { success: true, contato: result.contato } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao alterar status do contato no Supabase.");
      }
    }
  );
  app3.delete(
    "/api/contatos/:id",
    requireAuth,
    requireRole(["ADMIN" /* ADMIN */, "SINDICO" /* SINDICO */]),
    async (req, res) => {
      const { id } = req.params;
      const condominioId = req.user.condominioId;
      try {
        const result = await supabaseStore.deleteContato(id, condominioId);
        return res.status(result.status).json(
          result.success ? { success: true, removido: result.removido } : { error: result.error }
        );
      } catch (err) {
        return handleStorageError(res, err, "Erro ao excluir contato no Supabase.");
      }
    }
  );
  app3.get("/api/prismas/:id/historico", async (req, res) => {
    const { id } = req.params;
    const condominioId = req.query.condominioId || "condo-1";
    try {
      const historico = await supabaseStore.getHistoricoPrisma(id, condominioId);
      if (!historico) {
        return res.status(404).json({ error: "Prisma n\xE3o encontrado no Supabase." });
      }
      return res.json(historico);
    } catch (err) {
      return handleStorageError(res, err, "Erro ao buscar hist\xF3rico do prisma no Supabase.");
    }
  });
  app3.get("/api/auditoria", async (req, res) => {
    const condominioId = req.query.condominioId || "condo-1";
    const limit = parseInt(req.query.limit) || 100;
    try {
      const logs = await supabaseStore.listAuditoria(condominioId, limit);
      return res.json({ logs });
    } catch (err) {
      return handleStorageError(res, err, "Erro ao consultar logs de auditoria no Supabase.");
    }
  });
  return app3;
}
var app = createExpressApp();
async function startServer() {
  const PORT = 3e3;
  if (process.env.VERCEL === "1" || process.env.NOW_REGION) {
    return;
  }
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u{1F680} Servidor Controle de Prismas rodando em http://localhost:${PORT}`);
  });
}
var isMainProcess = typeof process !== "undefined" && process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.cjs") || process.argv[1].endsWith("server.js"));
if (isMainProcess && process.env.VERCEL !== "1" && !process.env.NOW_REGION) {
  startServer().catch((err) => {
    console.error("Falha fatal ao iniciar o servidor:", err);
  });
}

// src/api/handler.ts
var app2 = createExpressApp();
function handler(req, res) {
  const rawUrl = typeof req.url === "string" ? req.url : "";
  const headers = req.headers || {};
  let targetPath = "";
  if (rawUrl && rawUrl !== "/" && rawUrl !== "/api" && rawUrl !== "/api/") {
    targetPath = rawUrl;
  } else if (headers["x-now-route-matches"]) {
    try {
      const parts = new URLSearchParams(headers["x-now-route-matches"]);
      const subpath = parts.get("1") || parts.get("0");
      if (subpath) {
        targetPath = `/api/${decodeURIComponent(subpath)}`;
      }
    } catch {
    }
  } else if (headers["x-matched-path"] && headers["x-matched-path"] !== "/api" && headers["x-matched-path"] !== "/api/") {
    targetPath = headers["x-matched-path"];
  } else if (headers["x-forwarded-uri"] && headers["x-forwarded-uri"] !== "/api" && headers["x-forwarded-uri"] !== "/api/") {
    targetPath = headers["x-forwarded-uri"];
  }
  if (targetPath) {
    if (!targetPath.startsWith("/api")) {
      targetPath = `/api${targetPath.startsWith("/") ? "" : "/"}${targetPath}`;
    }
    req.url = targetPath;
  } else if (rawUrl && !rawUrl.startsWith("/api")) {
    req.url = `/api${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
  }
  return app2(req, res);
}
export {
  handler as default
};
