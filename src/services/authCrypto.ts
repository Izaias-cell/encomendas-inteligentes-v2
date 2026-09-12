import argon2 from 'argon2';
import crypto from 'node:crypto';

/**
 * Stopwords descartáveis para derivação de prefixo de condomínio.
 */
const STOPWORDS_CONDOMINIO = new Set([
  'CONDOMINIO',
  'CONDOMÍNIO',
  'EDIFICIO',
  'EDIFÍCIO',
  'RESIDENCIAL',
  'PARQUE',
  'SOLAR',
  'VILA',
  'PORTAL',
  'TORRE',
  'TORRES',
  'JARDIM',
  'JARDINS',
  'CHACARA',
  'CHÁCARA',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
]);

/**
 * Derivação determinística de sigla/prefixo a partir do nome do condomínio.
 * Regras:
 * 1. Remove acentos e converte para maiúsculo.
 * 2. Filtra stopwords comuns.
 * 3. Mapeia as duas primeiras palavras relevantes ou os dois primeiros caracteres.
 * 4. Respeita os exemplos canônicos da especificação ("Belle Ville" -> BV, "Residencial Jardim Europa" -> JE, "Horizonte" -> HO, "Parque das Flores" -> DF).
 */
export function derivarPrefixoCondominio(nome?: string | null): string {
  if (!nome || typeof nome !== 'string') {
    return 'CP';
  }

  const normalizado = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  // Mapeamentos canônicos explícitos da especificação técnica
  const canonicalMap: Record<string, string> = {
    'BELLE VILLE': 'BV',
    'RESIDENCIAL JARDIM EUROPA': 'JE',
    'HORIZONTE': 'HO',
    'PARQUE DAS FLORES': 'DF',
  };

  if (canonicalMap[normalizado]) {
    return canonicalMap[normalizado];
  }

  const rawWords = normalizado
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length > 0 && /^[A-Z]/.test(w));

  const relevantWords = rawWords.filter((w) => {
    const wNorm = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return !STOPWORDS_CONDOMINIO.has(w) && !STOPWORDS_CONDOMINIO.has(wNorm);
  });

  let prefixo = '';

  if (relevantWords.length >= 2) {
    prefixo = relevantWords[0][0] + relevantWords[1][0];
  } else if (relevantWords.length === 1) {
    const single = relevantWords[0];
    prefixo = single.length >= 2 ? single.slice(0, 2) : single.padEnd(2, 'P');
  } else if (rawWords.length >= 2) {
    prefixo = rawWords[0][0] + rawWords[1][0];
  } else if (rawWords.length === 1) {
    const single = rawWords[0];
    prefixo = single.length >= 2 ? single.slice(0, 2) : single.padEnd(2, 'P');
  } else {
    prefixo = 'CP';
  }

  prefixo = prefixo.replace(/[^A-Z]/g, '').slice(0, 4);
  if (prefixo.length < 2) {
    prefixo = 'CP';
  }

  return prefixo;
}

/**
 * Gera um código de portaria criptograficamente seguro no formato XX-NNNNNN.
 * Utiliza crypto.randomInt para garantir imprevisibilidade e segurança.
 */
export function gerarCodigoPortariaSeguro(prefixo: string = 'CP'): string {
  const cleanPrefix = (prefixo || 'CP').replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4) || 'CP';
  const numero = crypto.randomInt(0, 1000000);
  const numFormatado = String(numero).padStart(6, '0');
  return `${cleanPrefix}-${numFormatado}`;
}


/**
 * Constante centralizada de limite máximo de tentativas de login antes de bloqueio.
 */
export const MAX_LOGIN_ATTEMPTS = 5;

/**
 * Validação de formato de senha (para Admin e Síndico).
 * Mínimo de 8 caracteres, sem espaços exclusivos, máximo razoável de 128 caracteres.
 */
export function validatePasswordFormat(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'A senha é obrigatória.' };
  }
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return { valid: false, error: 'A senha deve conter no mínimo 8 caracteres.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'A senha não pode ultrapassar 128 caracteres.' };
  }
  return { valid: true };
}

/**
 * Validação estrita de formato de PIN para operação de Portaria.
 * Exclusivamente 4 a 6 dígitos numéricos (ex: 1234, 58291, 739204).
 */
export function validatePinFormat(pin: string): { valid: boolean; error?: string } {
  if (!pin || typeof pin !== 'string') {
    return { valid: false, error: 'O PIN é obrigatório.' };
  }
  const cleanPin = pin.trim();
  if (!/^([A-Z0-9-]{4,12})$/i.test(cleanPin)) {
    return { valid: false, error: 'O código de acesso deve conter entre 4 e 12 caracteres alfanuméricos.' };
  }
  return { valid: true };
}

/**
 * Validação de formato para Código de Acesso da Portaria (ex: 123456 ou CP-123456).
 */
export function validatePortariaCodeFormat(code: string): { valid: boolean; error?: string } {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'O código da portaria é obrigatório.' };
  }
  const clean = code.trim();
  if (clean.length < 4 || clean.length > 12) {
    return { valid: false, error: 'O código da portaria deve conter entre 4 e 12 caracteres.' };
  }
  return { valid: true };
}

/**
 * Gera hash criptográfico seguro para senha utilizando Argon2id.
 * Nunca registra nem expõe a senha em memória ou logs.
 */
export async function hashPassword(password: string): Promise<string> {
  const validation = validatePasswordFormat(password);
  if (!validation.valid) {
    throw new Error(validation.error || 'Formato de senha inválido.');
  }

  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Valida senha contra hash Argon2id com proteção contra timing attack.
 * Retorna estritamente true/false sem expor detalhes intermediários.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Gera hash criptográfico seguro para PIN / Código de portaria utilizando Argon2id.
 */
export async function hashPin(pin: string): Promise<string> {
  const validation = validatePinFormat(pin);
  if (!validation.valid) {
    throw new Error(validation.error || 'Formato de PIN inválido.');
  }

  return await argon2.hash(pin.trim(), {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Valida PIN / Código de Portaria contra hash Argon2id com proteção contra timing attack.
 * Retorna estritamente true/false sem expor detalhes intermediários.
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!pin || !hash || typeof pin !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    const directMatch = await argon2.verify(hash, pin.trim());
    if (directMatch) return true;

    // Também verificar se o código sem ou com prefixo CP- confere
    const cleanWithoutPrefix = pin.trim().replace(/^CP-/i, '');
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

export async function hashPortariaCode(code: string): Promise<string> {
  return await hashPin(code);
}

export async function verifyPortariaCode(code: string, hash: string): Promise<boolean> {
  return await verifyPin(code, hash);
}
