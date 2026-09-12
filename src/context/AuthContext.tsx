import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthUserContext, UserRole, TipoSessao } from '../types';
import {
  api,
  setUnauthorizedHandler,
  setAuthToken,
  getAuthToken,
  getStoredStationSession,
  setStoredStationSession,
  ApiError,
} from '../services/api';

interface AuthContextType {
  user: AuthUserContext | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginAdmin: (params: { identificador: string; senha: string; condominioId?: string }) => Promise<void>;
  loginPortariaCodigo: (params: { codigo: string; condominioId?: string; stationId?: string }) => Promise<void>;
  assumirPortaria: (params: { usuarioId: string; pin: string; condominioId?: string; stationId?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Inicialização resiliente a partir do estado da estação autorizada
  const [user, setUser] = useState<AuthUserContext | null>(() => getStoredStationSession());
  const [isLoading, setIsLoading] = useState<boolean>(() => !getStoredStationSession());

  const refreshAuth = useCallback(async () => {
    const currentToken = getAuthToken();
    const cachedSession = getStoredStationSession();

    // Se não há token nem sessão prévia, encerra carregamento
    if (!currentToken && !cachedSession) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.getAuthMe();
      if (data.authenticated && data.user) {
        setUser(data.user);
        setStoredStationSession(data.user);
      } else {
        setUser(null);
        setAuthToken(null);
        setStoredStationSession(null);
      }
    } catch (err: any) {
      // Diferenciação crítica: Perda de Autenticação (401/403) vs Queda de Conexão (Rede/500/503)
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null);
        setAuthToken(null);
        setStoredStationSession(null);
      } else {
        // Falha temporária de rede/conectividade: NÃO fazer logout da estação de portaria
        if (cachedSession) {
          setUser(cachedSession);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restauração e validação inicial da sessão
    refreshAuth();

    // Callback global de 401 Unauthorized para revogação/expiração confirmada pelo backend
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setStoredStationSession(null);
      setUser(null);
    });

    // Revalidação automática quando a conectividade com a internet for restabelecida
    const handleOnline = () => {
      refreshAuth();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      setUnauthorizedHandler(null);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [refreshAuth]);

  const loginAdmin = async (params: { identificador: string; senha: string; condominioId?: string }) => {
    const res = await api.loginAdmin(params);
    if (res.token) {
      setAuthToken(res.token);
    }
    if (res.success && res.user) {
      const userContext: AuthUserContext = {
        usuarioId: res.user.id,
        condominioId: res.user.condominioId,
        role: res.user.role,
        nome: res.user.nome,
        tipoSessao: res.user.tipoSessao,
      };
      setStoredStationSession(userContext);
      setUser(userContext);
    }
  };

  const loginPortariaCodigo = async (params: { codigo: string; condominioId?: string; stationId?: string }) => {
    const res = await api.loginPortariaCodigo(params);
    if (res.token) {
      setAuthToken(res.token);
    }
    if (res.success && res.user) {
      const userContext: AuthUserContext = {
        usuarioId: res.user.id,
        condominioId: res.user.condominioId,
        role: res.user.role,
        nome: res.user.nome,
        tipoSessao: res.user.tipoSessao,
        stationId: res.user.stationId,
      };
      setStoredStationSession(userContext);
      setUser(userContext);
    }
  };

  const assumirPortaria = async (params: { usuarioId: string; pin: string; condominioId?: string; stationId?: string }) => {
    const res = await api.assumirPortariaPin(params);
    if (res.token) {
      setAuthToken(res.token);
    }
    if (res.success && res.user) {
      const userContext: AuthUserContext = {
        usuarioId: res.user.id,
        condominioId: res.user.condominioId,
        role: res.user.role,
        nome: res.user.nome,
        tipoSessao: res.user.tipoSessao,
        stationId: res.user.stationId,
      };
      setStoredStationSession(userContext);
      setUser(userContext);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignorar erros de rede no logout
    } finally {
      setAuthToken(null);
      setStoredStationSession(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        isLoading,
        loginAdmin,
        loginPortariaCodigo,
        assumirPortaria,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider.');
  }
  return context;
}

