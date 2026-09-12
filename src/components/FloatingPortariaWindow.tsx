import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Prisma,
  PrismaEstado,
  Usuario,
  Condominio,
  DashboardStats,
  OperadorIdentificado,
  TipoTurno,
  Paridade12x36,
  Movimentacao,
} from '../types';
import { ActionSelector, MainActionTab } from './ActionSelector';
import { PrismaCard } from './PrismaCard';
import { ReceberView } from './ReceberView';
import { PrismasEmAbertoView } from './PrismasEmAbertoView';
import { BuscaView } from './BuscaView';
import {
  Building2,
  User,
  Moon,
  Sun,
  X,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Minus,
  Move,
  Maximize2,
  SlidersHorizontal,
} from 'lucide-react';

interface FloatingPortariaWindowProps {
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
  onOpenGerenciamento?: () => void;
  isOnline: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onAbrirEmJanelaDesktop?: () => void;
  onToggleMinimize?: (minimized: boolean) => void;
  ultimasMovimentacoes?: Movimentacao[];
  isStandalonePopup?: boolean;
}

const STORAGE_POS_KEY = 'prismas_portaria_pos';
const STORAGE_SIZE_KEY = 'prismas_portaria_size';
const STORAGE_MINIMIZED_KEY = 'prismas_portaria_minimized';

export const FloatingPortariaWindow: React.FC<FloatingPortariaWindowProps> = ({
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
  onOpenGerenciamento,
  isOnline,
  isRefreshing,
  onRefresh,
  onClose,
  onAbrirEmJanelaDesktop,
  onToggleMinimize,
  ultimasMovimentacoes = [],
  isStandalonePopup = false,
}) => {
  // 1. Position calculation with localStorage persistence
  const getInitialPosition = (): { x: number; y: number } => {
    if (typeof window === 'undefined') return { x: 40, y: 40 };

    try {
      const saved = localStorage.getItem(STORAGE_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          // Clamp inside viewport
          const clampedX = Math.max(10, Math.min(window.innerWidth - 380, parsed.x));
          const clampedY = Math.max(10, Math.min(window.innerHeight - 100, parsed.y));
          return { x: clampedX, y: clampedY };
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    // Default right-aligned
    const defaultX = Math.max(16, window.innerWidth - 420);
    const defaultY = Math.max(16, Math.min(40, window.innerHeight - 700));
    return { x: defaultX, y: defaultY };
  };

  // 2. Size calculation with localStorage persistence
  const getInitialSize = (): { width: number; height: number } => {
    try {
      const saved = localStorage.getItem(STORAGE_SIZE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
          return {
            width: Math.max(360, Math.min(600, parsed.width)),
            height: Math.max(500, Math.min(900, parsed.height)),
          };
        }
      }
    } catch {}
    return { width: 400, height: 670 };
  };

  const [position, setPosition] = useState<{ x: number; y: number }>(getInitialPosition);
  const [size, setSize] = useState<{ width: number; height: number }>(getInitialSize);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_MINIMIZED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  const wasDraggingRef = useRef<boolean>(false);

  // Sync minimize state
  const handleToggleMinimize = (min: boolean) => {
    setIsMinimized(min);
    try {
      localStorage.setItem(STORAGE_MINIMIZED_KEY, String(min));
    } catch {
      // Ignore localStorage errors
    }
    if (onToggleMinimize) {
      onToggleMinimize(min);
    }
  };

  // Dragging handlers for expanded window
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (isStandalonePopup) return;
    // Don't drag if clicking buttons or interactive elements
    if ((e.target as HTMLElement).closest('button, input, select, a')) {
      return;
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
    setIsDragging(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      const deltaX = moveEvent.clientX - dragRef.current.startX;
      const deltaY = moveEvent.clientY - dragRef.current.startY;

      const newX = Math.max(
        0,
        Math.min(window.innerWidth - 380, dragRef.current.initialX + deltaX)
      );
      const newY = Math.max(
        0,
        Math.min(window.innerHeight - 60, dragRef.current.initialY + deltaY)
      );

      setPosition({ x: newX, y: newY });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (dragRef.current) {
        const deltaX = upEvent.clientX - dragRef.current.startX;
        const deltaY = upEvent.clientY - dragRef.current.startY;
        const finalX = Math.max(
          0,
          Math.min(window.innerWidth - 380, dragRef.current.initialX + deltaX)
        );
        const finalY = Math.max(
          0,
          Math.min(window.innerHeight - 60, dragRef.current.initialY + deltaY)
        );

        setPosition({ x: finalX, y: finalY });
        try {
          localStorage.setItem(
            STORAGE_POS_KEY,
            JSON.stringify({ x: finalX, y: finalY })
          );
        } catch {
          // Ignore localStorage errors
        }
      }
      setIsDragging(false);
      dragRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Dragging handlers for small / minimized window (distinguishes drag >= 5px from click)
  const handlePointerDownSmall = (e: React.PointerEvent<HTMLElement>) => {
    if (isStandalonePopup) return;
    if (e.button !== 0) return; // Only primary button

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
    wasDraggingRef.current = false;

    let hasMovedBeyondThreshold = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      const deltaX = moveEvent.clientX - dragRef.current.startX;
      const deltaY = moveEvent.clientY - dragRef.current.startY;
      const distance = Math.hypot(deltaX, deltaY);

      if (!hasMovedBeyondThreshold && distance >= 5) {
        hasMovedBeyondThreshold = true;
        wasDraggingRef.current = true;
        setIsDragging(true);
      }

      if (hasMovedBeyondThreshold) {
        const newX = Math.max(
          10,
          Math.min(window.innerWidth - 340, dragRef.current.initialX + deltaX)
        );
        const newY = Math.max(
          10,
          Math.min(window.innerHeight - 80, dragRef.current.initialY + deltaY)
        );

        setPosition({ x: newX, y: newY });
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (dragRef.current) {
        const deltaX = upEvent.clientX - dragRef.current.startX;
        const deltaY = upEvent.clientY - dragRef.current.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance >= 5) {
          wasDraggingRef.current = true;
          const finalX = Math.max(
            10,
            Math.min(window.innerWidth - 340, dragRef.current.initialX + deltaX)
          );
          const finalY = Math.max(
            10,
            Math.min(window.innerHeight - 80, dragRef.current.initialY + deltaY)
          );

          setPosition({ x: finalX, y: finalY });
          try {
            localStorage.setItem(
              STORAGE_POS_KEY,
              JSON.stringify({ x: finalX, y: finalY })
            );
          } catch {
            // Ignore localStorage errors
          }
        }
      }

      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleClickSmall = (e: React.MouseEvent) => {
    if (wasDraggingRef.current) {
      e.preventDefault();
      e.stopPropagation();
      wasDraggingRef.current = false;
      return;
    }
    handleToggleMinimize(false);
  };

  // Make sure position stays within viewport on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const clampedX = Math.max(10, Math.min(window.innerWidth - 380, prev.x));
        const clampedY = Math.max(10, Math.min(window.innerHeight - 100, prev.y));
        return { x: clampedX, y: clampedY };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isNoturno = Boolean(
    operadorIdentificado?.operador?.horaInicio &&
    operadorIdentificado?.operador?.horaFim &&
    operadorIdentificado.operador.horaInicio > operadorIdentificado.operador.horaFim
  );

  const prismasDisponiveis = prismas.filter((p) => p.estado === PrismaEstado.DISPONIVEL);
  const prismasEmUso = prismas.filter((p) => p.estado === PrismaEstado.EM_USO);

  // ----------------------------------------------------
  // MINIMIZED STATE: Floating Persistent Operational Popup
  // ----------------------------------------------------
  if (isMinimized) {
    const qtdDisponiveis = stats.disponiveis ?? 0;
    const isEsgotado = qtdDisponiveis === 0;
    const isAlertaApenasUm = qtdDisponiveis === 1;
    const formattedQtd = qtdDisponiveis < 10 ? `0${qtdDisponiveis}` : `${qtdDisponiveis}`;

    let popupBg = 'bg-slate-900 border-blue-500/80 hover:border-blue-400 hover:bg-slate-800 ring-blue-500/20';
    let iconBg = 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-blue-500/50';
    let statusText = `🔷 Prismas disponíveis: ${formattedQtd}`;
    let statusColor = 'text-blue-300';
    let pulseEffect = '';

    if (isEsgotado) {
      popupBg = 'bg-rose-950 border-rose-500/90 hover:border-rose-400 hover:bg-rose-900 ring-rose-500/30';
      iconBg = 'bg-gradient-to-br from-rose-500 to-rose-700 shadow-rose-500/50 animate-bounce';
      statusText = '🚨 Prismas esgotados, por favor informe!';
      statusColor = 'text-rose-200 font-bold';
      pulseEffect = 'animate-pulse';
    } else if (isAlertaApenasUm) {
      popupBg = 'bg-amber-950 border-amber-500/90 hover:border-amber-400 hover:bg-amber-900 ring-amber-500/30';
      iconBg = 'bg-gradient-to-br from-amber-500 to-amber-700 shadow-amber-500/50';
      statusText = '⚠️ Vamos ficar sem prisma, temos apenas 1 disponível';
      statusColor = 'text-amber-200 font-semibold';
      pulseEffect = '';
    }

    if (isStandalonePopup) {
      return (
        <div
          id="popup-flutuante-portaria-container"
          className="w-full h-full p-2 flex items-center justify-center bg-slate-950 select-none animate-in fade-in duration-150"
        >
          <button
            type="button"
            id="btn-restaurar-modo-portaria"
            onClick={handleClickSmall}
            className={`w-full h-full flex items-center gap-3 px-3.5 py-2 text-white rounded-2xl shadow-xl border-2 transition-all group ring-2 text-left cursor-pointer hover:scale-[1.01] ${popupBg} ${pulseEffect}`}
            title="Clique para expandir o Modo Portaria"
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shadow-md flex-shrink-0 group-hover:scale-105 transition-transform pointer-events-none ${iconBg}`}
            >
              {isEsgotado ? '🚨' : isAlertaApenasUm ? '⚠️' : '🔷'}
            </div>
            <div className="flex flex-col items-start leading-tight min-w-0 pr-1 pointer-events-none flex-1">
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-black tracking-wider uppercase text-slate-300 flex items-center gap-1">
                  🛡️ CONTROL PRISMA • PORTARIA
                </span>
                <span className="text-[9px] font-bold text-blue-400 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800/60">
                  EXPANDIR ⤢
                </span>
              </div>
              <span className={`text-xs mt-0.5 leading-snug break-words ${statusColor}`}>
                {statusText}
              </span>
              <span className="text-[9px] text-slate-400 group-hover:text-white transition-colors mt-0.5 font-medium">
                Clique para expandir o painel operacional
              </span>
            </div>
          </button>
        </div>
      );
    }

    return (
      <div
        id="popup-flutuante-portaria-container"
        onPointerDown={handlePointerDownSmall}
        className={`fixed z-50 select-none animate-in fade-in zoom-in-95 duration-150 touch-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{
          left: Math.max(10, Math.min(window.innerWidth - 340, position.x)),
          top: Math.max(10, Math.min(window.innerHeight - 80, position.y)),
        }}
      >
        <button
          type="button"
          id="btn-restaurar-modo-portaria"
          onClick={handleClickSmall}
          className={`flex items-center gap-3 px-4 py-3 text-white rounded-2xl shadow-2xl border-2 transition-all group ring-4 text-left max-w-sm ${
            isDragging ? 'cursor-grabbing ring-blue-500/60 shadow-blue-500/30' : 'cursor-grab active:cursor-grabbing'
          } ${popupBg} ${pulseEffect}`}
          title="Clique para abrir a Portaria ou arraste para reposicionar"
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shadow-md flex-shrink-0 group-hover:scale-105 transition-transform pointer-events-none ${iconBg}`}
          >
            {isEsgotado ? '🚨' : isAlertaApenasUm ? '⚠️' : '🔷'}
          </div>
          <div className="flex flex-col items-start leading-tight min-w-0 pr-1 pointer-events-none">
            <span className="text-[10px] font-black tracking-wider uppercase text-slate-300 flex items-center gap-1">
              🛡️ CONTROL PRISMA • PORTARIA
            </span>
            <span className={`text-xs mt-0.5 leading-snug break-words ${statusColor}`}>
              {statusText}
            </span>
            <span className="text-[9px] text-slate-400 group-hover:text-white transition-colors mt-1 font-medium">
              Clique para abrir ou arraste para mover
            </span>
          </div>
        </button>
      </div>
    );
  }

  // ----------------------------------------------------
  // FULL COMPACT OPERATIONAL WINDOW
  // ----------------------------------------------------
  const windowStyle: React.CSSProperties = isStandalonePopup
    ? { width: '100%', maxWidth: '420px', height: '100%', maxHeight: '680px' }
    : {
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 45,
        width: `${size.width}px`,
        height: `${size.height}px`,
        maxHeight: 'calc(100vh - 20px)',
      };

  return (
    <aside
      id="floating-portaria-window"
      aria-label="Janela Operacional Modo Portaria"
      style={windowStyle}
      className={`bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700/90 flex flex-col overflow-hidden select-none animate-in duration-150 ${
        isDragging ? 'ring-2 ring-blue-500 shadow-blue-500/20' : ''
      }`}
    >
      {/* 1. TOP TITLEBAR (DRAG HANDLE) */}
      <header
        onPointerDown={handlePointerDown}
        className={`bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 flex-shrink-0 select-none ${
          isStandalonePopup ? 'cursor-default' : 'cursor-grab active:cursor-grabbing hover:bg-slate-900/80 transition-colors'
        }`}
        title={isStandalonePopup ? undefined : 'Clique e arraste para posicionar a janela'}
      >
        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
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

        {/* Window controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-400' : 'bg-rose-500 animate-ping'
            }`}
            title={isOnline ? 'Conectado ao servidor' : 'Sem conexão'}
          />

          {onOpenGerenciamento && (
            <button
              type="button"
              id="btn-gerenciar-prismas-portaria"
              onClick={onOpenGerenciamento}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-black tracking-wider text-amber-300 hover:text-amber-200 bg-amber-950/80 hover:bg-amber-900 border border-amber-600/60 rounded-lg transition-colors cursor-pointer shadow-sm uppercase"
              title="Gerenciar Prismas"
            >
              <SlidersHorizontal className="w-3 h-3 text-amber-400" />
              <span>PRISMAS</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {onAbrirEmJanelaDesktop && !isStandalonePopup && (
            <button
              type="button"
              onClick={onAbrirEmJanelaDesktop}
              className="p-1.5 text-blue-400 hover:text-blue-300 bg-blue-950/80 hover:bg-blue-900 border border-blue-800/60 rounded-lg transition-colors cursor-pointer"
              title="Desacoplar para Janela Independente do Windows (400×680)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => handleToggleMinimize(true)}
            className="p-1.5 text-slate-400 hover:text-amber-300 bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Minimizar Modo Portaria"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-rose-300 bg-slate-800/80 hover:bg-rose-900/50 rounded-lg transition-colors cursor-pointer ml-0.5"
            title="Fechar Modo Portaria"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. AUTOMATIC OPERATOR ON DUTY */}
      <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="w-3 h-3 text-blue-400 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-[9px] text-slate-400 uppercase font-bold block leading-none">
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
              <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-bold flex items-center gap-0.5">
                {isNoturno ? <Moon className="w-2.5 h-2.5 text-indigo-400" /> : <Sun className="w-2.5 h-2.5 text-amber-400" />}
                <span>
                  {operadorIdentificado.operador.horaInicio}–{operadorIdentificado.operador.horaFim}
                </span>
              </span>
            )}
            {operadorIdentificado.operador.tipoTurno === TipoTurno.TURNO_12X36 && operadorIdentificado.operador.paridade12x36 && (
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded font-black tracking-wide uppercase ${
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

      {/* 3. SCROLLABLE OPERATIONAL CANVAS */}
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

        {/* PALCO OPERACIONAL */}
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
              termo={searchTerm}
              onOpenHistorico={(p) => onOpenHistoricoById(p.id)}
              onOpenHistoricoById={(id) => onOpenHistoricoById(id)}
            />
          )}
        </div>
      </div>

      {/* 4. FOOTER */}
      <footer className="bg-slate-950 px-3 py-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400 flex-shrink-0">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span>WhatsApp + Controle de Acesso simultâneo</span>
        </span>
        <span className="font-mono text-slate-500 flex items-center gap-1">
          <Move className="w-3 h-3 text-blue-400" />
          <span>{size.width}×{size.height}</span>
        </span>
      </footer>
    </aside>
  );
};
