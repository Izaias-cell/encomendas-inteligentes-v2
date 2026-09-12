import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
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
  TipoSessao,
  DEFAULT_PORTARIA_STATION_ID,
} from './src/types';
import { supabaseStore, SupabaseStorageError } from './src/services/supabaseStore';
import {
  requireAuth,
  requireRole,
  requirePortaria,
  optionalAuth,
} from './src/services/authMiddleware';
import {
  generateSessionToken,
  SESSION_COOKIE_NAME,
  getSessionCookieOptions,
  getClearCookieOptions,
  isAuthConfigured,
} from './src/services/authService';
import {
  verifyPassword,
  verifyPin,
  hashPassword,
  hashPin,
  validatePasswordFormat,
  validatePinFormat,
} from './src/services/authCrypto';
import { identificarOperadorEmOperacao } from './src/utils/turnoUtils';

// Lock map for atomic concurrency protection
const prismaLocks = new Map<string, Promise<void>>();

async function withPrismaLock<T>(prismaId: string, fn: () => Promise<T>): Promise<T> {
  while (prismaLocks.has(prismaId)) {
    try {
      await prismaLocks.get(prismaId);
    } catch {
      // ignore
    }
  }

  let resolveLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
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

// In-Memory Turn Session State (Fast volatile session tracking)
let activeTurnoSessions: { [condoId: string]: Turno } = {};

// Active plantão substitutions (troca rápida de plantonista na portaria)
let activePlantaoSubstituicoes: {
  [condoId: string]: {
    condominioId: string;
    usuarioId: string;
    usuarioNome: string;
    substituidoPorId?: string;
    substituidoPorNome?: string;
    motivo?: string;
    inicio: string;
  };
} = {};

async function resolveOperadorPlantao(condominioId: string, fallbackUserId?: string, fallbackUserNome?: string) {
  // 1. Substituição manual ativa
  if (activePlantaoSubstituicoes[condominioId]) {
    const sub = activePlantaoSubstituicoes[condominioId];
    return {
      usuarioId: sub.usuarioId,
      usuarioNome: sub.usuarioNome,
      isSubstituicao: true,
      motivoSubstituicao: sub.motivo,
    };
  }

  // 2. Escala automática calculada em tempo real (12x36 paridade / horários)
  try {
    const usuarios = await supabaseStore.listUsuarios(condominioId);
    const opInfo = identificarOperadorEmOperacao(usuarios, new Date());
    if (opInfo.status === 'OK' && opInfo.operador) {
      return {
        usuarioId: opInfo.operador.id,
        usuarioNome: opInfo.operador.nome,
        isSubstituicao: false,
      };
    }
  } catch (e) {
    console.warn('[Plantao Auto] Falha ao identificar operador da escala:', e);
  }

  // 3. Fallback para usuário de sessão ou Portaria Geral
  return {
    usuarioId: fallbackUserId || 'portaria-station',
    usuarioNome: fallbackUserNome || 'Portaria Principal',
    isSubstituicao: false,
  };
}

function handleStorageError(res: express.Response, err: any, customMessage?: string) {
  console.warn('[Storage Notice]:', err?.message || err);
  const status = err instanceof SupabaseStorageError ? err.status : 503;
  const message = err?.message || customMessage || 'Armazenamento primário (Supabase PostgreSQL) indisponível.';
  return res.status(status).json({
    error: message,
    code: 'STORAGE_PRIMARY_UNAVAILABLE',
    storageStatus: 'SUPABASE_UNAVAILABLE',
    details: err?.details || undefined,
  });
}

export function createExpressApp(): express.Application {
  const app = express();
  const PORT = 3000;

  console.log('[Server] Backend PRISMAS — Persistência Primária Operacional Exclusiva: Supabase PostgreSQL.');

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // ==========================================
  // 1. HEALTH & VALIDAÇÃO DE INFRAESTRUTURA
  // ==========================================
  app.get('/api/health', async (req, res) => {
    const isLive = await supabaseStore.checkLivePostgres();
    res.json({
      status: isLive ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      storage: 'supabase-postgresql',
      primarySource: 'supabase-postgresql',
      cutoverStatus: isLive ? 'COMPLETED_ACTIVE' : 'SUPABASE_CONNECTION_REQUIRED',
    });
  });

  // ==========================================
  // 1.1 INFRAESTRUTURA DE AUTENTICAÇÃO (PVA-6 FASE 3)
  // ==========================================
  app.get('/api/auth/status', (req, res) => {
    res.json({
      configured: isAuthConfigured(),
      sessionCookieName: SESSION_COOKIE_NAME,
      stationDefault: DEFAULT_PORTARIA_STATION_ID,
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { identificador, senha, condominioId = 'condo-1' } = req.body;

    if (!identificador || !senha) {
      return res.status(400).json({
        error: 'PARAMETROS_INVALIDOS',
        message: 'Identificador e senha são obrigatórios.',
      });
    }

    try {
      const cred = await supabaseStore.findCredencialByIdentificador(identificador);
      if (!cred || !cred.ativo || !cred.senhaHash) {
        return res.status(401).json({
          error: 'CREDENCIAL_INVALIDA',
          message: 'Identificador ou senha inválidos.',
        });
      }

      if (cred.bloqueado) {
        return res.status(403).json({
          error: 'CREDENCIAL_BLOQUEADA',
          message: 'Credencial bloqueada por excesso de tentativas ou intervenção administrativa.',
        });
      }

      const senhaValida = await verifyPassword(senha, cred.senhaHash);
      if (!senhaValida) {
        const statusTentativa = await supabaseStore.registrarTentativaInvalida(cred.id);
        return res.status(statusTentativa.bloqueado ? 403 : 401).json({
          error: statusTentativa.bloqueado ? 'CREDENCIAL_BLOQUEADA' : 'CREDENCIAL_INVALIDA',
          message: statusTentativa.bloqueado
            ? 'Credencial bloqueada após exceder o limite de tentativas inválidas.'
            : 'Identificador ou senha inválidos.',
        });
      }

      // Login com sucesso: reseta tentativas e atualiza timestamp
      await supabaseStore.resetTentativasInvalidas(cred.id);
      await supabaseStore.updateCredencial(cred.id, { ultimoLogin: new Date().toISOString() });

      const usuarios = await supabaseStore.listUsuarios(cred.condominioId || condominioId);
      const usuario = usuarios.find((u) => u.id === cred.usuarioId);

      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(403).json({
          error: 'USUARIO_INATIVO',
          message: 'O usuário correspondente a esta credencial está inativo ou arquivado.',
        });
      }

      const tipoSessao = cred.tipoAcesso === TipoAcesso.SINDICO ? TipoSessao.SINDICO : TipoSessao.ADMIN;
      const token = generateSessionToken({
        usuarioId: usuario.id,
        condominioId: cred.condominioId || condominioId,
        role: usuario.role,
        tipoSessao,
        nome: usuario.nome,
      });

      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(tipoSessao));

      return res.json({
        success: true,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          role: usuario.role,
          tipoSessao,
          condominioId: cred.condominioId || condominioId,
        },
        token,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao autenticar credencial.');
    }
  });

  app.post('/api/auth/portaria-codigo', async (req, res) => {
    const { codigo, stationId = DEFAULT_PORTARIA_STATION_ID } = req.body;

    if (!codigo || typeof codigo !== 'string' || !codigo.trim()) {
      return res.status(400).json({
        error: 'PARAMETROS_INVALIDOS',
        message: 'O Código de acesso da portaria é obrigatório.',
      });
    }

    try {
      const authResult = await supabaseStore.authenticatePortariaByCodigo(codigo);
      if (!authResult.success) {
        return res.status(authResult.status || 401).json({
          error: authResult.error,
          message: authResult.message,
        });
      }

      const condominioId = authResult.condominioId || 'condo-1';

      const token = generateSessionToken({
        usuarioId: 'portaria-station',
        condominioId,
        role: UserRole.PORTEIRO,
        tipoSessao: TipoSessao.PORTARIA,
        stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
        nome: 'Portaria Principal',
      });

      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(TipoSessao.PORTARIA));

      return res.json({
        success: true,
        user: {
          id: 'portaria-station',
          nome: 'Portaria Principal',
          role: UserRole.PORTEIRO,
          tipoSessao: TipoSessao.PORTARIA,
          stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
          condominioId,
        },
        token,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao autenticar código da portaria.');
    }
  });

  app.post('/api/auth/portaria-assumir', async (req, res) => {
    const {
      usuarioId,
      pin,
      stationId = DEFAULT_PORTARIA_STATION_ID,
      condominioId = 'condo-1',
    } = req.body;

    if (!usuarioId || !pin) {
      return res.status(400).json({
        error: 'PARAMETROS_INVALIDOS',
        message: 'Operador (usuarioId) e PIN são obrigatórios.',
      });
    }

    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const usuario = usuarios.find((u) => u.id === usuarioId);

      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(403).json({
          error: 'USUARIO_INATIVO',
          message: 'Operador inativo ou não cadastrado neste condomínio.',
        });
      }

      const creds = await supabaseStore.findCredenciaisByUsuarioId(usuarioId);
      const credPortaria = creds.find((c) => c.tipoAcesso === TipoAcesso.PORTARIA && c.ativo);

      if (!credPortaria || !credPortaria.pinHash) {
        return res.status(401).json({
          error: 'CREDENCIAL_PORTARIA_NAO_ENCONTRADA',
          message: 'PIN de portaria não configurado para este operador.',
        });
      }

      if (credPortaria.bloqueado) {
        return res.status(403).json({
          error: 'CREDENCIAL_BLOQUEADA',
          message: 'PIN de portaria bloqueado por excesso de tentativas inválidas.',
        });
      }

      const pinValido = await verifyPin(pin, credPortaria.pinHash);
      if (!pinValido) {
        const statusTentativa = await supabaseStore.registrarTentativaInvalida(credPortaria.id);
        return res.status(statusTentativa.bloqueado ? 403 : 401).json({
          error: statusTentativa.bloqueado ? 'CREDENCIAL_BLOQUEADA' : 'PIN_INVALIDO',
          message: statusTentativa.bloqueado
            ? 'Credencial de portaria bloqueada por excesso de tentativas.'
            : 'PIN incorreto.',
        });
      }

      await supabaseStore.resetTentativasInvalidas(credPortaria.id);
      await supabaseStore.updateCredencial(credPortaria.id, { ultimoLogin: new Date().toISOString() });

      const token = generateSessionToken({
        usuarioId: usuario.id,
        condominioId,
        role: usuario.role,
        tipoSessao: TipoSessao.PORTARIA,
        stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
        nome: usuario.nome,
      });

      res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(TipoSessao.PORTARIA));

      return res.json({
        success: true,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          role: usuario.role,
          tipoSessao: TipoSessao.PORTARIA,
          stationId: stationId || DEFAULT_PORTARIA_STATION_ID,
          condominioId,
        },
        token,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao autenticar plantão de portaria.');
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    return res.json({
      authenticated: true,
      user: req.user,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions());
    return res.json({
      success: true,
      message: 'Sessão encerrada com sucesso.',
    });
  });

  // ==========================================
  // PLANTÃO & ESCALA AUTOMÁTICA DE PORTARIA
  // ==========================================
  app.get('/api/plantao/status', requireAuth, async (req, res) => {
    const condominioId = (req.query.condominioId as string) || req.user?.condominioId || 'condo-1';
    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const opInfo = identificarOperadorEmOperacao(usuarios, new Date());
      const subAtiva = activePlantaoSubstituicoes[condominioId] || null;

      let operadorAtivo: any = null;
      if (subAtiva) {
        const u = usuarios.find((item) => item.id === subAtiva.usuarioId);
        operadorAtivo = {
          id: subAtiva.usuarioId,
          nome: subAtiva.usuarioNome,
          cargo: u?.cargo || 'Porteiro (Substituto)',
          horaInicio: u?.horaInicio,
          horaFim: u?.horaFim,
          isSubstituicao: true,
          motivoSubstituicao: subAtiva.motivo,
        };
      } else if (opInfo.status === 'OK' && opInfo.operador) {
        operadorAtivo = {
          id: opInfo.operador.id,
          nome: opInfo.operador.nome,
          cargo: opInfo.operador.cargo || 'Porteiro',
          horaInicio: opInfo.operador.horaInicio,
          horaFim: opInfo.operador.horaFim,
          isSubstituicao: false,
        };
      }

      return res.json({
        status: opInfo.status,
        operadorEscala: opInfo.operador,
        operadorAtivo,
        substituicaoAtiva: subAtiva,
        horarioAtual: opInfo.horarioAtual,
        mensagem: opInfo.mensagem,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao consultar status do plantão.');
    }
  });

  app.post('/api/plantao/substituir', requireAuth, requirePortaria, async (req, res) => {
    const { usuarioId, motivo } = req.body;
    const condominioId = req.body.condominioId || req.user?.condominioId || 'condo-1';

    if (!usuarioId) {
      return res.status(400).json({ error: 'ID do operador substituto é obrigatório.' });
    }

    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId);
      const usuario = usuarios.find((u) => u.id === usuarioId);
      if (!usuario || usuario.excluido || usuario.ativo === false) {
        return res.status(404).json({ error: 'Operador substituto não encontrado ou inativo.' });
      }

      activePlantaoSubstituicoes[condominioId] = {
        condominioId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        substituidoPorId: req.user?.usuarioId,
        substituidoPorNome: req.user?.nome,
        motivo: motivo || 'Substituição manual de plantão',
        inicio: new Date().toISOString(),
      };

      await supabaseStore.logAuditoria({
        condominioId,
        acao: 'SUBSTITUICAO_PLANTAO',
        usuarioId: req.user?.usuarioId || 'portaria-station',
        usuarioNome: req.user?.nome || 'Portaria',
        usuarioCargo: req.user?.role || 'PORTEIRO',
        detalhes: `Operador responsável alterado para ${usuario.nome}. Motivo: ${motivo || 'Não informado'}.`,
        dadosNovos: { substitutoId: usuario.id, substitutoNome: usuario.nome, motivo },
      });

      return res.json({
        success: true,
        message: `Responsável pelo plantão alterado com sucesso para ${usuario.nome}.`,
        substituicao: activePlantaoSubstituicoes[condominioId],
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao registrar substituição de plantão.');
    }
  });

  app.post('/api/plantao/restaurar-escala', requireAuth, requirePortaria, async (req, res) => {
    const condominioId = req.body.condominioId || req.user?.condominioId || 'condo-1';
    const subAnterior = activePlantaoSubstituicoes[condominioId];
    delete activePlantaoSubstituicoes[condominioId];

    try {
      await supabaseStore.logAuditoria({
        condominioId,
        acao: 'RESTAURACAO_ESCALA_PLANTAO',
        usuarioId: req.user?.usuarioId || 'portaria-station',
        usuarioNome: req.user?.nome || 'Portaria',
        usuarioCargo: req.user?.role || 'PORTEIRO',
        detalhes: 'Plantão retornou para identificação automática da escala.',
        dadosAnteriores: subAnterior,
      });

      return res.json({
        success: true,
        message: 'Escala automática restaurada com sucesso.',
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao restaurar escala.');
    }
  });

  app.get('/api/condominios/codigo-portaria', requireAuth, requireRole([UserRole.ADMIN, UserRole.SINDICO]), async (req, res) => {
    const requestedCondoId = (req.query.condominioId as string) || req.user?.condominioId || 'condo-1';
    if (req.user?.condominioId && req.query.condominioId && req.query.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: 'ISOLAMENTO_CONDOMINIO_VIOLADO', message: 'Acesso negado aos dados de outro condomínio.' });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      const status = await supabaseStore.getPortariaStatus(condominioId);
      return res.json({
        success: true,
        ...status,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao obter status do código da portaria.');
    }
  });

  app.post('/api/condominios/codigo-portaria/gerar', requireAuth, requireRole([UserRole.ADMIN]), async (req, res) => {
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || 'condo-1';
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: 'ISOLAMENTO_CONDOMINIO_VIOLADO', message: 'Não é permitido gerar código para outro condomínio.' });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      const result = await supabaseStore.gerarNovoCodigoPortaria(condominioId, {
        id: req.user!.usuarioId,
        nome: req.user!.nome,
        role: req.user!.role,
      });
      return res.json({
        success: true,
        codigo: result.codigo,
        status: result.status,
        message: 'Novo código de acesso da portaria gerado com sucesso.',
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao gerar código de acesso da portaria.');
    }
  });

  app.post('/api/condominios/codigo-portaria/desbloquear', requireAuth, requireRole([UserRole.ADMIN]), async (req, res) => {
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || 'condo-1';
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: 'ISOLAMENTO_CONDOMINIO_VIOLADO', message: 'Não é permitido desbloquear acesso de outro condomínio.' });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;
    try {
      await supabaseStore.desbloquearPortaria(condominioId, {
        id: req.user!.usuarioId,
        nome: req.user!.nome,
        role: req.user!.role,
      });
      return res.json({
        success: true,
        message: 'Acesso da portaria desbloqueado com sucesso.',
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao desbloquear acesso da portaria.');
    }
  });

  app.put('/api/condominios/codigo-portaria', requireAuth, requireRole([UserRole.ADMIN]), async (req, res) => {
    const { codigo } = req.body;
    const requestedCondoId = req.body.condominioId || req.user?.condominioId || 'condo-1';
    if (req.user?.condominioId && req.body.condominioId && req.body.condominioId !== req.user.condominioId) {
      return res.status(403).json({ error: 'ISOLAMENTO_CONDOMINIO_VIOLADO', message: 'Não é permitido alterar código de outro condomínio.' });
    }
    const condominioId = req.user?.condominioId || requestedCondoId;

    if (!codigo || typeof codigo !== 'string' || codigo.trim().length < 4 || codigo.trim().length > 12) {
      return res.status(400).json({ error: 'O código da portaria deve conter entre 4 e 12 caracteres.' });
    }

    try {
      await supabaseStore.setPortariaCodigo(condominioId, codigo.trim());
      await supabaseStore.logAuditoria({
        condominioId,
        acao: 'CÓDIGO_PORTARIA_REGENERADO',
        usuarioId: req.user?.usuarioId || 'admin',
        usuarioNome: req.user?.nome || 'Administrador',
        usuarioCargo: req.user?.role || 'ADMIN',
        detalhes: 'Código de acesso da portaria atualizado manualmente pelo gestor.',
      });

      return res.json({
        success: true,
        message: 'Código da portaria atualizado com sucesso.',
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao atualizar código da portaria.');
    }
  });

  app.get('/api/supabase/validate', async (req, res) => {
    const result = await supabaseStore.validateConnectionOnly();
    res.json(result);
  });

  app.get('/api/supabase/validate-pva1', async (req, res) => {
    const result = await supabaseStore.validatePVA1Infrastructure();
    res.json(result);
  });

  app.get('/api/supabase/snapshot-pva3', (req, res) => {
    try {
      const result = supabaseStore.getJsonSnapshot();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  app.post('/api/supabase/migrate-pva3', async (req, res) => {
    try {
      const result = await supabaseStore.executePVA3Migration();
      res.json(result);
    } catch (e: any) {
      handleStorageError(res, e, 'Erro durante migração manual PVA-3.');
    }
  });

  // ==========================================
  // 2. DASHBOARD / STATUS GERAL DO CONDOMÍNIO (SUPABASE)
  // ==========================================
  app.get('/api/dashboard', requireAuth, async (req, res) => {
    const condominioId = (req.query.condominioId as string) || req.user?.condominioId || 'condo-1';
    try {
      const statusData = await supabaseStore.getStatus(condominioId);
      const turnoAtivo = activeTurnoSessions[condominioId] || undefined;
      return res.json({
        ...statusData,
        turnoAtivo,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao consultar dashboard no Supabase.');
    }
  });

  app.get('/api/status', async (req, res) => {
    const condominioId = (req.query.condominioId as string) || 'condo-1';

    try {
      const statusData = await supabaseStore.getStatus(condominioId);
      const turnoAtivo = activeTurnoSessions[condominioId] || undefined;
      return res.json({
        ...statusData,
        turnoAtivo,
      });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao consultar status no Supabase.');
    }
  });

  // Ranking inteligente das 6 casas que mais utilizam prismas (isolado por condomínio)
  app.get('/api/condominios/:condominioId/ranking-casas', requireAuth, async (req, res) => {
    const { condominioId } = req.params;
    const userCondoId = req.user?.condominioId;
    const isAdminOrSindico = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.SINDICO;
    if (!isAdminOrSindico && userCondoId && userCondoId !== condominioId) {
      return res.status(403).json({ error: 'Acesso não autorizado ao condomínio informado.' });
    }
    try {
      const ranking = await supabaseStore.getRankingCasasFrequentes(condominioId);
      return res.json({ success: true, ranking });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao consultar ranking de casas no Supabase.');
    }
  });

  // ==========================================
  // 3. FLUXO ENTREGAR PRISMA (ATÔMICO NO SUPABASE)
  // ==========================================
  app.post(
    '/api/movimentacoes/entrega',
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const {
        prismaId,
        casa,
        fotoEvidenciaUrl,
      } = req.body;

      if (!prismaId || !casa) {
        return res.status(400).json({ error: 'ID do prisma e Casa são obrigatórios.' });
      }

      const condominioId = req.body.condominioId || req.user?.condominioId || 'condo-1';
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
            fotoEvidenciaUrl,
          });
        });

        return res.status(result.status).json(
          result.success
            ? { success: true, prisma: result.prisma, movimentacao: result.movimentacao }
            : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao persistir entrega no Supabase.');
      }
    }
  );

  // ==========================================
  // 4. FLUXO DEVOLVER / RECOLHER PRISMA (ATÔMICO NO SUPABASE)
  // ==========================================
  app.post(
    '/api/movimentacoes/devolucao',
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const { prismaId } = req.body;

      if (!prismaId) {
        return res.status(400).json({ error: 'ID do prisma é obrigatório.' });
      }

      const condominioId = req.body.condominioId || req.user?.condominioId || 'condo-1';
      const opPlantao = await resolveOperadorPlantao(condominioId, req.user?.usuarioId, req.user?.nome);
      const usuarioId = opPlantao.usuarioId;
      const usuarioNome = opPlantao.usuarioNome;

      try {
        const result = await withPrismaLock(prismaId, async () => {
          return await supabaseStore.devolverPrisma({
            prismaId,
            usuarioId,
            usuarioNome,
            condominioId,
          });
        });

        return res.status(result.status).json(
          result.success
            ? { success: true, prisma: result.prisma, movimentacao: result.movimentacao }
            : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao persistir devolução no Supabase.');
      }
    }
  );

  // ==========================================
  // 5. REGISTRAR PENDÊNCIA (SUPABASE)
  // ==========================================
  app.post(
    '/api/movimentacoes/pendencia',
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const { prismaId, motivo } = req.body;

      if (!prismaId || !motivo) {
        return res.status(400).json({ error: 'ID do prisma e Motivo da pendência são obrigatórios.' });
      }

      const condominioId = req.body.condominioId || req.user?.condominioId || 'condo-1';
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
            condominioId,
          });
        });

        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao registrar pendência no Supabase.');
      }
    }
  );

  // ==========================================
  // 6. RESOLVER PENDÊNCIA (SUPABASE)
  // ==========================================
  app.post('/api/movimentacoes/resolver-pendencia', requireAuth, async (req, res) => {
    const {
      prismaId,
      novoEstado,
      justificativa,
    } = req.body;

    if (!prismaId || !novoEstado || !justificativa) {
      return res.status(400).json({ error: 'Dados incompletos para resolução de pendência.' });
    }

    const usuarioId = req.user!.usuarioId;
    const usuarioNome = req.user!.nome;
    const condominioId = req.user!.condominioId;

    try {
      const result = await withPrismaLock(prismaId, async () => {
        return await supabaseStore.resolverPendencia({
          prismaId,
          novoEstado,
          justificativa,
          usuarioId,
          usuarioNome,
          condominioId,
        });
      });

      return res.status(result.status).json(
        result.success ? { success: true, prisma: result.prisma } : { error: result.error }
      );
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao resolver pendência no Supabase.');
    }
  });

  // ==========================================
  // 7. ALTERAR INDISPONIBILIDADE (SUPABASE)
  // ==========================================
  app.post('/api/prismas/toggle-indisponivel', requireAuth, async (req, res) => {
    const { prismaId, motivo, tornarIndisponivel } = req.body;

    if (!prismaId) {
      return res.status(400).json({ error: 'ID do prisma é obrigatório.' });
    }

    const condominioId = req.user!.condominioId;
    const actor = {
      id: req.user!.usuarioId,
      nome: req.user!.nome,
    };

    try {
      const result = await withPrismaLock(prismaId, async () => {
        return await supabaseStore.togglePrismaIndisponivel(prismaId, {
          tornarIndisponivel: Boolean(tornarIndisponivel),
          motivo,
          condominioId,
          actor,
        });
      });

      return res.status(result.status).json(
        result.success ? { success: true, prisma: result.prisma } : { error: result.error }
      );
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao alterar estado do prisma no Supabase.');
    }
  });

  // ==========================================
  // 8. CORREÇÃO DE MOVIMENTAÇÃO (SUPABASE)
  // ==========================================
  app.post(
    '/api/movimentacoes/correcao',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { movimentacaoId, novaCasa, motivoCorrecao } = req.body;

      if (!movimentacaoId || !novaCasa || !motivoCorrecao) {
        return res.status(400).json({ error: 'Movimentação, nova Casa e Motivo da correção são obrigatórios.' });
      }

      const condominioId = req.user!.condominioId;
      const usuarioId = req.user!.usuarioId;
      const usuarioNome = req.user!.nome;

      try {
        const result = await supabaseStore.corrigirMovimentacao({
          movimentacaoId,
          novaCasa,
          motivoCorrecao,
          usuarioId,
          usuarioNome,
          condominioId,
        });

        return res.status(result.status).json(
          result.success ? { success: true, movimentacao: result.movimentacao } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao processar correção no Supabase.');
      }
    }
  );

  // ==========================================
  // 9. TROCA DE TURNO / ASSUNÇÃO DE POSTO (SUPABASE)
  // ==========================================
  app.post(
    '/api/turnos/assumir',
    requireAuth,
    requirePortaria,
    async (req, res) => {
      const {
        nomeTurno,
        notasPassagem,
      } = req.body;

      const porteiroId = req.user!.usuarioId;
      const porteiroNome = req.user!.nome;
      const condominioId = req.user!.condominioId;

      try {
        const prismas = await supabaseStore.listPrismas(condominioId, false);
        const prismasEmUso = prismas.filter((p) => p.estado === PrismaEstado.EM_USO).length;

        const novoTurno: Turno = {
          id: `tur-${Date.now()}`,
          condominioId,
          nome: nomeTurno || `Turno ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          porteiroId,
          porteiroNome,
          inicio: new Date().toISOString(),
          ativo: true,
          prismasEmUsoNaAssuncao: prismasEmUso,
          notasPassagem: notasPassagem || undefined,
        };

        activeTurnoSessions[condominioId] = novoTurno;

        await supabaseStore.logAuditoria({
          condominioId,
          acao: 'TROCA_TURNO',
          usuarioId: porteiroId,
          usuarioNome: porteiroNome,
          turnoId: novoTurno.id,
          turnoNome: novoTurno.nome,
          detalhes: `Passagem de turno assumida por ${porteiroNome}. ${prismasEmUso} prisma(s) em uso no momento.${
            notasPassagem ? ` Observações: ${notasPassagem}` : ''
          }`,
          dadosNovos: { turnoId: novoTurno.id, prismasEmUso },
        });

        return res.json({ success: true, turno: novoTurno, prismasEmUso });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao registrar troca de turno no Supabase.');
      }
    }
  );

  // ==========================================
  // 10. CADASTRO DE NOVO PRISMA (SUPABASE)
  // ==========================================
  app.post(
    '/api/prismas',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO, UserRole.PORTEIRO]),
    async (req, res) => {
      const { numero, corId, corNome } = req.body;

      if (!numero || !corId || !corNome) {
        return res.status(400).json({ error: 'Número e Cor são obrigatórios.' });
      }

      const condominioId = req.user!.condominioId;
      const actor = {
        id: req.user!.usuarioId,
        nome: req.user!.nome,
      };

      try {
        const result = await supabaseStore.createPrisma({
          numero,
          corId,
          corNome,
          condominioId,
          actor,
        });

        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao cadastrar prisma no Supabase.');
      }
    }
  );

  // ==========================================
  // 10.1 CADASTRO DE PRISMAS EM LOTE (SUPABASE)
  // ==========================================
  app.post(
    '/api/prismas/lote',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO, UserRole.PORTEIRO]),
    async (req, res) => {
      const { numeros, numeroInicial, quantidade, padZero, corId, corNome } = req.body;

      if (!corId || !corNome) {
        return res.status(400).json({ error: 'Cor é obrigatória.' });
      }

      let listaNumeros: string[] = [];

      if (Array.isArray(numeros) && numeros.length > 0) {
        listaNumeros = numeros.map((n: any) => String(n).trim()).filter(Boolean);
      } else if (numeroInicial !== undefined && quantidade !== undefined) {
        const numInicio = parseInt(String(numeroInicial), 10);
        const qtd = parseInt(String(quantidade), 10);

        if (isNaN(numInicio) || numInicio < 1) {
          return res.status(400).json({ error: 'O número inicial deve ser um valor inteiro maior ou igual a 1.' });
        }

        if (isNaN(qtd) || qtd < 1) {
          return res.status(400).json({ error: 'A quantidade deve ser um número inteiro maior ou igual a 1.' });
        }

        if (qtd > 100) {
          return res.status(400).json({ error: 'A quantidade máxima por lote é de 100 prismas.' });
        }

        const devePad = padZero !== false;
        for (let i = numInicio; i < numInicio + qtd; i++) {
          listaNumeros.push(devePad && i < 10 ? `0${i}` : `${i}`);
        }
      } else {
        return res.status(400).json({ error: 'Informe a lista de números ou o número inicial e a quantidade.' });
      }

      if (listaNumeros.length === 0) {
        return res.status(400).json({ error: 'Nenhum prisma válido a cadastrar.' });
      }

      if (listaNumeros.length > 100) {
        return res.status(400).json({ error: 'O limite máximo por lote é de 100 prismas.' });
      }

      const condominioId = req.user!.condominioId;
      const actor = {
        id: req.user!.usuarioId,
        nome: req.user!.nome,
      };

      try {
        const result = await supabaseStore.createPrismasLote({
          numeros: listaNumeros,
          corId,
          corNome,
          condominioId,
          actor,
        });

        return res.status(result.status).json(
          result.success
            ? {
                success: true,
                totalCriados: result.totalCriados,
                primeiro: result.primeiro,
                ultimo: result.ultimo,
                prismas: result.prismas,
              }
            : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao cadastrar lote de prismas no Supabase.');
      }
    }
  );

  // ==========================================
  // 11. LISTAR TODOS OS PRISMAS (SUPABASE)
  // ==========================================
  app.get('/api/prismas/todos', async (req, res) => {
    const condominioId = (req.query.condominioId as string) || 'condo-1';

    try {
      const prismas = await supabaseStore.listPrismas(condominioId, false);
      return res.json({ prismas });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao listar prismas no Supabase.');
    }
  });

  // ==========================================
  // 12. EXCLUIR PRISMA FÍSICO (SUPABASE)
  // ==========================================
  const handleExcluirPrisma = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'ID do prisma é obrigatório.' });
    }

    const condominioId = req.user!.condominioId;
    const actor = {
      id: req.user!.usuarioId,
      nome: req.user!.nome,
      role: req.user!.role,
      cargo: req.user!.role === UserRole.SINDICO ? 'Síndico(a)' : req.user!.role === UserRole.PORTEIRO ? 'Porteiro(a)' : 'Administrador',
    };

    try {
      const result = await withPrismaLock(id, async () => {
        return await supabaseStore.excluirPrisma(id, {
          condominioId,
          actor,
        });
      });

      return res.status(result.status).json(
        result.success
          ? {
              success: true,
              message: result.message,
              tipoExclusao: result.tipoExclusao,
              prismaId: result.prismaId,
            }
          : { error: result.error }
      );
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao processar exclusão do prisma no Supabase.');
    }
  };

  app.post(
    '/api/prismas/:id/excluir',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO, UserRole.PORTEIRO]),
    handleExcluirPrisma
  );
  app.delete(
    '/api/prismas/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO, UserRole.PORTEIRO]),
    handleExcluirPrisma
  );

  // ==========================================
  // 13. ALTERAR STATUS DO PRISMA (SUPABASE)
  // ==========================================
  app.patch(
    '/api/prismas/:id/status',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo, motivoInativacao } = req.body;

      const condominioId = req.user!.condominioId;
      const actor = {
        id: req.user!.usuarioId,
        nome: req.user!.nome,
      };

      try {
        const result = await supabaseStore.updatePrismaStatus(id, {
          ativo: Boolean(ativo),
          motivoInativacao,
          condominioId,
          actor,
        });

        return res.status(result.status).json(
          result.success ? { success: true, prisma: result.prisma } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao alterar status do prisma no Supabase.');
      }
    }
  );

  // ==========================================
  // 14. LISTAR USUÁRIOS (SUPABASE)
  // ==========================================
  app.get('/api/usuarios', async (req, res) => {
    const condominioId = (req.query.condominioId as string) || 'condo-1';

    try {
      const usuarios = await supabaseStore.listUsuarios(condominioId, false);
      return res.json({ usuarios });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao listar usuários no Supabase.');
    }
  });

  // ==========================================
  // 15. CADASTRO DE NOVO USUÁRIO (SUPABASE)
  // ==========================================
  app.post(
    '/api/usuarios',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const {
        nome,
        cargo,
        role = UserRole.PORTEIRO,
        matricula,
        tipoTurno,
        opcaoTurno12x36,
        paridade12x36,
        horaInicio,
        horaFim,
        identificador,
        senhaInicial,
      } = req.body;

      if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'Nome do usuário é obrigatório.' });
      }

      const condominioId = req.body.condominioId || req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

      try {
        let cleanIdentificador: string | undefined;
        let senhaHash: string | undefined;

        // Se o perfil for SINDICO, exigir e validar identificador e senha inicial
        if (role === UserRole.SINDICO) {
          if (!identificador || typeof identificador !== 'string' || !identificador.trim()) {
            return res.status(400).json({
              error: 'IDENTIFICADOR_OBRIGATORIO',
              message: 'Identificador / Usuário de login é obrigatório para o perfil Síndico.',
            });
          }
          cleanIdentificador = identificador.trim();

          const identJaExiste = await supabaseStore.findCredencialByIdentificador(cleanIdentificador);
          if (identJaExiste) {
            return res.status(409).json({
              error: 'IDENTIFICADOR_JA_EXISTE',
              message: 'O identificador informado já está em uso.',
            });
          }

          if (!senhaInicial || typeof senhaInicial !== 'string') {
            return res.status(400).json({
              error: 'SENHA_OBRIGATORIA',
              message: 'A senha inicial é obrigatória para o perfil Síndico.',
            });
          }

          const valSenha = validatePasswordFormat(senhaInicial);
          if (!valSenha.valid) {
            return res.status(400).json({
              error: 'SENHA_INVALIDA',
              message: valSenha.error || 'A senha deve possuir no mínimo 8 caracteres.',
            });
          }

          senhaHash = await hashPassword(senhaInicial);
        }

        const result = await supabaseStore.createUsuario(
          {
            nome: nome.trim(),
            cargo: cargo?.trim() || (role === UserRole.SINDICO ? 'Síndico' : 'Porteiro'),
            role,
            matricula,
            tipoTurno,
            opcaoTurno12x36,
            paridade12x36,
            horaInicio,
            horaFim,
            condominioId,
          },
          { id: adminId, nome: adminNome }
        );

        if (!result.success || !result.usuario) {
          return res.status(result.status || 500).json({
            error: result.error || 'Erro ao criar usuário.',
          });
        }

        // Criar credencial em credenciais_acesso caso perfil seja SINDICO
        let credencialSanitizada = undefined;
        if (role === UserRole.SINDICO && cleanIdentificador && senhaHash) {
          const novaCred = await supabaseStore.createCredencial({
            usuarioId: result.usuario.id,
            condominioId: result.usuario.condominioId || condominioId,
            tipoAcesso: TipoAcesso.SINDICO,
            identificador: cleanIdentificador,
            senhaHash,
            ativo: true,
          });

          await supabaseStore.logAuditoria({
            condominioId: result.usuario.condominioId || condominioId,
            acao: 'CRIACAO_CREDENCIAL_SINDICO',
            usuarioId: adminId,
            usuarioNome: adminNome,
            detalhes: `Credencial de Síndico criada com identificador "${cleanIdentificador}" para o usuário ${result.usuario.nome}.`,
          });

          credencialSanitizada = supabaseStore.sanitizeCredencial(novaCred);
        }

        return res.status(result.status || 201).json({
          success: true,
          usuario: result.usuario,
          ...(credencialSanitizada ? { credencial: credencialSanitizada } : {}),
        });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao criar usuário no Supabase.');
      }
    }
  );

  // ==========================================
  // 16. EDITAR USUÁRIO (SUPABASE)
  // ==========================================
  app.put(
    '/api/usuarios/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
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
        ativo,
      } = req.body;

      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

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
            condominioId,
          },
          { id: adminId, nome: adminNome }
        );

        return res.status(result.status).json(
          result.success ? { success: true, usuario: result.usuario } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao editar usuário no Supabase.');
      }
    }
  );

  // ==========================================
  // 17. ATIVAR / DESATIVAR USUÁRIO (SUPABASE)
  // ==========================================
  app.patch(
    '/api/usuarios/:id/status',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo } = req.body;

      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

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
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao alterar status do usuário no Supabase.');
      }
    }
  );

  // ==========================================
  // 18. EXCLUIR USUÁRIO (SUPABASE)
  // ==========================================
  app.delete(
    '/api/usuarios/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

      try {
        const result = await supabaseStore.deleteUsuario(id, condominioId, { id: adminId, nome: adminNome });
        return res.status(result.status).json(
          result.success
            ? {
                success: true,
                message: result.message,
                modo: result.modo,
                usuario: result.usuario,
              }
            : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao excluir usuário no Supabase.');
      }
    }
  );

  // ==========================================
  // 19. SINCRONIZAÇÃO E RESTAURAÇÃO DE USUÁRIOS (SUPABASE)
  // ==========================================
  app.post('/api/usuarios/sync-restore', async (req, res) => {
    const { condominioId = 'condo-1', usuarios = [] } = req.body;
    if (!Array.isArray(usuarios)) {
      return res.status(400).json({ error: 'Lista de usuários inválida.' });
    }

    try {
      const existing = await supabaseStore.listUsuarios(condominioId, true);
      let adicionados = 0;

      for (const u of usuarios) {
        if (!u || !u.nome) continue;
        const exists = existing.find(
          (ex) =>
            ex.id === u.id || ex.nome.trim().toLowerCase() === u.nome.trim().toLowerCase()
        );
        if (!exists) {
          await supabaseStore.createUsuario(
            {
              ...u,
              condominioId,
            },
            { id: 'usr-admin', nome: 'Sincronizador Automático' }
          );
          adicionados++;
        }
      }

      const list = await supabaseStore.listUsuarios(condominioId, false);
      return res.json({ success: true, adicionados, usuarios: list });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao sincronizar usuários no Supabase.');
    }
  });

  // ==========================================
  // 19.1 GESTÃO DE CREDENCIAIS DE ACESSO (EXCLUSIVO ADMIN)
  // ==========================================

  // 1. Listar credenciais sanitizadas do condomínio
  app.get(
    '/api/credenciais',
    requireAuth,
    requireRole([UserRole.ADMIN]),
    async (req, res) => {
      const condominioId = req.user!.condominioId;
      try {
        const credenciais = await supabaseStore.listCredenciaisSanitizadas(condominioId);
        return res.json({ success: true, credenciais });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao listar credenciais de acesso.');
      }
    }
  );

  // 2. Criar credencial para usuário
  app.post(
    '/api/credenciais',
    requireAuth,
    requireRole([UserRole.ADMIN]),
    async (req, res) => {
      const condominioId = req.user!.condominioId;
      const { usuarioId, identificador, senha, pin } = req.body;

      if (!usuarioId) {
        return res.status(400).json({ error: 'USUARIO_ID_OBRIGATORIO', message: 'O ID do usuário é obrigatório.' });
      }

      try {
        // Obter cadastro oficial do usuário do banco (anti-spoofing)
        const usuario = await supabaseStore.getUsuario(usuarioId, condominioId);
        if (!usuario || usuario.excluido) {
          return res.status(404).json({ error: 'USUARIO_NAO_ENCONTRADO', message: 'Usuário não encontrado no condomínio.' });
        }
        if (!usuario.ativo) {
          return res.status(400).json({ error: 'USUARIO_INATIVO', message: 'Não é possível criar credencial para usuário inativo.' });
        }

        if (usuario.role === UserRole.PORTEIRO) {
          return res.status(400).json({
            error: 'OPERACAO_INVALIDA',
            message: 'Operadores de portaria utilizam o Código de Acesso da Portaria compartilhado da estação. Não é permitida a criação de credenciais individuais para porteiros.',
          });
        }

        // Verificar duplicidade de credencial para o usuário
        const existingCreds = await supabaseStore.findCredenciaisByUsuarioId(usuarioId);
        if (existingCreds.length > 0) {
          return res.status(409).json({
            error: 'CREDENCIAL_JA_EXISTE',
            message: 'Este usuário já possui credencial de acesso configurada. Utilize a redefinição de acesso.',
          });
        }

        // Determinar tipo de acesso a partir da role oficial do banco
        let tipoAcesso: TipoAcesso;
        if (usuario.role === UserRole.ADMIN) {
          tipoAcesso = TipoAcesso.ADMIN;
        } else if (usuario.role === UserRole.SINDICO) {
          tipoAcesso = TipoAcesso.SINDICO;
        } else {
          tipoAcesso = TipoAcesso.PORTARIA;
        }

        let senhaHash: string | null = null;
        let pinHash: string | null = null;
        let idLogin = (identificador || '').trim();

        if (!idLogin) {
          return res.status(400).json({
            error: 'IDENTIFICADOR_OBRIGATORIO',
            message: 'O identificador (login) é obrigatório para administradores e síndicos.',
          });
        }

        // Verificar duplicidade do identificador
        const idDuplicado = await supabaseStore.findCredencialByIdentificador(idLogin);
        if (idDuplicado) {
          return res.status(409).json({
            error: 'IDENTIFICADOR_JA_EXISTE',
            message: `O identificador "${idLogin}" já está em uso por outra credencial.`,
          });
        }

        // Validar senha
        const passValidation = validatePasswordFormat(senha);
        if (!passValidation.valid) {
          return res.status(400).json({
            error: 'SENHA_INVALIDA',
            message: passValidation.error,
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
          ativo: true,
        });

        await supabaseStore.logAuditoria({
          condominioId,
          acao: 'CRIACAO_CREDENCIAL',
          usuarioId: req.user!.usuarioId,
          usuarioNome: req.user!.nome,
          detalhes: `Credencial criada para ${usuario.nome} (${tipoAcesso}).`,
          dadosNovos: { credencialId: novaCredencial.id, usuarioId: usuario.id, tipoAcesso, identificador: idLogin },
        });

        // Retornar sanitizado (sem hashes)
        const sanitizada = supabaseStore.sanitizeCredencial(novaCredencial);
        return res.status(201).json({ success: true, credencial: sanitizada });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao criar credencial de acesso.');
      }
    }
  );

  // 3. Redefinir / Alterar senha (ADMIN / SÍNDICO)
  app.put(
    '/api/credenciais/:id/senha',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const { senha, senhaAtual, identificador } = req.body;
      const usuarioIdAuth = req.user!.usuarioId;
      const roleAuth = req.user!.role;
      const condominioIdAuth = req.user!.condominioId;

      try {
        let cred: any = null;
        if (id === 'me') {
          const creds = await supabaseStore.findCredenciaisByUsuarioId(usuarioIdAuth);
          cred = creds && creds.length > 0 ? creds[0] : null;
        } else {
          cred = await supabaseStore.findCredencialById(id);
        }

        if (!cred) {
          return res.status(404).json({ error: 'CREDENCIAL_NAO_ENCONTRADA', message: 'Credencial não encontrada.' });
        }

        // REGRA DE SEGURANÇA: SÍNDICO só pode alterar sua própria credencial!
        if (roleAuth === UserRole.SINDICO && cred.usuarioId !== usuarioIdAuth) {
          return res.status(403).json({
            error: 'ACESSO_NEGADO',
            message: 'Acesso negado: Você só possui autorização para alterar sua própria senha.',
          });
        }

        if (cred.tipoAcesso === TipoAcesso.PORTARIA) {
          return res.status(400).json({
            error: 'TIPO_ACESSO_INVALIDO',
            message: 'Operadores de portaria utilizam autenticação por PIN, não por senha.',
          });
        }

        // Validação da senha atual se for o próprio Síndico ou se senhaAtual foi informada
        if (roleAuth === UserRole.SINDICO || (id === 'me' && senhaAtual)) {
          if (!senhaAtual || typeof senhaAtual !== 'string') {
            return res.status(400).json({
              error: 'SENHA_ATUAL_OBRIGATORIA',
              message: 'A senha atual é obrigatória.',
            });
          }
          if (!cred.senhaHash) {
            return res.status(400).json({
              error: 'CREDENCIAL_SEM_SENHA',
              message: 'Credencial não possui senha configurada.',
            });
          }
          const senhaAtualValida = await verifyPassword(senhaAtual, cred.senhaHash);
          if (!senhaAtualValida) {
            return res.status(400).json({
              error: 'SENHA_ATUAL_INCORRETA',
              message: 'A senha atual informada está incorreta.',
            });
          }
        }

        const passValidation = validatePasswordFormat(senha);
        if (!passValidation.valid) {
          return res.status(400).json({
            error: 'SENHA_INVALIDA',
            message: passValidation.error || 'A nova senha deve possuir no mínimo 8 caracteres.',
          });
        }

        const updates: any = {};
        updates.senhaHash = await hashPassword(senha);

        // Apenas ADMIN pode alterar identificador da credencial
        if (roleAuth === UserRole.ADMIN && identificador && identificador.trim() !== cred.identificador) {
          const novoId = identificador.trim();
          const idDuplicado = await supabaseStore.findCredencialByIdentificador(novoId);
          if (idDuplicado && idDuplicado.id !== cred.id) {
            return res.status(409).json({
              error: 'IDENTIFICADOR_JA_EXISTE',
              message: `O identificador "${novoId}" já está em uso.`,
            });
          }
          updates.identificador = novoId;
        }

        const updated = await supabaseStore.updateCredencial(cred.id, updates);

        await supabaseStore.logAuditoria({
          condominioId: cred.condominioId || condominioIdAuth,
          acao: 'ALTERACAO_SENHA',
          usuarioId: req.user!.usuarioId,
          usuarioNome: req.user!.nome,
          detalhes: `Senha alterada para credencial ${cred.identificador}.`,
        });

        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({
          success: true,
          message: 'Senha alterada com sucesso.',
          credencial: sanitizada,
        });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao redefinir senha da credencial.');
      }
    }
  );

  // 4. Redefinir PIN (PORTARIA)
  app.put(
    '/api/credenciais/:id/pin',
    requireAuth,
    requireRole([UserRole.ADMIN]),
    async (req, res) => {
      const condominioId = req.user!.condominioId;
      const { id } = req.params;
      const { pin } = req.body;

      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || 'condo-1') !== condominioId) {
          return res.status(404).json({ error: 'CREDENCIAL_NAO_ENCONTRADA', message: 'Credencial não encontrada.' });
        }

        if (cred.tipoAcesso !== TipoAcesso.PORTARIA) {
          return res.status(400).json({
            error: 'TIPO_ACESSO_INVALIDO',
            message: 'Apenas operadores de portaria utilizam autenticação por PIN.',
          });
        }

        const pinValidation = validatePinFormat(pin);
        if (!pinValidation.valid) {
          return res.status(400).json({
            error: 'PIN_INVALIDO',
            message: pinValidation.error,
          });
        }

        const pinHash = await hashPin(pin);
        const updated = await supabaseStore.updateCredencial(id, { pinHash });

        await supabaseStore.logAuditoria({
          condominioId,
          acao: 'REDEFINICAO_PIN',
          usuarioId: req.user!.usuarioId,
          usuarioNome: req.user!.nome,
          detalhes: `PIN redefinido para credencial do usuário ID ${cred.usuarioId}.`,
        });

        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({ success: true, credencial: sanitizada });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao redefinir PIN da credencial.');
      }
    }
  );

  // 5. Atualizar status da credencial (ativar/desativar ou desbloquear)
  app.patch(
    '/api/credenciais/:id/status',
    requireAuth,
    requireRole([UserRole.ADMIN]),
    async (req, res) => {
      const condominioId = req.user!.condominioId;
      const { id } = req.params;
      const { ativo, desbloquear } = req.body;

      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || 'condo-1') !== condominioId) {
          return res.status(404).json({ error: 'CREDENCIAL_NAO_ENCONTRADA', message: 'Credencial não encontrada.' });
        }

        // Regra de Proteção: Não permitir auto-desativação da credencial do administrador em uso
        if (cred.usuarioId === req.user!.usuarioId && ativo === false) {
          return res.status(400).json({
            error: 'OPERACAO_INVALIDA',
            message: 'Não é permitido desativar a própria credencial de administrador em uso na sessão.',
          });
        }

        const updates: any = {};
        if (typeof ativo === 'boolean') {
          updates.ativo = ativo;
        }
        if (desbloquear === true) {
          updates.bloqueado = false;
          updates.tentativasInvalidas = 0;
        }

        const updated = await supabaseStore.updateCredencial(id, updates);

        await supabaseStore.logAuditoria({
          condominioId,
          acao: 'STATUS_CREDENCIAL',
          usuarioId: req.user!.usuarioId,
          usuarioNome: req.user!.nome,
          detalhes: `Credencial ${cred.identificador}: ${ativo !== undefined ? (ativo ? 'ativada' : 'desativada') : ''} ${desbloquear ? 'desbloqueada' : ''}.`,
          dadosNovos: { id, ativo: updated.ativo, bloqueado: updated.bloqueado },
        });

        const sanitizada = supabaseStore.sanitizeCredencial(updated);
        return res.json({ success: true, credencial: sanitizada });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao alterar status da credencial.');
      }
    }
  );

  // 6. Excluir credencial de acesso
  app.delete(
    '/api/credenciais/:id',
    requireAuth,
    requireRole([UserRole.ADMIN]),
    async (req, res) => {
      const condominioId = req.user!.condominioId;
      const { id } = req.params;

      try {
        const cred = await supabaseStore.findCredencialById(id);
        if (!cred || (cred.condominioId || 'condo-1') !== condominioId) {
          return res.status(404).json({ error: 'CREDENCIAL_NAO_ENCONTRADA', message: 'Credencial não encontrada.' });
        }

        // Regra de Proteção: Não permitir auto-exclusão da credencial do administrador em uso
        if (cred.usuarioId === req.user!.usuarioId) {
          return res.status(400).json({
            error: 'OPERACAO_INVALIDA',
            message: 'Não é permitido excluir a própria credencial de administrador em uso na sessão.',
          });
        }

        const result = await supabaseStore.deleteCredencial(id, condominioId);

        await supabaseStore.logAuditoria({
          condominioId,
          acao: 'EXCLUSAO_CREDENCIAL',
          usuarioId: req.user!.usuarioId,
          usuarioNome: req.user!.nome,
          detalhes: `Credencial ${cred.identificador} (Usuário ID ${cred.usuarioId}) removida.`,
        });

        return res.json({ success: true, removido: result.removido });
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao excluir credencial de acesso.');
      }
    }
  );

  // ==========================================
  // 20. ATUALIZAR CONDOMÍNIO (SUPABASE)
  // ==========================================
  app.put(
    '/api/condominios/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const { nome, endereco, mostrarMensagem } = req.body;

      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

      let nomeFinal = nome?.trim();
      let enderecoFinal = endereco !== undefined ? endereco?.trim() : undefined;

      if (!nomeFinal) {
        try {
          const currentStatus = await supabaseStore.getStatus(id);
          const currentCondo = currentStatus.condominio || currentStatus.condominios?.find((c) => c.id === id);
          if (!currentCondo) {
            return res.status(404).json({ error: 'Condomínio não encontrado.' });
          }
          nomeFinal = currentCondo.nome;
          if (enderecoFinal === undefined) {
            enderecoFinal = currentCondo.endereco;
          }
        } catch (err) {
          return res.status(400).json({ error: 'O nome do condomínio é obrigatório.' });
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
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao atualizar condomínio no Supabase.');
      }
    }
  );

  // ==========================================
  // 21. CONTATOS (CRUD NO SUPABASE)
  // ==========================================
  app.get('/api/contatos', async (req, res) => {
    const condominioId = (req.query.condominioId as string) || 'condo-1';

    try {
      const contatos = await supabaseStore.listContatos(condominioId);
      return res.json({ contatos });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao listar contatos no Supabase.');
    }
  });

  app.post(
    '/api/contatos',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const {
        nome,
        categoria = CategoriaContato.PORTARIA,
        telefoneOuWhatsapp,
        identificador,
      } = req.body;

      if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'Nome do contato é obrigatório.' });
      }
      if (!telefoneOuWhatsapp || !telefoneOuWhatsapp.trim()) {
        return res.status(400).json({ error: 'Telefone / WhatsApp é obrigatório.' });
      }

      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

      try {
        const result = await supabaseStore.createContato(
          {
            nome,
            categoria,
            telefoneOuWhatsapp,
            identificador,
            condominioId,
          },
          { id: adminId, nome: adminNome }
        );

        return res.status(result.status).json(
          result.success ? { success: true, contato: result.contato } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao criar contato no Supabase.');
      }
    }
  );

  app.put(
    '/api/contatos/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const {
        nome,
        categoria,
        telefoneOuWhatsapp,
        identificador,
        ativo,
      } = req.body;

      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

      try {
        const result = await supabaseStore.updateContato(
          id,
          {
            nome,
            categoria,
            telefoneOuWhatsapp,
            identificador,
            ativo,
            condominioId,
          },
          { id: adminId, nome: adminNome }
        );

        return res.status(result.status).json(
          result.success ? { success: true, contato: result.contato } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao atualizar contato no Supabase.');
      }
    }
  );

  app.patch(
    '/api/contatos/:id/status',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const { ativo } = req.body;

      const condominioId = req.user!.condominioId;
      const adminId = req.user!.usuarioId;
      const adminNome = req.user!.nome;

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
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao alterar status do contato no Supabase.');
      }
    }
  );

  app.delete(
    '/api/contatos/:id',
    requireAuth,
    requireRole([UserRole.ADMIN, UserRole.SINDICO]),
    async (req, res) => {
      const { id } = req.params;
      const condominioId = req.user!.condominioId;

      try {
        const result = await supabaseStore.deleteContato(id, condominioId);
        return res.status(result.status).json(
          result.success ? { success: true, removido: result.removido } : { error: result.error }
        );
      } catch (err: any) {
        return handleStorageError(res, err, 'Erro ao excluir contato no Supabase.');
      }
    }
  );

  // ==========================================
  // 22. HISTÓRICO DE UM PRISMA (SUPABASE)
  // ==========================================
  app.get('/api/prismas/:id/historico', async (req, res) => {
    const { id } = req.params;
    const condominioId = (req.query.condominioId as string) || 'condo-1';

    try {
      const historico = await supabaseStore.getHistoricoPrisma(id, condominioId);
      if (!historico) {
        return res.status(404).json({ error: 'Prisma não encontrado no Supabase.' });
      }

      return res.json(historico);
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao buscar histórico do prisma no Supabase.');
    }
  });

  // ==========================================
  // 23. AUDITORIA COMPLETA (SUPABASE)
  // ==========================================
  app.get('/api/auditoria', async (req, res) => {
    const condominioId = (req.query.condominioId as string) || 'condo-1';
    const limit = parseInt(req.query.limit as string) || 100;

    try {
      const logs = await supabaseStore.listAuditoria(condominioId, limit);
      return res.json({ logs });
    } catch (err: any) {
      return handleStorageError(res, err, 'Erro ao consultar logs de auditoria no Supabase.');
    }
  });

  return app;
}

export const app = createExpressApp();
export default app;

async function startServer() {
  const PORT = 3000;

  // Em ambiente Vercel Serverless, o servidor é invocado sob demanda e não utiliza app.listen
  if (process.env.VERCEL === '1' || process.env.NOW_REGION) {
    return;
  }

  // ==========================================
  // VITE & FRONTEND SERVING (STANDALONE / DEV)
  // ==========================================
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Controle de Prismas rodando em http://localhost:${PORT}`);
  });
}

// Iniciar servidor autônomo apenas quando executado diretamente como processo principal (dev/container)
const isMainProcess = typeof process !== 'undefined' && process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.cjs') ||
  process.argv[1].endsWith('server.js')
);

if (isMainProcess && process.env.VERCEL !== '1' && !process.env.NOW_REGION) {
  startServer().catch((err) => {
    console.error('Falha fatal ao iniciar o servidor:', err);
  });
}
