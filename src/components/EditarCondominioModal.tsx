import React, { useState, useEffect } from 'react';
import { Building2, X, Check, AlertCircle } from 'lucide-react';
import { Condominio, Usuario } from '../types';
import { api } from '../services/api';

interface EditarCondominioModalProps {
  isOpen: boolean;
  onClose: () => void;
  condominio?: Condominio;
  usuarioAtual: Usuario;
  onSuccess: (condominioAtualizado: Condominio) => void;
}

export const EditarCondominioModal: React.FC<EditarCondominioModalProps> = ({
  isOpen,
  onClose,
  condominio,
  usuarioAtual,
  onSuccess,
}) => {
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [mostrarMensagem, setMostrarMensagem] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (condominio && isOpen) {
      setNome(condominio.nome || '');
      setEndereco(condominio.endereco || '');
      setMostrarMensagem(condominio.mostrarMensagem !== false);
      setError(null);
    }
  }, [condominio, isOpen]);

  if (!isOpen || !condominio) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setError('O nome do condomínio não pode ficar em branco.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await api.atualizarCondominio(condominio.id, {
        nome: nome.trim(),
        endereco: endereco.trim(),
        mostrarMensagem,
        usuarioId: usuarioAtual.id,
        usuarioNome: usuarioAtual.nome,
      });

      if (res.success && res.condominio) {
        try {
          if (res.condominio.nome) {
            localStorage.setItem(`condo_nome_${condominio.id}`, res.condominio.nome);
          }
          if (res.condominio.endereco) {
            localStorage.setItem(`condo_endereco_${condominio.id}`, res.condominio.endereco);
          }
        } catch {
          // Ignore localStorage errors
        }
        onSuccess(res.condominio);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar informações do condomínio.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="modal-editar-condominio-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        id="modal-editar-condominio-container"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                EDITAR CONDOMÍNIO
              </h2>
              <p className="text-xs text-slate-400">
                Altere o nome e informações cadastrais da unidade
              </p>
            </div>
          </div>
          <button
            id="btn-fechar-editar-condominio"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Nome do Condomínio <span className="text-rose-400">*</span>
            </label>
            <input
              id="input-nome-condominio"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do condomínio"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition-all"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Endereço / Referência (Opcional)
            </label>
            <input
              id="input-endereco-condominio"
              type="text"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Ex: Rua Santo Agostinho, 419"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition-all"
            />
          </div>

          {/* Mensagens de Entrega e Recolhimento */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  MOSTRAR MENSAGEM
                </span>
                <span
                  className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    mostrarMensagem
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mostrarMensagem ? 'ON' : 'OFF'}
                </span>
              </div>

              <button
                type="button"
                id="btn-toggle-mostrar-mensagem-modal"
                onClick={() => setMostrarMensagem(!mostrarMensagem)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  mostrarMensagem ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
                role="switch"
                aria-checked={mostrarMensagem}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    mostrarMensagem ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Quando ativado, o sistema copiará automaticamente a mensagem de entrega e recolhimento do prisma.
            </p>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400">
            <span className="font-semibold text-slate-300">Identificação:</span> Alterações são salvas por condomínio e registradas na auditoria.
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              id="btn-cancelar-editar-condominio"
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              id="btn-salvar-editar-condominio"
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer transition-all shadow-md shadow-blue-900/30"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Salvando...' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
