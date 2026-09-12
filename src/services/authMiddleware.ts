import { Request, Response, NextFunction } from 'express';
import { AuthUserContext, DEFAULT_PORTARIA_STATION_ID, TipoSessao, UserRole } from '../types';
import { SESSION_COOKIE_NAME, verifySessionToken } from './authService';
import { supabaseStore } from './supabaseStore';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserContext;
    }
  }
}

/**
 * Middleware para validar autenticação via Cookie HttpOnly ou Header de Autorização.
 * Valida integridade do JWT, existência do usuário, status ativo/não-excluído e credenciais ativas.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Extração do token (preferência por Cookie HttpOnly)
    let token = req.cookies?.[SESSION_COOKIE_NAME];

    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      res.status(401).json({
        error: 'AUTENTICACAO_OBRIGATORIA',
        message: 'Acesso não autenticado. Faça login para continuar.',
      });
      return;
    }

    // 2. Validação criptográfica do JWT
    const tokenResult = verifySessionToken(token);
    if (!tokenResult.valid || !tokenResult.payload) {
      if (tokenResult.expired) {
        res.status(401).json({
          error: 'SESSAO_EXPIRADA',
          message: 'Sua sessão expirou. Por favor, autentique-se novamente.',
        });
        return;
      }
      res.status(401).json({
        error: 'TOKEN_INVALIDO',
        message: tokenResult.error || 'Token de sessão inválido.',
      });
      return;
    }

    const payload = tokenResult.payload;

    // 3. Suporte a sessão autenticada de Estação de Portaria (PORTARIA por Código)
    if (payload.tipoSessao === TipoSessao.PORTARIA && (payload.sub === 'portaria-station' || payload.sub === 'usr-portaria')) {
      const targetCondoId = payload.condominioId || 'condo-1';

      // 3.1 Validação do condomínio
      const condominios = await supabaseStore.listCondominios();
      const condomínio = condominios.find((c) => c.id === targetCondoId);
      if (!condomínio || condomínio.ativo === false) {
        res.status(401).json({
          error: 'CONDOMINIO_INVALIDO',
          message: 'O condomínio associado a esta estação de portaria está inativo ou não existe.',
        });
        return;
      }

      // 3.2 Validação da credencial da portaria
      const portariaCred = await supabaseStore.findPortariaCredencial(targetCondoId);
      if (portariaCred && portariaCred.ativo === false) {
        res.status(401).json({
          error: 'CREDENCIAL_INATIVA',
          message: 'O acesso da portaria deste condomínio foi revogado ou inativado.',
        });
        return;
      }

      if (portariaCred && portariaCred.bloqueado) {
        res.status(403).json({
          error: 'CREDENCIAL_BLOQUEADA',
          message: 'O acesso da portaria deste condomínio está temporariamente bloqueado.',
        });
        return;
      }

      req.user = {
        usuarioId: payload.sub,
        condominioId: targetCondoId,
        role: UserRole.PORTEIRO,
        nome: payload.nome || 'Portaria Principal',
        tipoSessao: TipoSessao.PORTARIA,
        stationId: payload.stationId || DEFAULT_PORTARIA_STATION_ID,
      };
      return next();
    }

    // 4. Validação do usuário na base de dados (Revogação / Inativação em tempo real para Admin / Síndico / Porteiros individuais)
    const usuarios = await supabaseStore.listUsuarios(payload.condominioId || 'condo-1');
    const usuario = usuarios.find((u) => u.id === payload.sub);

    if (!usuario) {
      res.status(401).json({
        error: 'USUARIO_NAO_ENCONTRADO',
        message: 'O usuário associado a esta sessão não foi encontrado.',
      });
      return;
    }

    if (usuario.excluido) {
      res.status(403).json({
        error: 'USUARIO_ARQUIVADO',
        message: 'O cadastro deste usuário foi arquivado.',
      });
      return;
    }

    if (usuario.ativo === false) {
      res.status(403).json({
        error: 'USUARIO_INATIVO',
        message: 'O acesso deste usuário está temporariamente inativo.',
      });
      return;
    }

    // 5. Validação de bloqueio de credencial (se houver)
    const credenciais = await supabaseStore.findCredenciaisByUsuarioId(usuario.id);
    const credBloqueada = credenciais.find((c) => c.ativo && c.bloqueado);
    if (credBloqueada) {
      res.status(403).json({
        error: 'CREDENCIAL_BLOQUEADA',
        message: 'A credencial de acesso está bloqueada por excesso de tentativas ou intervenção administrativa.',
      });
      return;
    }

    // 6. Injeção do contexto seguro req.user
    req.user = {
      usuarioId: usuario.id,
      condominioId: payload.condominioId || usuario.condominioId || 'condo-1',
      role: usuario.role,
      nome: usuario.nome,
      tipoSessao: payload.tipoSessao || (usuario.role === UserRole.PORTEIRO ? TipoSessao.PORTARIA : TipoSessao.ADMIN),
      stationId: payload.stationId,
    };

    next();
  } catch (err: any) {
    res.status(500).json({
      error: 'ERRO_MIDDLEWARE_AUTH',
      message: err?.message || 'Falha interna na verificação de autenticação.',
    });
  }
}

/**
 * Middleware RBAC para validar papéis autorizados (Role Based Access Control).
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'AUTENTICACAO_OBRIGATORIA',
        message: 'Sessão autenticada necessária.',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'ACESSO_NEGADO',
        message: 'Você não possui autorização funcional para acessar este recurso.',
        rolesPermitidas: allowedRoles,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware específico para operações de Portaria (Entrega, Recolhimento, Pendências).
 * Valida autenticação, aceita sessões de terminal de Portaria (PORTARIA) ou administradores/supervisores operando o sistema.
 */
export function requirePortaria(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'AUTENTICACAO_OBRIGATORIA',
      message: 'Sessão autenticada necessária.',
    });
    return;
  }

  const isSessaoPortaria = req.user.tipoSessao === TipoSessao.PORTARIA;
  const isPapelOperacional = [
    UserRole.PORTEIRO,
    UserRole.ADMIN,
    UserRole.SINDICO,
  ].includes(req.user.role);

  if (!isSessaoPortaria && !isPapelOperacional) {
    res.status(403).json({
      error: 'SESSAO_PORTARIA_REQUERIDA',
      message: 'Esta operação deve ser executada exclusivamente por operadores de portaria ou administração autenticados.',
    });
    return;
  }

  if (!req.user.stationId) {
    req.user.stationId = DEFAULT_PORTARIA_STATION_ID;
  }

  next();
}

/**
 * Middleware de autenticação opcional (para rotas híbridas ou transição suave).
 * Preenche req.user se houver token válido, sem bloquear a requisição se ausente.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    let token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (token) {
      const tokenResult = verifySessionToken(token);
      if (tokenResult.valid && tokenResult.payload) {
        const payload = tokenResult.payload;
        if (payload.tipoSessao === TipoSessao.PORTARIA && (payload.sub === 'portaria-station' || payload.sub === 'usr-portaria')) {
          req.user = {
            usuarioId: payload.sub,
            condominioId: payload.condominioId || 'condo-1',
            role: UserRole.PORTEIRO,
            nome: payload.nome || 'Portaria',
            tipoSessao: TipoSessao.PORTARIA,
            stationId: payload.stationId || DEFAULT_PORTARIA_STATION_ID,
          };
        } else {
          const usuarios = await supabaseStore.listUsuarios(payload.condominioId || 'condo-1');
          const usuario = usuarios.find((u) => u.id === payload.sub);
          if (usuario && !usuario.excluido && usuario.ativo !== false) {
            req.user = {
              usuarioId: usuario.id,
              condominioId: payload.condominioId || usuario.condominioId || 'condo-1',
              role: usuario.role,
              nome: usuario.nome,
              tipoSessao: payload.tipoSessao,
              stationId: payload.stationId,
            };
          }
        }
      }
    }
  } catch {
    // Falhas em optionalAuth são silenciosas para não interromper rotas públicas
  }
  next();
}
