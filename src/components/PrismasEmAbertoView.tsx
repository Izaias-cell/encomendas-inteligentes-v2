import React, { useState } from 'react';
import { Prisma, PrismaEstado, Usuario } from '../types';
import { PrismaVisual } from './PrismaVisual';
import { sortPrismasNumericos } from '../utils/prismaSort';
import {
  Clock,
  Home,
  AlertTriangle,
  Camera,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

interface PrismasEmAbertoViewProps {
  prismas: Prisma[];
  onReceberPrisma: (
    prismaId: string,
    options?: { origin?: 'CARD' | 'BUTTON' }
  ) => Promise<void>;
  onRegistrarPendencia: (prismaId: string, motivo: string) => Promise<void>;
  onResolverPendencia: (prismaId: string, novoEstado: string, justificativa: string) => Promise<void>;
  onOpenHistorico: (prisma: Prisma) => void;
  usuarioAtual: Usuario;
  isLoading: boolean;
}

export const PrismasEmAbertoView: React.FC<PrismasEmAbertoViewProps> = ({
  prismas,
  onReceberPrisma,
  onRegistrarPendencia,
  onResolverPendencia,
  onOpenHistorico,
  usuarioAtual,
  isLoading,
}) => {
  const [activeTab, setActiveTab] = useState<'TODOS' | 'EM_USO' | 'PENDENTES'>('TODOS');
  const [pendenciaModalPrisma, setPendenciaModalPrisma] = useState<Prisma | null>(null);
  const [motivoPendencia, setMotivoPendencia] = useState('');
  const [resolverModalPrisma, setResolverModalPrisma] = useState<Prisma | null>(null);
  const [novoEstadoResolucao, setNovoEstadoResolucao] = useState<PrismaEstado>(PrismaEstado.DISPONIVEL);
  const [justificativaResolucao, setJustificativaResolucao] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const emUso = React.useMemo(() => sortPrismasNumericos(prismas.filter((p) => p.estado === PrismaEstado.EM_USO)), [prismas]);
  const pendentes = React.useMemo(() => sortPrismasNumericos(prismas.filter((p) => p.estado === PrismaEstado.PENDENTE)), [prismas]);

  const listToDisplay = React.useMemo(() => {
    if (activeTab === 'EM_USO') return emUso;
    if (activeTab === 'PENDENTES') return pendentes;
    return sortPrismasNumericos([...emUso, ...pendentes]);
  }, [activeTab, emUso, pendentes]);

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

  const handleOpenPendencia = (prisma: Prisma) => {
    setPendenciaModalPrisma(prisma);
    setMotivoPendencia('');
    setActionError(null);
  };

  const handleConfirmPendencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendenciaModalPrisma || !motivoPendencia.trim()) return;
    try {
      await onRegistrarPendencia(pendenciaModalPrisma.id, motivoPendencia.trim());
      setPendenciaModalPrisma(null);
    } catch (err: any) {
      setActionError(err.message || 'Erro ao registrar pendência.');
    }
  };

  const handleOpenResolver = (prisma: Prisma) => {
    setResolverModalPrisma(prisma);
    setNovoEstadoResolucao(PrismaEstado.DISPONIVEL);
    setJustificativaResolucao('');
    setActionError(null);
  };

  const handleConfirmResolver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolverModalPrisma || !justificativaResolucao.trim()) return;
    try {
      await onResolverPendencia(
        resolverModalPrisma.id,
        novoEstadoResolucao,
        justificativaResolucao.trim()
      );
      setResolverModalPrisma(null);
    } catch (err: any) {
      setActionError(err.message || 'Erro ao resolver pendência.');
    }
  };

  return (
    <div id="view-prismas-em-aberto" className="space-y-3">
      {/* Top Filter Buttons */}
      <div className="flex items-center justify-between gap-2 bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-black uppercase text-slate-800">
            PRISMAS PENDENTES ({listToDisplay.length})
          </span>
        </div>

        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg gap-0.5 text-xs font-bold">
          <button
            onClick={() => setActiveTab('TODOS')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer text-[11px] ${
              activeTab === 'TODOS'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Todos ({emUso.length + pendentes.length})
          </button>
          <button
            onClick={() => setActiveTab('EM_USO')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer text-[11px] ${
              activeTab === 'EM_USO'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-blue-700'
            }`}
          >
            Em Uso ({emUso.length})
          </button>
          <button
            onClick={() => setActiveTab('PENDENTES')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer text-[11px] ${
              activeTab === 'PENDENTES'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-amber-700'
            }`}
          >
            Pendentes ({pendentes.length})
          </button>
        </div>
      </div>

      {/* Grid of Open Prisms */}
      {listToDisplay.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 p-5">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
          <h3 className="text-sm sm:text-base font-bold text-slate-800">Nenhum prisma em aberto no momento!</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Todos os prismas do condomínio estão guardados e disponíveis para nova entrega.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          {listToDisplay.map((prisma) => {
            const isPendente = prisma.estado === PrismaEstado.PENDENTE;

            return (
              <div
                key={prisma.id}
                id={`card-aberto-${prisma.id}`}
                className={`bg-white rounded-xl border p-3 sm:p-3.5 shadow-2xs flex flex-col justify-between transition-all ${
                  isPendente
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-slate-200 hover:border-slate-400'
                }`}
              >
                <div>
                  {/* Status Ribbon */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] sm:text-xs font-black uppercase text-slate-800">
                      {prisma.corNome.toUpperCase()}
                    </span>

                    {isPendente ? (
                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        PENDENTE
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.2 rounded-full uppercase">
                        EM USO
                      </span>
                    )}
                  </div>

                  {/* Physical Prisma Miniature & House Details */}
                  <div className="flex items-center gap-3.5 my-2">
                    <PrismaVisual
                      numero={prisma.numero}
                      corIdOrNome={prisma.corNome}
                      size="sm"
                      className="flex-shrink-0"
                    />

                    <div className="min-w-0">
                      <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight truncate">
                        {prisma.numero} — {prisma.corNome.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-1 text-xs sm:text-sm font-black text-slate-900 mt-1 truncate">
                        <Home className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        <span className="truncate">{prisma.casaAtual || 'Unidade não definida'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Observation or pending details */}
                  {isPendente ? (
                    <div className="bg-amber-100/60 border border-amber-200 rounded-lg p-2 my-1.5 text-xs text-amber-900">
                      <p className="font-bold flex items-center gap-1 text-[11px]">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
                        Pendência:
                      </p>
                      <p className="mt-0.5 text-[11px]">{prisma.observacao || 'Requer conferência da portaria.'}</p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 my-1.5 text-xs space-y-0.5 text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-slate-500 text-[11px]">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Desde {getTimeFormatted(prisma.horarioEntregaAtual)}
                        </span>
                        <span className="font-bold text-slate-800 bg-white px-1.5 py-0.2 rounded border border-slate-200 text-[10px]">
                          {getElapsed(prisma.horarioEntregaAtual)}
                        </span>
                      </div>

                      {prisma.fotoEntregaAtual && (
                        <div className="pt-0.5 flex items-center gap-1 text-indigo-700 font-semibold text-[10px]">
                          <Camera className="w-3 h-3" />
                          <span>Foto anexada</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Action footer */}
                <div className="pt-1.5 mt-1 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => onOpenHistorico(prisma)}
                    className="text-xs font-semibold px-2 py-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    Histórico
                  </button>

                  {!isPendente ? (
                    <>
                      <button
                        onClick={() => handleOpenPendencia(prisma)}
                        className="text-xs font-semibold px-2 py-1.5 text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                      >
                        ⚠️ Pendência
                      </button>

                      <button
                        disabled={isLoading}
                        onClick={() => onReceberPrisma(prisma.id, { origin: 'BUTTON' })}
                        className="flex-1 text-xs font-bold py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Recolher</span>
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={isLoading}
                      onClick={() => handleOpenResolver(prisma)}
                      className="flex-1 text-xs font-bold py-1.5 px-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Resolver Pendência</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Registrar Pendência */}
      {pendenciaModalPrisma && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-amber-600 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-black text-base">Registrar Pendência</h3>
              </div>
              <button
                onClick={() => setPendenciaModalPrisma(null)}
                className="text-amber-100 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmPendencia} className="p-4 sm:p-5 space-y-3.5">
              <p className="text-xs text-slate-600">
                Prisma: <span className="font-bold">{pendenciaModalPrisma.numero} — {pendenciaModalPrisma.corNome}</span> ({pendenciaModalPrisma.casaAtual || 'Unidade'})
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Motivo da Pendência *
                </label>
                <textarea
                  required
                  rows={3}
                  value={motivoPendencia}
                  onChange={(e) => setMotivoPendencia(e.target.value)}
                  placeholder="Ex: Visitante saiu sem devolver o prisma; Não localizado no veículo; Prisma esquecido na casa..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
              </div>

              {actionError && <p className="text-xs text-rose-600 font-bold">{actionError}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendenciaModalPrisma(null)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !motivoPendencia.trim()}
                  className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow cursor-pointer disabled:opacity-50"
                >
                  Confirmar Pendência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Resolver Pendência */}
      {resolverModalPrisma && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-black text-base">Resolver Pendência</h3>
              </div>
              <button
                onClick={() => setResolverModalPrisma(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmResolver} className="p-4 sm:p-5 space-y-3.5">
              <p className="text-xs text-slate-600">
                Prisma: <span className="font-bold">{resolverModalPrisma.numero} — {resolverModalPrisma.corNome}</span>
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Novo Estado do Prisma
                </label>
                <select
                  value={novoEstadoResolucao}
                  onChange={(e) => setNovoEstadoResolucao(e.target.value as PrismaEstado)}
                  className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-xl font-bold"
                >
                  <option value={PrismaEstado.DISPONIVEL}>DISPONÍVEL (Prisma recuperado)</option>
                  <option value={PrismaEstado.INDISPONIVEL}>INDISPONÍVEL (Danificado / Perdido)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Justificativa da Resolução (Obrigatório para Auditoria) *
                </label>
                <textarea
                  required
                  rows={3}
                  value={justificativaResolucao}
                  onChange={(e) => setJustificativaResolucao(e.target.value)}
                  placeholder="Ex: Prisma recolhido na portaria pelo morador; Localizado e conferido em bom estado..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>

              {actionError && <p className="text-xs text-rose-600 font-bold">{actionError}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setResolverModalPrisma(null)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !justificativaResolucao.trim()}
                  className="px-4 py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow cursor-pointer disabled:opacity-50"
                >
                  Resolver e Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
