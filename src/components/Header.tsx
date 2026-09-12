import React from 'react';
import {
  Building2,
  Clock,
  Wifi,
  WifiOff,
  Zap,
  RefreshCw,
  History,
  SlidersHorizontal,
  Settings,
  Pencil,
  AlertCircle,
  AlertTriangle,
  User,
  Moon,
  Sun,
  LogOut,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { Condominio, Turno, Usuario, UserRole, OperadorIdentificado, TipoTurno, Paridade12x36, AuthUserContext, TipoSessao } from '../types';

interface HeaderProps {
  condominioAtual?: Condominio;
  condominios: Condominio[];
  onSelectCondominio: (id: string) => void;
  onOpenEditarCondominio: () => void;
  turnoAtivo?: Turno;
  operadorIdentificado: OperadorIdentificado;
  authUser?: AuthUserContext | null;
  onLogout?: () => void;
  onOpenPassagemTurno: () => void;
  onOpenAuditoria: () => void;
  onOpenGerenciamento: () => void;
  onOpenConcorrenciaSim: () => void;
  onOpenConfiguracoes?: () => void;
  onOpenAlterarSenha?: () => void;
  isDevEnvironment?: boolean;
  isOnline: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  isModoPortariaActive?: boolean;
  onToggleModoPortaria?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  condominioAtual,
  condominios,
  onSelectCondominio,
  onOpenEditarCondominio,
  turnoAtivo,
  operadorIdentificado,
  authUser,
  onLogout,
  onOpenPassagemTurno,
  onOpenAuditoria,
  onOpenGerenciamento,
  onOpenConcorrenciaSim,
  onOpenConfiguracoes,
  onOpenAlterarSenha,
  isDevEnvironment = false,
  isOnline,
  onRefresh,
  isRefreshing,
  isModoPortariaActive = false,
  onToggleModoPortaria,
}) => {
  const isNoturno = Boolean(
    operadorIdentificado?.operador?.horaInicio &&
    operadorIdentificado?.operador?.horaFim &&
    operadorIdentificado.operador.horaInicio > operadorIdentificado.operador.horaFim
  );

  const canAccessConfig = Boolean(
    authUser &&
      (authUser.role === UserRole.ADMIN ||
        authUser.role === UserRole.SINDICO ||
        authUser.tipoSessao === TipoSessao.ADMIN ||
        authUser.tipoSessao === TipoSessao.SINDICO)
  );

  const canAccessPrismas = Boolean(
    (authUser &&
      (authUser.role === UserRole.ADMIN ||
        authUser.role === UserRole.SINDICO ||
        authUser.role === UserRole.PORTEIRO ||
        authUser.tipoSessao === TipoSessao.ADMIN ||
        authUser.tipoSessao === TipoSessao.SINDICO ||
        authUser.tipoSessao === TipoSessao.PORTARIA)) ||
      operadorIdentificado.operador
  );

  return (
    <header
      id="main-app-header"
      className="bg-slate-900 text-white border-b border-slate-800 shadow-md sticky top-0 z-30"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 space-y-2">
        {/* ========================================================
            LINHA SUPERIOR: TÍTULO DO SISTEMA + PORTEIRO EM OPERAÇÃO (AUTO / AUTH)
           ======================================================== */}
        <div className="flex items-center justify-between gap-3">
          {/* Top-Left: App Brand & Connection Status */}
          <div className="flex items-center gap-2">
            <h1 className="text-xs sm:text-sm font-black tracking-wider text-white uppercase flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block shadow-sm shadow-blue-500/50" />
              <span>CONTROLE DE PRISMAS</span>
            </h1>

            {/* Status Online/Offline Minimal Indicator */}
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-tight ${
                isOnline
                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/60'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-700/60 animate-pulse'
              }`}
              title={isOnline ? 'Conexão ativa com o servidor' : 'Sem conexão com o servidor'}
            >
              {isOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
              <span className="hidden sm:inline">{isOnline ? 'Online' : 'Offline'}</span>
            </span>
          </div>

          {/* Top-Right: SESSÃO / OPERADOR AUTENTICADO */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {authUser ? (
              <div
                id="card-porteiro-operacao-auto"
                className="flex items-center gap-2.5 bg-slate-950/90 border border-slate-800 px-3 py-1.5 rounded-xl shadow-inner text-right"
              >
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {authUser.tipoSessao === TipoSessao.PORTARIA ? (
                      <User className="w-2.5 h-2.5 text-blue-400" />
                    ) : (
                      <ShieldCheck className="w-2.5 h-2.5 text-amber-400" />
                    )}
                    <span>
                      {authUser.tipoSessao === TipoSessao.PORTARIA
                        ? 'PORTEIRO EM OPERAÇÃO'
                        : authUser.tipoSessao === TipoSessao.SINDICO
                        ? 'SÍNDICO AUTENTICADO'
                        : 'ADMINISTRADOR'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs sm:text-sm font-black text-white tracking-tight whitespace-nowrap">
                      {authUser.usuarioId === 'portaria-station' && operadorIdentificado?.operador?.nome
                        ? `${operadorIdentificado.operador.nome} (Plantão)`
                        : authUser.nome}
                    </span>
                    {operadorIdentificado?.operador?.horaInicio && authUser.tipoSessao === TipoSessao.PORTARIA && (
                      <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-bold flex items-center gap-0.5">
                        {isNoturno ? (
                          <Moon className="w-2.5 h-2.5 text-indigo-400" />
                        ) : (
                          <Sun className="w-2.5 h-2.5 text-amber-400" />
                        )}
                        <span>
                          {operadorIdentificado.operador.horaInicio}–{operadorIdentificado.operador.horaFim}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : operadorIdentificado.status === 'OK' && operadorIdentificado.operador ? (
              <div
                id="card-porteiro-operacao-auto"
                className="flex items-center gap-2.5 bg-slate-950/90 border border-slate-800 px-3 py-1.5 rounded-xl shadow-inner text-right"
              >
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <User className="w-2.5 h-2.5 text-blue-400" />
                    <span>PORTEIRO EM OPERAÇÃO</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs sm:text-sm font-black text-white tracking-tight whitespace-nowrap">
                      {operadorIdentificado.operador.nome}
                    </span>
                  </div>
                </div>
              </div>
            ) : operadorIdentificado.status === 'SEM_PORTEIRO' ? (
              <div
                id="card-porteiro-sem-operador"
                className="flex items-center gap-2 bg-rose-950/50 border border-rose-600/50 px-2.5 py-1.5 rounded-xl text-right"
                title={operadorIdentificado.mensagem}
              >
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 animate-bounce" />
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-rose-300 uppercase tracking-wide">
                    PORTEIRO NÃO IDENTIFICADO
                  </span>
                  <span className="text-[11px] text-rose-200 font-semibold">
                    Nenhum plantão ativo ({operadorIdentificado.horarioAtual})
                  </span>
                </div>
              </div>
            ) : (
              <div
                id="card-porteiro-conflito"
                className="flex items-center gap-2 bg-amber-950/50 border border-amber-500/50 px-2.5 py-1.5 rounded-xl text-right"
                title={operadorIdentificado.mensagem}
              >
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div className="flex flex-col items-end max-w-[240px]">
                  <span className="text-[10px] font-black text-amber-300 uppercase tracking-wide">
                    CONFLITO DE ESCALA ({operadorIdentificado.horarioAtual})
                  </span>
                  <span className="text-[11px] text-amber-200 font-semibold truncate">
                    {operadorIdentificado.conflitoUsuarios?.map((u) => u.nome).join(', ')}
                  </span>
                </div>
              </div>
            )}

            {/* Botão Alterar Senha (SÍNDICO) */}
            {onOpenAlterarSenha && authUser && (authUser.role === UserRole.SINDICO || authUser.tipoSessao === TipoSessao.SINDICO) && (
              <button
                type="button"
                id="btn-alterar-senha-header"
                onClick={onOpenAlterarSenha}
                className="p-1.5 sm:p-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-amber-300 hover:text-amber-200 rounded-xl cursor-pointer transition-all shadow-sm flex items-center gap-1.5"
                title="Alterar Minha Senha"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase">Senha</span>
              </button>
            )}

            {/* Botão de Logout */}
            {onLogout && (
              <button
                id="btn-logout-header"
                onClick={onLogout}
                className="p-1.5 sm:p-2 bg-slate-800 hover:bg-rose-950/80 hover:border-rose-700/60 active:bg-rose-900 border border-slate-700 text-slate-400 hover:text-rose-300 rounded-xl cursor-pointer transition-all shadow-sm flex items-center gap-1"
                title="Sair da Sessão (Logout)"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase">Sair</span>
              </button>
            )}
          </div>
        </div>

        {/* ========================================================
            LINHA INFERIOR: CONDOMÍNIO (INTERATIVO) + ÍCONES OPERACIONAIS ESPAÇADOS
           ======================================================== */}
        <div className="pt-1 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Interactive Condominium Name */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              id="btn-editar-condominio-header"
              onClick={onOpenEditarCondominio}
              className="group flex items-center gap-2 text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 px-2.5 py-1.5 rounded-xl transition-all cursor-pointer truncate max-w-full sm:max-w-md"
              title="Clique para editar o nome do condomínio"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <div className="truncate">
                <span className="text-xs sm:text-sm font-bold text-white group-hover:text-blue-300 transition-colors truncate block">
                  {condominioAtual?.nome || 'Condomínio'}
                </span>
              </div>
              <Pencil className="w-3 h-3 text-slate-400 group-hover:text-blue-400 flex-shrink-0 ml-1 opacity-70 group-hover:opacity-100" />
            </button>
          </div>

          {/* Action Icons with generous spacing to avoid accidental touches */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-end">
            {/* Shift handover trigger */}
            <button
              id="btn-troca-turno-header"
              onClick={onOpenPassagemTurno}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-sm"
              title="Passagem de Turno"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-bold">Turno</span>
            </button>

            {/* Prism Management */}
            {canAccessPrismas && (
              <button
                id="btn-gerenciar-prismas-nav"
                onClick={onOpenGerenciamento}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-indigo-300 px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                title="Administrar Prismas"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">Prismas</span>
              </button>
            )}

            {/* Audit log trigger */}
            <button
              id="btn-auditoria-nav"
              onClick={onOpenAuditoria}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-sm"
              title="Trilha de Auditoria"
            >
              <History className="w-3.5 h-3.5 text-slate-300" />
              <span className="text-[11px] font-bold">Auditoria</span>
            </button>

            {/* Concurrency Simulator button */}
            <button
              id="btn-simulador-concorrencia"
              onClick={onOpenConcorrenciaSim}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-amber-300 border border-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-sm"
              title="Simulador de Concorrência"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden lg:inline text-[11px] font-bold">Concorrência</span>
            </button>

            {/* Settings button - conditionally rendered for Admin, Síndico or Dev environment */}
            {canAccessConfig && onOpenConfiguracoes && (
              <button
                id="btn-configuracoes-nav"
                onClick={onOpenConfiguracoes}
                className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-all shadow-sm"
                title="Configurações do Sistema"
              >
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] uppercase tracking-wide">
                  CONFIGURAÇÕES
                </span>
              </button>
            )}

            {/* Modo Portaria Compacto (PC Exclusivo) */}
            {onToggleModoPortaria && (
              <button
                id="btn-modo-portaria-toggle"
                onClick={onToggleModoPortaria}
                className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-all shadow-sm border ${
                  isModoPortariaActive
                    ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400 ring-2 ring-blue-400/40'
                    : 'bg-blue-950/80 hover:bg-blue-900 active:bg-blue-800 text-blue-300 border-blue-700/60'
                }`}
                title="Modo Portaria Compacto (Pop-up 400×680 para uso simultâneo com WhatsApp e Controle de Acesso)"
              >
                <span className="w-2 h-2 rounded-xs bg-blue-400 inline-block" />
                <span className="text-[11px] tracking-wide uppercase">MODO PORTARIA</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              id="btn-refresh-dashboard"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 sm:p-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white rounded-xl cursor-pointer transition-all disabled:opacity-50 shadow-sm"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
