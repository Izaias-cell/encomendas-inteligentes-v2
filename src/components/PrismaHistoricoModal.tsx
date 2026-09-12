import React, { useState, useEffect } from 'react';
import { Prisma, Movimentacao, AuditoriaLog, Usuario, UserRole } from '../types';
import { getCorConfig } from '../constants/cores';
import { PrismaVisual } from './PrismaVisual';
import { FotoEvidenciaModal } from './FotoEvidenciaModal';
import { api } from '../services/api';
import {
  X,
  Clock,
  Home,
  User,
  Camera,
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
  Edit3,
  History,
  Shield,
  CheckCircle2,
} from 'lucide-react';

interface PrismaHistoricoModalProps {
  prismaId: string | null;
  onClose: () => void;
  usuarioAtual: Usuario;
  condominioId: string;
  onUpdateSuccess: () => void;
}

export const PrismaHistoricoModal: React.FC<PrismaHistoricoModalProps> = ({
  prismaId,
  onClose,
  usuarioAtual,
  condominioId,
  onUpdateSuccess,
}) => {
  const [prisma, setPrisma] = useState<Prisma | null>(null);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [auditoriaLogs, setAuditoriaLogs] = useState<AuditoriaLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFotoMov, setSelectedFotoMov] = useState<Movimentacao | null>(null);

  // Correction state
  const [editingMov, setEditingMov] = useState<Movimentacao | null>(null);
  const [novaCasa, setNovaCasa] = useState('');
  const [motivoCorrecao, setMotivoCorrecao] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);

  useEffect(() => {
    if (!prismaId) return;

    let isMounted = true;
    setIsLoading(true);

    api
      .getHistoricoPrisma(prismaId, condominioId)
      .then((data) => {
        if (isMounted) {
          setPrisma(data.prisma);
          setMovimentacoes(data.movimentacoes);
          setAuditoriaLogs(data.auditoria);
        }
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [prismaId, condominioId]);

  if (!prismaId) return null;

  const corConfig = prisma ? getCorConfig(prisma.corId || prisma.corNome) : null;

  const handleOpenCorrection = (mov: Movimentacao) => {
    setEditingMov(mov);
    setNovaCasa(mov.casa);
    setMotivoCorrecao('');
    setCorrectionError(null);
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMov || !novaCasa.trim() || !motivoCorrecao.trim()) {
      setCorrectionError('Nova casa e motivo da correção são obrigatórios.');
      return;
    }

    setIsSavingCorrection(true);
    setCorrectionError(null);
    try {
      await api.corrigirMovimentacao({
        movimentacaoId: editingMov.id,
        novaCasa: novaCasa.trim(),
        motivoCorrecao: motivoCorrecao.trim(),
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
        condominioId,
      });

      // Reload
      const updated = await api.getHistoricoPrisma(prismaId, condominioId);
      setPrisma(updated.prisma);
      setMovimentacoes(updated.movimentacoes);
      setAuditoriaLogs(updated.auditoria);
      setEditingMov(null);
      onUpdateSuccess();
    } catch (err: any) {
      setCorrectionError(err.message || 'Erro ao salvar correção.');
    } finally {
      setIsSavingCorrection(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {prisma && (
              <PrismaVisual
                numero={prisma.numero}
                corIdOrNome={prisma.corNome}
                size="sm"
              />
            )}
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Histórico Operacional & Auditoria
              </span>
              <h2 className="text-base sm:text-lg font-black leading-tight text-white">
                PRISMA {prisma?.numero} — {prisma?.corNome?.toUpperCase()}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span>Carregando histórico do prisma...</span>
            </div>
          ) : (
            <>
              {/* Prisma Current State Card */}
              {prisma && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      Estado Atual
                    </span>
                    <span className="text-sm font-black text-slate-900">{prisma.estado}</span>
                  </div>

                  {prisma.casaAtual && (
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">
                        Unidade / Casa
                      </span>
                      <span className="text-sm font-bold text-blue-700">{prisma.casaAtual}</span>
                    </div>
                  )}

                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      ID Técnico
                    </span>
                    <span className="font-mono text-slate-600">{prisma.id}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">
                      Cadastro
                    </span>
                    <span className="text-slate-600">
                      {new Date(prisma.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}

              {/* TIMELINE OF MOVEMENTS */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-600" />
                  Linha do Tempo de Movimentações ({movimentacoes.length})
                </h3>

                {movimentacoes.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-400 border border-dashed rounded-xl">
                    Nenhuma movimentação registrada para este prisma.
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-200 ml-3.5 space-y-4 pb-2">
                    {movimentacoes.map((mov) => {
                      const isEntrega = mov.tipo === 'ENTREGA';
                      return (
                        <div key={mov.id} className="relative pl-6">
                          {/* Dot */}
                          <div
                            className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 border-white ${
                              isEntrega ? 'bg-emerald-600' : 'bg-blue-600'
                            }`}
                          />

                          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs hover:border-slate-300 transition-colors space-y-2">
                            {/* Top row */}
                            <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                              <span
                                className={`font-black flex items-center gap-1 ${
                                  isEntrega ? 'text-emerald-700' : 'text-blue-700'
                                }`}
                              >
                                {isEntrega ? (
                                  <>
                                    <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                                    ENTREGA
                                  </>
                                ) : (
                                  <>
                                    <ArrowDownLeft className="w-3.5 h-3.5 stroke-[2.5]" />
                                    DEVOLUÇÃO
                                  </>
                                )}
                              </span>

                              <span className="text-[11px] text-slate-400">
                                {new Date(mov.dataHora).toLocaleString([], {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </span>
                            </div>

                            {/* Details */}
                            <div className="flex flex-wrap items-center justify-between text-xs text-slate-700 gap-2">
                              <span className="font-bold flex items-center gap-1">
                                <Home className="w-3.5 h-3.5 text-blue-600" />
                                {mov.casa}
                              </span>

                              <span className="text-slate-500 flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                Porteiro: <strong className="text-slate-700">{mov.usuarioNome}</strong> ({mov.turnoNome})
                              </span>
                            </div>

                            {/* Correction note if any */}
                            {mov.motivoCorrecao && (
                              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                                <strong>⚠️ Registro Corrigido:</strong> {mov.motivoCorrecao}
                              </div>
                            )}

                            {/* Photo Evidence button */}
                            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                              {mov.fotoEvidenciaUrl ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedFotoMov(mov)}
                                  className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors"
                                >
                                  <Camera className="w-3.5 h-3.5" />
                                  <span>Visualizar Foto de Evidência</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">Sem foto</span>
                              )}

                              {/* Correction trigger for supervisor / admin */}
                              {usuarioAtual.role !== UserRole.PORTEIRO && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenCorrection(mov)}
                                  className="text-xs text-slate-600 hover:text-blue-600 flex items-center gap-1 font-semibold cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Corrigir Casa
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* AUDIT LOGS FOR THIS PRISM */}
              <div className="pt-3 border-t border-slate-200">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  Trilha de Auditoria do Prisma ({auditoriaLogs.length})
                </h3>

                <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px]">
                  {auditoriaLogs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-slate-800">{log.detalhes}</span>
                        <span className="block text-slate-500 text-[10px]">
                          Por: {log.usuarioNome} ({log.usuarioCargo}) • {log.turnoNome}
                        </span>
                      </div>
                      <span className="text-slate-400 whitespace-nowrap text-[10px]">
                        {new Date(log.dataHora).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Fechar Histórico
          </button>
        </div>
      </div>

      {/* Photo Viewer Submodal */}
      <FotoEvidenciaModal
        movimentacao={selectedFotoMov}
        onClose={() => setSelectedFotoMov(null)}
      />

      {/* Correction Form Submodal */}
      {editingMov && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
              <h4 className="font-black text-sm">Corrigir Registro de Movimentação</h4>
              <button onClick={() => setEditingMov(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCorrection} className="p-5 space-y-4">
              <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border">
                ℹ️ <strong className="text-slate-900">Regra de Auditoria:</strong> Toda correção fica gravada de forma permanente com o motivo, seu nome e data/hora.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Casa Registrada Anteriormente: <span className="text-slate-500 font-normal">{editingMov.casa}</span>
                </label>
                <input
                  type="text"
                  required
                  value={novaCasa}
                  onChange={(e) => setNovaCasa(e.target.value)}
                  placeholder="Nova identificação da casa..."
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-xl font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Motivo da Correção (Obrigatório) *
                </label>
                <textarea
                  required
                  rows={2}
                  value={motivoCorrecao}
                  onChange={(e) => setMotivoCorrecao(e.target.value)}
                  placeholder="Ex: Porteiro digitou 42 por engano quando era 43; Conferido com morador..."
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              {correctionError && (
                <p className="text-xs text-rose-600 font-bold">{correctionError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMov(null)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingCorrection || !novaCasa.trim() || !motivoCorrecao.trim()}
                  className="px-4 py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow cursor-pointer disabled:opacity-50"
                >
                  {isSavingCorrection ? 'Salvando...' : 'Salvar Correção Auditável'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
