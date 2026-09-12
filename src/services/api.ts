import {
  Prisma,
  Movimentacao,
  AuditoriaLog,
  Turno,
  Usuario,
  UserRole,
  TipoTurno,
  CategoriaContato,
  ContatoEvidencia,
  Condominio,
  DashboardStats,
  Paridade12x36,
  AuthUserContext,
  TipoSessao,
  CredencialAcessoSanitizada,
  PlantaoStatusResponse,
  SubstituicaoPlantao,
  PortariaStatusResponse,
} from '../types';

export interface DashboardResponse {
  condominio: Condominio;
  condominios: Condominio[];
  usuarios: Usuario[];
  turnoAtivo?: Turno;
  stats: DashboardStats;
  prismas: Prisma[];
  ultimasMovimentacoes: Movimentacao[];
  rankingCasas?: string[];
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: AuthUserContext;
}

export interface AuthLoginResponse {
  success: boolean;
  user: {
    id: string;
    nome: string;
    role: UserRole;
    tipoSessao: TipoSessao;
    condominioId: string;
  };
  token?: string;
}

export interface AuthPortariaResponse {
  success: boolean;
  user: {
    id: string;
    nome: string;
    role: UserRole;
    tipoSessao: TipoSessao;
    stationId: string;
    condominioId: string;
  };
  token?: string;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Chaves de armazenamento da estação autorizada de portaria
export const STATION_AUTH_STORAGE_KEY = 'control_prisma_station_token';
export const STATION_SESSION_STORAGE_KEY = 'control_prisma_station_session';

function getStoredAuthToken(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(STATION_AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignorar falhas de acesso a localStorage
  }
  return null;
}

// In-memory session token storage com restauração automática de token persistido
let inMemoryAuthToken: string | null = getStoredAuthToken();

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        window.localStorage.setItem(STATION_AUTH_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(STATION_AUTH_STORAGE_KEY);
        window.localStorage.removeItem(STATION_SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // Ignorar falhas de storage
  }
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken || getStoredAuthToken();
}

export function getStoredStationSession(): AuthUserContext | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STATION_SESSION_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as AuthUserContext;
      }
    }
  } catch {
    // Ignorar falhas de parse/storage
  }
  return null;
}

export function setStoredStationSession(session: AuthUserContext | null) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (session) {
        window.localStorage.setItem(STATION_SESSION_STORAGE_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(STATION_SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // Ignorar falhas de storage
  }
}

// Global callback for 401 Unauthorized handling
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(url: string, options?: RequestInit, retries = 4): Promise<T> {
  const isGet = !options?.method || options.method === 'GET';
  const customHeaders = (options?.headers as Record<string, string>) || {};
  const currentToken = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    ...customHeaders,
  };

  try {
    const res = await fetch(url, {
      ...options,
      credentials: 'same-origin', // Ensure HttpOnly cookies are automatically sent
      headers,
    });

    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { error: res.statusText };
      }

      // If 401 Unauthorized occurs on protected API calls (not during login/portaria-assumir attempts)
      if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/portaria-assumir')) {
        if (unauthorizedHandler) {
          unauthorizedHandler();
        }
      }

      // If server is returning temporary 502, 503, 504 or 500 on GET, retry before giving up
      if (isGet && retries > 0 && (res.status >= 500 || res.status === 408)) {
        await new Promise((r) => setTimeout(r, (5 - retries) * 500));
        return request<T>(url, options, retries - 1);
      }

      const errorMessage =
        (typeof errBody?.message === 'string' && errBody.message) ||
        (typeof errBody?.error === 'string' && errBody.error) ||
        (typeof errBody?.details === 'string' && errBody.details) ||
        'Erro na requisição';

      throw new ApiError(errorMessage, res.status, errBody);
    }

    return await res.json();
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (retries > 0 && isGet) {
      await new Promise((r) => setTimeout(r, (5 - retries) * 500));
      return request<T>(url, options, retries - 1);
    }
    throw new ApiError(
      '⚠️ Não foi possível conectar ao servidor. Verifique a conexão com a internet.',
      0
    );
  }
}

export const api = {
  // ==========================================
  // AUTENTICAÇÃO JWT E SESSÃO
  // ==========================================
  getAuthMe: (): Promise<AuthMeResponse> => {
    return request<AuthMeResponse>('/api/auth/me');
  },

  loginAdmin: (params: {
    identificador: string;
    senha: string;
    condominioId?: string;
  }): Promise<AuthLoginResponse> => {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  loginPortariaCodigo: (params: {
    codigo: string;
    condominioId?: string;
    stationId?: string;
  }): Promise<AuthPortariaResponse> => {
    return request('/api/auth/portaria-codigo', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  assumirPortariaPin: (params: {
    usuarioId: string;
    pin: string;
    condominioId?: string;
    stationId?: string;
  }): Promise<AuthPortariaResponse> => {
    return request('/api/auth/portaria-assumir', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  logout: (): Promise<{ success: boolean; message: string }> => {
    return request('/api/auth/logout', {
      method: 'POST',
    });
  },

  // ==========================================
  // PLANTÃO E ESCALA AUTOMÁTICA
  // ==========================================
  getPlantaoStatus: (condominioId: string = 'condo-1'): Promise<PlantaoStatusResponse> => {
    return request<PlantaoStatusResponse>(`/api/plantao/status?condominioId=${encodeURIComponent(condominioId)}`);
  },

  substituirPlantao: (params: {
    usuarioId: string;
    motivo?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; message: string; substituicao: SubstituicaoPlantao }> => {
    return request('/api/plantao/substituir', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  restaurarEscalaPlantao: (condominioId: string = 'condo-1'): Promise<{ success: boolean; message: string }> => {
    return request('/api/plantao/restaurar-escala', {
      method: 'POST',
      body: JSON.stringify({ condominioId }),
    });
  },

  atualizarCodigoPortaria: (params: {
    codigo: string;
    condominioId?: string;
  }): Promise<{ success: boolean; message: string }> => {
    return request('/api/condominios/codigo-portaria', {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  getCodigoPortariaStatus: (condominioId: string = 'condo-1'): Promise<PortariaStatusResponse> => {
    return request<PortariaStatusResponse>(`/api/condominios/codigo-portaria?condominioId=${encodeURIComponent(condominioId)}`);
  },

  gerarNovoCodigoPortaria: (condominioId: string = 'condo-1'): Promise<{ success: boolean; codigo: string; status: string; message: string }> => {
    return request('/api/condominios/codigo-portaria/gerar', {
      method: 'POST',
      body: JSON.stringify({ condominioId }),
    });
  },

  desbloquearPortariaCodigo: (condominioId: string = 'condo-1'): Promise<{ success: boolean; message: string }> => {
    return request('/api/condominios/codigo-portaria/desbloquear', {
      method: 'POST',
      body: JSON.stringify({ condominioId }),
    });
  },

  // ==========================================
  // DASHBOARD E OPERAÇÃO
  // ==========================================
  getStatus: (condominioId: string = 'condo-1'): Promise<DashboardResponse> => {
    return request<DashboardResponse>(`/api/status?condominioId=${encodeURIComponent(condominioId)}`);
  },

  getRankingCasas: (condominioId: string = 'condo-1'): Promise<{ success: boolean; ranking: string[] }> => {
    return request(`/api/condominios/${encodeURIComponent(condominioId)}/ranking-casas`);
  },

  entregarPrisma: (params: {
    prismaId: string;
    casa: string;
    fotoEvidenciaUrl?: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma; movimentacao: Movimentacao }> => {
    return request('/api/movimentacoes/entrega', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  receberPrisma: (params: {
    prismaId: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma; movimentacao: Movimentacao }> => {
    return request('/api/movimentacoes/devolucao', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  registrarPendencia: (params: {
    prismaId: string;
    motivo: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma }> => {
    return request('/api/movimentacoes/pendencia', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  resolverPendencia: (params: {
    prismaId: string;
    novoEstado: string;
    justificativa: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma }> => {
    return request('/api/movimentacoes/resolver-pendencia', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  toggleIndisponivel: (params: {
    prismaId: string;
    tornarIndisponivel: boolean;
    motivo?: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma }> => {
    return request('/api/prismas/toggle-indisponivel', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  corrigirMovimentacao: (params: {
    movimentacaoId: string;
    novaCasa: string;
    motivoCorrecao: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; movimentacao: Movimentacao }> => {
    return request('/api/movimentacoes/correcao', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  assumirTurno: (params: {
    nomeTurno?: string;
    notasPassagem?: string;
    porteiroId?: string;
    porteiroNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; turno: Turno; prismasEmUso: number }> => {
    return request('/api/turnos/assumir', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  cadastrarPrisma: (params: {
    numero: string;
    corId: string;
    corNome: string;
    condominioId?: string;
    usuarioId?: string;
    usuarioNome?: string;
  }): Promise<{ success: boolean; prisma: Prisma }> => {
    return request('/api/prismas', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  cadastrarPrismasLote: (params: {
    numeros?: string[];
    numeroInicial?: number;
    quantidade?: number;
    padZero?: boolean;
    corId: string;
    corNome: string;
    condominioId?: string;
    usuarioId?: string;
    usuarioNome?: string;
  }): Promise<{ success: boolean; totalCriados: number; primeiro: string; ultimo: string; prismas?: Prisma[] }> => {
    return request('/api/prismas/lote', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  getTodosPrismas: (condominioId: string = 'condo-1'): Promise<{ prismas: Prisma[] }> => {
    return request(`/api/prismas/todos?condominioId=${encodeURIComponent(condominioId)}`);
  },

  toggleStatusPrisma: (params: {
    prismaId: string;
    ativo: boolean;
    motivoInativacao?: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; prisma: Prisma }> => {
    return request(`/api/prismas/${encodeURIComponent(params.prismaId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },

  excluirPrisma: (params: {
    prismaId: string;
    usuarioId?: string;
    usuarioNome?: string;
    condominioId?: string;
  }): Promise<{ success: boolean; message: string; tipoExclusao: 'LOGICA' | 'FISICA'; prismaId: string }> => {
    return request(`/api/prismas/${encodeURIComponent(params.prismaId)}/excluir`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  getUsuarios: (condominioId: string = 'condo-1'): Promise<{ usuarios: Usuario[] }> => {
    return request(`/api/usuarios?condominioId=${encodeURIComponent(condominioId)}`);
  },

  cadastrarUsuario: (params: {
    nome: string;
    cargo?: string;
    role?: UserRole;
    matricula?: string;
    tipoTurno?: TipoTurno;
    opcaoTurno12x36?: string;
    paridade12x36?: Paridade12x36;
    horaInicio?: string;
    horaFim?: string;
    condominioId?: string;
    adminId?: string;
    adminNome?: string;
    identificador?: string;
    senhaInicial?: string;
  }): Promise<{ success: boolean; usuario: Usuario; credencial?: CredencialAcessoSanitizada }> => {
    return request('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  editarUsuario: (params: {
    id: string;
    nome?: string;
    cargo?: string;
    role?: UserRole;
    matricula?: string;
    tipoTurno?: TipoTurno;
    opcaoTurno12x36?: string;
    paridade12x36?: Paridade12x36;
    horaInicio?: string;
    horaFim?: string;
    ativo?: boolean;
    condominioId?: string;
    adminId?: string;
    adminNome?: string;
  }): Promise<{ success: boolean; usuario: Usuario }> => {
    return request(`/api/usuarios/${encodeURIComponent(params.id)}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  toggleStatusUsuario: (params: {
    id: string;
    ativo: boolean;
    condominioId?: string;
    adminId?: string;
    adminNome?: string;
  }): Promise<{ success: boolean; usuario: Usuario }> => {
    return request(`/api/usuarios/${encodeURIComponent(params.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },

  excluirUsuario: (
    id: string,
    condominioId: string = 'condo-1',
    adminId?: string,
    adminNome?: string
  ): Promise<{ success: boolean; message: string; modo: 'ARQUIVADO' | 'REMOVIDO'; usuario?: Usuario }> => {
    return request(`/api/usuarios/${encodeURIComponent(id)}?condominioId=${encodeURIComponent(condominioId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ adminId, adminNome, condominioId }),
    });
  },

  syncUsuarios: (params: {
    condominioId: string;
    usuarios: Usuario[];
  }): Promise<{ success: boolean; adicionados: number; usuarios: Usuario[] }> => {
    return request('/api/usuarios/sync-restore', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  atualizarCondominio: (
    id: string,
    params: {
      nome?: string;
      endereco?: string;
      mostrarMensagem?: boolean;
      usuarioId?: string;
      usuarioNome?: string;
    }
  ): Promise<{ success: boolean; condominio: Condominio }> => {
    return request(`/api/condominios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  getContatos: (condominioId: string = 'condo-1'): Promise<{ contatos: ContatoEvidencia[] }> => {
    return request(`/api/contatos?condominioId=${encodeURIComponent(condominioId)}`);
  },

  cadastrarContato: (params: {
    nome: string;
    categoria: CategoriaContato;
    telefoneOuWhatsapp: string;
    identificador?: string;
    condominioId?: string;
    usuarioId?: string;
    usuarioNome?: string;
  }): Promise<{ success: boolean; contato: ContatoEvidencia }> => {
    return request('/api/contatos', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  editarContato: (params: {
    id: string;
    nome?: string;
    categoria?: CategoriaContato;
    telefoneOuWhatsapp?: string;
    identificador?: string;
    ativo?: boolean;
    condominioId?: string;
    usuarioId?: string;
    usuarioNome?: string;
  }): Promise<{ success: boolean; contato: ContatoEvidencia }> => {
    return request(`/api/contatos/${encodeURIComponent(params.id)}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  toggleStatusContato: (params: {
    id: string;
    ativo: boolean;
    condominioId?: string;
    usuarioId?: string;
    usuarioNome?: string;
  }): Promise<{ success: boolean; contato: ContatoEvidencia }> => {
    return request(`/api/contatos/${encodeURIComponent(params.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },

  excluirContato: (
    id: string,
    condominioId: string = 'condo-1'
  ): Promise<{ success: boolean; removido: ContatoEvidencia }> => {
    return request(`/api/contatos/${encodeURIComponent(id)}?condominioId=${encodeURIComponent(condominioId)}`, {
      method: 'DELETE',
    });
  },

  getHistoricoPrisma: (
    id: string,
    condominioId: string = 'condo-1'
  ): Promise<{ prisma: Prisma; movimentacoes: Movimentacao[]; auditoria: AuditoriaLog[] }> => {
    return request(`/api/prismas/${encodeURIComponent(id)}/historico?condominioId=${encodeURIComponent(condominioId)}`);
  },

  getAuditoria: (condominioId: string = 'condo-1'): Promise<{ logs: AuditoriaLog[] }> => {
    return request(`/api/auditoria?condominioId=${encodeURIComponent(condominioId)}`);
  },

  // ==========================================
  // GESTÃO DE CREDENCIAIS DE ACESSO (EXCLUSIVO ADMIN)
  // ==========================================
  listCredenciais: (): Promise<{ success: boolean; credenciais: CredencialAcessoSanitizada[] }> => {
    return request('/api/credenciais');
  },

  criarCredencial: (params: {
    usuarioId: string;
    identificador?: string;
    senha?: string;
    pin?: string;
  }): Promise<{ success: boolean; credencial: CredencialAcessoSanitizada }> => {
    return request('/api/credenciais', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  redefinirSenha: (
    id: string,
    params: { senha: string; senhaAtual?: string; identificador?: string }
  ): Promise<{ success: boolean; credencial?: CredencialAcessoSanitizada; message?: string }> => {
    return request(`/api/credenciais/${encodeURIComponent(id)}/senha`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  alterarMinhaSenha: (params: {
    senhaAtual: string;
    novaSenha: string;
  }): Promise<{ success: boolean; message: string; credencial?: CredencialAcessoSanitizada }> => {
    return request('/api/credenciais/me/senha', {
      method: 'PUT',
      body: JSON.stringify({
        senhaAtual: params.senhaAtual,
        senha: params.novaSenha,
      }),
    });
  },

  redefinirPin: (
    id: string,
    params: { pin: string }
  ): Promise<{ success: boolean; credencial: CredencialAcessoSanitizada }> => {
    return request(`/api/credenciais/${encodeURIComponent(id)}/pin`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  atualizarStatusCredencial: (
    id: string,
    params: { ativo?: boolean; desbloquear?: boolean }
  ): Promise<{ success: boolean; credencial: CredencialAcessoSanitizada }> => {
    return request(`/api/credenciais/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },

  excluirCredencial: (id: string): Promise<{ success: boolean; removido: boolean }> => {
    return request(`/api/credenciais/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  resetTestData: (): Promise<{ success: boolean; message: string }> => {
    return request('/api/dev/reset-test-data', { method: 'POST' });
  },
};
