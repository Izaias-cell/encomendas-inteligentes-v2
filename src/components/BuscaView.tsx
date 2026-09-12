import React, { useState } from 'react';
import { Prisma, PrismaEstado, Movimentacao } from '../types';
import { getCorConfig, CORES_DISPONIVEIS } from '../constants/cores';
import { PrismaVisual } from './PrismaVisual';
import { FotoEvidenciaModal } from './FotoEvidenciaModal';
import { sortPrismasNumericos } from '../utils/prismaSort';
import {
  Search,
  Filter,
  Home,
  History,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Navigation,
  Camera,
} from 'lucide-react';

interface BuscaViewProps {
  prismas: Prisma[];
  movimentacoes: Movimentacao[];
  termo?: string;
  onOpenHistorico: (prisma: Prisma) => void;
  onOpenHistoricoById: (prismaId: string) => void;
}

export const BuscaView: React.FC<BuscaViewProps> = ({
  prismas,
  movimentacoes,
  termo = '',
  onOpenHistorico,
  onOpenHistoricoById,
}) => {
  const [selectedFotoMov, setSelectedFotoMov] = useState<Movimentacao | null>(null);

  // Filter prisms based on inline search term
  const prismasFiltrados = React.useMemo(() => {
    const q = termo.toLowerCase().trim();
    const list = prismas.filter((p) => {
      if (!q) return true;
      return (
        p.numero.toLowerCase().includes(q) ||
        p.corNome.toLowerCase().includes(q) ||
        (p.casaAtual && p.casaAtual.toLowerCase().includes(q))
      );
    });
    return sortPrismasNumericos(list);
  }, [prismas, termo]);

  // Filter recent historical movements if searching by house, number or name
  const movimentacoesFiltradas = termo.trim()
    ? movimentacoes.filter((m) => {
        const q = termo.toLowerCase().trim();
        return (
          m.casa.toLowerCase().includes(q) ||
          m.prismaNumero.toLowerCase().includes(q) ||
          m.prismaCorNome.toLowerCase().includes(q) ||
          m.usuarioNome.toLowerCase().includes(q)
        );
      })
    : [];

  const getEstadoBadge = (estado: PrismaEstado) => {
    switch (estado) {
      case PrismaEstado.DISPONIVEL:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            DISPONÍVEL
          </span>
        );
      case PrismaEstado.EM_USO:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300">
            <Navigation className="w-3 h-3 text-blue-600" />
            EM USO
          </span>
        );
      case PrismaEstado.PENDENTE:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            PENDENTE
          </span>
        );
      case PrismaEstado.INDISPONIVEL:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300">
            <Ban className="w-3 h-3 text-slate-500" />
            INDISPONÍVEL
          </span>
        );
    }
  };

  return (
    <div id="view-busca-rapida" className="space-y-3">
      {/* Informação sobre resultados da busca */}
      {termo.trim() ? (
        <div className="flex items-center justify-between px-1 text-xs text-slate-600">
          <span>
            Buscando por: <strong className="text-purple-900 font-black">"{termo}"</strong>
          </span>
          <span className="font-bold text-slate-500">
            {prismasFiltrados.length} {prismasFiltrados.length === 1 ? 'prisma encontrado' : 'prismas encontrados'}
          </span>
        </div>
      ) : null}

      {/* Empty State if no prism matches */}
      {prismasFiltrados.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-5">
          <Search className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-70" />
          <h3 className="text-sm font-bold text-slate-800">
            Nenhum prisma encontrado para "{termo}"
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Verifique o número (ex: 08), cor (ex: Azul) ou casa (ex: Casa 42).
          </p>
        </div>
      ) : (
        /* Results Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          {prismasFiltrados.map((prisma) => (
            <div
              key={prisma.id}
              className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] sm:text-xs font-black uppercase text-slate-800">
                    {prisma.corNome.toUpperCase()}
                  </span>
                  {getEstadoBadge(prisma.estado)}
                </div>

                <div className="flex items-center gap-3.5 my-2">
                  <PrismaVisual
                    numero={prisma.numero}
                    corIdOrNome={prisma.corNome}
                    size="sm"
                    className="flex-shrink-0"
                  />

                  <div className="min-w-0">
                    <h4 className="text-lg sm:text-xl font-black text-slate-900 leading-tight truncate">
                      {prisma.numero} — {prisma.corNome.toUpperCase()}
                    </h4>
                    {prisma.casaAtual && (
                      <div className="flex items-center gap-1 text-xs font-black text-blue-800 mt-1 truncate">
                        <Home className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        <span className="truncate">{prisma.casaAtual}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-1.5 mt-1 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  Cadastrado em {new Date(prisma.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenHistorico(prisma)}
                  className="text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  Histórico
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Historical movements matching search term */}
      {movimentacoesFiltradas.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs mt-3">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-purple-600" />
            Movimentações Correspondentes ({movimentacoesFiltradas.length})
          </h3>

          <div className="space-y-1.5">
            {movimentacoesFiltradas.map((m) => {
              const cor = getCorConfig(m.prismaCorNome);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: cor.hex }}
                    />
                    <span className="font-black text-slate-900">
                      Prisma {m.prismaNumero} {m.prismaCorNome}
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="font-bold text-blue-800">{m.casa}</span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-500">
                      {m.tipo === 'ENTREGA' ? 'Entregue' : 'Recolhido'} por {m.usuarioNome}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    {m.fotoEvidenciaUrl && (
                      <button
                        type="button"
                        onClick={() => setSelectedFotoMov(m)}
                        className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 border border-indigo-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Ver foto ampliada e compartilhar"
                      >
                        <Camera className="w-2.5 h-2.5 text-indigo-600" />
                        <span>Foto</span>
                      </button>
                    )}
                    <span>{new Date(m.dataHora).toLocaleString()}</span>
                    <button
                      onClick={() => onOpenHistoricoById(m.prismaId)}
                      className="font-bold text-purple-600 hover:underline cursor-pointer"
                    >
                      Histórico
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal de Foto e Compartilhamento */}
      <FotoEvidenciaModal
        movimentacao={selectedFotoMov}
        onClose={() => setSelectedFotoMov(null)}
      />
    </div>
  );
};
