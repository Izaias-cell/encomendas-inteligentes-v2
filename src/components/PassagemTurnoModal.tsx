import React, { useState } from 'react';
import { Prisma, Turno, Usuario, PrismaEstado } from '../types';
import { getCorConfig } from '../constants/cores';
import { PrismaVisual } from './PrismaVisual';
import {
  Clock,
  UserCheck,
  CheckCircle,
  X,
  Navigation,
  FileText,
  AlertCircle,
} from 'lucide-react';

interface PassagemTurnoModalProps {
  isOpen: boolean;
  onClose: () => void;
  turnoAtivo?: Turno;
  prismasEmUso: Prisma[];
  usuarios: Usuario[];
  usuarioAtual: Usuario;
  onConfirmAssumirTurno: (params: {
    porteiroId: string;
    porteiroNome: string;
    nomeTurno: string;
    notasPassagem?: string;
  }) => Promise<void>;
  isLoading: boolean;
}

export const PassagemTurnoModal: React.FC<PassagemTurnoModalProps> = ({
  isOpen,
  onClose,
  turnoAtivo,
  prismasEmUso,
  usuarios,
  usuarioAtual,
  onConfirmAssumirTurno,
  isLoading,
}) => {
  const [selectedPorteiroId, setSelectedPorteiroId] = useState(usuarioAtual.id);
  const [nomeTurno, setNomeTurno] = useState(
    new Date().getHours() >= 18 || new Date().getHours() < 6
      ? 'Turno Noturno (18h - 06h)'
      : 'Turno Diurno (06h - 18h)'
  );
  const [notasPassagem, setNotasPassagem] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const porteiro = usuarios.find((u) => u.id === selectedPorteiroId);
    if (!porteiro) {
      setErrorMsg('Selecione o porteiro que está assumindo o turno.');
      return;
    }

    setErrorMsg(null);
    try {
      await onConfirmAssumirTurno({
        porteiroId: porteiro.id,
        porteiroNome: porteiro.nome,
        nomeTurno: nomeTurno.trim(),
        notasPassagem: notasPassagem.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao assumir turno.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 font-bold">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">Troca de Turno / Assunção de Posto</h2>
              <span className="text-xs text-slate-400">
                Conferência de prismas em uso para passagem de serviço
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

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* CRITICAL SECTION: PRISMAS EM USO NA ASSUNÇÃO */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                <Navigation className="w-4 h-4 text-blue-600" />
                PRISMAS EM USO NO MOMENTO ({prismasEmUso.length})
              </span>
              <span className="text-[11px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
                Passagem Obrigatória
              </span>
            </div>

            <p className="text-xs text-blue-800 mb-3">
              O porteiro que assume o posto deve estar ciente destes prismas entregues:
            </p>

            {prismasEmUso.length === 0 ? (
              <div className="text-xs text-emerald-800 bg-emerald-100/70 p-2.5 rounded-lg font-semibold flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                Excelente! Nenhum prisma está em circulação no momento.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {prismasEmUso.map((p) => {
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between bg-white p-2 rounded-lg border border-blue-200 text-xs shadow-2xs gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PrismaVisual
                          numero={p.numero}
                          corIdOrNome={p.corNome}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="font-black text-slate-900 truncate block">
                            {p.numero} — {p.corNome.toUpperCase()}
                          </span>
                          <span className="font-bold text-blue-700 truncate block">
                            {p.casaAtual || 'Casa N/A'}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-500 flex-shrink-0">
                        {p.horarioEntregaAtual
                          ? `Desde ${new Date(p.horarioEntregaAtual).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Porteiro que assume */}
          <div>
            <label className="block text-xs font-bold text-slate-800 uppercase mb-1 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-slate-500" />
              Porteiro que está assumindo o posto *
            </label>
            <select
              value={selectedPorteiroId}
              onChange={(e) => setSelectedPorteiroId(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
            >
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} ({u.cargo || u.role})
                </option>
              ))}
            </select>
          </div>

          {/* Nome / Identificação do Turno */}
          <div>
            <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
              Nome / Horário do Turno *
            </label>
            <input
              type="text"
              required
              value={nomeTurno}
              onChange={(e) => setNomeTurno(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900"
            />
          </div>

          {/* Notas de Passagem */}
          <div>
            <label className="block text-xs font-bold text-slate-800 uppercase mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              Observações da Passagem de Turno (Opcional)
            </label>
            <textarea
              rows={2}
              value={notasPassagem}
              onChange={(e) => setNotasPassagem(e.target.value)}
              placeholder="Ex: Rádio HT 02 carregando; Tudo em ordem na portaria..."
              className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:border-blue-500 outline-none"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="w-2/3 py-2.5 text-xs font-black uppercase text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Assumir Turno Agora</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
