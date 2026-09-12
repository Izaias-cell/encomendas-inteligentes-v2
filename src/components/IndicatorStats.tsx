import React from 'react';
import { Navigation, AlertTriangle } from 'lucide-react';
import { DashboardStats, Prisma } from '../types';

interface IndicatorStatsProps {
  stats: DashboardStats;
  prismasPendentes?: Prisma[];
  selectedFilter?: string;
  onSelectFilter?: (filter: string) => void;
  activeTab?: string;
}

export const IndicatorStats: React.FC<IndicatorStatsProps> = ({
  stats,
  prismasPendentes = [],
  selectedFilter,
  onSelectFilter,
  activeTab,
}) => {
  const isEmUsoActive = selectedFilter === 'EM_USO' || activeTab === 'RECEBER';
  const isPendentesActive = selectedFilter === 'PENDENTES' || activeTab === 'PENDENTES';

  return (
    <div id="indicators-container" className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
      {/* 1. CARD EM USO (Ocupa o lugar do card DISPONÍVEIS menor) */}
      <button
        id="indicator-card-em_uso"
        type="button"
        onClick={() => onSelectFilter && onSelectFilter('EM_USO')}
        className={`flex flex-col justify-between p-3 sm:p-3.5 rounded-xl border text-left transition-all cursor-pointer bg-blue-50/90 border-blue-300 min-h-[90px] sm:min-h-[105px] ${
          isEmUsoActive
            ? 'ring-2 ring-blue-600 shadow-md border-blue-500'
            : 'hover:border-blue-400 shadow-2xs hover:shadow-xs'
        }`}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 min-w-0">
            <Navigation className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-700 flex-shrink-0" />
            <span className="text-[11px] sm:text-xs font-black tracking-wider uppercase text-blue-900 truncate">
              EM USO
            </span>
          </div>

          <span className="text-xl sm:text-2xl font-black tracking-tight leading-none text-blue-700">
            {String(stats.emUso).padStart(2, '0')}
          </span>
        </div>

        <div className="text-[11px] text-blue-800/80 font-medium mt-1 sm:mt-2">
          Prismas atualmente com moradores/prestadores
        </div>
      </button>

      {/* 2. CARD PENDENTES (Ocupa o lugar do card EM USO com lista direta e texto explicativo) */}
      <div
        id="indicator-card-pendentes"
        onClick={() => onSelectFilter && onSelectFilter('PENDENTES')}
        className={`flex flex-col justify-between p-3 sm:p-3.5 rounded-xl border text-left transition-all cursor-pointer bg-amber-50/90 border-amber-300 min-h-[90px] sm:min-h-[105px] ${
          isPendentesActive
            ? 'ring-2 ring-amber-600 shadow-md border-amber-500'
            : 'hover:border-amber-400 shadow-2xs hover:shadow-xs'
        }`}
      >
        <div>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 flex-shrink-0" />
              <span className="text-[11px] sm:text-xs font-black tracking-wider uppercase text-amber-950 truncate">
                PENDENTES
              </span>
            </div>

            <span className="text-xs px-2 py-0.5 rounded-full font-black bg-amber-200/80 text-amber-900 border border-amber-300">
              {stats.pendentes}
            </span>
          </div>

          {/* Subtítulo obrigatório permanente */}
          <div className="text-[11px] sm:text-xs font-bold text-amber-800/90 mt-0.5">
            Prismas não entregues no dia
          </div>
        </div>

        {/* Listagem direta de prismas pendentes */}
        <div className="mt-2">
          {prismasPendentes.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-0.5">
              Nenhum prisma pendente.
            </div>
          ) : (
            <div className="max-h-24 sm:max-h-28 overflow-y-auto space-y-1 pr-1">
              {prismasPendentes.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-2 py-0.5 bg-amber-100/80 hover:bg-amber-200/80 border border-amber-200 rounded text-xs font-bold text-amber-950 transition-colors"
                >
                  <span className="tracking-wide">Prisma {p.numero}</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-800 font-semibold">
                    {p.corNome && <span>{p.corNome}</span>}
                    {p.casaAtual && <span>• {p.casaAtual}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


