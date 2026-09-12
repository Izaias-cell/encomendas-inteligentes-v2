import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, X, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { api } from '../services/api';

interface AlterarSenhaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (mensagem: string) => void;
}

export const AlterarSenhaModal: React.FC<AlterarSenhaModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [showSenhaAtual, setShowSenhaAtual] = useState(false);
  const [showNovaSenha, setShowNovaSenha] = useState(false);
  const [showConfirmarSenha, setShowConfirmarSenha] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleReset = () => {
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
    setShowSenhaAtual(false);
    setShowNovaSenha(false);
    setShowConfirmarSenha(false);
    setError(null);
    setSuccessMessage(null);
    setIsLoading(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validações no frontend
    if (!senhaAtual) {
      setError('Informe sua senha atual.');
      return;
    }
    if (!novaSenha) {
      setError('Informe a nova senha.');
      return;
    }
    if (novaSenha.length < 8) {
      setError('A nova senha deve possuir no mínimo 8 caracteres.');
      return;
    }
    if (novaSenha.length > 128) {
      setError('A nova senha não pode ultrapassar 128 caracteres.');
      return;
    }
    if (novaSenha === senhaAtual) {
      setError('A nova senha deve ser diferente da senha atual.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setError('As senhas não coincidem.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.alterarMinhaSenha({
        senhaAtual,
        novaSenha,
      });

      if (res.success) {
        setSuccessMessage('Senha alterada com sucesso.');
        if (onSuccess) {
          onSuccess('Senha alterada com sucesso.');
        }
        setTimeout(() => {
          handleClose();
        }, 1200);
      } else {
        setError(res.message || 'Erro ao alterar a senha.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao comunicar com o servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="modal-alterar-senha-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        id="modal-alterar-senha"
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Alterar Minha Senha
              </h3>
              <p className="text-[11px] text-slate-400">
                Atualize sua senha individual de acesso ao sistema
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-fechar-modal-senha"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              id="alert-error-senha"
              className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div
              id="alert-success-senha"
              className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2.5 font-bold"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Campo Senha Atual */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Senha Atual <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showSenhaAtual ? 'text' : 'password'}
                id="input-senha-atual"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                placeholder="Informe sua senha atual"
                disabled={isLoading || Boolean(successMessage)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowSenhaAtual(!showSenhaAtual)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                title={showSenhaAtual ? 'Ocultar senha' : 'Ver senha'}
              >
                {showSenhaAtual ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Campo Nova Senha */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Nova Senha <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showNovaSenha ? 'text' : 'password'}
                id="input-nova-senha"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                disabled={isLoading || Boolean(successMessage)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowNovaSenha(!showNovaSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                title={showNovaSenha ? 'Ocultar senha' : 'Ver senha'}
              >
                {showNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Dica: Utilize no mínimo 8 caracteres alfanuméricos para maior segurança.
            </p>
          </div>

          {/* Campo Confirmar Nova Senha */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Confirmar Nova Senha <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmarSenha ? 'text' : 'password'}
                id="input-confirmar-senha"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha"
                disabled={isLoading || Boolean(successMessage)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmarSenha(!showConfirmarSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                title={showConfirmarSenha ? 'Ocultar senha' : 'Ver senha'}
              >
                {showConfirmarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Ações */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              id="btn-cancelar-senha"
              onClick={handleClose}
              disabled={isLoading || Boolean(successMessage)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              id="btn-salvar-senha"
              disabled={isLoading || Boolean(successMessage)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-amber-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isLoading ? 'Salvando...' : 'Salvar Nova Senha'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
