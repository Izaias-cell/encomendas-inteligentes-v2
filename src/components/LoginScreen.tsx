import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Usuario } from '../types';
import {
  Shield,
  User,
  KeyRound,
  Lock,
  Building2,
  AlertCircle,
  ChevronRight,
  LogIn,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';

interface LoginScreenProps {
  usuarios: Usuario[];
  condominioNome?: string;
  condominioId?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  condominioNome = 'Condomínio',
  condominioId = 'condo-1',
}) => {
  const { loginAdmin, loginPortariaCodigo } = useAuth();

  // Mode: PORTARIA (Código de Acesso da Portaria) vs ADMIN / SINDICO (Identificador + Senha)
  const [modoAcesso, setModoAcesso] = useState<'PORTARIA' | 'ADMIN'>('PORTARIA');

  // Form State - Portaria Código
  const [codigoPortaria, setCodigoPortaria] = useState<string>('');
  const [showCode, setShowCode] = useState<boolean>(false);

  // Form State - Admin / Síndico
  const [identificador, setIdentificador] = useState<string>('');
  const [senha, setSenha] = useState<string>('');

  // UI State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePortariaCodigoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigoPortaria.trim()) {
      setErrorMessage('Informe o Código de Acesso da Portaria.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      await loginPortariaCodigo({
        codigo: codigoPortaria.trim(),
        condominioId,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Código de acesso incorreto ou portaria bloqueada.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identificador.trim() || !senha.trim()) {
      setErrorMessage('Informe o identificador/usuário e a senha.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      await loginAdmin({
        identificador: identificador.trim(),
        senha: senha.trim(),
        condominioId,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao autenticar. Identificador ou senha inválidos.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 select-none font-sans text-slate-100 antialiased">
      {/* Container Principal */}
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Cabeçalho do Card */}
        <div className="bg-slate-950 p-6 border-b border-slate-800/80 text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 mb-1 shadow-inner">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-base sm:text-lg font-black tracking-wider uppercase text-white">
            CONTROLE DE PRISMAS
          </h1>
          <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 font-medium">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="truncate max-w-[280px]">{condominioNome}</span>
          </p>
        </div>

        {/* Seletor de Modo: PORTARIA vs ADMIN/SÍNDICO */}
        <div className="p-3 bg-slate-900/80 border-b border-slate-800 grid grid-cols-2 gap-2">
          <button
            type="button"
            id="tab-login-portaria"
            onClick={() => {
              setModoAcesso('PORTARIA');
              setErrorMessage(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer border ${
              modoAcesso === 'PORTARIA'
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/30'
                : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <User className="w-4 h-4" />
            <span>PORTARIA</span>
          </button>

          <button
            type="button"
            id="tab-login-admin"
            onClick={() => {
              setModoAcesso('ADMIN');
              setErrorMessage(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer border ${
              modoAcesso === 'ADMIN'
                ? 'bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-900/30'
                : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>ADMIN / SÍNDICO</span>
          </button>
        </div>

        {/* Mensagem de Erro */}
        {errorMessage && (
          <div
            id="login-error-banner"
            className="m-4 p-3 bg-rose-950/80 border border-rose-700/60 rounded-xl text-rose-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Formulário - Modo PORTARIA (Código da Portaria & Plantão Automático) */}
        {modoAcesso === 'PORTARIA' && (
          <form onSubmit={handlePortariaCodigoSubmit} className="p-5 sm:p-6 space-y-4">
            <div className="text-center space-y-1 pb-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-950/70 border border-blue-800/60 rounded-full text-blue-300 text-[11px] font-bold">
                <Sparkles className="w-3 h-3 text-blue-400" />
                <span>Acesso da Portaria • Plantão Automático</span>
              </div>
              <p className="text-xs text-slate-400 pt-1">
                Digite o Código de Acesso da Portaria para iniciar as operações.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="input-portaria-codigo" className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
                Código de Acesso da Portaria
              </label>
              <div className="relative">
                <input
                  id="input-portaria-codigo"
                  type={showCode ? 'text' : 'password'}
                  maxLength={12}
                  placeholder="Ex: BV-067985"
                  value={codigoPortaria}
                  onChange={(e) => setCodigoPortaria(e.target.value)}
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-11 py-3 text-base tracking-widest text-white text-center font-mono font-bold uppercase focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-inner"
                  required
                />
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <button
                  type="button"
                  onClick={() => setShowCode(!showCode)}
                  className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                  title={showCode ? 'Ocultar código' : 'Mostrar código'}
                >
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 text-center">
                Insira o código fornecido pela administração do condomínio.
              </p>
            </div>

            <button
              type="submit"
              id="btn-acessar-portaria"
              disabled={isLoading || !codigoPortaria.trim()}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2 cursor-pointer mt-3"
            >
              {isLoading ? (
                <span>Validando Acesso...</span>
              ) : (
                <>
                  <span>ACESSAR PORTARIA</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Formulário - Modo ADMIN / SÍNDICO */}
        {modoAcesso === 'ADMIN' && (
          <form onSubmit={handleAdminSubmit} className="p-5 sm:p-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="input-admin-user" className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
                Usuário / Identificador
              </label>
              <div className="relative">
                <input
                  id="input-admin-user"
                  type="text"
                  placeholder="admin ou síndico"
                  value={identificador}
                  onChange={(e) => setIdentificador(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  required
                />
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="input-admin-pass" className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
                Senha
              </label>
              <div className="relative">
                <input
                  id="input-admin-pass"
                  type="password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  required
                />
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              </div>
            </div>

            <button
              type="submit"
              id="btn-confirmar-admin"
              disabled={isLoading || !identificador || !senha}
              className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-amber-900/40 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {isLoading ? (
                <span>Autenticando...</span>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Entrar no Sistema</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Rodapé informativo */}
        <div className="p-3.5 bg-slate-950/90 border-t border-slate-800 text-center text-[11px] text-slate-400">
          <span>Sessão segura com JWT HttpOnly • Controlprisma</span>
        </div>
      </div>
    </div>
  );
};

