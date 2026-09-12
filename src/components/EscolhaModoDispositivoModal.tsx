import React, { useState } from 'react';
import { Monitor, Smartphone, ShieldCheck, Check, Sparkles } from 'lucide-react';

export type DeviceUsageMode = 'PORTARIA' | 'NORMAL';

interface EscolhaModoDispositivoModalProps {
  isOpen: boolean;
  onSelectMode: (mode: DeviceUsageMode) => void;
}

export const EscolhaModoDispositivoModal: React.FC<EscolhaModoDispositivoModalProps> = ({
  isOpen,
  onSelectMode,
}) => {
  const [selected, setSelected] = useState<DeviceUsageMode>('PORTARIA');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onSelectMode(selected);
  };

  return (
    <div
      id="modal-escolha-modo-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none animate-in fade-in duration-200"
    >
      <div
        id="modal-escolha-modo-container"
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl text-white space-y-5 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-xl shadow-lg shadow-blue-500/30 mx-auto border border-blue-400/40">
            🛡️
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white tracking-wide uppercase">
            CONTROL PRISMA
          </h2>
          <p className="text-sm font-semibold text-slate-200">
            Como deseja utilizar?
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Selecione o perfil de operação deste computador:
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {/* Option 1: Modo Portaria */}
          <div
            id="opt-modo-portaria"
            onClick={() => setSelected('PORTARIA')}
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3.5 ${
              selected === 'PORTARIA'
                ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/30'
                : 'bg-slate-800/60 border-slate-700 hover:border-slate-600'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                selected === 'PORTARIA'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-white flex items-center gap-1.5">
                  🛡️ MODO PORTARIA
                </span>
                {selected === 'PORTARIA' && (
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </span>
                )}
              </div>
              <p className="text-[11px] text-blue-200 mt-1 leading-snug font-medium">
                ★ <strong>Recomendado para o posto de portaria</strong>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                Inicia em popup flutuante compacto com status dos prismas, expansível para a portaria completa.
              </p>
            </div>
          </div>

          {/* Option 2: Modo Normal */}
          <div
            id="opt-modo-normal"
            onClick={() => setSelected('NORMAL')}
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3.5 ${
              selected === 'NORMAL'
                ? 'bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/30'
                : 'bg-slate-800/60 border-slate-700 hover:border-slate-600'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                selected === 'NORMAL'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              <Monitor className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-white flex items-center gap-1.5">
                  💻 MODO NORMAL
                </span>
                {selected === 'NORMAL' && (
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                Dashboard completo em tela cheia para administração, síndico e uso padrão do sistema.
              </p>
            </div>
          </div>
        </div>

        {/* Note */}
        <p className="text-[10px] text-slate-400 text-center">
          Esta preferência será salva neste computador e poderá ser alterada a qualquer momento em <strong>Configurações</strong>.
        </p>

        {/* Action Button */}
        <button
          id="btn-confirmar-modo-dispositivo"
          onClick={handleConfirm}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl font-black text-sm tracking-wide transition-all shadow-lg shadow-blue-600/30 cursor-pointer"
        >
          CONFIRMAR E INICIAR
        </button>
      </div>
    </div>
  );
};
