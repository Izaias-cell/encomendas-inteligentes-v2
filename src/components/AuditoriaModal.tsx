import React, { useState, useEffect } from 'react';
import { AuditoriaLog } from '../types';
import { api } from '../services/api';
import { X, Shield, Search, Download, Filter, Clock, User } from 'lucide-react';

interface AuditoriaModalProps {
  isOpen: boolean;
  onClose: () => void;
  condominioId: string;
}

export const AuditoriaModal: React.FC<AuditoriaModalProps> = ({
  isOpen,
  onClose,
  condominioId,
}) => {
  const [logs, setLogs] = useState<AuditoriaLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [tipoAcao, setTipoAcao] = useState('TODAS');

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);

    api
      .getAuditoria(condominioId)
      .then((data) => {
        if (isMounted) setLogs(data.logs);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, condominioId]);

  if (!isOpen) return null;

  const logsFiltrados = logs.filter((log) => {
    const q = filtro.toLowerCase().trim();
    const matchTermo =
      !q ||
      log.detalhes.toLowerCase().includes(q) ||
      log.usuarioNome.toLowerCase().includes(q) ||
      (log.prismaNumero && log.prismaNumero.includes(q)) ||
      (log.prismaCorNome && log.prismaCorNome.toLowerCase().includes(q));

    const matchAcao = tipoAcao === 'TODAS' || log.acao === tipoAcao;

    return matchTermo && matchAcao;
  });

  const exportCSV = () => {
    const headers = 'Data/Hora,Acao,Prisma,Usuario,Turno,Detalhes\n';
    const rows = logsFiltrados
      .map(
        (l) =>
          `"${new Date(l.dataHora).toLocaleString()}","${l.acao}","${l.prismaNumero || ''} ${
            l.prismaCorNome || ''
          }","${l.usuarioNome}","${l.turnoNome}","${l.detalhes.replace(/"/g, '""')}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria-prismas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">Trilha de Auditoria & Segurança</h2>
              <span className="text-xs text-slate-400">
                Log imutável de todas as operações, trocas de turno e correções
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 min-w-[200px] items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar por porteiro, prisma ou detalhe..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500"
              />
            </div>

            <select
              value={tipoAcao}
              onChange={(e) => setTipoAcao(e.target.value)}
              className="text-xs font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 outline-none"
            >
              <option value="TODAS">Todas as Ações</option>
              <option value="ENTREGA_PRISMA">Entregas</option>
              <option value="DEVOLUCAO_PRISMA">Devoluções</option>
              <option value="PENDENCIA_REGISTRADA">Pendências</option>
              <option value="PENDENCIA_RESOLVIDA">Resoluções</option>
              <option value="CORRECAO_MOVIMENTACAO">Correções</option>
              <option value="TROCA_TURNO">Trocas de Turno</option>
              <option value="CADASTRO_PRISMA">Novos Prismas</option>
            </select>
          </div>

          <button
            onClick={exportCSV}
            className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>

        {/* Logs List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Carregando registros de auditoria...
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Nenhum registro de auditoria encontrado.
            </div>
          ) : (
            logsFiltrados.map((log) => (
              <div
                key={log.id}
                className="bg-white p-3 rounded-xl border border-slate-200 text-xs shadow-2xs hover:border-slate-300 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] text-slate-400 font-bold">
                      {log.acao}
                    </span>
                    {log.prismaNumero && (
                      <span className="font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                        Prisma {log.prismaNumero} {log.prismaCorNome}
                      </span>
                    )}
                  </div>
                  <p className="font-medium text-slate-800">{log.detalhes}</p>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-400" />
                      {log.usuarioNome} ({log.usuarioCargo})
                    </span>
                    <span>•</span>
                    <span>{log.turnoNome}</span>
                  </div>
                </div>

                <div className="text-right sm:flex-shrink-0">
                  <span className="text-[11px] font-bold text-slate-700 block">
                    {new Date(log.dataHora).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(log.dataHora).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Total: {logsFiltrados.length} eventos auditados</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
