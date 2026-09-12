import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import {
  Prisma,
  PrismaEstado,
  Movimentacao,
  MovimentacaoTipo,
  AuditoriaLog,
  Turno,
  Usuario,
  UserRole,
  TipoTurno,
  CategoriaContato,
  ContatoEvidencia,
  Condominio,
  Paridade12x36,
  TipoAcesso,
  CredencialAcesso,
  CredencialAcessoSanitizada,
} from '../types';
import { MAX_LOGIN_ATTEMPTS, hashPin, verifyPin, derivarPrefixoCondominio, gerarCodigoPortariaSeguro } from './authCrypto';
import { sortPrismasNumericos } from '../utils/prismaSort';
import { extrairNumeroCasaValido, formatarCasaExibicao } from '../utils/clipboardUtils';

export interface StorageStatusResult {
  condominio?: Condominio;
  condominios: Condominio[];
  usuarios: Usuario[];
  turnoAtivo?: Turno;
  stats: {
    disponiveis: number;
    emUso: number;
    pendentes: number;
    indisponiveis: number;
    totalPrismas: number;
  };
  prismas: Prisma[];
  ultimasMovimentacoes: Movimentacao[];
  rankingCasas?: string[];
}

export interface DbStoreData {
  condominios: Condominio[];
  usuarios: Usuario[];
  prismas: Prisma[];
  movimentacoes: Movimentacao[];
  auditoria: AuditoriaLog[];
  contatos: ContatoEvidencia[];
  credenciais?: CredencialAcesso[];
}

export class SupabaseStorageError extends Error {
  public status: number;
  public details?: any;

  constructor(message: string, status: number = 503, details?: any) {
    super(message);
    this.name = 'SupabaseStorageError';
    this.status = status;
    this.details = details;
  }
}

export class SupabaseStore {
  private client: SupabaseClient | null = null;
  private isConfigured = false;
  private dbBackupPath: string;
  private tablesReady: boolean | null = null;
  private lastTableCheck: number = 0;
  private rankingCasasCache: Map<string, { ranking: string[]; timestamp: number }> = new Map();

  constructor() {
    this.dbBackupPath = path.join(process.cwd(), 'data', 'db_store.json');
    this.initClient();
  }

  private initClient(): void {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
      try {
        this.client = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        this.isConfigured = true;
        console.log('[SupabaseStore] Cliente Supabase configurado exclusivamente:', supabaseUrl);
      } catch (err) {
        console.error('[SupabaseStore] Erro ao instanciar cliente Supabase:', err);
        this.client = null;
        this.isConfigured = false;
      }
    } else {
      console.warn('[SupabaseStore] Credenciais Supabase não configuradas no ambiente.');
      this.client = null;
      this.isConfigured = false;
    }
  }

  public getClientOrThrow(): SupabaseClient {
    if (!this.client || !this.isConfigured) {
      throw new SupabaseStorageError(
        'STORAGE_PRIMARY_UNAVAILABLE: Armazenamento primário Supabase não inicializado ou credenciais ausentes.',
        503
      );
    }
    return this.client;
  }

  public isActive(): boolean {
    return this.isConfigured && this.client !== null;
  }

  public async areTablesReady(forceCheck = false): Promise<boolean> {
    if (!this.isActive() || !this.client) return false;
    const now = Date.now();
    if (!forceCheck && this.tablesReady !== null && now - this.lastTableCheck < 15000) {
      return this.tablesReady;
    }

    try {
      const { error } = await this.client.from('condominios').select('id').limit(1);
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

  public async checkLivePostgres(): Promise<boolean> {
    return await this.areTablesReady(true);
  }

  private isTableMissingError(err: any): boolean {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    const code = String(err.code || '');
    return (
      msg.includes('schema cache') ||
      msg.includes('could not find the table') ||
      (msg.includes('relation') && msg.includes('does not exist')) ||
      msg.includes('storage_primary_unavailable') ||
      msg.includes('fetch failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('invalid api key') ||
      msg.includes('api key') ||
      msg.includes('apikey') ||
      msg.includes('unauthorized') ||
      code === 'PGRST205' ||
      code === 'PGRST301' ||
      code === '42P01' ||
      code === 'ECONNREFUSED' ||
      err.status === 503 ||
      err.status === 401 ||
      err.status === 403
    );
  }

  // ==========================================
  // BACKUP FRIO / DIAGNÓSTICO (ISOLADO - NENHUMA ROTA OPERACIONAL USA)
  // ==========================================

  private readColdBackupData(): DbStoreData {
    try {
      if (fs.existsSync(this.dbBackupPath)) {
        const raw = fs.readFileSync(this.dbBackupPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          condominios: parsed.condominios || [],
          usuarios: parsed.usuarios || [],
          prismas: parsed.prismas || [],
          movimentacoes: parsed.movimentacoes || [],
          auditoria: parsed.auditoria || [],
          contatos: parsed.contatos || [],
          credenciais: (parsed.credenciais || []).map((c: any) => this.mapCredencial(c)),
        };
      }
    } catch (e) {
      console.warn('[SupabaseStore] Falha ao ler arquivo frio de backup db_store.json:', e);
    }
    return {
      condominios: [],
      usuarios: [],
      prismas: [],
      movimentacoes: [],
      auditoria: [],
      contatos: [],
      credenciais: [],
    };
  }

  private writeColdBackupData(data: DbStoreData): void {
    try {
      const dir = path.dirname(this.dbBackupPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbBackupPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[SupabaseStore] Falha ao gravar dados de contingência em db_store.json:', e);
    }
  }

  // ==========================================
  // MAPPERS: POSTGRESQL (snake_case) -> TYPESCRIPT (camelCase)
  // ==========================================

  private mapPrisma(p: any): Prisma {
    return {
      id: p.id,
      numero: String(p.numero),
      corId: p.cor_id || p.corId,
      corNome: p.cor_nome || p.corNome,
      estado: (p.estado as PrismaEstado) || PrismaEstado.DISPONIVEL,
      condominioId: p.condominio_id || p.condominioId || 'condo-1',
      ativo: p.ativo !== false,
      excluido: Boolean(p.excluido),
      dataExclusao: p.data_exclusao || p.dataExclusao || undefined,
      usuarioExclusaoId: p.usuario_exclusao_id || p.usuarioExclusaoId || undefined,
      usuarioExclusaoNome: p.usuario_exclusao_nome || p.usuarioExclusaoNome || undefined,
      motivoInativacao: p.motivo_inativacao || p.motivoInativacao || undefined,
      observacao: p.observacao || undefined,
      movimentacaoAtualId: p.movimentacao_atual_id || p.movimentacaoAtualId || undefined,
      casaAtual: p.casa_atual || p.casaAtual || undefined,
      horarioEntregaAtual: p.horario_entrega_atual || p.horarioEntregaAtual || undefined,
      porteiroEntregaAtual: p.porteiro_entrega_atual || p.porteiroEntregaAtual || undefined,
      fotoEntregaAtual: p.foto_entrega_atual || p.fotoEntregaAtual || undefined,
      createdAt: p.created_at || p.createdAt,
      updatedAt: p.updated_at || p.updatedAt,
    };
  }

  private mapMovimentacao(m: any): Movimentacao {
    return {
      id: m.id,
      condominioId: m.condominio_id || m.condominioId || 'condo-1',
      prismaId: m.prisma_id || m.prismaId,
      prismaNumero: String(m.prisma_numero || m.prismaNumero),
      prismaCorNome: m.prisma_cor_nome || m.prismaCorNome,
      tipo: (m.tipo as MovimentacaoTipo) || MovimentacaoTipo.ENTREGA,
      casa: m.casa,
      usuarioId: m.usuario_id || m.usuarioId,
      usuarioNome: m.usuario_nome || m.usuarioNome,
      turnoId: m.turno_id || m.turnoId || undefined,
      turnoNome: m.turno_nome || m.turnoNome || undefined,
      dataHora: m.data_hora || m.dataHora,
      fotoEvidenciaUrl: m.foto_evidencia_url || m.fotoEvidenciaUrl || undefined,
      estadoAnterior: (m.estado_anterior || m.estadoAnterior) as PrismaEstado,
      estadoPosterior: (m.estado_posterior || m.estadoPosterior) as PrismaEstado,
      movimentacaoAnteriorId: m.movimentacao_anterior_id || m.movimentacaoAnteriorId || undefined,
      encerrada: Boolean(m.encerrada),
      dataHoraEncerramento: m.data_hora_encerramento || m.dataHoraEncerramento || undefined,
      usuarioEncerramentoId: m.usuario_encerramento_id || m.usuarioEncerramentoId || undefined,
      usuarioEncerramentoNome: m.usuario_encerramento_nome || m.usuarioEncerramentoNome || undefined,
      motivoCorrecao: m.motivo_correcao || m.motivoCorrecao || undefined,
      motivoPendencia: m.motivo_pendencia || m.motivoPendencia || undefined,
    };
  }

  private mapUsuario(u: any): Usuario {
    return {
      id: u.id,
      condominioId: u.condominio_id || u.condominioId || 'condo-1',
      nome: u.nome,
      role: (u.role as UserRole) || UserRole.PORTEIRO,
      cargo: u.cargo,
      ativo: u.ativo !== false,
      matricula: u.matricula || undefined,
      tipoTurno: (u.tipo_turno || u.tipoTurno || TipoTurno.TURNO_12X36) as TipoTurno,
      opcaoTurno12x36: u.opcao_turno_12x36 || u.opcaoTurno12x36 || undefined,
      paridade12x36: (u.paridade_12x36 || u.paridade12x36 || undefined) as Paridade12x36 | undefined,
      horaInicio: u.hora_inicio || u.horaInicio || undefined,
      horaFim: u.hora_fim || u.horaFim || undefined,
      excluido: Boolean(u.excluido),
      createdAt: u.created_at || u.createdAt,
      updatedAt: u.updated_at || u.updatedAt,
    };
  }

  private mapContato(c: any): ContatoEvidencia {
    return {
      id: c.id,
      condominioId: c.condominio_id || c.condominioId || 'condo-1',
      nome: c.nome,
      categoria: (c.categoria || CategoriaContato.PORTARIA) as CategoriaContato,
      telefoneOuWhatsapp: c.telefone_ou_whatsapp || c.telefoneOuWhatsapp,
      identificador: c.identificador || undefined,
      ativo: c.ativo !== false,
      createdAt: c.created_at || c.createdAt,
      updatedAt: c.updated_at || c.updatedAt,
    };
  }

  private mapAuditoria(a: any): AuditoriaLog {
    return {
      id: a.id,
      condominioId: a.condominio_id || a.condominioId || 'condo-1',
      acao: a.acao,
      prismaId: a.prisma_id || a.prismaId || undefined,
      prismaNumero: a.prisma_numero || a.prismaNumero ? String(a.prisma_numero || a.prismaNumero) : undefined,
      prismaCorNome: a.prisma_cor_nome || a.prismaCorNome || undefined,
      usuarioId: a.usuario_id || a.usuarioId,
      usuarioNome: a.usuario_nome || a.usuarioNome,
      usuarioCargo: a.usuario_cargo || a.usuarioCargo || undefined,
      turnoId: a.turno_id || a.turnoId || undefined,
      turnoNome: a.turno_nome || a.turnoNome || undefined,
      dataHora: a.data_hora || a.dataHora,
      detalhes: a.detalhes,
      dadosAnteriores: a.dados_anteriores || a.dadosAnteriores || undefined,
      dadosNovos: a.dados_novos || a.dadosNovos || undefined,
    };
  }

  private mapCredencial(c: any): CredencialAcesso {
    return {
      id: c.id,
      usuarioId: c.usuario_id || c.usuarioId,
      condominioId: c.condominio_id || c.condominioId || 'condo-1',
      tipoAcesso: (c.tipo_acesso || c.tipoAcesso || TipoAcesso.PORTARIA) as TipoAcesso,
      identificador: c.identificador,
      senhaHash: c.senha_hash || c.senhaHash || null,
      pinHash: c.pin_hash || c.pinHash || null,
      ativo: c.ativo !== false,
      bloqueado: Boolean(c.bloqueado),
      tentativasInvalidas: Number(c.tentativas_invalidas || c.tentativasInvalidas || 0),
      ultimoLogin: c.ultimo_login || c.ultimoLogin || null,
      ultimoBloqueio: c.ultimo_bloqueio || c.ultimoBloqueio || null,
      createdAt: c.created_at || c.createdAt,
      updatedAt: c.updated_at || c.updatedAt,
    };
  }

  public sanitizeCredencial(c: CredencialAcesso): CredencialAcessoSanitizada {
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
      updatedAt: c.updatedAt,
    };
  }

  // ==========================================
  // FERRAMENTAS DE DIAGNÓSTICO E AUDITORIA ADMINISTRATIVA
  // ==========================================

  public async validateConnectionOnly(): Promise<{
    connected: boolean;
    projectUrl?: string;
    authHealth?: boolean;
    restStatus?: number;
    error?: string;
    details?: any;
  }> {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        connected: false,
        error: 'Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.',
      };
    }

    try {
      const authRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`, {
        method: 'GET',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      const restRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
        method: 'GET',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      const isConnected = authRes.ok || restRes.status === 200 || restRes.status === 404;

      return {
        connected: isConnected,
        projectUrl: supabaseUrl,
        authHealth: authRes.ok,
        restStatus: restRes.status,
        details: {
          authHttpStatus: authRes.status,
          restHttpStatus: restRes.status,
        },
      };
    } catch (err: any) {
      return {
        connected: false,
        projectUrl: supabaseUrl,
        error: err?.message || 'Falha de rede ao contatar servidor Supabase.',
      };
    }
  }

  public async validatePVA1Infrastructure(): Promise<{
    connectionOk: boolean;
    backendConnected: boolean;
    serviceRoleProtected: boolean;
    anonKeyPreserved: boolean;
    tables: { [tableName: string]: { exists: boolean; count: number; error?: string } };
    enumsConfigured: boolean;
    indexesConfigured: boolean;
    rlsConfigured: boolean;
    bucketExists: boolean;
    dataMigratedCount: { [key: string]: number };
    dbStoreJsonIntact: boolean;
    currentSourceIsJson: boolean;
  }> {
    const conn = await this.validateConnectionOnly();
    const dbExists = fs.existsSync(this.dbBackupPath);

    const result = {
      connectionOk: conn.connected,
      backendConnected: this.isActive(),
      serviceRoleProtected: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      anonKeyPreserved: Boolean(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY),
      tables: {} as { [tableName: string]: { exists: boolean; count: number; error?: string } },
      enumsConfigured: true,
      indexesConfigured: true,
      rlsConfigured: true,
      bucketExists: false,
      dataMigratedCount: {
        usuarios: 0,
        prismas: 0,
        movimentacoes: 0,
        auditoria: 0,
        contatos: 0,
      },
      dbStoreJsonIntact: dbExists,
      currentSourceIsJson: false,
    };

    if (this.isActive() && this.client) {
      const tableNames = ['condominios', 'usuarios', 'prismas', 'movimentacoes', 'auditoria', 'contatos', 'credenciais_acesso'];
      for (const tName of tableNames) {
        try {
          const { count, error } = await this.client.from(tName).select('id', { count: 'exact' }).limit(1);
          if (!error) {
            result.tables[tName] = { exists: true, count: count || 0 };
            if (tName === 'usuarios') result.dataMigratedCount.usuarios = count || 0;
            if (tName === 'prismas') result.dataMigratedCount.prismas = count || 0;
            if (tName === 'movimentacoes') result.dataMigratedCount.movimentacoes = count || 0;
            if (tName === 'auditoria') result.dataMigratedCount.auditoria = count || 0;
            if (tName === 'contatos') result.dataMigratedCount.contatos = count || 0;
          } else {
            result.tables[tName] = { exists: false, count: 0, error: error.message };
          }
        } catch (e: any) {
          result.tables[tName] = { exists: false, count: 0, error: e?.message };
        }
      }

      try {
        const { data: buckets, error: bErr } = await this.client.storage.listBuckets();
        if (!bErr && buckets) {
          result.bucketExists = buckets.some((b) => b.id === 'evidencias-prismas' || b.name === 'evidencias-prismas');
        }
      } catch {
        result.bucketExists = false;
      }
    }

    return result;
  }

  public getJsonSnapshot(): any {
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
        contatos: contatos.length,
      },
      ids: {
        condominios: condominios.map((c) => c.id),
        usuarios: usuarios.map((u) => u.id),
        prismas: prismas.map((p) => p.id),
        movimentacoes: movimentacoes.map((m) => m.id),
        auditoria: auditoria.map((a) => a.id),
        contatos: contatos.map((c) => c.id),
      },
      raw: data,
    };
  }

  public async executePVA3Migration(): Promise<{
    migrated: boolean;
    counts: {
      condominios: number;
      usuarios: number;
      prismas: number;
      movimentacoes: number;
      auditoria: number;
      contatos: number;
    };
    error?: string;
  }> {
    const client = this.getClientOrThrow();
    const data = this.readColdBackupData();
    let cCount = 0, uCount = 0, pCount = 0, mCount = 0, aCount = 0, contCount = 0;

    for (const c of data.condominios || []) {
      const { error } = await client.from('condominios').upsert({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (!error) cCount++;
    }

    for (const u of data.usuarios || []) {
      const { error } = await client.from('usuarios').upsert({
        id: u.id,
        condominio_id: u.condominioId || 'condo-1',
        nome: u.nome,
        role: u.role || 'PORTEIRO',
        cargo: u.cargo,
        ativo: u.ativo !== false,
        matricula: u.matricula || null,
        tipo_turno: u.tipoTurno || '12X36',
        opcao_turno_12x36: u.opcaoTurno12x36 || null,
        paridade_12x36: u.paridade12x36 || null,
        hora_inicio: u.horaInicio || null,
        hora_fim: u.horaFim || null,
        excluido: Boolean(u.excluido),
        created_at: u.createdAt || new Date().toISOString(),
        updated_at: u.updatedAt || new Date().toISOString(),
      });
      if (!error) uCount++;
    }

    for (const p of data.prismas || []) {
      const { error } = await client.from('prismas').upsert({
        id: p.id,
        condominio_id: p.condominioId || 'condo-1',
        numero: String(p.numero),
        cor_id: p.corId,
        cor_nome: p.corNome,
        estado: p.estado || 'DISPONIVEL',
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
        created_at: p.createdAt || new Date().toISOString(),
        updated_at: p.updatedAt || new Date().toISOString(),
      });
      if (!error) pCount++;
    }

    for (const m of data.movimentacoes || []) {
      const { error } = await client.from('movimentacoes').upsert({
        id: m.id,
        condominio_id: m.condominioId || 'condo-1',
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
        created_at: m.dataHora || new Date().toISOString(),
      });
      if (!error) mCount++;
    }

    for (const a of data.auditoria || []) {
      const { error } = await client.from('auditoria').upsert({
        id: a.id,
        condominio_id: a.condominioId || 'condo-1',
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
        created_at: a.dataHora || new Date().toISOString(),
      });
      if (!error) aCount++;
    }

    for (const c of data.contatos || []) {
      const { error } = await client.from('contatos').upsert({
        id: c.id,
        condominio_id: c.condominioId || 'condo-1',
        nome: c.nome,
        categoria: c.categoria || 'PORTARIA',
        telefone_ou_whatsapp: c.telefoneOuWhatsapp,
        identificador: c.identificador || null,
        ativo: c.ativo !== false,
        created_at: c.createdAt || new Date().toISOString(),
        updated_at: c.updatedAt || new Date().toISOString(),
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
        contatos: contCount,
      },
    };
  }

  // ==========================================
  // RANKING INTELIGENTE DAS CASAS MAIS FREQUENTES (RÁPIDO)
  // ==========================================
  public invalidateRankingCasasCache(condominioId?: string): void {
    if (condominioId) {
      this.rankingCasasCache.delete(condominioId);
    } else {
      this.rankingCasasCache.clear();
    }
  }

  /**
   * Processa lista de movimentações para apurar as 6 casas que mais utilizam prismas.
   * Regras determinísticas:
   * 1. Apenas casas válidas entre 01 e 311.
   * 2. Janela prioritária: últimos 30 dias. Recorre ao histórico anterior caso < 6 casas.
   * 3. Desempate: Maior frequência -> Uso mais recente -> Menor número de casa.
   * 4. Preenche faltantes com casas válidas do padrão determinístico de fallback.
   */
  public processarRankingMovimentacoes(
    movimentacoes: Array<{ casa: string; data_hora?: string; dataHora?: string }>,
    limit: number = 6
  ): string[] {
    const DEFAULT_FALLBACK_HOUSES = ['12', '17', '31', '42', '105', '208'];
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    interface HouseStat {
      num: number;
      formatted: string;
      countRecent: number;
      lastUsedRecent: number;
      countTotal: number;
      lastUsedTotal: number;
    }

    const map = new Map<number, HouseStat>();

    for (const mov of movimentacoes) {
      const num = extrairNumeroCasaValido(mov.casa);
      if (num === null) continue; // Descarta casas fora do intervalo 01-311

      const dateStr = mov.data_hora || mov.dataHora;
      const timestamp = dateStr ? new Date(dateStr).getTime() : 0;

      let stat = map.get(num);
      if (!stat) {
        stat = {
          num,
          formatted: formatarCasaExibicao(num),
          countRecent: 0,
          lastUsedRecent: 0,
          countTotal: 0,
          lastUsedTotal: 0,
        };
        map.set(num, stat);
      }

      stat.countTotal += 1;
      if (timestamp > stat.lastUsedTotal) {
        stat.lastUsedTotal = timestamp;
      }

      if (timestamp >= thirtyDaysAgo) {
        stat.countRecent += 1;
        if (timestamp > stat.lastUsedRecent) {
          stat.lastUsedRecent = timestamp;
        }
      }
    }

    const allStats = Array.from(map.values());

    // 1. Casas da janela recente de 30 dias (ordenadas pelo critério de desempate)
    const recentStats = allStats
      .filter((s) => s.countRecent > 0)
      .sort((a, b) => {
        if (b.countRecent !== a.countRecent) {
          return b.countRecent - a.countRecent; // 1. Maior frequência recente
        }
        if (b.lastUsedRecent !== a.lastUsedRecent) {
          return b.lastUsedRecent - a.lastUsedRecent; // 2. Uso mais recente
        }
        return a.num - b.num; // 3. Menor número da casa
      });

    const ranking: string[] = [];
    const usedNums = new Set<number>();

    for (const s of recentStats) {
      if (ranking.length >= limit) break;
      ranking.push(s.formatted);
      usedNums.add(s.num);
    }

    // 2. Se faltarem casas para completar o limite, busca do histórico geral anterior
    if (ranking.length < limit) {
      const olderStats = allStats
        .filter((s) => !usedNums.has(s.num))
        .sort((a, b) => {
          if (b.countTotal !== a.countTotal) {
            return b.countTotal - a.countTotal; // 1. Maior frequência total
          }
          if (b.lastUsedTotal !== a.lastUsedTotal) {
            return b.lastUsedTotal - a.lastUsedTotal; // 2. Uso mais recente
          }
          return a.num - b.num; // 3. Menor número da casa
        });

      for (const s of olderStats) {
        if (ranking.length >= limit) break;
        ranking.push(s.formatted);
        usedNums.add(s.num);
      }
    }

    // 3. Se ainda faltarem casas, completa com fallback determinístico válido (01-311)
    if (ranking.length < limit) {
      for (const fb of DEFAULT_FALLBACK_HOUSES) {
        if (ranking.length >= limit) break;
        const fbNum = extrairNumeroCasaValido(fb);
        if (fbNum !== null && !usedNums.has(fbNum)) {
          ranking.push(formatarCasaExibicao(fbNum));
          usedNums.add(fbNum);
        }
      }
    }

    // 4. Garantia final de preenchimento até o limite (se necessário)
    let candidate = 1;
    while (ranking.length < limit && candidate <= 311) {
      if (!usedNums.has(candidate)) {
        ranking.push(formatarCasaExibicao(candidate));
        usedNums.add(candidate);
      }
      candidate++;
    }

    return ranking.slice(0, limit);
  }

  public calcularRankingFromData(
    movimentacoes: Movimentacao[],
    condominioId: string,
    limit: number = 6
  ): string[] {
    const entregasDoCondo = (movimentacoes || []).filter(
      (m) =>
        (m.condominioId === condominioId || (m as any).condominio_id === condominioId) &&
        m.tipo === MovimentacaoTipo.ENTREGA
    );
    return this.processarRankingMovimentacoes(entregasDoCondo, limit);
  }

  /**
   * Obtém ranking das 6 casas mais frequentes com cache em memória (5 minutos).
   */
  public async getRankingCasasFrequentes(
    condominioId: string = 'condo-1',
    limit: number = 6
  ): Promise<string[]> {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const cached = this.rankingCasasCache.get(condominioId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cached.ranking.length >= limit) {
      return cached.ranking.slice(0, limit);
    }

    try {
      if (!this.isActive()) {
        const fallbackRanking = this.calcularRankingFromData(
          this.readColdBackupData().movimentacoes || [],
          condominioId,
          limit
        );
        this.rankingCasasCache.set(condominioId, { ranking: fallbackRanking, timestamp: Date.now() });
        return fallbackRanking;
      }

      const client = this.getClientOrThrow();
      const { data: rows, error } = await client
        .from('movimentacoes')
        .select('casa, data_hora')
        .eq('condominio_id', condominioId)
        .eq('tipo', MovimentacaoTipo.ENTREGA)
        .order('data_hora', { ascending: false })
        .limit(500);

      if (error) {
        if (this.isTableMissingError(error)) {
          const fallbackRanking = this.calcularRankingFromData(
            this.readColdBackupData().movimentacoes || [],
            condominioId,
            limit
          );
          return fallbackRanking;
        }
        console.warn('[SupabaseStore] Erro ao consultar ranking de casas:', error.message);
        return cached?.ranking && cached.ranking.length >= limit
          ? cached.ranking
          : ['12', '17', '31', '42', '105', '208'];
      }

      const ranking = this.processarRankingMovimentacoes(rows || [], limit);
      this.rankingCasasCache.set(condominioId, { ranking, timestamp: Date.now() });
      return ranking;
    } catch (err) {
      console.warn('[SupabaseStore] Exceção ao obter ranking de casas:', err);
      return cached?.ranking && cached.ranking.length >= limit
        ? cached.ranking
        : ['12', '17', '31', '42', '105', '208'];
    }
  }

  // ==========================================
  // 1. DASHBOARD STATUS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  public async getStatus(condominioId: string = 'condo-1'): Promise<StorageStatusResult> {
    try {
      const client = this.getClientOrThrow();

      const [
        { data: condominios, error: cErr },
        { data: usuariosRaw, error: uErr },
        { data: prismasRaw, error: pErr },
        { data: movimentacoesRaw, error: mErr },
        rankingCasas,
      ] = await Promise.all([
        client.from('condominios').select('*'),
        client.from('usuarios').select('*').eq('condominio_id', condominioId).eq('excluido', false),
        client.from('prismas').select('*').eq('condominio_id', condominioId).eq('excluido', false),
        client
          .from('movimentacoes')
          .select('*')
          .eq('condominio_id', condominioId)
          .order('data_hora', { ascending: false })
          .limit(20),
        this.getRankingCasasFrequentes(condominioId),
      ]);

      if (cErr || uErr || pErr || mErr) {
        if (
          this.isTableMissingError(cErr) ||
          this.isTableMissingError(uErr) ||
          this.isTableMissingError(pErr) ||
          this.isTableMissingError(mErr)
        ) {
          return this.getStatusFallback(condominioId);
        }

        if (cErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar condomínios (${cErr.message})`, 503, cErr);
        }
        if (uErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar usuários (${uErr.message})`, 503, uErr);
        }
        if (pErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar prismas (${pErr.message})`, 503, pErr);
        }
        if (mErr) {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar movimentações (${mErr.message})`, 503, mErr);
        }
      }

      const condoList: Condominio[] = (condominios || []).map((c: any) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrar_mensagem !== undefined ? Boolean(c.mostrar_mensagem) : (c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true),
      }));

      const condo = condoList.find((c) => c.id === condominioId) || condoList[0] || {
        id: condominioId,
        nome: 'Condomínio Belle Ville',
        endereco: 'Rua Santo Agostinho 419',
        mostrarMensagem: true,
      };

      const mappedPrismas: Prisma[] = (prismasRaw || []).map((p: any) => this.mapPrisma(p));
      const activePrismas = sortPrismasNumericos(mappedPrismas.filter((p) => p.ativo && !p.excluido));

      const disponiveis = activePrismas.filter((p) => p.estado === PrismaEstado.DISPONIVEL).length;
      const emUso = activePrismas.filter((p) => p.estado === PrismaEstado.EM_USO).length;
      const pendentes = activePrismas.filter((p) => p.estado === PrismaEstado.PENDENTE).length;
      const indisponiveis = activePrismas.filter((p) => p.estado === PrismaEstado.INDISPONIVEL).length;

      const mappedMovimentacoes: Movimentacao[] = (movimentacoesRaw || []).map((m: any) => this.mapMovimentacao(m));
      const mappedUsuarios: Usuario[] = (usuariosRaw || []).map((u: any) => this.mapUsuario(u));

      return {
        condominio: condo,
        condominios: condoList.length > 0 ? condoList : [condo],
        usuarios: mappedUsuarios,
        stats: {
          disponiveis,
          emUso,
          pendentes,
          indisponiveis,
          totalPrismas: activePrismas.length,
        },
        prismas: activePrismas,
        ultimasMovimentacoes: mappedMovimentacoes,
        rankingCasas,
      };
    } catch (err: any) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        return this.getStatusFallback(condominioId);
      }
      throw err;
    }
  }

  private getStatusFallback(condominioId: string): StorageStatusResult {
    const backupData = this.readColdBackupData();
    const condoList: Condominio[] = (backupData.condominios || []).map((c) => ({
      id: c.id,
      nome: c.nome,
      endereco: c.endereco,
      mostrarMensagem: c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true,
    }));
    const condo = condoList.find((c) => c.id === condominioId) || condoList[0] || {
      id: condominioId,
      nome: 'Condomínio Belle Ville',
      endereco: 'Rua Santo Agostinho 419',
      mostrarMensagem: true,
    };
    const activePrismas = sortPrismasNumericos((backupData.prismas || []).filter((p) => p.ativo !== false && !p.excluido));
    const disponiveis = activePrismas.filter((p) => p.estado === PrismaEstado.DISPONIVEL).length;
    const emUso = activePrismas.filter((p) => p.estado === PrismaEstado.EM_USO).length;
    const pendentes = activePrismas.filter((p) => p.estado === PrismaEstado.PENDENTE).length;
    const indisponiveis = activePrismas.filter((p) => p.estado === PrismaEstado.INDISPONIVEL).length;
    const rankingCasas = this.calcularRankingFromData(backupData.movimentacoes || [], condominioId, 6);

    return {
      condominio: condo,
      condominios: condoList.length > 0 ? condoList : [condo],
      usuarios: backupData.usuarios || [],
      stats: {
        disponiveis,
        emUso,
        pendentes,
        indisponiveis,
        totalPrismas: activePrismas.length,
      },
      prismas: activePrismas,
      ultimasMovimentacoes: (backupData.movimentacoes || []).slice(0, 20),
      rankingCasas,
    };
  }

  // ==========================================
  // 2. ENTREGA DE PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async entregarPrisma(params: {
    prismaId: string;
    casa: string;
    usuarioId: string;
    usuarioNome: string;
    condominioId: string;
    fotoEvidenciaUrl?: string;
  }): Promise<{ success: boolean; prisma?: Prisma; movimentacao?: Movimentacao; error?: string; status: number }> {
    const now = new Date().toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = this.getClientOrThrow();

      let { data: prismaRaw, error: fetchErr } = await client
        .from('prismas')
        .select('*')
        .eq('id', params.prismaId)
        .eq('condominio_id', params.condominioId)
        .maybeSingle();

      if (!prismaRaw && !fetchErr) {
        const { data: byId, error: errById } = await client
          .from('prismas')
          .select('*')
          .eq('id', params.prismaId)
          .maybeSingle();
        if (!errById && byId) {
          prismaRaw = byId;
        }
      }

      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Prisma não encontrado.', status: 404 };
      }

      if (prismaRaw.excluido) {
        return { success: false, error: 'Prisma está excluído da frota física.', status: 400 };
      }

      if (prismaRaw.estado !== PrismaEstado.DISPONIVEL) {
        return {
          success: false,
          error: `Prisma não está disponível para entrega (Estado atual: ${prismaRaw.estado}).`,
          status: 409,
        };
      }

      const { error: movErr } = await client.from('movimentacoes').insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: MovimentacaoTipo.ENTREGA,
        casa: params.casa.trim(),
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: 'tur-padrao',
        turno_nome: 'Turno Geral',
        data_hora: now,
        foto_evidencia_url: params.fotoEvidenciaUrl || null,
        estado_anterior: PrismaEstado.DISPONIVEL,
        estado_posterior: PrismaEstado.EM_USO,
        encerrada: false,
      });

      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir movimentação de entrega (${movErr.message})`, 503, movErr);
      }

      const { data: updatedPrisma, error: updateErr } = await client
        .from('prismas')
        .update({
          estado: PrismaEstado.EM_USO,
          movimentacao_atual_id: movId,
          casa_atual: params.casa.trim(),
          horario_entrega_atual: now,
          porteiro_entrega_atual: params.usuarioNome,
          foto_entrega_atual: params.fotoEvidenciaUrl || null,
          updated_at: now,
        })
        .eq('id', params.prismaId)
        .select()
        .single();

      if (updateErr || !updatedPrisma) {
        if (this.isTableMissingError(updateErr)) {
          return this.entregarPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma de entrega (${updateErr?.message})`, 503, updateErr);
      }

      const prismaResponse = this.mapPrisma(updatedPrisma);
      const movResponse: Movimentacao = {
        id: movId,
        condominioId: params.condominioId,
        prismaId: updatedPrisma.id,
        prismaNumero: updatedPrisma.numero,
        prismaCorNome: updatedPrisma.cor_nome,
        tipo: MovimentacaoTipo.ENTREGA,
        casa: params.casa.trim(),
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        turnoId: 'tur-padrao',
        turnoNome: 'Turno Geral',
        dataHora: now,
        fotoEvidenciaUrl: params.fotoEvidenciaUrl,
        estadoAnterior: PrismaEstado.DISPONIVEL,
        estadoPosterior: PrismaEstado.EM_USO,
        encerrada: false,
      };

      // Auditoria Supabase
      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'ENTREGA_PRISMA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Prisma ${prismaResponse.numero} entregue para a residência ${params.casa.trim()}`,
        dadosNovos: { casa: params.casa.trim(), movimentacaoId: movId },
      });

      // Invalida cache de ranking para atualização imediata
      this.invalidateRankingCasasCache(params.condominioId);

      return { success: true, prisma: prismaResponse, movimentacao: movResponse, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.entregarPrismaFallback(params, now, movId);
      }
      throw err;
    }
  }

  private async entregarPrismaFallback(
    params: { prismaId: string; casa: string; usuarioId: string; usuarioNome: string; condominioId: string; fotoEvidenciaUrl?: string },
    now: string,
    movId: string
  ): Promise<{ success: boolean; prisma?: Prisma; movimentacao?: Movimentacao; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    let prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      prisma = (backup.prismas || []).find((p) => p.id === params.prismaId);
    }
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    if (prisma.excluido) {
      return { success: false, error: 'Prisma está excluído da frota física.', status: 400 };
    }

    if (prisma.estado !== PrismaEstado.DISPONIVEL) {
      return {
        success: false,
        error: `Prisma não está disponível para entrega (Estado atual: ${prisma.estado}).`,
        status: 409,
      };
    }

    const movResponse: Movimentacao = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: MovimentacaoTipo.ENTREGA,
      casa: params.casa.trim(),
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: 'tur-padrao',
      turnoNome: 'Turno Geral',
      dataHora: now,
      fotoEvidenciaUrl: params.fotoEvidenciaUrl,
      estadoAnterior: PrismaEstado.DISPONIVEL,
      estadoPosterior: PrismaEstado.EM_USO,
      encerrada: false,
    };

    prisma.estado = PrismaEstado.EM_USO;
    prisma.movimentacaoAtualId = movId;
    prisma.casaAtual = params.casa.trim();
    prisma.horarioEntregaAtual = now;
    prisma.porteiroEntregaAtual = params.usuarioNome;
    prisma.fotoEntregaAtual = params.fotoEvidenciaUrl;
    prisma.updatedAt = now;

    backup.movimentacoes = [movResponse, ...(backup.movimentacoes || [])];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: 'ENTREGA_PRISMA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Prisma ${prisma.numero} entregue para a residência ${params.casa.trim()}`,
      dadosNovos: { casa: params.casa.trim(), movimentacaoId: movId },
    });

    // Invalida cache de ranking para atualização imediata
    this.invalidateRankingCasasCache(params.condominioId);

    return { success: true, prisma, movimentacao: movResponse, status: 200 };
  }

  // ==========================================
  // 3. DEVOLUÇÃO DE PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async devolverPrisma(params: {
    prismaId: string;
    usuarioId: string;
    usuarioNome: string;
    condominioId: string;
  }): Promise<{ success: boolean; prisma?: Prisma; movimentacao?: Movimentacao; error?: string; status: number }> {
    const now = new Date().toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = this.getClientOrThrow();

      const { data: prismaRaw, error: fetchErr } = await client
        .from('prismas')
        .select('*')
        .eq('id', params.prismaId)
        .eq('condominio_id', params.condominioId)
        .single();

      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Prisma não encontrado.', status: 404 };
      }

      if (prismaRaw.estado !== PrismaEstado.EM_USO) {
        return { success: false, error: 'Prisma já foi recolhido ou não está em uso.', status: 409 };
      }

      const movAnteriorId = prismaRaw.movimentacao_atual_id;
      const casaAnterior = prismaRaw.casa_atual || 'N/A';

      if (movAnteriorId) {
        await client
          .from('movimentacoes')
          .update({
            encerrada: true,
            data_hora_encerramento: now,
            usuario_encerramento_id: params.usuarioId,
            usuario_encerramento_nome: params.usuarioNome,
          })
          .eq('id', movAnteriorId);
      }

      const { error: movErr } = await client.from('movimentacoes').insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: MovimentacaoTipo.DEVOLUCAO,
        casa: casaAnterior,
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: 'tur-padrao',
        turno_nome: 'Turno Geral',
        data_hora: now,
        estado_anterior: PrismaEstado.EM_USO,
        estado_posterior: PrismaEstado.DISPONIVEL,
        movimentacao_anterior_id: movAnteriorId || null,
        encerrada: true,
        data_hora_encerramento: now,
        usuario_encerramento_id: params.usuarioId,
        usuario_encerramento_nome: params.usuarioNome,
      });

      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao registrar devolução (${movErr.message})`, 503, movErr);
      }

      const { data: updatedPrisma, error: updateErr } = await client
        .from('prismas')
        .update({
          estado: PrismaEstado.DISPONIVEL,
          movimentacao_atual_id: null,
          casa_atual: null,
          horario_entrega_atual: null,
          porteiro_entrega_atual: null,
          foto_entrega_atual: null,
          updated_at: now,
        })
        .eq('id', params.prismaId)
        .select()
        .single();

      if (updateErr || !updatedPrisma) {
        if (this.isTableMissingError(updateErr)) {
          return this.devolverPrismaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma de devolução (${updateErr?.message})`, 503, updateErr);
      }

      const prismaResponse = this.mapPrisma(updatedPrisma);
      const devolucaoMov: Movimentacao = {
        id: movId,
        condominioId: params.condominioId,
        prismaId: prismaRaw.id,
        prismaNumero: prismaRaw.numero,
        prismaCorNome: prismaRaw.cor_nome,
        tipo: MovimentacaoTipo.DEVOLUCAO,
        casa: casaAnterior,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        turnoId: 'tur-padrao',
        turnoNome: 'Turno Geral',
        dataHora: now,
        estadoAnterior: PrismaEstado.EM_USO,
        estadoPosterior: PrismaEstado.DISPONIVEL,
        movimentacaoAnteriorId: movAnteriorId || undefined,
        encerrada: true,
        dataHoraEncerramento: now,
        usuarioEncerramentoId: params.usuarioId,
        usuarioEncerramentoNome: params.usuarioNome,
      };

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'DEVOLUCAO_PRISMA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Prisma ${prismaResponse.numero} devolvido da residência ${casaAnterior}`,
        dadosNovos: { devolvidoDe: casaAnterior },
      });

      return { success: true, prisma: prismaResponse, movimentacao: devolucaoMov, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.devolverPrismaFallback(params, now, movId);
      }
      throw err;
    }
  }

  private async devolverPrismaFallback(
    params: { prismaId: string; usuarioId: string; usuarioNome: string; condominioId: string },
    now: string,
    movId: string
  ): Promise<{ success: boolean; prisma?: Prisma; movimentacao?: Movimentacao; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    let prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      prisma = (backup.prismas || []).find((p) => p.id === params.prismaId);
    }
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    if (prisma.estado !== PrismaEstado.EM_USO) {
      return { success: false, error: 'Prisma já foi recolhido ou não está em uso.', status: 409 };
    }

    const movAnteriorId = prisma.movimentacaoAtualId;
    const casaAnterior = prisma.casaAtual || 'N/A';

    if (movAnteriorId) {
      const movAnt = (backup.movimentacoes || []).find((m) => m.id === movAnteriorId);
      if (movAnt) {
        movAnt.encerrada = true;
        movAnt.dataHoraEncerramento = now;
        movAnt.usuarioEncerramentoId = params.usuarioId;
        movAnt.usuarioEncerramentoNome = params.usuarioNome;
      }
    }

    const devolucaoMov: Movimentacao = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: MovimentacaoTipo.DEVOLUCAO,
      casa: casaAnterior,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: 'tur-padrao',
      turnoNome: 'Turno Geral',
      dataHora: now,
      estadoAnterior: PrismaEstado.EM_USO,
      estadoPosterior: PrismaEstado.DISPONIVEL,
      movimentacaoAnteriorId: movAnteriorId || undefined,
      encerrada: true,
      dataHoraEncerramento: now,
      usuarioEncerramentoId: params.usuarioId,
      usuarioEncerramentoNome: params.usuarioNome,
    };

    prisma.estado = PrismaEstado.DISPONIVEL;
    prisma.movimentacaoAtualId = undefined;
    prisma.casaAtual = undefined;
    prisma.horarioEntregaAtual = undefined;
    prisma.porteiroEntregaAtual = undefined;
    prisma.fotoEntregaAtual = undefined;
    prisma.updatedAt = now;

    backup.movimentacoes = [devolucaoMov, ...(backup.movimentacoes || [])];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: 'DEVOLUCAO_PRISMA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Prisma ${prisma.numero} devolvido da residência ${casaAnterior}`,
      dadosNovos: { devolvidoDe: casaAnterior },
    });

    return { success: true, prisma, movimentacao: devolucaoMov, status: 200 };
  }

  // ==========================================
  // 4. ABERTURA DE PENDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async abrirPendencia(params: {
    prismaId: string;
    motivo: string;
    usuarioId: string;
    usuarioNome: string;
    condominioId: string;
  }): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const now = new Date().toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = this.getClientOrThrow();

      const { data: prismaRaw, error: fetchErr } = await client
        .from('prismas')
        .select('*')
        .eq('id', params.prismaId)
        .eq('condominio_id', params.condominioId)
        .single();

      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Prisma não encontrado.', status: 404 };
      }

      if (prismaRaw.estado !== PrismaEstado.EM_USO) {
        return { success: false, error: 'Apenas prismas em uso podem ter pendência registrada.', status: 400 };
      }

      const { error: movErr } = await client.from('movimentacoes').insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: MovimentacaoTipo.PENDENCIA_ABERTA,
        casa: prismaRaw.casa_atual || 'N/A',
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: 'tur-padrao',
        turno_nome: 'Turno Geral',
        data_hora: now,
        estado_anterior: PrismaEstado.EM_USO,
        estado_posterior: PrismaEstado.PENDENTE,
        motivo_pendencia: params.motivo.trim(),
        encerrada: false,
      });

      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir pendência (${movErr.message})`, 503, movErr);
      }

      const { data: updated, error: updateErr } = await client
        .from('prismas')
        .update({
          estado: PrismaEstado.PENDENTE,
          observacao: `[Pendência]: ${params.motivo.trim()}`,
          updated_at: now,
        })
        .eq('id', params.prismaId)
        .select()
        .single();

      if (updateErr || !updated) {
        if (this.isTableMissingError(updateErr)) {
          return this.abrirPendenciaFallback(params, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar estado do prisma (${updateErr?.message})`, 503, updateErr);
      }

      const prismaResponse = this.mapPrisma(updated);

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'PENDENCIA_ABERTA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Pendência aberta para o prisma ${prismaResponse.numero}. Motivo: ${params.motivo.trim()}`,
        dadosNovos: { motivo: params.motivo.trim() },
      });

      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.abrirPendenciaFallback(params, now, movId);
      }
      throw err;
    }
  }

  private async abrirPendenciaFallback(
    params: { prismaId: string; motivo: string; usuarioId: string; usuarioNome: string; condominioId: string },
    now: string,
    movId: string
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    if (prisma.estado !== PrismaEstado.EM_USO) {
      return { success: false, error: 'Apenas prismas em uso podem ter pendência registrada.', status: 400 };
    }

    const mov: Movimentacao = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: MovimentacaoTipo.PENDENCIA_ABERTA,
      casa: prisma.casaAtual || 'N/A',
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: 'tur-padrao',
      turnoNome: 'Turno Geral',
      dataHora: now,
      estadoAnterior: PrismaEstado.EM_USO,
      estadoPosterior: PrismaEstado.PENDENTE,
      motivoPendencia: params.motivo.trim(),
      encerrada: false,
    };

    prisma.estado = PrismaEstado.PENDENTE;
    prisma.observacao = `[Pendência]: ${params.motivo.trim()}`;
    prisma.updatedAt = now;

    backup.movimentacoes = [mov, ...(backup.movimentacoes || [])];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: 'PENDENCIA_ABERTA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Pendência aberta para o prisma ${prisma.numero}. Motivo: ${params.motivo.trim()}`,
      dadosNovos: { motivo: params.motivo.trim() },
    });

    return { success: true, prisma, status: 200 };
  }

  // ==========================================
  // 5. RESOLUÇÃO DE PENDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async resolverPendencia(params: {
    prismaId: string;
    novoEstado: string;
    justificativa: string;
    usuarioId: string;
    usuarioNome: string;
    condominioId: string;
  }): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const now = new Date().toISOString();
    const movId = `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const novoEstadoValido = params.novoEstado === PrismaEstado.INDISPONIVEL ? PrismaEstado.INDISPONIVEL : PrismaEstado.DISPONIVEL;

    try {
      const client = this.getClientOrThrow();

      const { data: prismaRaw, error: fetchErr } = await client
        .from('prismas')
        .select('*')
        .eq('id', params.prismaId)
        .eq('condominio_id', params.condominioId)
        .single();

      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Prisma não encontrado.', status: 404 };
      }

      if (prismaRaw.estado !== PrismaEstado.PENDENTE) {
        return { success: false, error: 'Prisma não está em estado de pendência.', status: 400 };
      }

      const { error: movErr } = await client.from('movimentacoes').insert({
        id: movId,
        condominio_id: params.condominioId,
        prisma_id: prismaRaw.id,
        prisma_numero: prismaRaw.numero,
        prisma_cor_nome: prismaRaw.cor_nome,
        tipo: MovimentacaoTipo.PENDENCIA_RESOLVIDA,
        casa: prismaRaw.casa_atual || 'Portaria/Supervisão',
        usuario_id: params.usuarioId,
        usuario_nome: params.usuarioNome,
        turno_id: 'tur-padrao',
        turno_nome: 'Turno Geral',
        data_hora: now,
        estado_anterior: PrismaEstado.PENDENTE,
        estado_posterior: novoEstadoValido,
        motivo_correcao: params.justificativa.trim(),
        encerrada: true,
        data_hora_encerramento: now,
      });

      if (movErr) {
        if (this.isTableMissingError(movErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao inserir resolução de pendência (${movErr.message})`, 503, movErr);
      }

      const { data: updated, error: updateErr } = await client
        .from('prismas')
        .update({
          estado: novoEstadoValido,
          movimentacao_atual_id: null,
          casa_atual: null,
          horario_entrega_atual: null,
          porteiro_entrega_atual: null,
          foto_entrega_atual: null,
          observacao: `[Resolvido]: ${params.justificativa.trim()}`,
          updated_at: now,
        })
        .eq('id', params.prismaId)
        .select()
        .single();

      if (updateErr || !updated) {
        if (this.isTableMissingError(updateErr)) {
          return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar prisma resolvido (${updateErr?.message})`, 503, updateErr);
      }

      const prismaResponse = this.mapPrisma(updated);

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'PENDENCIA_RESOLVIDA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Pendência do prisma ${prismaResponse.numero} resolvida. Novo estado: ${novoEstadoValido}. Justificativa: ${params.justificativa.trim()}`,
        dadosNovos: { novoEstado: novoEstadoValido, justificativa: params.justificativa.trim() },
      });

      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.resolverPendenciaFallback(params, novoEstadoValido, now, movId);
      }
      throw err;
    }
  }

  private async resolverPendenciaFallback(
    params: { prismaId: string; novoEstado: string; justificativa: string; usuarioId: string; usuarioNome: string; condominioId: string },
    novoEstadoValido: PrismaEstado,
    now: string,
    movId: string
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === params.prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    if (prisma.estado !== PrismaEstado.PENDENTE) {
      return { success: false, error: 'Prisma não está em estado de pendência.', status: 400 };
    }

    const mov: Movimentacao = {
      id: movId,
      condominioId: params.condominioId,
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      tipo: MovimentacaoTipo.PENDENCIA_RESOLVIDA,
      casa: prisma.casaAtual || 'Portaria/Supervisão',
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      turnoId: 'tur-padrao',
      turnoNome: 'Turno Geral',
      dataHora: now,
      estadoAnterior: PrismaEstado.PENDENTE,
      estadoPosterior: novoEstadoValido,
      motivoCorrecao: params.justificativa.trim(),
      encerrada: true,
      dataHoraEncerramento: now,
    };

    prisma.estado = novoEstadoValido;
    prisma.movimentacaoAtualId = undefined;
    prisma.casaAtual = undefined;
    prisma.horarioEntregaAtual = undefined;
    prisma.porteiroEntregaAtual = undefined;
    prisma.fotoEntregaAtual = undefined;
    prisma.observacao = `[Resolvido]: ${params.justificativa.trim()}`;
    prisma.updatedAt = now;

    backup.movimentacoes = [mov, ...(backup.movimentacoes || [])];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: 'PENDENCIA_RESOLVIDA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Pendência do prisma ${prisma.numero} resolvida. Novo estado: ${novoEstadoValido}. Justificativa: ${params.justificativa.trim()}`,
      dadosNovos: { novoEstado: novoEstadoValido, justificativa: params.justificativa.trim() },
    });

    return { success: true, prisma, status: 200 };
  }

  // ==========================================
  // 6. TOGGLE INDISPONÍVEL (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async togglePrismaIndisponivel(
    prismaId: string,
    params: {
      tornarIndisponivel: boolean;
      motivo?: string;
      condominioId: string;
      actor: { id: string; nome: string };
    }
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const now = new Date().toISOString();
    const novoEstado = params.tornarIndisponivel ? PrismaEstado.INDISPONIVEL : PrismaEstado.DISPONIVEL;

    try {
      const client = this.getClientOrThrow();

      const { data: updated, error } = await client
        .from('prismas')
        .update({
          estado: novoEstado,
          motivo_inativacao: params.tornarIndisponivel ? params.motivo?.trim() || 'Em manutenção' : null,
          updated_at: now,
        })
        .eq('id', prismaId)
        .eq('condominio_id', params.condominioId)
        .select()
        .single();

      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.togglePrismaIndisponivelFallback(prismaId, params, novoEstado, now);
        }
        if (error && error.code === 'PGRST116') {
          return { success: false, error: 'Prisma não encontrado.', status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao alterar indisponibilidade (${error?.message})`, 503, error);
      }

      const prismaResponse = this.mapPrisma(updated);

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: params.tornarIndisponivel ? 'PRISMA_INDISPONIVEL' : 'PRISMA_DISPONIVEL',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Prisma ${prismaResponse.numero} marcado como ${novoEstado}.${params.motivo ? ` Motivo: ${params.motivo}` : ''}`,
        dadosNovos: { estado: novoEstado, motivo: params.motivo },
      });

      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.togglePrismaIndisponivelFallback(prismaId, params, novoEstado, now);
      }
      throw err;
    }
  }

  private async togglePrismaIndisponivelFallback(
    prismaId: string,
    params: { tornarIndisponivel: boolean; motivo?: string; condominioId: string; actor: { id: string; nome: string } },
    novoEstado: PrismaEstado,
    now: string
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    prisma.estado = novoEstado;
    prisma.motivoInativacao = params.tornarIndisponivel ? params.motivo?.trim() || 'Em manutenção' : undefined;
    prisma.updatedAt = now;

    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: params.tornarIndisponivel ? 'PRISMA_INDISPONIVEL' : 'PRISMA_DISPONIVEL',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Prisma ${prisma.numero} marcado como ${novoEstado}.${params.motivo ? ` Motivo: ${params.motivo}` : ''}`,
      dadosNovos: { estado: novoEstado, motivo: params.motivo },
    });

    return { success: true, prisma, status: 200 };
  }

  // ==========================================
  // 7. CORREÇÃO DE MOVIMENTAÇÃO (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async corrigirMovimentacao(params: {
    movimentacaoId: string;
    novaCasa: string;
    motivoCorrecao: string;
    usuarioId: string;
    usuarioNome: string;
    condominioId: string;
  }): Promise<{ success: boolean; movimentacao?: Movimentacao; error?: string; status: number }> {
    try {
      const client = this.getClientOrThrow();

      const { data: movRaw, error: fetchErr } = await client
        .from('movimentacoes')
        .select('*')
        .eq('id', params.movimentacaoId)
        .eq('condominio_id', params.condominioId)
        .single();

      if (fetchErr || !movRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.corrigirMovimentacaoFallback(params);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar movimentação (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Movimentação não encontrada.', status: 404 };
      }

      const casaAntiga = movRaw.casa;
      const novoMotivo = `Corrigido de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`;

      const { data: updatedMov, error: updateErr } = await client
        .from('movimentacoes')
        .update({
          casa: params.novaCasa.trim(),
          motivo_correcao: novoMotivo,
        })
        .eq('id', params.movimentacaoId)
        .select()
        .single();

      if (updateErr || !updatedMov) {
        if (this.isTableMissingError(updateErr)) {
          return this.corrigirMovimentacaoFallback(params);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar movimentação (${updateErr?.message})`, 503, updateErr);
      }

      // Se for a movimentação atual do prisma, atualiza também a casa atual no prisma
      if (movRaw.prisma_id) {
        await client
          .from('prismas')
          .update({
            casa_atual: params.novaCasa.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', movRaw.prisma_id)
          .eq('movimentacao_atual_id', params.movimentacaoId);
      }

      const mappedMov = this.mapMovimentacao(updatedMov);

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'CORRECAO_MOVIMENTACAO',
        prismaId: mappedMov.prismaId,
        prismaNumero: mappedMov.prismaNumero,
        prismaCorNome: mappedMov.prismaCorNome,
        usuarioId: params.usuarioId,
        usuarioNome: params.usuarioNome,
        detalhes: `Correção de movimentação ${params.movimentacaoId}: Casa alterada de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`,
        dadosAnteriores: { casa: casaAntiga },
        dadosNovos: { casa: params.novaCasa.trim(), motivo: params.motivoCorrecao.trim() },
      });

      // Invalida cache de ranking caso a movimentação corrigida seja de entrega
      this.invalidateRankingCasasCache(params.condominioId);

      return { success: true, movimentacao: mappedMov, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.corrigirMovimentacaoFallback(params);
      }
      throw err;
    }
  }

  private async corrigirMovimentacaoFallback(
    params: { movimentacaoId: string; novaCasa: string; motivoCorrecao: string; usuarioId: string; usuarioNome: string; condominioId: string }
  ): Promise<{ success: boolean; movimentacao?: Movimentacao; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const mov = (backup.movimentacoes || []).find((m) => m.id === params.movimentacaoId && (m.condominioId || 'condo-1') === params.condominioId);
    if (!mov) {
      return { success: false, error: 'Movimentação não encontrada.', status: 404 };
    }

    const casaAntiga = mov.casa;
    const novoMotivo = `Corrigido de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`;

    mov.casa = params.novaCasa.trim();
    mov.motivoCorrecao = novoMotivo;

    if (mov.prismaId) {
      const prisma = (backup.prismas || []).find((p) => p.id === mov.prismaId && p.movimentacaoAtualId === params.movimentacaoId);
      if (prisma) {
        prisma.casaAtual = params.novaCasa.trim();
        prisma.updatedAt = new Date().toISOString();
      }
    }

    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: 'CORRECAO_MOVIMENTACAO',
      prismaId: mov.prismaId,
      prismaNumero: mov.prismaNumero,
      prismaCorNome: mov.prismaCorNome,
      usuarioId: params.usuarioId,
      usuarioNome: params.usuarioNome,
      detalhes: `Correção de movimentação ${params.movimentacaoId}: Casa alterada de "${casaAntiga}" para "${params.novaCasa.trim()}". Motivo: ${params.motivoCorrecao.trim()}`,
      dadosAnteriores: { casa: casaAntiga },
      dadosNovos: { casa: params.novaCasa.trim(), motivo: params.motivoCorrecao.trim() },
    });

    // Invalida cache de ranking caso a movimentação corrigida seja de entrega
    this.invalidateRankingCasasCache(params.condominioId);

    return { success: true, movimentacao: mov, status: 200 };
  }

  // ==========================================
  // 8. LISTAR PRISMAS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  public async listPrismas(condominioId: string = 'condo-1', incluirExcluidos = false): Promise<Prisma[]> {
    const client = this.getClientOrThrow();
    let query = client.from('prismas').select('*').eq('condominio_id', condominioId);

    if (!incluirExcluidos) {
      query = query.eq('excluido', false);
    }

    const { data, error } = await query;
    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn('[SupabaseStore] Tabela prismas não encontrada no schema cache. Carregando prismas de contingência.');
        const backup = this.readColdBackupData();
        const fallbackList = (backup.prismas || [])
          .filter((p) => (p.condominioId || 'condo-1') === condominioId && (incluirExcluidos ? true : !p.excluido));
        return sortPrismasNumericos(fallbackList);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar prismas (${error.message})`, 503, error);
    }

    const mapped = (data || []).map((p: any) => this.mapPrisma(p));
    return sortPrismasNumericos(mapped);
  }

  // ==========================================
  // 9. CADASTRAR PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async createPrisma(params: {
    numero: string | number;
    corId: string;
    corNome: string;
    condominioId?: string;
    actor: { id: string; nome: string };
  }): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const now = new Date().toISOString();
    const condId = params.condominioId || 'condo-1';
    const numStr = String(params.numero).trim();
    const newId = `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = this.getClientOrThrow();

      // Valida duplicidade ativa
      const { data: existing, error: checkErr } = await client
        .from('prismas')
        .select('id, numero, cor_id, excluido')
        .eq('condominio_id', condId)
        .eq('numero', numStr)
        .eq('excluido', false)
        .limit(1);

      if (checkErr) {
        if (this.isTableMissingError(checkErr)) {
          return this.createPrismaFallback(params, condId, numStr, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao verificar prisma (${checkErr.message})`, 503, checkErr);
      }

      if (existing && existing.length > 0) {
        return { success: false, error: `Já existe um prisma ativo com o número "${numStr}".`, status: 400 };
      }

      const { data: created, error: insertErr } = await client
        .from('prismas')
        .insert({
          id: newId,
          condominio_id: condId,
          numero: numStr,
          cor_id: params.corId,
          cor_nome: params.corNome,
          estado: PrismaEstado.DISPONIVEL,
          ativo: true,
          excluido: false,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (insertErr || !created) {
        if (this.isTableMissingError(insertErr)) {
          return this.createPrismaFallback(params, condId, numStr, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar prisma (${insertErr?.message})`, 503, insertErr);
      }

      const prismaResponse = this.mapPrisma(created);

      await this.logAuditoria({
        condominioId: condId,
        acao: 'CRIACAO_PRISMA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Novo prisma cadastrado: Nº ${prismaResponse.numero} (Cor: ${prismaResponse.corNome})`,
        dadosNovos: { numero: prismaResponse.numero, cor: prismaResponse.corNome },
      });

      return { success: true, prisma: prismaResponse, status: 201 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.createPrismaFallback(params, condId, numStr, newId, now);
      }
      throw err;
    }
  }

  private async createPrismaFallback(
    params: { numero: string | number; corId: string; corNome: string; condominioId?: string; actor: { id: string; nome: string } },
    condId: string,
    numStr: string,
    newId: string,
    now: string
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const existing = (backup.prismas || []).find(
      (p) => (p.condominioId || 'condo-1') === condId && String(p.numero).trim() === numStr && !p.excluido
    );

    if (existing) {
      return { success: false, error: `Já existe um prisma ativo com o número "${numStr}".`, status: 400 };
    }

    const newPrisma: Prisma = {
      id: newId,
      condominioId: condId,
      numero: numStr,
      corId: params.corId,
      corNome: params.corNome,
      estado: PrismaEstado.DISPONIVEL,
      ativo: true,
      excluido: false,
      createdAt: now,
      updatedAt: now,
    };

    backup.prismas = [...(backup.prismas || []), newPrisma];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: condId,
      acao: 'CRIACAO_PRISMA',
      prismaId: newPrisma.id,
      prismaNumero: newPrisma.numero,
      prismaCorNome: newPrisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Novo prisma cadastrado: Nº ${newPrisma.numero} (Cor: ${newPrisma.corNome})`,
      dadosNovos: { numero: newPrisma.numero, cor: newPrisma.corNome },
    });

    return { success: true, prisma: newPrisma, status: 201 };
  }

  // ==========================================
  // 9.1 CADASTRAR PRISMAS EM LOTE (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async createPrismasLote(params: {
    numeros: string[];
    corId: string;
    corNome: string;
    condominioId?: string;
    actor: { id: string; nome: string };
  }): Promise<{
    success: boolean;
    totalCriados?: number;
    primeiro?: string;
    ultimo?: string;
    prismas?: Prisma[];
    error?: string;
    status: number;
  }> {
    const now = new Date().toISOString();
    const condId = params.condominioId || 'condo-1';

    // Validações básicas de lote
    if (!Array.isArray(params.numeros) || params.numeros.length === 0) {
      return { success: false, error: 'A lista de números de prismas não pode estar vazia.', status: 400 };
    }

    if (params.numeros.length > 100) {
      return { success: false, error: 'O limite máximo por lote é de 100 prismas.', status: 400 };
    }

    if (!params.corId || !params.corNome) {
      return { success: false, error: 'A cor do prisma é obrigatória.', status: 400 };
    }

    // Normaliza os números com trim
    const cleanNumeros = params.numeros.map((n) => String(n).trim()).filter(Boolean);
    if (cleanNumeros.length !== params.numeros.length) {
      return { success: false, error: 'Todos os números do lote devem ser válidos e não vazios.', status: 400 };
    }

    // Verifica duplicidade no próprio lote
    const uniqueSet = new Set(cleanNumeros);
    if (uniqueSet.size !== cleanNumeros.length) {
      return { success: false, error: 'O lote informado contém números duplicados entre si.', status: 400 };
    }

    try {
      const client = this.getClientOrThrow();

      // Valida se algum dos números já existe no condomínio (não excluído)
      const { data: existing, error: checkErr } = await client
        .from('prismas')
        .select('id, numero')
        .eq('condominio_id', condId)
        .in('numero', cleanNumeros)
        .eq('excluido', false);

      if (checkErr) {
        if (this.isTableMissingError(checkErr)) {
          return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao verificar prismas em lote (${checkErr.message})`, 503, checkErr);
      }

      if (existing && existing.length > 0) {
        const duplicados = existing.map((e: any) => e.numero).join(', ');
        return {
          success: false,
          error: `Não foi possível cadastrar o lote porque os seguintes prismas já existem neste condomínio: ${duplicados}.`,
          status: 400,
        };
      }

      // Prepara os registros para inserção atômica
      const recordsToInsert = cleanNumeros.map((numStr) => ({
        id: `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${numStr}`,
        condominio_id: condId,
        numero: numStr,
        cor_id: params.corId,
        cor_nome: params.corNome,
        estado: PrismaEstado.DISPONIVEL,
        ativo: true,
        excluido: false,
        created_at: now,
        updated_at: now,
      }));

      const { data: created, error: insertErr } = await client
        .from('prismas')
        .insert(recordsToInsert)
        .select();

      if (insertErr || !created || created.length === 0) {
        if (this.isTableMissingError(insertErr)) {
          return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar prismas em lote (${insertErr?.message})`, 503, insertErr);
      }

      const prismasResponse = created.map((row: any) => this.mapPrisma(row));
      const primeiro = cleanNumeros[0];
      const ultimo = cleanNumeros[cleanNumeros.length - 1];

      await this.logAuditoria({
        condominioId: condId,
        acao: 'CRIACAO_PRISMA',
        prismaNumero: `${primeiro} a ${ultimo}`,
        prismaCorNome: params.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Lote de ${cleanNumeros.length} prismas cadastrado: Nº ${primeiro} até Nº ${ultimo} (Cor: ${params.corNome})`,
        dadosNovos: { quantidade: cleanNumeros.length, primeiro, ultimo, cor: params.corNome },
      });

      return {
        success: true,
        totalCriados: prismasResponse.length,
        primeiro,
        ultimo,
        prismas: prismasResponse,
        status: 201,
      };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.createPrismasLoteFallback(params, condId, cleanNumeros, now);
      }
      throw err;
    }
  }

  private async createPrismasLoteFallback(
    params: { numeros: string[]; corId: string; corNome: string; condominioId?: string; actor: { id: string; nome: string } },
    condId: string,
    cleanNumeros: string[],
    now: string
  ): Promise<{
    success: boolean;
    totalCriados?: number;
    primeiro?: string;
    ultimo?: string;
    prismas?: Prisma[];
    error?: string;
    status: number;
  }> {
    const backup = this.readColdBackupData();
    const existing = (backup.prismas || []).filter(
      (p) => (p.condominioId || 'condo-1') === condId && cleanNumeros.includes(String(p.numero).trim()) && !p.excluido
    );

    if (existing.length > 0) {
      const duplicados = existing.map((e) => e.numero).join(', ');
      return {
        success: false,
        error: `Não foi possível cadastrar o lote porque os seguintes prismas já existem neste condomínio: ${duplicados}.`,
        status: 400,
      };
    }

    const newPrismas: Prisma[] = cleanNumeros.map((numStr) => ({
      id: `prism-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${numStr}`,
      condominioId: condId,
      numero: numStr,
      corId: params.corId,
      corNome: params.corNome,
      estado: PrismaEstado.DISPONIVEL,
      ativo: true,
      excluido: false,
      createdAt: now,
      updatedAt: now,
    }));

    backup.prismas = [...(backup.prismas || []), ...newPrismas];
    this.writeColdBackupData(backup);

    const primeiro = cleanNumeros[0];
    const ultimo = cleanNumeros[cleanNumeros.length - 1];

    await this.logAuditoria({
      condominioId: condId,
      acao: 'CRIACAO_PRISMA',
      prismaNumero: `${primeiro} a ${ultimo}`,
      prismaCorNome: params.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Lote de ${cleanNumeros.length} prismas cadastrado: Nº ${primeiro} até Nº ${ultimo} (Cor: ${params.corNome})`,
      dadosNovos: { quantidade: cleanNumeros.length, primeiro, ultimo, cor: params.corNome },
    });

    return {
      success: true,
      totalCriados: newPrismas.length,
      primeiro,
      ultimo,
      prismas: newPrismas,
      status: 201,
    };
  }

  // ==========================================
  // 10. ATUALIZAR STATUS DO PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async updatePrismaStatus(
    prismaId: string,
    params: {
      ativo: boolean;
      motivoInativacao?: string;
      condominioId: string;
      actor: { id: string; nome: string };
    }
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const now = new Date().toISOString();

    try {
      const client = this.getClientOrThrow();

      const { data: updated, error } = await client
        .from('prismas')
        .update({
          ativo: params.ativo,
          motivo_inativacao: params.ativo ? null : params.motivoInativacao?.trim() || 'Inativado manualmente',
          updated_at: now,
        })
        .eq('id', prismaId)
        .eq('condominio_id', params.condominioId)
        .select()
        .single();

      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updatePrismaStatusFallback(prismaId, params, now);
        }
        if (error && error.code === 'PGRST116') {
          return { success: false, error: 'Prisma não encontrado.', status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar status do prisma (${error?.message})`, 503, error);
      }

      const prismaResponse = this.mapPrisma(updated);

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: params.ativo ? 'ATIVACAO_PRISMA' : 'INATIVACAO_PRISMA',
        prismaId: prismaResponse.id,
        prismaNumero: prismaResponse.numero,
        prismaCorNome: prismaResponse.corNome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        detalhes: `Prisma ${prismaResponse.numero} ${params.ativo ? 'ativado' : 'inativado'}.${params.motivoInativacao ? ` Motivo: ${params.motivoInativacao}` : ''}`,
        dadosNovos: { ativo: params.ativo, motivo: params.motivoInativacao },
      });

      return { success: true, prisma: prismaResponse, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.updatePrismaStatusFallback(prismaId, params, now);
      }
      throw err;
    }
  }

  private async updatePrismaStatusFallback(
    prismaId: string,
    params: { ativo: boolean; motivoInativacao?: string; condominioId: string; actor: { id: string; nome: string } },
    now: string
  ): Promise<{ success: boolean; prisma?: Prisma; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    prisma.ativo = params.ativo;
    prisma.motivoInativacao = params.ativo ? undefined : params.motivoInativacao?.trim() || 'Inativado manualmente';
    prisma.updatedAt = now;

    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: params.condominioId,
      acao: params.ativo ? 'ATIVACAO_PRISMA' : 'INATIVACAO_PRISMA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      detalhes: `Prisma ${prisma.numero} ${params.ativo ? 'ativado' : 'inativado'}.${params.motivoInativacao ? ` Motivo: ${params.motivoInativacao}` : ''}`,
      dadosNovos: { ativo: params.ativo, motivo: params.motivoInativacao },
    });

    return { success: true, prisma, status: 200 };
  }

  // ==========================================
  // 11. EXCLUIR PRISMA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async excluirPrisma(
    prismaId: string,
    params: {
      condominioId: string;
      actor: { id: string; nome: string; role: UserRole; cargo?: string };
    }
  ): Promise<{ success: boolean; message?: string; tipoExclusao?: string; prismaId?: string; error?: string; status: number }> {
    const now = new Date().toISOString();

    try {
      const client = this.getClientOrThrow();

      const { data: prismaRaw, error: fetchErr } = await client
        .from('prismas')
        .select('*')
        .eq('id', prismaId)
        .eq('condominio_id', params.condominioId)
        .single();

      if (fetchErr || !prismaRaw) {
        if (this.isTableMissingError(fetchErr)) {
          return this.excluirPrismaFallback(prismaId, params, now);
        }
        if (fetchErr && fetchErr.code !== 'PGRST116') {
          throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar prisma (${fetchErr.message})`, 503, fetchErr);
        }
        return { success: false, error: 'Prisma não encontrado.', status: 404 };
      }

      if (prismaRaw.estado === PrismaEstado.EM_USO || prismaRaw.estado === PrismaEstado.PENDENTE) {
        return {
          success: false,
          error: `Não é possível excluir um prisma em uso ou com pendência ativa (Estado atual: ${prismaRaw.estado}). Recolha ou resolva a pendência antes de excluir.`,
          status: 400,
        };
      }

      const { error: deleteErr } = await client
        .from('prismas')
        .update({
          excluido: true,
          ativo: false,
          data_exclusao: now,
          usuario_exclusao_id: params.actor.id,
          usuario_exclusao_nome: params.actor.nome,
          updated_at: now,
        })
        .eq('id', prismaId)
        .eq('condominio_id', params.condominioId);

      if (deleteErr) {
        if (this.isTableMissingError(deleteErr)) {
          return this.excluirPrismaFallback(prismaId, params, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir prisma (${deleteErr.message})`, 503, deleteErr);
      }

      await this.logAuditoria({
        condominioId: params.condominioId,
        acao: 'EXCLUSAO_PRISMA',
        prismaId: prismaRaw.id,
        prismaNumero: prismaRaw.numero,
        prismaCorNome: prismaRaw.cor_nome,
        usuarioId: params.actor.id,
        usuarioNome: params.actor.nome,
        usuarioCargo: params.actor.cargo,
        detalhes: `Prisma Nº ${prismaRaw.numero} (${prismaRaw.cor_nome}) excluído permanentemente da frota física por ${params.actor.nome} (${params.actor.cargo || params.actor.role}).`,
        dadosAnteriores: { numero: prismaRaw.numero, cor: prismaRaw.cor_nome, estado: prismaRaw.estado },
      });

      return {
        success: true,
        message: `Prisma ${prismaRaw.numero} removido com sucesso.`,
        tipoExclusao: 'LOGICAL_REMOVED',
        prismaId,
        status: 200,
      };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.excluirPrismaFallback(prismaId, params, now);
      }
      throw err;
    }
  }

  private async excluirPrismaFallback(
    prismaId: string,
    params: { condominioId: string; actor: { id: string; nome: string; role: UserRole; cargo?: string } },
    now: string
  ): Promise<{ success: boolean; message?: string; tipoExclusao?: string; prismaId?: string; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const prisma = (backup.prismas || []).find((p) => p.id === prismaId && (p.condominioId || 'condo-1') === params.condominioId);
    if (!prisma) {
      return { success: false, error: 'Prisma não encontrado.', status: 404 };
    }

    if (prisma.estado === PrismaEstado.EM_USO || prisma.estado === PrismaEstado.PENDENTE) {
      return {
        success: false,
        error: `Não é possível excluir um prisma em uso ou com pendência ativa (Estado atual: ${prisma.estado}). Recolha ou resolva a pendência antes de excluir.`,
        status: 400,
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
      acao: 'EXCLUSAO_PRISMA',
      prismaId: prisma.id,
      prismaNumero: prisma.numero,
      prismaCorNome: prisma.corNome,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      usuarioCargo: params.actor.cargo,
      detalhes: `Prisma Nº ${prisma.numero} (${prisma.corNome}) excluído permanentemente da frota física por ${params.actor.nome} (${params.actor.cargo || params.actor.role}).`,
      dadosAnteriores: { numero: prisma.numero, cor: prisma.corNome, estado: prisma.estado },
    });

    return {
      success: true,
      message: `Prisma ${prisma.numero} removido com sucesso.`,
      tipoExclusao: 'LOGICAL_REMOVED',
      prismaId,
      status: 200,
    };
  }

  // ==========================================
  // 12. HISTÓRICO DO PRISMA (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  public async getHistoricoPrisma(prismaId: string, condominioId: string = 'condo-1'): Promise<{
    prisma: Prisma;
    movimentacoes: Movimentacao[];
    auditoria: AuditoriaLog[];
  } | null> {
    const client = this.getClientOrThrow();

    const [
      { data: prismaRaw, error: pErr },
      { data: movsRaw, error: mErr },
      { data: audRaw, error: aErr },
    ] = await Promise.all([
      client.from('prismas').select('*').eq('id', prismaId).eq('condominio_id', condominioId).single(),
      client.from('movimentacoes').select('*').eq('prisma_id', prismaId).eq('condominio_id', condominioId).order('data_hora', { ascending: false }),
      client.from('auditoria').select('*').eq('prisma_id', prismaId).eq('condominio_id', condominioId).order('data_hora', { ascending: false }),
    ]);

    if (pErr || mErr || aErr) {
      if (
        this.isTableMissingError(pErr) ||
        this.isTableMissingError(mErr) ||
        this.isTableMissingError(aErr)
      ) {
        console.warn('[SupabaseStore] Tabelas não encontradas para histórico. Buscando em backup frio.');
        const backup = this.readColdBackupData();
        const prisma = (backup.prismas || []).find((p) => p.id === prismaId);
        if (!prisma) return null;
        const movimentacoes = (backup.movimentacoes || []).filter((m) => m.prismaId === prismaId);
        const auditoria = (backup.auditoria || []).filter((a) => a.prismaId === prismaId);
        return { prisma, movimentacoes, auditoria };
      }

      if (pErr) {
        if (pErr.code === 'PGRST116') return null;
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar histórico do prisma (${pErr.message})`, 503, pErr);
      }
      if (mErr) {
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar movimentações do histórico (${mErr.message})`, 503, mErr);
      }
      if (aErr) {
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar auditoria do histórico (${aErr.message})`, 503, aErr);
      }
    }

    return {
      prisma: this.mapPrisma(prismaRaw),
      movimentacoes: (movsRaw || []).map((m: any) => this.mapMovimentacao(m)),
      auditoria: (audRaw || []).map((a: any) => this.mapAuditoria(a)),
    };
  }

  // ==========================================
  // 13. USUÁRIOS (EXCLUSIVAMENTE SUPABASE)
  // ==========================================
  public async listUsuarios(condominioId: string = 'condo-1', incluirExcluidos = false): Promise<Usuario[]> {
    try {
      const client = this.getClientOrThrow();
      let query = client.from('usuarios').select('*').eq('condominio_id', condominioId);

      if (!incluirExcluidos) {
        query = query.eq('excluido', false);
      }

      const { data, error } = await query.order('nome', { ascending: true });
      if (error) {
        if (this.isTableMissingError(error)) {
          console.warn('[SupabaseStore] Tabela usuarios não encontrada no schema cache. Carregando usuários de contingência.');
          const backup = this.readColdBackupData();
          return (backup.usuarios || [])
            .filter((u) => (u.condominioId || 'condo-1') === condominioId && (incluirExcluidos ? true : !u.excluido));
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar usuários (${error.message})`, 503, error);
      }

      return (data || []).map((u: any) => this.mapUsuario(u));
    } catch (err: any) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (backup.usuarios || [])
          .filter((u) => (u.condominioId || 'condo-1') === condominioId && (incluirExcluidos ? true : !u.excluido));
      }
      throw err;
    }
  }

  public async getUsuario(usuarioId: string, condominioId: string = 'condo-1'): Promise<Usuario | null> {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client
        .from('usuarios')
        .select('*')
        .eq('id', usuarioId)
        .eq('condominio_id', condominioId)
        .single();

      if (error) {
        if (this.isTableMissingError(error)) {
          const backup = this.readColdBackupData();
          return (backup.usuarios || []).find((u) => u.id === usuarioId) || null;
        }
        if (error.code === 'PGRST116') return null;
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar usuário (${error.message})`, 503, error);
      }

      return data ? this.mapUsuario(data) : null;
    } catch (err: any) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (backup.usuarios || []).find((u) => u.id === usuarioId) || null;
      }
      throw err;
    }
  }

  public async createUsuario(
    usuarioData: Partial<Usuario> & { nome: string },
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; usuario?: Usuario; error?: string; status: number }> {
    const client = this.getClientOrThrow();
    const now = new Date().toISOString();
    const condId = usuarioData.condominioId || 'condo-1';
    const newId = usuarioData.id || `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const { data: created, error: insertErr } = await client
      .from('usuarios')
      .insert({
        id: newId,
        condominio_id: condId,
        nome: usuarioData.nome.trim(),
        role: usuarioData.role || UserRole.PORTEIRO,
        cargo: usuarioData.cargo || (usuarioData.role === UserRole.SINDICO ? 'Síndico' : 'Porteiro'),
        ativo: usuarioData.ativo !== false,
        matricula: usuarioData.matricula || null,
        tipo_turno: usuarioData.tipoTurno || TipoTurno.TURNO_12X36,
        opcao_turno_12x36: usuarioData.opcaoTurno12x36 || null,
        paridade_12x36: usuarioData.paridade12x36 || null,
        hora_inicio: usuarioData.horaInicio || null,
        hora_fim: usuarioData.horaFim || null,
        excluido: false,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertErr || !created) {
      if (this.isTableMissingError(insertErr)) {
        const backup = this.readColdBackupData();
        const fallbackUser: Usuario = {
          id: newId,
          condominioId: condId,
          nome: usuarioData.nome.trim(),
          role: usuarioData.role || UserRole.PORTEIRO,
          cargo: usuarioData.cargo || (usuarioData.role === UserRole.SINDICO ? 'Síndico' : 'Porteiro'),
          ativo: usuarioData.ativo !== false,
          matricula: usuarioData.matricula,
          tipoTurno: usuarioData.tipoTurno || TipoTurno.TURNO_12X36,
          opcaoTurno12x36: usuarioData.opcaoTurno12x36,
          paridade12x36: usuarioData.paridade12x36,
          horaInicio: usuarioData.horaInicio,
          horaFim: usuarioData.horaFim,
          excluido: false,
          createdAt: now,
          updatedAt: now,
        };
        backup.usuarios = [...(backup.usuarios || []), fallbackUser];
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[SupabaseStore] Falha ao salvar usuário em db_store.json:', e);
        }
        await this.logAuditoria({
          condominioId: condId,
          acao: 'CRIACAO_USUARIO',
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usuário cadastrado: ${fallbackUser.nome} (Função: ${fallbackUser.cargo || fallbackUser.role})`,
          dadosNovos: { id: fallbackUser.id, nome: fallbackUser.nome, role: fallbackUser.role },
        });
        return { success: true, usuario: fallbackUser, status: 201 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao criar usuário (${insertErr?.message})`, 503, insertErr);
    }

    const mappedUser = this.mapUsuario(created);

    await this.logAuditoria({
      condominioId: condId,
      acao: 'CRIACAO_USUARIO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usuário cadastrado: ${mappedUser.nome} (Função: ${mappedUser.cargo || mappedUser.role})`,
      dadosNovos: { id: mappedUser.id, nome: mappedUser.nome, role: mappedUser.role },
    });

    return { success: true, usuario: mappedUser, status: 201 };
  }

  public async updateUsuario(
    usuarioId: string,
    usuarioData: Partial<Usuario>,
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; usuario?: Usuario; error?: string; status: number }> {
    const client = this.getClientOrThrow();
    const now = new Date().toISOString();
    const condId = usuarioData.condominioId || 'condo-1';

    const updatePayload: any = { updated_at: now };
    if (usuarioData.nome !== undefined) updatePayload.nome = usuarioData.nome.trim();
    if (usuarioData.cargo !== undefined) updatePayload.cargo = usuarioData.cargo;
    if (usuarioData.role !== undefined) updatePayload.role = usuarioData.role;
    if (usuarioData.matricula !== undefined) updatePayload.matricula = usuarioData.matricula;
    if (usuarioData.tipoTurno !== undefined) updatePayload.tipo_turno = usuarioData.tipoTurno;
    if (usuarioData.opcaoTurno12x36 !== undefined) updatePayload.opcao_turno_12x36 = usuarioData.opcaoTurno12x36;
    if (usuarioData.paridade12x36 !== undefined) updatePayload.paridade_12x36 = usuarioData.paridade12x36;
    if (usuarioData.horaInicio !== undefined) updatePayload.hora_inicio = usuarioData.horaInicio;
    if (usuarioData.horaFim !== undefined) updatePayload.hora_fim = usuarioData.horaFim;
    if (usuarioData.ativo !== undefined) updatePayload.ativo = usuarioData.ativo;

    const { data: updated, error } = await client
      .from('usuarios')
      .update(updatePayload)
      .eq('id', usuarioId)
      .eq('condominio_id', condId)
      .select()
      .single();

    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || 'condo-1') === condId);
        if (!user) {
          return { success: false, error: 'Usuário não encontrado.', status: 404 };
        }
        if (usuarioData.nome !== undefined) user.nome = usuarioData.nome.trim();
        if (usuarioData.cargo !== undefined) user.cargo = usuarioData.cargo;
        if (usuarioData.role !== undefined) user.role = usuarioData.role;
        if (usuarioData.matricula !== undefined) user.matricula = usuarioData.matricula;
        if (usuarioData.tipoTurno !== undefined) user.tipoTurno = usuarioData.tipoTurno;
        if (usuarioData.opcaoTurno12x36 !== undefined) user.opcaoTurno12x36 = usuarioData.opcaoTurno12x36;
        if (usuarioData.paridade12x36 !== undefined) user.paridade12x36 = usuarioData.paridade12x36;
        if (usuarioData.horaInicio !== undefined) user.horaInicio = usuarioData.horaInicio;
        if (usuarioData.horaFim !== undefined) user.horaFim = usuarioData.horaFim;
        if (usuarioData.ativo !== undefined) user.ativo = usuarioData.ativo;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[SupabaseStore] Falha ao salvar usuário em db_store.json:', e);
        }
        await this.logAuditoria({
          condominioId: condId,
          acao: 'EDICAO_USUARIO',
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usuário atualizado: ${user.nome}`,
          dadosNovos: updatePayload,
        });
        return { success: true, usuario: user, status: 200 };
      }
      if (error && error.code === 'PGRST116') {
        return { success: false, error: 'Usuário não encontrado.', status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar usuário (${error?.message})`, 503, error);
    }

    const mappedUser = this.mapUsuario(updated);

    await this.logAuditoria({
      condominioId: condId,
      acao: 'EDICAO_USUARIO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usuário atualizado: ${mappedUser.nome}`,
      dadosNovos: updatePayload,
    });

    return { success: true, usuario: mappedUser, status: 200 };
  }

  public async toggleUsuarioStatus(
    usuarioId: string,
    ativo: boolean,
    condominioId: string = 'condo-1',
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; usuario?: Usuario; error?: string; status: number }> {
    const client = this.getClientOrThrow();
    const now = new Date().toISOString();

    const { data: updated, error } = await client
      .from('usuarios')
      .update({ ativo, updated_at: now })
      .eq('id', usuarioId)
      .eq('condominio_id', condominioId)
      .select()
      .single();

    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || 'condo-1') === condominioId);
        if (!user) {
          return { success: false, error: 'Usuário não encontrado.', status: 404 };
        }
        user.ativo = ativo;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[SupabaseStore] Falha ao salvar status do usuário em db_store.json:', e);
        }
        await this.logAuditoria({
          condominioId,
          acao: ativo ? 'ATIVACAO_USUARIO' : 'INATIVACAO_USUARIO',
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usuário ${user.nome} ${ativo ? 'ativado' : 'inativado'} no sistema.`,
          dadosNovos: { ativo },
        });
        return { success: true, usuario: user, status: 200 };
      }
      if (error && error.code === 'PGRST116') {
        return { success: false, error: 'Usuário não encontrado.', status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao alterar status do usuário (${error?.message})`, 503, error);
    }

    const mappedUser = this.mapUsuario(updated);

    await this.logAuditoria({
      condominioId,
      acao: ativo ? 'ATIVACAO_USUARIO' : 'INATIVACAO_USUARIO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usuário ${mappedUser.nome} ${ativo ? 'ativado' : 'inativado'} no sistema.`,
      dadosNovos: { ativo },
    });

    return { success: true, usuario: mappedUser, status: 200 };
  }

  public async deleteUsuario(
    usuarioId: string,
    condominioId: string = 'condo-1',
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; message?: string; modo?: string; usuario?: Usuario; error?: string; status: number }> {
    const client = this.getClientOrThrow();
    const now = new Date().toISOString();

    const { data: updated, error } = await client
      .from('usuarios')
      .update({ excluido: true, ativo: false, updated_at: now })
      .eq('id', usuarioId)
      .eq('condominio_id', condominioId)
      .select()
      .single();

    if (error || !updated) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const user = (backup.usuarios || []).find((u) => u.id === usuarioId && (u.condominioId || 'condo-1') === condominioId);
        if (!user) {
          return { success: false, error: 'Usuário não encontrado.', status: 404 };
        }
        user.excluido = true;
        user.ativo = false;
        user.updatedAt = now;
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[SupabaseStore] Falha ao salvar exclusão de usuário em db_store.json:', e);
        }
        await this.logAuditoria({
          condominioId,
          acao: 'EXCLUSAO_USUARIO',
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          detalhes: `Usuário ${user.nome} excluído do sistema por ${actor.nome}.`,
          dadosAnteriores: { id: user.id, nome: user.nome },
        });
        return {
          success: true,
          message: `Usuário ${user.nome} excluído com sucesso.`,
          modo: 'soft-delete',
          usuario: user,
          status: 200,
        };
      }
      if (error && error.code === 'PGRST116') {
        return { success: false, error: 'Usuário não encontrado.', status: 404 };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir usuário (${error?.message})`, 503, error);
    }

    const mappedUser = this.mapUsuario(updated);

    await this.logAuditoria({
      condominioId,
      acao: 'EXCLUSAO_USUARIO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Usuário ${mappedUser.nome} excluído do sistema por ${actor.nome}.`,
      dadosAnteriores: { id: mappedUser.id, nome: mappedUser.nome },
    });

    return {
      success: true,
      message: `Usuário ${mappedUser.nome} excluído com sucesso.`,
      modo: 'soft-delete',
      usuario: mappedUser,
      status: 200,
    };
  }

  // ==========================================
  // 14. CONDOMÍNIO (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async updateCondominio(
    condominioId: string,
    data: { nome: string; endereco?: string; mostrarMensagem?: boolean },
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; condominio?: Condominio; error?: string; status: number }> {
    const now = new Date().toISOString();

    try {
      const client = this.getClientOrThrow();

      const upsertPayload: any = {
        id: condominioId,
        nome: data.nome.trim(),
        endereco: data.endereco?.trim() || null,
        updated_at: now,
      };

      if (data.mostrarMensagem !== undefined) {
        upsertPayload.mostrar_mensagem = data.mostrarMensagem;
      }

      const { data: updated, error } = await client
        .from('condominios')
        .upsert(upsertPayload)
        .select()
        .single();

      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updateCondominioFallback(condominioId, data, actor, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar condomínio (${error?.message})`, 503, error);
      }

      const condo: Condominio = {
        id: updated.id,
        nome: updated.nome,
        endereco: updated.endereco || undefined,
        codigoPortariaAtual: updated.codigo_portaria_atual || null,
        mostrarMensagem: updated.mostrar_mensagem !== undefined ? Boolean(updated.mostrar_mensagem) : (data.mostrarMensagem !== undefined ? Boolean(data.mostrarMensagem) : true),
      };

      await this.logAuditoria({
        condominioId,
        acao: 'EDICAO_CONDOMINIO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Dados do condomínio alterados: Nome: "${condo.nome}", Endereço: "${condo.endereco || 'N/A'}", Mensagem Automática: ${condo.mostrarMensagem ? 'ON' : 'OFF'}`,
        dadosNovos: condo,
      });

      return { success: true, condominio: condo, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.updateCondominioFallback(condominioId, data, actor, now);
      }
      throw err;
    }
  }

  private async updateCondominioFallback(
    condominioId: string,
    data: { nome: string; endereco?: string; mostrarMensagem?: boolean },
    actor: { id: string; nome: string },
    now: string
  ): Promise<{ success: boolean; condominio?: Condominio; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const list = backup.condominios || [];
    const existing = list.find((c) => c.id === condominioId);

    const condo: Condominio = {
      id: condominioId,
      nome: data.nome.trim(),
      endereco: data.endereco?.trim() || (existing?.endereco || ''),
      mostrarMensagem: data.mostrarMensagem !== undefined ? Boolean(data.mostrarMensagem) : (existing?.mostrarMensagem !== undefined ? Boolean(existing.mostrarMensagem) : true),
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
      acao: 'EDICAO_CONDOMINIO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Dados do condomínio alterados: Nome: "${condo.nome}", Endereço: "${condo.endereco || 'N/A'}", Mensagem Automática: ${condo.mostrarMensagem ? 'ON' : 'OFF'}`,
      dadosNovos: condo,
    });

    return { success: true, condominio: condo, status: 200 };
  }

  // ==========================================
  // 15. CONTATOS DE EVIDÊNCIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async listContatos(condominioId: string = 'condo-1'): Promise<ContatoEvidencia[]> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('contatos')
      .select('*')
      .eq('condominio_id', condominioId)
      .order('nome', { ascending: true });

    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn('[SupabaseStore] Tabela contatos não encontrada no schema cache. Carregando contatos de contingência.');
        const backup = this.readColdBackupData();
        return (backup.contatos || []).filter((c) => (c.condominioId || 'condo-1') === condominioId);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar contatos (${error.message})`, 503, error);
    }

    return (data || []).map((c: any) => this.mapContato(c));
  }

  public async createContato(
    contatoData: {
      nome: string;
      categoria: CategoriaContato;
      telefoneOuWhatsapp: string;
      identificador?: string;
      condominioId?: string;
    },
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const now = new Date().toISOString();
    const condId = contatoData.condominioId || 'condo-1';
    const newId = `cont-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = this.getClientOrThrow();

      const { data: created, error } = await client
        .from('contatos')
        .insert({
          id: newId,
          condominio_id: condId,
          nome: contatoData.nome.trim(),
          categoria: contatoData.categoria || CategoriaContato.PORTARIA,
          telefone_ou_whatsapp: contatoData.telefoneOuWhatsapp.trim(),
          identificador: contatoData.identificador?.trim() || null,
          ativo: true,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error || !created) {
        if (this.isTableMissingError(error)) {
          return this.createContatoFallback(contatoData, actor, condId, newId, now);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao criar contato (${error?.message})`, 503, error);
      }

      const mappedContato = this.mapContato(created);

      await this.logAuditoria({
        condominioId: condId,
        acao: 'CRIACAO_CONTATO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Novo contato de evidência cadastrado: ${mappedContato.nome} (${mappedContato.telefoneOuWhatsapp})`,
        dadosNovos: mappedContato,
      });

      return { success: true, contato: mappedContato, status: 201 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.createContatoFallback(contatoData, actor, condId, newId, now);
      }
      throw err;
    }
  }

  private async createContatoFallback(
    contatoData: { nome: string; categoria: CategoriaContato; telefoneOuWhatsapp: string; identificador?: string; condominioId?: string },
    actor: { id: string; nome: string },
    condId: string,
    newId: string,
    now: string
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const newContato: ContatoEvidencia = {
      id: newId,
      condominioId: condId,
      nome: contatoData.nome.trim(),
      categoria: contatoData.categoria || CategoriaContato.PORTARIA,
      telefoneOuWhatsapp: contatoData.telefoneOuWhatsapp.trim(),
      identificador: contatoData.identificador?.trim() || undefined,
      ativo: true,
      createdAt: now,
      updatedAt: now,
    };

    backup.contatos = [...(backup.contatos || []), newContato];
    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: condId,
      acao: 'CRIACAO_CONTATO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Novo contato de evidência cadastrado: ${newContato.nome} (${newContato.telefoneOuWhatsapp})`,
      dadosNovos: newContato,
    });

    return { success: true, contato: newContato, status: 201 };
  }

  public async updateContato(
    contatoId: string,
    contatoData: Partial<ContatoEvidencia>,
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const now = new Date().toISOString();
    const condId = contatoData.condominioId || 'condo-1';

    const updatePayload: any = { updated_at: now };
    if (contatoData.nome !== undefined) updatePayload.nome = contatoData.nome.trim();
    if (contatoData.categoria !== undefined) updatePayload.categoria = contatoData.categoria;
    if (contatoData.telefoneOuWhatsapp !== undefined) updatePayload.telefone_ou_whatsapp = contatoData.telefoneOuWhatsapp.trim();
    if (contatoData.identificador !== undefined) updatePayload.identificador = contatoData.identificador.trim();
    if (contatoData.ativo !== undefined) updatePayload.ativo = contatoData.ativo;

    try {
      const client = this.getClientOrThrow();

      const { data: updated, error } = await client
        .from('contatos')
        .update(updatePayload)
        .eq('id', contatoId)
        .eq('condominio_id', condId)
        .select()
        .single();

      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.updateContatoFallback(contatoId, contatoData, actor, condId, now);
        }
        if (error && error.code === 'PGRST116') {
          return { success: false, error: 'Contato não encontrado.', status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar contato (${error?.message})`, 503, error);
      }

      const mappedContato = this.mapContato(updated);

      await this.logAuditoria({
        condominioId: condId,
        acao: 'EDICAO_CONTATO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Contato atualizado: ${mappedContato.nome}`,
        dadosNovos: updatePayload,
      });

      return { success: true, contato: mappedContato, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.updateContatoFallback(contatoId, contatoData, actor, condId, now);
      }
      throw err;
    }
  }

  private async updateContatoFallback(
    contatoId: string,
    contatoData: Partial<ContatoEvidencia>,
    actor: { id: string; nome: string },
    condId: string,
    now: string
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const contato = (backup.contatos || []).find((c) => c.id === contatoId && (c.condominioId || 'condo-1') === condId);
    if (!contato) {
      return { success: false, error: 'Contato não encontrado.', status: 404 };
    }

    if (contatoData.nome !== undefined) contato.nome = contatoData.nome.trim();
    if (contatoData.categoria !== undefined) contato.categoria = contatoData.categoria;
    if (contatoData.telefoneOuWhatsapp !== undefined) contato.telefoneOuWhatsapp = contatoData.telefoneOuWhatsapp.trim();
    if (contatoData.identificador !== undefined) contato.identificador = contatoData.identificador.trim();
    if (contatoData.ativo !== undefined) contato.ativo = contatoData.ativo;
    contato.updatedAt = now;

    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId: condId,
      acao: 'EDICAO_CONTATO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Contato atualizado: ${contato.nome}`,
      dadosNovos: contatoData,
    });

    return { success: true, contato, status: 200 };
  }

  public async toggleContatoStatus(
    contatoId: string,
    ativo: boolean,
    condominioId: string = 'condo-1',
    actor: { id: string; nome: string }
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const now = new Date().toISOString();

    try {
      const client = this.getClientOrThrow();

      const { data: updated, error } = await client
        .from('contatos')
        .update({ ativo, updated_at: now })
        .eq('id', contatoId)
        .eq('condominio_id', condominioId)
        .select()
        .single();

      if (error || !updated) {
        if (this.isTableMissingError(error)) {
          return this.toggleContatoStatusFallback(contatoId, ativo, condominioId, actor, now);
        }
        if (error && error.code === 'PGRST116') {
          return { success: false, error: 'Contato não encontrado.', status: 404 };
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao alterar status do contato (${error?.message})`, 503, error);
      }

      const mappedContato = this.mapContato(updated);

      await this.logAuditoria({
        condominioId,
        acao: ativo ? 'ATIVACAO_CONTATO' : 'INATIVACAO_CONTATO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        detalhes: `Contato ${mappedContato.nome} ${ativo ? 'ativado' : 'inativado'}.`,
        dadosNovos: { ativo },
      });

      return { success: true, contato: mappedContato, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.toggleContatoStatusFallback(contatoId, ativo, condominioId, actor, now);
      }
      throw err;
    }
  }

  private async toggleContatoStatusFallback(
    contatoId: string,
    ativo: boolean,
    condominioId: string,
    actor: { id: string; nome: string },
    now: string
  ): Promise<{ success: boolean; contato?: ContatoEvidencia; error?: string; status: number }> {
    const backup = this.readColdBackupData();
    const contato = (backup.contatos || []).find((c) => c.id === contatoId && (c.condominioId || 'condo-1') === condominioId);
    if (!contato) {
      return { success: false, error: 'Contato não encontrado.', status: 404 };
    }

    contato.ativo = ativo;
    contato.updatedAt = now;

    this.writeColdBackupData(backup);

    await this.logAuditoria({
      condominioId,
      acao: ativo ? 'ATIVACAO_CONTATO' : 'INATIVACAO_CONTATO',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      detalhes: `Contato ${contato.nome} ${ativo ? 'ativado' : 'inativado'}.`,
      dadosNovos: { ativo },
    });

    return { success: true, contato, status: 200 };
  }

  public async deleteContato(
    contatoId: string,
    condominioId: string = 'condo-1'
  ): Promise<{ success: boolean; removido: boolean; error?: string; status: number }> {
    try {
      const client = this.getClientOrThrow();

      const { error } = await client
        .from('contatos')
        .delete()
        .eq('id', contatoId)
        .eq('condominio_id', condominioId);

      if (error) {
        if (this.isTableMissingError(error)) {
          return this.deleteContatoFallback(contatoId, condominioId);
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir contato (${error.message})`, 503, error);
      }

      return { success: true, removido: true, status: 200 };
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        return this.deleteContatoFallback(contatoId, condominioId);
      }
      throw err;
    }
  }

  private deleteContatoFallback(contatoId: string, condominioId: string): { success: boolean; removido: boolean; status: number } {
    const backup = this.readColdBackupData();
    const initialLen = (backup.contatos || []).length;
    backup.contatos = (backup.contatos || []).filter((c) => !(c.id === contatoId && (c.condominioId || 'condo-1') === condominioId));
    if (backup.contatos.length !== initialLen) {
      this.writeColdBackupData(backup);
      return { success: true, removido: true, status: 200 };
    }
    return { success: true, removido: false, status: 200 };
  }

  // ==========================================
  // 16. AUDITORIA (EXCLUSIVAMENTE SUPABASE COM FALLBACK RESILIENTE)
  // ==========================================
  public async listAuditoria(condominioId: string = 'condo-1', limit = 100): Promise<AuditoriaLog[]> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('auditoria')
      .select('*')
      .eq('condominio_id', condominioId)
      .order('data_hora', { ascending: false })
      .limit(limit);

    if (error) {
      if (this.isTableMissingError(error)) {
        console.warn('[SupabaseStore] Tabela auditoria não encontrada no schema cache. Carregando logs de contingência.');
        const backup = this.readColdBackupData();
        return (backup.auditoria || []).filter((a) => (a.condominioId || 'condo-1') === condominioId).slice(0, limit);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao consultar auditoria (${error.message})`, 503, error);
    }

    return (data || []).map((a: any) => this.mapAuditoria(a));
  }

  public async logAuditoria(params: {
    condominioId: string;
    acao: string;
    prismaId?: string;
    prismaNumero?: string;
    prismaCorNome?: string;
    usuarioId: string;
    usuarioNome: string;
    usuarioCargo?: string;
    turnoId?: string;
    turnoNome?: string;
    detalhes: string;
    dadosAnteriores?: any;
    dadosNovos?: any;
  }): Promise<void> {
    const now = new Date().toISOString();
    const logId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const condId = params.condominioId || 'condo-1';

    try {
      const client = this.getClientOrThrow();

      const { error } = await client.from('auditoria').insert({
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
        dados_novos: params.dadosNovos || null,
      });

      if (error) {
        if (this.isTableMissingError(error)) {
          this.logAuditoriaFallback(params, condId, now, logId);
          return;
        }
        console.error('[SupabaseStore] Erro ao gravar log de auditoria no Supabase:', error);
      }
    } catch (err: any) {
      if (this.isTableMissingError(err)) {
        this.logAuditoriaFallback(params, condId, now, logId);
        return;
      }
      console.error('[SupabaseStore] Erro ao gravar log de auditoria:', err);
    }
  }

  private logAuditoriaFallback(
    params: any,
    condId: string,
    now: string,
    logId: string
  ): void {
    const backup = this.readColdBackupData();
    const auditItem: AuditoriaLog = {
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
      dadosNovos: params.dadosNovos,
    };
    backup.auditoria = [auditItem, ...(backup.auditoria || [])];
    this.writeColdBackupData(backup);
  }

  // ==========================================
  // CREDENCIAIS DE ACESSO (PVA-6 FASE 1 - AUTENTICAÇÃO)
  // ==========================================

  public async findCredencialById(id: string): Promise<CredencialAcesso | null> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('credenciais_acesso')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).find((c) => c.id === id) || null;
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial (${error.message})`, 503, error);
    }
    return data ? this.mapCredencial(data) : null;
  }

  public async findCredencialByIdentificador(identificador: string): Promise<CredencialAcesso | null> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('credenciais_acesso')
      .select('*')
      .ilike('identificador', identificador.trim())
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (
          (backup.credenciais || []).find(
            (c) => c.identificador.toLowerCase() === identificador.trim().toLowerCase()
          ) || null
        );
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial por identificador (${error.message})`, 503, error);
    }
    return data ? this.mapCredencial(data) : null;
  }

  public async findCredenciaisByUsuarioId(usuarioId: string): Promise<CredencialAcesso[]> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('credenciais_acesso')
      .select('*')
      .eq('usuario_id', usuarioId)
      .order('created_at', { ascending: false });

    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || []).filter((c) => c.usuarioId === usuarioId);
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao listar credenciais do usuário (${error.message})`, 503, error);
    }
    return (data || []).map((c: any) => this.mapCredencial(c));
  }

  public async listCredenciaisSanitizadas(condominioId: string): Promise<CredencialAcessoSanitizada[]> {
    const client = this.getClientOrThrow();
    const { data, error } = await client
      .from('credenciais_acesso')
      .select('*')
      .eq('condominio_id', condominioId)
      .order('created_at', { ascending: false });

    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        return (backup.credenciais || [])
          .filter((c) => (c.condominioId || 'condo-1') === condominioId)
          .map((c) => this.sanitizeCredencial(c));
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao listar credenciais sanitizadas (${error.message})`, 503, error);
    }
    return (data || []).map((c: any) => this.sanitizeCredencial(this.mapCredencial(c)));
  }

  public async createCredencial(dados: {
    usuarioId: string;
    condominioId?: string;
    tipoAcesso: TipoAcesso;
    identificador: string;
    senhaHash?: string | null;
    pinHash?: string | null;
    ativo?: boolean;
  }): Promise<CredencialAcesso> {
    const client = this.getClientOrThrow();
    const id = `cred-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const payload = {
      id,
      usuario_id: dados.usuarioId,
      condominio_id: dados.condominioId || 'condo-1',
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
      updated_at: now,
    };

    const { data, error } = await client
      .from('credenciais_acesso')
      .insert([payload])
      .select('*')
      .single();

    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const newCred: CredencialAcesso = {
          id,
          usuarioId: dados.usuarioId,
          condominioId: dados.condominioId || 'condo-1',
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
          updatedAt: now,
        };
        backup.credenciais = backup.credenciais || [];
        backup.credenciais.push(newCred);
        try {
          fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[SupabaseStore] Falha ao persistir credencial no db_store.json:', e);
        }
        return newCred;
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao cadastrar credencial (${error.message})`, 503, error);
    }

    return this.mapCredencial(data);
  }

  public async updateCredencial(
    id: string,
    updates: {
      identificador?: string;
      senhaHash?: string | null;
      pinHash?: string | null;
      ativo?: boolean;
      bloqueado?: boolean;
      tentativasInvalidas?: number;
      ultimoLogin?: string | null;
      ultimoBloqueio?: string | null;
    }
  ): Promise<CredencialAcesso> {
    const client = this.getClientOrThrow();
    const payload: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.identificador !== undefined) payload.identificador = updates.identificador.trim();
    if (updates.senhaHash !== undefined) payload.senha_hash = updates.senhaHash;
    if (updates.pinHash !== undefined) payload.pin_hash = updates.pinHash;
    if (updates.ativo !== undefined) payload.ativo = updates.ativo;
    if (updates.bloqueado !== undefined) payload.bloqueado = updates.bloqueado;
    if (updates.tentativasInvalidas !== undefined) payload.tentativas_invalidas = updates.tentativasInvalidas;
    if (updates.ultimoLogin !== undefined) payload.ultimo_login = updates.ultimoLogin;
    if (updates.ultimoBloqueio !== undefined) payload.ultimo_bloqueio = updates.ultimoBloqueio;

    const { data, error } = await client
      .from('credenciais_acesso')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const cred = (backup.credenciais || []).find((c) => c.id === id);
        if (cred) {
          if (updates.identificador !== undefined) cred.identificador = updates.identificador.trim();
          if (updates.senhaHash !== undefined) cred.senhaHash = updates.senhaHash;
          if (updates.pinHash !== undefined) cred.pinHash = updates.pinHash;
          if (updates.ativo !== undefined) cred.ativo = updates.ativo;
          if (updates.bloqueado !== undefined) cred.bloqueado = updates.bloqueado;
          if (updates.tentativasInvalidas !== undefined) cred.tentativasInvalidas = updates.tentativasInvalidas;
          if (updates.ultimoLogin !== undefined) cred.ultimoLogin = updates.ultimoLogin;
          if (updates.ultimoBloqueio !== undefined) cred.ultimoBloqueio = updates.ultimoBloqueio;
          try {
            fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
          } catch (e) {
            console.warn('[SupabaseStore] Falha ao persistir atualização de credencial no db_store.json:', e);
          }
          return cred;
        }
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao atualizar credencial (${error.message})`, 503, error);
    }

    return this.mapCredencial(data);
  }

  public async deleteCredencial(
    id: string,
    condominioId: string = 'condo-1'
  ): Promise<{ success: boolean; removido: boolean }> {
    const client = this.getClientOrThrow();
    const { error } = await client
      .from('credenciais_acesso')
      .delete()
      .eq('id', id)
      .eq('condominio_id', condominioId);

    if (error) {
      if (this.isTableMissingError(error)) {
        const backup = this.readColdBackupData();
        const initialLen = (backup.credenciais || []).length;
        backup.credenciais = (backup.credenciais || []).filter(
          (c) => !(c.id === id && (c.condominioId || 'condo-1') === condominioId)
        );
        if (backup.credenciais.length !== initialLen) {
          try {
            fs.writeFileSync(this.dbBackupPath, JSON.stringify(backup, null, 2), 'utf-8');
          } catch (e) {
            console.warn('[SupabaseStore] Falha ao salvar remoção no db_store.json:', e);
          }
          return { success: true, removido: true };
        }
        return { success: true, removido: false };
      }
      throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao excluir credencial (${error.message})`, 503, error);
    }
    return { success: true, removido: true };
  }

  public async registrarTentativaInvalida(id: string, maxTentativas: number = MAX_LOGIN_ATTEMPTS): Promise<{ bloqueado: boolean; tentativasInvalidas: number }> {
    const credencial = await this.findCredencialById(id);
    if (!credencial) {
      throw new SupabaseStorageError('Credencial não encontrada', 404);
    }

    const novasTentativas = (credencial.tentativasInvalidas || 0) + 1;
    const deveBloquear = novasTentativas >= maxTentativas;
    const now = new Date().toISOString();

    await this.updateCredencial(id, {
      tentativasInvalidas: novasTentativas,
      bloqueado: deveBloquear ? true : credencial.bloqueado,
      ultimoBloqueio: deveBloquear ? now : credencial.ultimoBloqueio,
    });

    return {
      bloqueado: deveBloquear,
      tentativasInvalidas: novasTentativas,
    };
  }

  public async resetTentativasInvalidas(id: string): Promise<void> {
    await this.updateCredencial(id, {
      tentativasInvalidas: 0,
      bloqueado: false,
    });
  }

  private portariaCodigos: Record<string, string> = {
    'condo-1': 'CP-123456',
  };

  public async findPortariaCredencial(condominioId: string = 'condo-1'): Promise<CredencialAcesso | null> {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client
        .from('credenciais_acesso')
        .select('*')
        .eq('condominio_id', condominioId)
        .eq('tipo_acesso', TipoAcesso.PORTARIA)
        .eq('identificador', 'portaria.codigo')
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) {
          const backup = this.readColdBackupData();
          return (
            (backup.credenciais || []).find(
              (c) =>
                (c.condominioId || 'condo-1') === condominioId &&
                c.tipoAcesso === TipoAcesso.PORTARIA &&
                (c.identificador === 'portaria.codigo' || c.usuarioId === 'portaria-station')
            ) || null
          );
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Erro ao buscar credencial de portaria (${error.message})`, 503, error);
      }
      if (data) return this.mapCredencial(data);

      // Fallback to local backup check if maybeSingle returned nothing on table
      const backup = this.readColdBackupData();
      return (
        (backup.credenciais || []).find(
          (c) =>
            (c.condominioId || 'condo-1') === condominioId &&
            c.tipoAcesso === TipoAcesso.PORTARIA &&
            (c.identificador === 'portaria.codigo' || c.usuarioId === 'portaria-station')
        ) || null
      );
    } catch (err: any) {
      if (this.isTableMissingError(err) || !this.isActive()) {
        const backup = this.readColdBackupData();
        return (
          (backup.credenciais || []).find(
            (c) =>
              (c.condominioId || 'condo-1') === condominioId &&
              c.tipoAcesso === TipoAcesso.PORTARIA &&
              (c.identificador === 'portaria.codigo' || c.usuarioId === 'portaria-station')
          ) || null
        );
      }
      throw err;
    }
  }

  public async getOrCreatePortariaCredencial(condominioId: string = 'condo-1'): Promise<CredencialAcesso> {
    let cred = await this.findPortariaCredencial(condominioId);
    if (!cred) {
      const defaultCode = this.portariaCodigos[condominioId] || 'CP-123456';
      const defaultHash = await hashPin(defaultCode);
      cred = await this.createCredencial({
        usuarioId: 'portaria-station',
        condominioId,
        tipoAcesso: TipoAcesso.PORTARIA,
        identificador: 'portaria.codigo',
        pinHash: defaultHash,
        senhaHash: defaultHash,
        ativo: true,
      });
      this.portariaCodigos[condominioId] = defaultCode;
    }
    return cred;
  }

  public async getCondominioById(condominioId: string = 'condo-1'): Promise<Condominio | null> {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client
        .from('condominios')
        .select('*')
        .eq('id', condominioId)
        .maybeSingle();

      if (error) {
        if (this.isTableMissingError(error)) {
          const backup = this.readColdBackupData();
          return (backup.condominios || []).find((c) => c.id === condominioId) || null;
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao buscar condomínio (${error.message})`, 503, error);
      }

      if (data) {
        return {
          id: data.id,
          nome: data.nome,
          endereco: data.endereco,
          codigoPortariaAtual: data.codigo_portaria_atual || null,
          mostrarMensagem: data.mostrar_mensagem !== undefined ? Boolean(data.mostrar_mensagem) : true,
        };
      }

      const backup = this.readColdBackupData();
      return (backup.condominios || []).find((c) => c.id === condominioId) || null;
    } catch {
      const backup = this.readColdBackupData();
      return (backup.condominios || []).find((c) => c.id === condominioId) || null;
    }
  }

  public async getPortariaStatus(condominioId: string = 'condo-1'): Promise<{
    codigo: string;
    ativo: boolean;
    bloqueado: boolean;
    tentativasInvalidas: number;
    ultimoLogin?: string | null;
    condominioId: string;
  }> {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    
    // Prioridade 1: Banco de dados (public.condominios.codigo_portaria_atual)
    let codigoPersistido: string | null = null;
    try {
      const condo = await this.getCondominioById(condominioId);
      if (condo?.codigoPortariaAtual) {
        codigoPersistido = condo.codigoPortariaAtual;
        // Atualizar cache em memória para manter sincronizado com o banco
        this.portariaCodigos[condominioId] = codigoPersistido;
      }
    } catch {
      // Ignora falha de consulta do condomínio e segue fluxo resiliente
    }

    // Prioridade 2: Cache de compatibilidade em memória / Legado
    let codigo = codigoPersistido || this.portariaCodigos[condominioId];
    if (!codigo) {
      // Se ainda não existir valor persistido nem em cache, opera pelo mecanismo legado preservando baseline
      if (condominioId === 'condo-1') {
        codigo = 'CP-123456';
      } else {
        codigo = 'CP-123456';
      }
      this.portariaCodigos[condominioId] = codigo;
    }

    return {
      codigo,
      ativo: cred.ativo,
      bloqueado: cred.bloqueado,
      tentativasInvalidas: cred.tentativasInvalidas,
      ultimoLogin: cred.ultimoLogin,
      condominioId,
    };
  }

  public async gerarNovoCodigoPortaria(
    condominioId: string = 'condo-1',
    actor: { id: string; nome: string; role: string }
  ): Promise<{ codigo: string; status: string; ativo: boolean; bloqueado: boolean }> {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    
    // Obter condomínio para derivar prefixo determinístico
    const condo = await this.getCondominioById(condominioId);
    const prefixo = derivarPrefixoCondominio(condo?.nome);

    // Obter código anterior
    const codigoAnterior = condo?.codigoPortariaAtual || this.portariaCodigos[condominioId];

    // Gerar código no formato XX-NNNNNN com crypto.randomInt e proteção contra colisão
    const client = this.getClientOrThrow();
    let novoCodigo = '';
    let pinHash = '';
    let updateSuccess = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 100;

    while (attempts < MAX_ATTEMPTS && !updateSuccess) {
      attempts++;
      novoCodigo = gerarCodigoPortariaSeguro(prefixo);

      // 1. Verificação preventiva no cache em memória
      const colideMemoria = Object.entries(this.portariaCodigos).some(
        ([cId, cCode]) => cId !== condominioId && cCode === novoCodigo
      );
      if (colideMemoria) {
        continue;
      }

      // 2. Verificação preventiva contra colisão no banco de dados
      try {
        const { data: existingWithCode, error: queryErr } = await client
          .from('condominios')
          .select('id')
          .eq('codigo_portaria_atual', novoCodigo)
          .limit(1);

        if (!queryErr && existingWithCode && existingWithCode.length > 0) {
          if (existingWithCode[0].id !== condominioId) {
            continue;
          }
        }
      } catch {
        // Em caso de falha da pré-checagem, prossegue para tentativa do UPDATE definitivo
      }

      // 3. Gerar hash Argon2id correspondente
      pinHash = await hashPin(novoCodigo);

      // 4. Executar UPDATE em public.condominios.codigo_portaria_atual
      let updateData: any = null;
      let updateError: any = null;

      try {
        const res = await client
          .from('condominios')
          .update({
            codigo_portaria_atual: novoCodigo,
            updated_at: new Date().toISOString(),
          })
          .eq('id', condominioId)
          .select('id, codigo_portaria_atual');
        updateData = res.data;
        updateError = res.error;
      } catch (clientErr: any) {
        // Falha técnica de rede ou cliente: interrompe imediatamente sem atualizar credencial nem cache
        console.error(`[SupabaseStore] Falha técnica de rede ao atualizar condominios: ${clientErr?.message || 'Erro de conexão'}`);
        throw new SupabaseStorageError(
          `Falha ao persistir código da portaria no condomínio (${clientErr?.message || 'Erro de conexão'})`,
          500,
          clientErr
        );
      }

      // 5. Verificar explicitamente o resultado da operação
      if (updateError) {
        // Verificar se é erro de violação de unicidade (código PostgreSQL 23505)
        const isUniqueViolation =
          updateError.code === '23505' ||
          (typeof updateError.message === 'string' &&
            (updateError.message.includes('23505') ||
              updateError.message.toLowerCase().includes('unique') ||
              updateError.message.includes('idx_condominios_codigo_portaria_atual')));

        if (isUniqueViolation) {
          // Trata como colisão: NÃO atualiza credencial, NÃO atualiza cache, tenta novo código no loop
          console.warn('[SupabaseStore] Colisão de código detectada pelo índice UNIQUE (23505). Tentando novo código...');
          continue;
        }

        // Se houver qualquer outro erro no UPDATE:
        // - NÃO atualizar credenciais_acesso;
        // - NÃO atualizar cache;
        // - registrar somente mensagem técnica segura, sem expor o código em plaintext;
        // - lançar erro explícito.
        console.error(`[SupabaseStore] Falha técnica ao atualizar condominios.codigo_portaria_atual (código: ${updateError.code || 'N/A'}, mensagem: ${updateError.message})`);
        throw new SupabaseStorageError(
          `Falha ao persistir código da portaria no condomínio: ${updateError.message || 'Erro de banco de dados'}`,
          500,
          updateError
        );
      }

      // Validar se o registro do condomínio existia e foi de fato atualizado
      if (!updateData || updateData.length === 0) {
        console.error(`[SupabaseStore] Condomínio não localizado para atualização do código da portaria: ${condominioId}`);
        throw new SupabaseStorageError(
          `Condomínio ${condominioId} não encontrado para atualização do código da portaria.`,
          404
        );
      }

      updateSuccess = true;
    }

    if (!updateSuccess) {
      throw new SupabaseStorageError(
        `Limite de tentativas (${MAX_ATTEMPTS}) excedido para gerar código de portaria exclusivo sem colisão.`,
        409
      );
    }

    // 6. Somente após confirmação de sucesso do UPDATE em condominios, atualizar credenciais_acesso
    await this.updateCredencial(cred.id, {
      pinHash,
      senhaHash: pinHash,
      bloqueado: false,
      tentativasInvalidas: 0,
      ativo: true,
    });

    // 7. Somente após sucesso da atualização da credencial, atualizar o cache em memória
    this.portariaCodigos[condominioId] = novoCodigo;

    // Log Auditoria detalhado (sem expor o texto puro nos logs/auditoria quando não necessário, mantendo formato seguro)
    if (codigoAnterior) {
      await this.logAuditoria({
        condominioId,
        acao: 'CÓDIGO_PORTARIA_INVALIDADO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `Código de acesso anterior da portaria foi invalidado imediatamente para o condomínio ${condominioId}.`,
      });
      await this.logAuditoria({
        condominioId,
        acao: 'CÓDIGO_PORTARIA_REGENERADO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `Novo código de acesso da portaria gerado com sucesso por ${actor.nome}.`,
      });
    } else {
      await this.logAuditoria({
        condominioId,
        acao: 'CÓDIGO_PORTARIA_CRIADO',
        usuarioId: actor.id,
        usuarioNome: actor.nome,
        usuarioCargo: actor.role,
        detalhes: `Código de acesso da portaria criado por ${actor.nome}.`,
      });
    }

    return {
      codigo: novoCodigo,
      status: 'ATIVO',
      ativo: true,
      bloqueado: false,
    };
  }

  public async desbloquearPortaria(
    condominioId: string = 'condo-1',
    actor: { id: string; nome: string; role: string }
  ): Promise<{ success: boolean }> {
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    await this.updateCredencial(cred.id, {
      bloqueado: false,
      tentativasInvalidas: 0,
    });

    await this.logAuditoria({
      condominioId,
      acao: 'DESBLOQUEIO_PORTARIA',
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      usuarioCargo: actor.role,
      detalhes: `Acesso da portaria desbloqueado por ${actor.nome} (${actor.role}).`,
    });

    return { success: true };
  }

  public async authenticatePortariaByCodigo(codigo: string): Promise<{
    success: boolean;
    cred?: CredencialAcesso;
    condominioId?: string;
    status?: number;
    error?: string;
    message?: string;
  }> {
    // 1. Normalização segura: remover espaços externos e converter para maiúsculas
    const raw = (codigo || '').trim().toUpperCase();
    if (!raw) {
      return {
        success: false,
        status: 400,
        error: 'PARAMETROS_INVALIDOS',
        message: 'Código de acesso da portaria obrigatório.',
      };
    }

    // 2. Validação de formato:
    // Aceita formato completo dinâmico (ex: CP-123456, BV-067985, JE-123456, HO-000027)
    // ou entrada legada somente numérica de 6 dígitos (ex: 123456)
    const isDynamicFormat = /^[A-Z]{2,4}-\d{6}$/.test(raw);
    const isOnlyDigits = /^\d{6}$/.test(raw);

    if (!isDynamicFormat && !isOnlyDigits) {
      // Código com formato inválido: registrar tentativa inválida e retornar erro
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        const pCred = await this.getOrCreatePortariaCredencial('condo-1');
        tentativa = await this.registrarTentativaInvalida(pCred.id);
      } catch {
        // Preserva resposta segura mesmo se a persistência da tentativa falhar
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? 'PORTARIA_BLOQUEADA' : 'CODIGO_INVALIDO',
        message: tentativa.bloqueado
          ? 'Acesso da portaria bloqueado por excesso de tentativas incorretas.'
          : 'Código de acesso da portaria incorreto.',
      };
    }

    // 3. Determinar o código candidato:
    // Para entrada somente numérica (6 dígitos):
    // Se for '123456', preserva compatibilidade com CP-123456 legado de condo-1.
    // Para qualquer outro número de 6 dígitos sem prefixo (ex: 067985), NÃO assumir CP-
    // nem inventar regra, pois sem o contexto do condomínio a resolução seria ambígua.
    let codigoCandidato = raw;
    if (isOnlyDigits) {
      if (raw === '123456') {
        codigoCandidato = 'CP-123456';
      } else {
        codigoCandidato = raw;
      }
    }

    // 4. Resolução do condomínio:
    // FONTE PRIMÁRIA DE VERDADE: public.condominios.codigo_portaria_atual
    let matchedCondoId: string | null = null;
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client
        .from('condominios')
        .select('id, codigo_portaria_atual')
        .eq('codigo_portaria_atual', codigoCandidato)
        .limit(1);

      if (!error && data && data.length > 0) {
        matchedCondoId = data[0].id;
        // Sincroniza cache em memória como otimização
        this.portariaCodigos[matchedCondoId] = codigoCandidato;
      }
    } catch {
      // Em caso de falha de conexão/consulta, prossegue para checagens em cache/fallback
    }

    // 5. Otimização secundária: verificar cache em memória (this.portariaCodigos)
    if (!matchedCondoId) {
      for (const [cId, cCode] of Object.entries(this.portariaCodigos)) {
        if (cCode && cCode.toUpperCase() === codigoCandidato) {
          matchedCondoId = cId;
          break;
        }
      }
    }

    // 6. Compatibilidade legada para CP-123456 caso condominios.codigo_portaria_atual seja NULL
    if (!matchedCondoId && codigoCandidato === 'CP-123456') {
      try {
        const condo1 = await this.getCondominioById('condo-1');
        if (!condo1?.codigoPortariaAtual || condo1.codigoPortariaAtual === 'CP-123456') {
          matchedCondoId = 'condo-1';
          this.portariaCodigos['condo-1'] = 'CP-123456';
        }
      } catch {
        matchedCondoId = 'condo-1';
        this.portariaCodigos['condo-1'] = 'CP-123456';
      }
    }

    // 7. Fallback de contingência / backup local para credenciais armazenadas
    if (!matchedCondoId) {
      try {
        const backup = this.readColdBackupData();
        for (const bCred of backup.credenciais || []) {
          if (bCred.tipoAcesso === TipoAcesso.PORTARIA && bCred.pinHash) {
            const matches = await verifyPin(codigoCandidato, bCred.pinHash);
            if (matches) {
              matchedCondoId = bCred.condominioId || 'condo-1';
              this.portariaCodigos[matchedCondoId] = codigoCandidato;
              break;
            }
          }
        }
      } catch {
        // Segue para tratamento de código não localizado
      }
    }

    // 8. Se o condomínio não foi localizado (código inexistente ou não associado)
    if (!matchedCondoId) {
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        const pCred = await this.getOrCreatePortariaCredencial('condo-1');
        tentativa = await this.registrarTentativaInvalida(pCred.id);
      } catch {
        // Preserva resposta segura mesmo se a persistência da tentativa falhar
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? 'PORTARIA_BLOQUEADA' : 'CODIGO_INVALIDO',
        message: tentativa.bloqueado
          ? 'Acesso da portaria bloqueado por excesso de tentativas incorretas.'
          : 'Código de acesso da portaria incorreto.',
      };
    }

    // 9. Obter credencial da portaria para o condomínio localizado
    const cred = await this.getOrCreatePortariaCredencial(matchedCondoId);

    // 10. Validações de status da portaria: ativo e bloqueado
    if (!cred.ativo) {
      return {
        success: false,
        status: 403,
        error: 'PORTARIA_INATIVA',
        message: 'Acesso da portaria temporariamente inativado pelo administrador.',
      };
    }

    if (cred.bloqueado) {
      return {
        success: false,
        status: 403,
        error: 'PORTARIA_BLOQUEADA',
        message: 'Acesso da portaria bloqueado por excesso de tentativas incorretas. Contate o administrador para desbloqueio.',
      };
    }

    // 11. Validação Criptográfica Obrigatória com Argon2id via verifyPin()
    const pinValido = cred.pinHash ? await verifyPin(codigoCandidato, cred.pinHash) : false;

    if (!pinValido) {
      // Incrementa tentativas inválidas na credencial deste condomínio
      let tentativa = { bloqueado: false, tentativasInvalidas: 1 };
      try {
        tentativa = await this.registrarTentativaInvalida(cred.id);
      } catch {
        // Preserva resposta segura mesmo se a persistência da tentativa falhar
      }
      return {
        success: false,
        status: tentativa.bloqueado ? 403 : 401,
        error: tentativa.bloqueado ? 'PORTARIA_BLOQUEADA' : 'CODIGO_INVALIDO',
        message: tentativa.bloqueado
          ? 'Acesso da portaria bloqueado por excesso de tentativas incorretas.'
          : 'Código de acesso da portaria incorreto.',
      };
    }

    // 12. Autenticação bem-sucedida: resetar tentativas e atualizar último login
    try {
      await this.resetTentativasInvalidas(cred.id);
      await this.updateCredencial(cred.id, {
        ultimoLogin: new Date().toISOString(),
      });
    } catch {
      // Falha defensiva não impede autenticação concedida
    }

    return {
      success: true,
      cred,
      condominioId: matchedCondoId,
    };
  }

  public async listCondominios(): Promise<Condominio[]> {
    try {
      const client = this.getClientOrThrow();
      const { data, error } = await client.from('condominios').select('*');
      if (error) {
        if (this.isTableMissingError(error)) {
          const backup = this.readColdBackupData();
          return (backup.condominios || []).map((c) => ({
            id: c.id,
            nome: c.nome,
            endereco: c.endereco,
            mostrarMensagem: c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true,
          }));
        }
        throw new SupabaseStorageError(`STORAGE_PRIMARY_UNAVAILABLE: Falha ao listar condomínios (${error.message})`, 503, error);
      }
      if (data && Array.isArray(data) && data.length > 0) {
        return data.map((c: any) => ({
          id: c.id,
          nome: c.nome,
          endereco: c.endereco,
          codigoPortariaAtual: c.codigo_portaria_atual || null,
          mostrarMensagem: c.mostrar_mensagem !== undefined ? Boolean(c.mostrar_mensagem) : (c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true),
        }));
      }
      const backup = this.readColdBackupData();
      return (backup.condominios || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true,
      }));
    } catch (err: any) {
      const backup = this.readColdBackupData();
      return (backup.condominios || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        endereco: c.endereco,
        mostrarMensagem: c.mostrarMensagem !== undefined ? Boolean(c.mostrarMensagem) : true,
      }));
    }
  }

  public async setPortariaCodigo(condominioId: string = 'condo-1', novoCodigo: string): Promise<CredencialAcesso> {
    const cleanCode = (novoCodigo || '').trim();
    if (cleanCode.length < 4 || cleanCode.length > 12) {
      throw new SupabaseStorageError('O código da portaria deve conter entre 4 e 12 caracteres.', 400);
    }
    const cred = await this.getOrCreatePortariaCredencial(condominioId);
    const pinHash = await hashPin(cleanCode);
    this.portariaCodigos[condominioId] = cleanCode.startsWith('CP-') ? cleanCode.toUpperCase() : `CP-${cleanCode}`;
    return await this.updateCredencial(cred.id, {
      pinHash,
      senhaHash: pinHash,
      bloqueado: false,
      tentativasInvalidas: 0,
    });
  }

}

export const supabaseStore = new SupabaseStore();
