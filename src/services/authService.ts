import jwt from 'jsonwebtoken';
import { CookieOptions } from 'express';
import { JwtSessionPayload, TipoSessao, UserRole } from '../types';

export const SESSION_COOKIE_NAME = 'session_token';

// Durações padrão de sessão
export const PORTARIA_SESSION_EXPIRY = '7d';
export const PORTARIA_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export const ADMIN_SESSION_EXPIRY = '8h';
export const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 horas

/**
 * Obtém a chave secreta JWT_SECRET do ambiente de forma segura e determinística.
 * Em ambiente de produção (NODE_ENV === 'production' ou VERCEL), a variável JWT_SECRET é ESTRITAMENTE OBRIGATÓRIA.
 * Nunca expõe o valor da chave em logs ou erros.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

  if (isProduction) {
    if (!secret || secret.trim() === '') {
      throw new Error(
        'CONFIGURACAO_CRITICA_AUSENTE: A variável de ambiente JWT_SECRET é obrigatória em ambiente de produção para garantir a segurança da assinatura dos tokens de sessão.'
      );
    }
    return secret.trim();
  }

  // Em ambiente de desenvolvimento local controlado:
  if (secret && secret.trim() !== '') {
    return secret.trim();
  }

  return 'control-prisma-jwt-local-dev-fallback-key-2026';
}

/**
 * Verifica se a camada de autenticação está devidamente configurada.
 */
export function isAuthConfigured(): boolean {
  try {
    getJwtSecret();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gera um token JWT assinado para a sessão.
 * Nunca inclui senhas, PINs ou hashes no payload.
 */
export function generateSessionToken(
  data: {
    usuarioId: string;
    condominioId: string;
    role: UserRole;
    tipoSessao: TipoSessao;
    nome: string;
    stationId?: string;
  },
  customExpiry?: string | number
): string {
  const secret = getJwtSecret();
  const expiresIn = customExpiry || (data.tipoSessao === TipoSessao.PORTARIA ? PORTARIA_SESSION_EXPIRY : ADMIN_SESSION_EXPIRY);

  const payload: Omit<JwtSessionPayload, 'iat' | 'exp'> = {
    sub: data.usuarioId,
    condominioId: data.condominioId,
    role: data.role,
    tipoSessao: data.tipoSessao,
    nome: data.nome,
    ...(data.stationId ? { stationId: data.stationId } : {}),
  };

  return jwt.sign(payload, secret, {
    expiresIn: expiresIn as any,
    algorithm: 'HS256',
  });
}

/**
 * Valida a assinatura e a expiração do token JWT.
 * Retorna o payload decodificado ou descrição segura do erro.
 */
export function verifySessionToken(token: string): {
  valid: boolean;
  payload?: JwtSessionPayload;
  expired?: boolean;
  error?: string;
} {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'TOKEN_AUSENTE: Token não fornecido.' };
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtSessionPayload;
    return {
      valid: true,
      payload: decoded,
    };
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, expired: true, error: 'TOKEN_EXPIRADO: A sessão expirou.' };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return { valid: false, error: 'TOKEN_INVALIDO: Assinatura ou formato de token inválido.' };
    }
    return { valid: false, error: 'TOKEN_ERRO: Falha ao validar token.' };
  }
}

/**
 * Decodifica o token sem validar a assinatura (para inspeção segura de metadados se necessário).
 */
export function decodeSessionToken(token: string): JwtSessionPayload | null {
  try {
    return jwt.decode(token) as JwtSessionPayload | null;
  } catch {
    return null;
  }
}

/**
 * Retorna as opções de configuração do Cookie HttpOnly para o tipo de sessão.
 */
export function getSessionCookieOptions(tipoSessao: TipoSessao): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = tipoSessao === TipoSessao.PORTARIA ? PORTARIA_SESSION_MAX_AGE_MS : ADMIN_SESSION_MAX_AGE_MS;

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: maxAge,
    path: '/',
  };
}

/**
 * Retorna as opções para remoção segura do cookie de sessão no logout.
 */
export function getClearCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  };
}
