import React, { useState } from 'react';
import { Movimentacao, MovimentacaoTipo } from '../types';
import { getCorConfig } from '../constants/cores';
import { FotoEvidenciaModal } from './FotoEvidenciaModal';
import {
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownLeft,
  Camera,
  ExternalLink,
} from 'lucide-react';

interface UltimasMovimentacoesProps {
  movimentacoes: Movimentacao[];
  onOpenHistoricoById: (prismaId: string) => void;
  onOpenAuditoria: () => void;
}

export const UltimasMovimentacoes: React.FC<UltimasMovimentacoesProps> = ({
  movimentacoes,
  onOpenHistoricoById,
  onOpenAuditoria,
}) => {
  // O estado padrão DEVE ser minimizado (false)
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [selectedFotoMovimentacao, setSelectedFotoMovimentacao] = useState<Movimentacao | null>(null);

  const getTimeFormatted = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const totalRecentes = movimentacoes.length;

  return (
    <>
      <section
        id="card-slim-ultimas-movimentacoes"
        className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden transition-all duration-200"
      >
        {/* Header Slim Minimizado (Clickable toggle button) */}
        <button
          id="btn-toggle-ultimas-movimentacoes"
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full p-3 sm:p-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer select-none"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-black uppercase tracking-wide text-slate-800 flex items-center gap-2">
                <span>ÚLTIMAS MOVIMENTAÇÕES</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600">
                  {totalRecentes}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {totalRecentes === 0
                  ? 'Nenhuma movimentação registrada no turno'
                  : `${totalRecentes} movimentaç${totalRecentes === 1 ? 'ão recente' : 'ões recentes'}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-slate-400">
            <span className="text-[11px] font-semibold hidden sm:inline text-slate-500">
              {isExpanded ? 'Ocultar' : 'Ver detalhes'}
            </span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-slate-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-600" />
            )}
          </div>
        </button>

        {/* Expanded Details Section */}
        {isExpanded && (
          <div
            id="ultimas-movimentacoes-conteudo-expandido"
            className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/50 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {totalRecentes === 0 ? (
              <div className="text-center py-4 text-xs text-slate-400">
                Nenhuma movimentação registrada no histórico recente.
              </div>
            ) : (
              <div className="space-y-1.5">
                {movimentacoes.slice(0, 5).map((mov) => {
                  const cor = getCorConfig(mov.prismaCorNome);
                  const isEntrega = mov.tipo === MovimentacaoTipo.ENTREGA;

                  return (
                    <div
                      key={mov.id}
                      className="p-2 sm:p-2.5 bg-white rounded-lg border border-slate-200/80 flex items-center justify-between gap-2 text-xs shadow-2xs hover:border-slate-300 transition-colors"
                    >
                      {/* Timestamp & Direction */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-500 text-[11px] sm:text-xs">
                          {getTimeFormatted(mov.dataHora)}
                        </span>

                        <div
                          className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                            isEntrega
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                          title={isEntrega ? 'Entrega' : 'Recebimento'}
                        >
                          {isEntrega ? (
                            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                          ) : (
                            <ArrowDownLeft className="w-3.5 h-3.5 stroke-[2.5]" />
                          )}
                        </div>

                        {/* Prisma, Color & House */}
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cor.hex }}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenHistoricoById(mov.prismaId)}
                            className="font-black text-slate-900 hover:text-blue-600 hover:underline cursor-pointer truncate text-[11px] sm:text-xs"
                          >
                            {mov.prismaNumero} — {mov.prismaCorNome.toUpperCase()}
                          </button>
                          <span className="text-slate-400">·</span>
                          <span className="font-bold text-slate-700 truncate text-[11px] sm:text-xs">
                            {mov.casa}
                          </span>
                        </div>
                      </div>

                      {/* Operator & Photo */}
                      <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px] sm:text-[11px]">
                        {mov.fotoEvidenciaUrl && (
                          <button
                            type="button"
                            onClick={() => setSelectedFotoMovimentacao(mov)}
                            className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 border border-indigo-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                            title="Tocar para ver foto ampliada e compartilhar"
                          >
                            <Camera className="w-3 h-3 text-indigo-600" />
                            <span>Foto</span>
                          </button>
                        )}
                        <span className="text-slate-400 hidden sm:inline">
                          por {mov.usuarioNome.split(' ')[0]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer of Expanded Card: Link to Complete Audit Trail */}
            <div className="pt-2 flex items-center justify-end">
              <button
                id="btn-ver-auditoria-completa-expanded"
                type="button"
                onClick={onOpenAuditoria}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 bg-white hover:bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <span>Ver Auditoria Completa</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal de visualização ampliada e compartilhamento da evidência */}
      <FotoEvidenciaModal
        movimentacao={selectedFotoMovimentacao}
        onClose={() => setSelectedFotoMovimentacao(null)}
      />
    </>
  );
};
