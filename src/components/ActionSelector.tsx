import React, { useRef, useEffect } from 'react';
import { ArrowUpRight, ArrowDownLeft, Navigation, AlertTriangle, Search, X } from 'lucide-react';
import { Prisma } from '../types';
import { getCorConfig } from '../constants/cores';
import { sortPrismasNumericos } from '../utils/prismaSort';

export type MainActionTab = 'ENTREGAR' | 'RECEBER' | 'PENDENTES' | 'BUSCAR';

interface ActionSelectorProps {
  activeTab: MainActionTab;
  onSelectTab: (tab: MainActionTab) => void;
  countEmUso: number;
  countDisponiveis: number;
  countPendentes?: number;
  prismasPendentes?: Prisma[];
  prismasEmUso?: Prisma[];
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  onCloseSearch?: () => void;
}

/**
 * Mini Badge Informativo de Prisma com Miniatura 3D e Casa Compacta
 * Layout: [Mini Ícone] CASA
 *                      426
 */
const MiniPrismaBadge: React.FC<{ prisma: Prisma; variant?: 'blue' | 'amber' }> = ({
  prisma,
  variant = 'blue',
}) => {
  const corConfig = getCorConfig(prisma.corNome);
  const normalized = (prisma.corNome || '').toLowerCase().trim();
  const isLightColor =
    normalized === 'branco' ||
    normalized === 'amarelo' ||
    normalized === 'white' ||
    normalized === 'yellow';

  const textColor = isLightColor ? 'text-slate-950' : 'text-white';
  const rawCasa = (prisma.casaAtual || '').trim();
  let numeroCasa = '--';
  if (rawCasa) {
    const cleanNum = rawCasa.replace(/^casa\s*:?\s*/i, '').trim();
    numeroCasa = cleanNum || rawCasa;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border shadow-2xs flex-shrink-0 select-none ${
        variant === 'blue'
          ? 'bg-blue-100/95 border-blue-300/80 text-blue-950'
          : 'bg-amber-100/95 border-amber-300/80 text-amber-950'
      }`}
      title={`Prisma ${prisma.numero} (${prisma.corNome}) - CASA ${numeroCasa}`}
    >
      {/* Miniatura física do Prisma à esquerda */}
      <div
        className="w-3.5 h-6 rounded-t-[3px] rounded-b-[1px] flex flex-col items-center justify-between shadow-2xs overflow-hidden flex-shrink-0"
        style={{
          backgroundColor: corConfig.hex,
          border: isLightColor ? '1px solid #cbd5e1' : '0.5px solid rgba(0,0,0,0.3)',
        }}
      >
        <div className="w-full h-0.5 bg-white/40" />
        <span className={`text-[7.5px] font-black leading-none ${textColor}`}>
          {prisma.numero}
        </span>
        <div className="w-full h-0.5 bg-slate-900/90" />
      </div>

      {/* Identificação vertical e compacta da Casa: Linha 1 = CASA, Linha 2 = Número */}
      <div className="flex flex-col justify-center text-left min-w-0">
        <span
          className={`text-[8.5px] font-bold tracking-wider leading-none uppercase ${
            variant === 'blue' ? 'text-blue-800/90' : 'text-amber-800/90'
          }`}
        >
          CASA
        </span>
        <span className="text-[13px] sm:text-[13.5px] font-black tracking-tight leading-tight whitespace-nowrap">
          {numeroCasa}
        </span>
      </div>
    </div>
  );
};

export const ActionSelector: React.FC<ActionSelectorProps> = ({
  activeTab,
  onSelectTab,
  countEmUso,
  countDisponiveis,
  countPendentes = 0,
  prismasPendentes = [],
  prismasEmUso = [],
  searchTerm = '',
  onSearchChange,
  onCloseSearch,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const sortedPrismasEmUso = React.useMemo(
    () => sortPrismasNumericos(prismasEmUso),
    [prismasEmUso]
  );
  const sortedPrismasPendentes = React.useMemo(
    () => sortPrismasNumericos(prismasPendentes),
    [prismasPendentes]
  );

  // Auto-foco imediato ao ativar a busca
  useEffect(() => {
    if (activeTab === 'BUSCAR') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  return (
    <div id="actions-container" className="space-y-2 sm:space-y-2.5">
      {/* GRADE OPERACIONAL 2 x 2 COM ALTURA PADRONIZADA */}
      <div id="grid-operacional-2x2" className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {/* =========================================================================
            LINHA 1 - COLUNA 1: EM USO (PAINEL INFORMATIVO COM EXPANSÃO VERTICAL DINÂMICA)
            ========================================================================= */}
        <div
          id="card-info-em-uso"
          className="flex flex-col justify-between p-2.5 sm:p-3 rounded-2xl border text-left bg-blue-50/70 border-blue-200/90 shadow-2xs min-h-24 sm:min-h-26 h-auto select-none transition-all duration-200"
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="p-1.5 rounded-lg flex-shrink-0 bg-blue-200/90 text-blue-800">
                <Navigation className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              </div>
              <span className="text-[11px] sm:text-xs md:text-sm font-black tracking-wider uppercase text-blue-950 truncate">
                EM USO
              </span>
            </div>

            <span className="text-xs px-2 py-0.5 rounded-full font-black bg-blue-200/90 text-blue-900 border border-blue-300">
              {String(countEmUso).padStart(2, '0')}
            </span>
          </div>

          {/* Listagem vertical/wrap com miniícones de todos os prismas em uso */}
          <div className="mt-2 w-full">
            {sortedPrismasEmUso.length === 0 ? (
              <div className="text-[10px] sm:text-[11px] text-slate-500 italic leading-tight">
                Nenhum prisma em uso
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {sortedPrismasEmUso.map((p) => (
                  <MiniPrismaBadge key={p.id} prisma={p} variant="blue" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* =========================================================================
            LINHA 1 - COLUNA 2: PENDENTES (PAINEL INFORMATIVO COM EXPANSÃO VERTICAL DINÂMICA)
            ========================================================================= */}
        <div
          id="card-info-pendentes"
          className="flex flex-col justify-between p-2.5 sm:p-3 rounded-2xl border text-left bg-amber-50/70 border-amber-200/90 shadow-2xs min-h-24 sm:min-h-26 h-auto select-none transition-all duration-200"
        >
          <div className="w-full">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="p-1.5 rounded-lg flex-shrink-0 bg-amber-200/90 text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
                </div>
                <span className="text-[11px] sm:text-xs md:text-sm font-black tracking-wider uppercase text-amber-950 truncate">
                  PENDENTES
                </span>
              </div>

              <span className="text-xs px-2 py-0.5 rounded-full font-black bg-amber-200/90 text-amber-900 border border-amber-300">
                {countPendentes}
              </span>
            </div>

            {/* Subtítulo explicativo permanente */}
            <div className="text-[9px] sm:text-[10px] font-bold text-amber-800 mt-0.5 truncate">
              Prismas não entregues no dia
            </div>
          </div>

          {/* Listagem vertical/wrap com miniícones de todos os prismas pendentes */}
          <div className="mt-2 w-full">
            {sortedPrismasPendentes.length === 0 ? (
              <div className="text-[10px] sm:text-[11px] text-slate-500 italic leading-tight">
                Nenhum pendente
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {sortedPrismasPendentes.map((p) => (
                  <MiniPrismaBadge key={p.id} prisma={p} variant="amber" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* =========================================================================
            LINHA 2 - COLUNA 1: DISPONÍVEL (BOTÃO OPERACIONAL DE ENTREGA)
            ========================================================================= */}
        <button
          id="btn-card-disponivel"
          type="button"
          onClick={() => onSelectTab('ENTREGAR')}
          className={`flex flex-col justify-between p-2.5 sm:p-3 rounded-2xl border text-left transition-all cursor-pointer h-24 sm:h-26 ${
            activeTab === 'ENTREGAR'
              ? 'bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-500/50'
              : 'bg-emerald-50/90 hover:bg-emerald-100/90 text-emerald-950 border-emerald-300 shadow-2xs hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={`p-1.5 rounded-lg flex-shrink-0 ${
                  activeTab === 'ENTREGAR'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-emerald-200/90 text-emerald-800'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              </div>
              <span className="text-[11px] sm:text-xs md:text-sm font-black tracking-wider uppercase truncate">
                DISPONÍVEL
              </span>
            </div>

            <span
              className={`text-lg sm:text-xl font-black px-2 py-0.5 rounded-lg leading-none ${
                activeTab === 'ENTREGAR'
                  ? 'bg-emerald-800 text-white'
                  : 'bg-emerald-200/90 text-emerald-900 border border-emerald-300'
              }`}
            >
              {String(countDisponiveis).padStart(2, '0')}
            </span>
          </div>

          <div className="mt-auto">
            <span
              className={`text-[10px] sm:text-xs font-semibold block leading-tight ${
                activeTab === 'ENTREGAR' ? 'text-emerald-100' : 'text-emerald-800/80'
              }`}
            >
              Prontos para entrega
            </span>
          </div>
        </button>

        {/* =========================================================================
            LINHA 2 - COLUNA 2: RECOLHER (BOTÃO OPERACIONAL DE BAIXA)
            ========================================================================= */}
        <button
          id="btn-card-recolher"
          type="button"
          onClick={() => onSelectTab('RECEBER')}
          className={`flex flex-col justify-between p-2.5 sm:p-3 rounded-2xl border text-left transition-all cursor-pointer h-24 sm:h-26 ${
            activeTab === 'RECEBER'
              ? 'bg-blue-600 text-white border-blue-700 shadow-md ring-2 ring-blue-500/50'
              : 'bg-white hover:bg-blue-50 text-slate-800 border-slate-200 hover:border-blue-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={`p-1.5 rounded-lg flex-shrink-0 ${
                  activeTab === 'RECEBER' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-700'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              </div>
              <span className="text-[11px] sm:text-xs md:text-sm font-black tracking-wider uppercase truncate">
                RECOLHER
              </span>
            </div>

            <span
              className={`text-xs px-2 py-0.5 rounded-full font-black ${
                activeTab === 'RECEBER' ? 'bg-blue-800 text-white' : 'bg-blue-100 text-blue-800'
              }`}
            >
              {countEmUso}
            </span>
          </div>

          <div className="mt-auto">
            <span
              className={`text-[10px] sm:text-xs font-semibold block leading-tight ${
                activeTab === 'RECEBER' ? 'text-blue-100' : 'text-slate-500'
              }`}
            >
              Baixa na portaria
            </span>
          </div>
        </button>
      </div>

      {/* =========================================================================
          BOTÃO BUSCAR (PERMANECE SEPARADO / FORA DA GRADE 2 x 2)
          ========================================================================= */}
      {activeTab !== 'BUSCAR' ? (
        <button
          id="btn-action-buscar"
          type="button"
          onClick={() => onSelectTab('BUSCAR')}
          className="w-full flex items-center justify-center gap-2 p-3 sm:p-3.5 rounded-xl font-black text-xs sm:text-sm tracking-wide uppercase transition-all cursor-pointer border h-11 sm:h-12 bg-white hover:bg-purple-50 text-slate-800 border-slate-200 hover:border-purple-300 shadow-2xs"
        >
          <Search className="w-4 h-4 sm:w-4.5 sm:h-4.5 stroke-[2.5] text-purple-600 flex-shrink-0" />
          <span>BUSCAR</span>
        </button>
      ) : (
        <div
          id="container-action-buscar-inline"
          className="w-full flex items-center gap-2 px-3 sm:px-3.5 rounded-xl border-2 border-purple-500 bg-white shadow-xs h-11 sm:h-12 ring-2 ring-purple-100 transition-all"
        >
          <Search className="w-4 h-4 sm:w-4.5 sm:h-4.5 stroke-[2.5] text-purple-600 flex-shrink-0" />
          <input
            ref={inputRef}
            id="input-busca-inline"
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && onCloseSearch) {
                onCloseSearch();
              }
            }}
            placeholder="Buscar prisma..."
            className="flex-1 bg-transparent border-none outline-none text-xs sm:text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium min-w-0"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />

          {searchTerm ? (
            <button
              type="button"
              onClick={() => onSearchChange && onSearchChange('')}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
              title="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}

          <button
            id="btn-fechar-busca-inline"
            type="button"
            onClick={() => {
              if (onCloseSearch) {
                onCloseSearch();
              } else {
                onSelectTab('ENTREGAR');
              }
            }}
            className="p-1.5 text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 rounded-lg font-black text-xs flex items-center gap-1 transition-colors cursor-pointer flex-shrink-0 border border-purple-200"
            title="Cancelar e fechar busca"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden xs:inline text-[10px] uppercase font-black">X</span>
          </button>
        </div>
      )}
    </div>
  );
};


