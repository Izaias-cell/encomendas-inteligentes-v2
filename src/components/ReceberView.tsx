import React, { useState } from 'react';
import { Prisma } from '../types';
import { PrismaVisual } from './PrismaVisual';
import { sortPrismasNumericos } from '../utils/prismaSort';
import {
  Clock,
  Home,
  CheckCircle2,
  Camera,
  AlertCircle,
  Search,
} from 'lucide-react';

interface ReceberViewProps {
  prismasEmUso: Prisma[];
  onReceberPrisma: (
    prismaId: string,
    options?: { origin?: 'CARD' | 'BUTTON' }
  ) => Promise<void>;
  isLoading: boolean;
  onOpenHistorico: (prisma: Prisma) => void;
}

export const ReceberView: React.FC<ReceberViewProps> = ({
  prismasEmUso,
  onReceberPrisma,
  isLoading,
  onOpenHistorico,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [processingPrismaId, setProcessingPrismaId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const result = prismasEmUso.filter((p) => {
      if (!q) return true;
      return (
        p.numero.includes(q) ||
        p.corNome.toLowerCase().includes(q) ||
        (p.casaAtual && p.casaAtual.toLowerCase().includes(q))
      );
    });
    return sortPrismasNumericos(result);
  }, [prismasEmUso, searchTerm]);

  const getTimeFormatted = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const getElapsed = (dateStr?: string) => {
    if (!dateStr) return '';
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (diffMin < 60) return `Há ${diffMin} min`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `Há ${hours}h ${mins}m`;
  };

  // Baixa direta e imediata pelo CARD ou pelo botão interno
  const handleBaixaDireta = async (prisma: Prisma) => {
    if (processingPrismaId || isLoading) return;

    setProcessingPrismaId(prisma.id);
    setGlobalError(null);
    try {
      // origin: 'CARD' garante explicitamente que a navegação permanece em 'RECEBER'
      await onReceberPrisma(prisma.id, { origin: 'CARD' });
    } catch (err: any) {
      setGlobalError(err.message || 'Erro ao registrar devolução do prisma.');
    } finally {
      setProcessingPrismaId(null);
    }
  };

  return (
    <div id="view-recolher-prisma" className="space-y-3">
      {/* Quick filter input */}
      {prismasEmUso.length > 3 && (
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nº, cor ou casa..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:border-blue-500 outline-none shadow-2xs font-medium"
          />
        </div>
      )}

      {/* Global Error alert if any */}
      {globalError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{globalError}</span>
          </div>
          <button
            onClick={() => setGlobalError(null)}
            className="text-xs font-bold text-rose-700 underline cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Cards Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-5">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
          <h3 className="text-sm sm:text-base font-bold text-slate-800">
            {searchTerm ? 'Nenhum prisma corresponde à busca' : 'Nenhum prisma em uso para recolhimento!'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            {searchTerm
              ? 'Tente buscar por outro número, cor ou casa.'
              : 'Todos os prismas já foram recolhidos e estão disponíveis.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          {filtered.map((prisma) => {
            const isBeingProcessed = processingPrismaId === prisma.id;
            const isAnyProcessing = processingPrismaId !== null || isLoading;

            return (
              <div
                key={prisma.id}
                id={`card-recolher-${prisma.id}`}
                onClick={() => handleBaixaDireta(prisma)}
                className={`bg-white hover:bg-slate-50 border border-slate-200 hover:border-blue-400 rounded-xl p-3 sm:p-3.5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between cursor-pointer group ${
                  isAnyProcessing ? 'pointer-events-none opacity-80' : ''
                }`}
              >
                <div>
                  {/* Top Bar: Status EM USO */}
                  <div className="flex items-center justify-end mb-1.5">
                    <span className="text-[10px] sm:text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.2 rounded-full uppercase">
                      EM USO
                    </span>
                  </div>

                  {/* Physical Prisma Miniature & House Info */}
                  <div className="flex items-center gap-3.5 my-2">
                    <PrismaVisual
                      numero={prisma.numero}
                      corIdOrNome={prisma.corNome}
                      size="sm"
                      className="flex-shrink-0 group-hover:scale-105 transition-transform"
                    />

                    <div className="min-w-0">
                      <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight truncate">
                        {prisma.numero} — {prisma.corNome.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-1 text-xs sm:text-sm font-black text-blue-800 mt-1 truncate">
                        <Home className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        <span className="truncate">{prisma.casaAtual || 'Casa N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Delivery time metadata */}
                  <div className="bg-slate-50 rounded-lg p-2 my-1.5 border border-slate-100 text-xs space-y-0.5">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="flex items-center gap-1 text-slate-500 text-[11px]">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Entregue às {getTimeFormatted(prisma.horarioEntregaAtual)}
                      </span>
                      <span className="font-bold text-slate-700 bg-white px-1.5 py-0.2 rounded border border-slate-200 text-[10px]">
                        {getElapsed(prisma.horarioEntregaAtual)}
                      </span>
                    </div>

                    {prisma.fotoEntregaAtual && (
                      <div className="pt-0.5 flex items-center gap-1 text-indigo-700 font-semibold text-[10px]">
                        <Camera className="w-3 h-3" />
                        <span>Evidência fotográfica anexada</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Action: Instant Recolher / Baixa */}
                <div className="pt-1.5 mt-1 border-t border-slate-100 relative flex items-center justify-center min-h-[28px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenHistorico(prisma);
                    }}
                    className="absolute left-0 py-1.5 px-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                    title="Ver histórico do prisma"
                  >
                    Histórico
                  </button>

                  {isBeingProcessed ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                      <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Dando baixa...</span>
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-slate-500 text-center">
                      Clique no card para dar baixa
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
