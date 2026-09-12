import React, { useState, useEffect } from 'react';
import {
  Prisma,
  PrismaEstado,
  Usuario,
  Condominio,
  DashboardStats,
  OperadorIdentificado,
  TipoTurno,
  Paridade12x36,
} from '../types';
import { ActionSelector, MainActionTab } from './ActionSelector';
import { PrismaCard } from './PrismaCard';
import { ReceberView } from './ReceberView';
import { PrismasEmAbertoView } from './PrismasEmAbertoView';
import { BuscaView } from './BuscaView';
import {
  Building2,
  Clock,
  User,
  Moon,
  Sun,
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
} from 'lucide-react';

interface ModoPortariaCompactoProps {
  condominioAtual?: Condominio;
  operadorIdentificado: OperadorIdentificado;
  usuarioAtual: Usuario;
  stats: DashboardStats;
  prismas: Prisma[];
  activeTab: MainActionTab;
  onSelectTab: (tab: MainActionTab) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onCloseSearch: () => void;
  onSelectPrismaEntrega: (prisma: Prisma) => void;
  onReceberPrisma: (
    prismaId: string,
    options?: { origin?: 'CARD' | 'BUTTON' }
  ) => Promise<void>;
  isReceberLoading: boolean;
  onRegistrarPendencia: (prismaId: string, motivo: string) => Promise<void>;
  onResolverPendencia: (prismaId: string) => Promise<void>;
  onOpenHistoricoById: (prismaId: string) => void;
  isOnline: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCloseModoPortaria: () => void;
  onAbrirEmJanelaDesktop?: () => void;
  ultimasMovimentacoes?: any[];
}

export const ModoPortariaCompacto: React.FC<ModoPortariaCompactoProps> = ({
  condominioAtual,
  operadorIdentificado,
  usuarioAtual,
  stats,
  prismas,
  activeTab,
  onSelectTab,
  searchTerm,
  onSearchChange,
  onCloseSearch,
  onSelectPrismaEntrega,
  onReceberPrisma,
  isReceberLoading,
  onRegistrarPendencia,
  onResolverPendencia,
  onOpenHistoricoById,
  isOnline,
  isRefreshing,
  onRefresh,
  onCloseModoPortaria,
  onAbrirEmJanelaDesktop,
  ultimasMovimentacoes = [],
}) => {
  const isNoturno = Boolean(
    operadorIdentificado?.operador?.horaInicio &&
    operadorIdentificado?.operador?.horaFim &&
    operadorIdentificado.operador.horaInicio > operadorIdentificado.operador.horaFim
  );

  const prismasDisponiveis = prismas.filter((p) => p.estado === PrismaEstado.DISPONIVEL);
  const prismasEmUso = prismas.filter((p) => p.estado === PrismaEstado.EM_USO);

  return (
    <div
      id="modo-portaria-compacto-container"
      className="w-full h-full max-w-[420px] mx-auto bg-slate-900 text-white flex flex-col shadow-2xl rounded-2xl overflow-hidden border border-slate-700 select-none animate-in fade-in zoom-in-95 duration-200"
      style={{ minHeight: '620px', maxHeight: '700px' }}
    >
      {/* 1. COMPACT HEADER */}
      <header className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center font-black text-xs text-white shadow-md shadow-blue-500/30 flex-shrink-0 border border-blue-400/40">
            🔷
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-sm font-black text-white tracking-wider uppercase">
                PRISMAS
              </span>
              <span className="text-[9px] text-blue-300 font-bold bg-blue-950 border border-blue-700/60 px-1 py-0.5 rounded tracking-wide uppercase">
                PORTARIA
              </span>
            </div>
            <div className="text-[10px] text-slate-300 font-medium truncate flex items-center gap-1 mt-0.5">
              <Building2 className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
              <span className="truncate">{condominioAtual?.nome || 'Controle de Prismas'}</span>
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-400' : 'bg-rose-500 animate-ping'
            }`}
            title={isOnline ? 'Conectado' : 'Offline'}
          />

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {onAbrirEmJanelaDesktop && (
            <button
              type="button"
              onClick={onAbrirEmJanelaDesktop}
              className="p-1 text-blue-400 hover:text-blue-300 bg-blue-950/80 hover:bg-blue-900 border border-blue-800/60 rounded-lg transition-colors cursor-pointer"
              title="Abrir em Janela Flutuante Independente (400×680)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onCloseModoPortaria}
            className="p-1 text-slate-400 hover:text-rose-300 bg-slate-800/80 hover:bg-rose-900/50 rounded-lg transition-colors cursor-pointer ml-0.5"
            title="Voltar ao modo padrão"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. OPERADOR EM PLANTÃO (AUTOMATIC) */}
      <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 uppercase font-bold block leading-none">
              PLANTÃO:
            </span>
            <span className="text-xs font-black text-white truncate block">
              {operadorIdentificado.operador?.nome || 'Nenhum plantão ativo'}
            </span>
          </div>
        </div>

        {operadorIdentificado.operador && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {operadorIdentificado.operador.horaInicio && (
              <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5">
                {isNoturno ? <Moon className="w-2.5 h-2.5 text-indigo-400" /> : <Sun className="w-2.5 h-2.5 text-amber-400" />}
                <span>
                  {operadorIdentificado.operador.horaInicio}–{operadorIdentificado.operador.horaFim}
                </span>
              </span>
            )}
            {operadorIdentificado.operador.tipoTurno === TipoTurno.TURNO_12X36 && operadorIdentificado.operador.paridade12x36 && (
              <span
                className={`text-[9px] px-1 py-0.5 rounded font-black tracking-wide uppercase ${
                  operadorIdentificado.operador.paridade12x36 === Paridade12x36.IMPAR
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-blue-500/20 text-blue-300'
                }`}
              >
                {operadorIdentificado.operador.paridade12x36 === Paridade12x36.IMPAR ? 'ÍMPAR' : 'PAR'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3. SCROLLABLE OPERATIONAL BODY */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-slate-100 text-slate-900">
        {/* GRADE OPERACIONAL 2x2: EM USO | PENDENTES | DISPONÍVEL | RECOLHER + BUSCAR */}
        <ActionSelector
          activeTab={activeTab}
          onSelectTab={onSelectTab}
          countDisponiveis={stats.disponiveis}
          countEmUso={stats.emUso}
          countPendentes={stats.pendentes}
          prismasEmUso={prismas.filter((p) => p.estado === PrismaEstado.EM_USO)}
          prismasPendentes={prismas.filter((p) => p.estado === PrismaEstado.PENDENTE)}
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          onCloseSearch={onCloseSearch}
        />

        {/* PALCO OPERACIONAL DO MODO PORTARIA */}
        <div className="pt-0.5">
          {activeTab === 'ENTREGAR' && (
            <div className="space-y-2">
              {prismasDisponiveis.length === 0 ? (
                <div className="text-center py-6 bg-white rounded-xl border border-dashed border-slate-300 p-4">
                  <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-1 opacity-80" />
                  <div className="text-xs font-bold text-slate-800">
                    Nenhum prisma disponível no momento
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Todos os prismas estão em uso ou pendentes.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {prismasDisponiveis.map((p) => (
                    <PrismaCard
                      key={p.id}
                      prisma={p}
                      variant="entrega"
                      onClick={() => onSelectPrismaEntrega(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'RECEBER' && (
            <ReceberView
              prismasEmUso={prismasEmUso}
              onReceberPrisma={onReceberPrisma}
              isLoading={isReceberLoading}
              onOpenHistorico={(p) => onOpenHistoricoById(p.id)}
            />
          )}

          {activeTab === 'PENDENTES' && (
            <PrismasEmAbertoView
              prismas={prismas}
              onReceberPrisma={onReceberPrisma}
              onRegistrarPendencia={onRegistrarPendencia}
              onResolverPendencia={onResolverPendencia}
              onOpenHistorico={(p) => onOpenHistoricoById(p.id)}
              usuarioAtual={usuarioAtual}
              isLoading={isReceberLoading}
            />
          )}

          {activeTab === 'BUSCAR' && (
            <BuscaView
              prismas={prismas}
              movimentacoes={ultimasMovimentacoes}
              searchTerm={searchTerm}
              onSelectPrisma={(p) => {
                if (p.estado === PrismaEstado.DISPONIVEL) {
                  onSelectPrismaEntrega(p);
                } else {
                  onOpenHistoricoById(p.id);
                }
              }}
            />
          )}
        </div>
      </div>

      {/* 4. COMPACT FOOTER STATUS */}
      <footer className="bg-slate-950 px-3 py-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400 flex-shrink-0">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span>Controle de Acesso + WhatsApp compatível</span>
        </span>
        <span className="font-mono text-slate-500">400×680</span>
      </footer>
    </div>
  );
};
