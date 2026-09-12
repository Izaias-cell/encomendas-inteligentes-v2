import React, { useState, useRef, useEffect } from 'react';
import { Prisma } from '../types';
import { PrismaVisual } from './PrismaVisual';
import {
  X,
  Camera,
  Trash2,
  Check,
  AlertCircle,
  Home,
} from 'lucide-react';

interface EntregaModalProps {
  prisma: Prisma | null;
  onClose: () => void;
  onConfirmEntrega: (params: {
    prismaId: string;
    casa: string;
    fotoEvidenciaUrl?: string;
  }) => Promise<void>;
  isLoading: boolean;
  errorMessage?: string | null;
  quickHouses?: string[];
}

export const EntregaModal: React.FC<EntregaModalProps> = ({
  prisma,
  onClose,
  onConfirmEntrega,
  isLoading,
  errorMessage,
  quickHouses,
}) => {
  const [casa, setCasa] = useState('');
  const [fotoEvidencia, setFotoEvidencia] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputCasaRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus house input upon opening
  useEffect(() => {
    if (prisma) {
      setCasa('');
      setFotoEvidencia(null);
      setLocalError(null);
      setTimeout(() => {
        inputCasaRef.current?.focus();
      }, 100);
    }
  }, [prisma]);

  if (!prisma) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!casa.trim()) {
      setLocalError('Por favor, informe o número da casa.');
      inputCasaRef.current?.focus();
      return;
    }

    setLocalError(null);
    try {
      await onConfirmEntrega({
        prismaId: prisma.id,
        casa: casa.trim(),
        fotoEvidenciaUrl: fotoEvidencia || undefined,
      });
    } catch (err: any) {
      setLocalError(err.message || 'Erro ao confirmar entrega.');
    }
  };

  // Quick house suggestion chips: utiliza ranking dinâmico de casas ou fallback seguro dentro de 01-311
  const DEFAULT_QUICK_HOUSES = ['12', '17', '31', '42', '105', '208'];
  const activeQuickHouses = (quickHouses && quickHouses.length > 0)
    ? quickHouses.slice(0, 6)
    : DEFAULT_QUICK_HOUSES;

  // Handle Photo Capture / Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setLocalError('A imagem selecionada é muito grande (máximo 5MB).');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setFotoEvidencia(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      id="modal-entrega-prisma-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
    >
      <div
        id="modal-entrega-prisma-card"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <PrismaVisual
              numero={prisma.numero}
              corIdOrNome={prisma.corNome}
              size="sm"
            />
            <div>
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Entregar Prisma
              </span>
              <h2 className="text-lg font-black leading-tight text-white">
                {prisma.numero} — {prisma.corNome.toUpperCase()}
              </h2>
            </div>
          </div>

          <button
            id="btn-fechar-modal-entrega"
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-3.5">
          {/* Error Message */}
          {(errorMessage || localError) && (
            <div
              id="alert-erro-entrega"
              className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2 animate-shake"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Atenção:</p>
                <p>{errorMessage || localError}</p>
              </div>
            </div>
          )}

          {/* SEÇÃO PRINCIPAL COMPACTA: QUAL A CASA? + [ CAMPO ] + [ CONFIRMAR ENTREGA ] + [ CANCELAR ] */}
          <div>
            <label
              htmlFor="input-qual-a-casa"
              className="block text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"
            >
              <Home className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>Qual a Casa?</span>
              <span className="text-rose-500">*</span>
            </label>

            {/* Disposição estritamente em uma única linha lado a lado: [ CASA ] [ CONFIRMAR ENTREGA ] [ CANCELAR ] */}
            <div className="flex flex-row items-center gap-2 w-full">
              {/* 1. Campo Compacto da Casa */}
              <div className="w-20 sm:w-28 flex-shrink-0">
                <input
                  ref={inputCasaRef}
                  id="input-qual-a-casa"
                  type="text"
                  required
                  value={casa}
                  onChange={(e) => setCasa(e.target.value)}
                  placeholder="12"
                  className="w-full text-base sm:text-lg font-black px-2 sm:px-3 bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none text-slate-900 transition-all placeholder:text-slate-400 text-center h-12"
                  autoComplete="off"
                />
              </div>

              {/* 2. Botão CONFIRMAR ENTREGA (Maior largura horizontal, ação principal) */}
              <button
                id="btn-confirmar-entrega-modal"
                type="submit"
                disabled={isLoading || !casa.trim()}
                className="flex-1 min-w-0 h-12 px-2.5 sm:px-4 text-xs sm:text-sm font-black tracking-wide text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[3] flex-shrink-0" />
                    <span className="truncate uppercase">CONFIRMAR ENTREGA</span>
                  </>
                )}
              </button>

              {/* 3. Botão CANCELAR (Menor largura horizontal que CONFIRMAR ENTREGA) */}
              <button
                id="btn-cancelar-modal-entrega"
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="w-auto px-3 sm:px-4 h-12 text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-xl transition-colors cursor-pointer flex-shrink-0 flex items-center justify-center whitespace-nowrap"
              >
                CANCELAR
              </button>
            </div>

            {/* Atalhos Rápidos de Casas (Ranking Inteligente) */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] text-slate-400 font-medium mr-1">Rápido:</span>
              {activeQuickHouses.map((item) => (
                <button
                  key={item}
                  id={`btn-rapido-casa-${item}`}
                  type="button"
                  onClick={() => {
                    setCasa(item);
                    inputCasaRef.current?.focus();
                  }}
                  className="text-xs font-semibold px-2 py-0.5 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-700 rounded-md transition-colors cursor-pointer"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* REGISTRAR EVIDÊNCIA (OPCIONAL) */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] sm:text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Camera className="w-3.5 h-3.5 text-slate-500" />
                Fotografia / Evidência
              </span>
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium">(Opcional)</span>
            </div>

            {fotoEvidencia ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <img
                  src={fotoEvidencia}
                  alt="Evidência fotográfica"
                  className="w-full h-32 sm:h-36 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setFotoEvidencia(null)}
                  className="absolute top-2 right-2 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-md cursor-pointer transition-colors"
                  title="Remover foto"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 px-3 border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl text-xs font-semibold text-slate-600 hover:text-blue-700 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-slate-400" />
                  <span>📷 REGISTRAR EVIDÊNCIA (FOTO)</span>
                </button>
              </div>
            )}
          </div>

          {/* Operational notice */}
          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg">
            ℹ️ <span className="font-semibold">Sem dados desnecessários:</span> O sistema não solicita nome ou placa, focando unicamente no prisma e na unidade.
          </div>
        </form>
      </div>
    </div>
  );
};
