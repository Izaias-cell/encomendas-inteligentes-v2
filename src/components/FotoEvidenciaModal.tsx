import React, { useState } from 'react';
import { Movimentacao, MovimentacaoTipo } from '../types';
import { PrismaVisual } from './PrismaVisual';
import {
  X,
  Share2,
  Calendar,
  Clock,
  Home,
  User,
  Check,
  Camera,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
} from 'lucide-react';

interface FotoEvidenciaModalProps {
  movimentacao: Movimentacao | null;
  onClose: () => void;
}

export const FotoEvidenciaModal: React.FC<FotoEvidenciaModalProps> = ({
  movimentacao,
  onClose,
}) => {
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied' | 'shared'>('idle');

  if (!movimentacao || !movimentacao.fotoEvidenciaUrl) return null;

  const isEntrega = movimentacao.tipo === MovimentacaoTipo.ENTREGA;
  const dataFormatada = new Date(movimentacao.dataHora).toLocaleDateString('pt-BR');
  const horaFormatada = new Date(movimentacao.dataHora).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleShare = async () => {
    setShareStatus('sharing');
    const shareTitle = `Evidência - Prisma ${movimentacao.prismaNumero} ${movimentacao.prismaCorNome}`;
    const shareText = `Condomínio - Controle de Prismas\nPrisma: ${movimentacao.prismaNumero} (${movimentacao.prismaCorNome})\nTipo: ${isEntrega ? 'Entrega' : 'Recolhimento'}\nUnidade: ${movimentacao.casa}\nData/Hora: ${dataFormatada} às ${horaFormatada}\nPortaria: ${movimentacao.usuarioNome}`;

    try {
      // Tenta converter Data URL para File se suportado pelo navegador
      if (
        navigator.share &&
        movimentacao.fotoEvidenciaUrl.startsWith('data:image/')
      ) {
        try {
          const res = await fetch(movimentacao.fotoEvidenciaUrl);
          const blob = await res.blob();
          const file = new File([blob], `prisma_${movimentacao.prismaNumero}_evidencia.jpg`, {
            type: blob.type || 'image/jpeg',
          });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: shareTitle,
              text: shareText,
              files: [file],
            });
            setShareStatus('shared');
            setTimeout(() => setShareStatus('idle'), 3000);
            return;
          }
        } catch {
          // Fallback para share de texto se files falhar
        }
      }

      // Compartilhamento nativo de texto caso compartilhamento de arquivo não seja aceito
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
        });
        setShareStatus('shared');
        setTimeout(() => setShareStatus('idle'), 3000);
        return;
      }

      // Fallback para cópia do texto com link para a área de transferência
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        setShareStatus('copied');
        setTimeout(() => setShareStatus('idle'), 3000);
        return;
      }

      setShareStatus('idle');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Erro ao compartilhar:', err);
      }
      setShareStatus('idle');
    }
  };

  return (
    <div
      id="modal-foto-evidencia-overlay"
      className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="modal-foto-evidencia-card"
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 sm:px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/80 flex items-center justify-center text-white">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base leading-tight">
                Evidência Fotográfica
              </h3>
              <p className="text-[11px] text-slate-400">
                Registro operacional auditável
              </p>
            </div>
          </div>

          <button
            id="btn-fechar-foto-evidencia"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar visualização"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Container */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Main Photo Display */}
          <div className="relative bg-slate-950 rounded-xl overflow-hidden border border-slate-200 shadow-inner flex items-center justify-center min-h-[220px] max-h-[55vh]">
            <img
              src={movimentacao.fotoEvidenciaUrl}
              alt={`Evidência do Prisma ${movimentacao.prismaNumero}`}
              className="w-full max-h-[55vh] object-contain select-none"
            />
          </div>

          {/* Evidence Details Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2.5">
                <PrismaVisual
                  numero={movimentacao.prismaNumero}
                  corIdOrNome={movimentacao.prismaCorNome}
                  size="sm"
                />
                <div>
                  <div className="text-sm font-black text-slate-900 leading-tight">
                    Prisma {movimentacao.prismaNumero} — {movimentacao.prismaCorNome.toUpperCase()}
                  </div>
                  <div className="text-xs font-bold text-blue-700 flex items-center gap-1 mt-0.5">
                    <Home className="w-3.5 h-3.5" />
                    <span>{movimentacao.casa}</span>
                  </div>
                </div>
              </div>

              <div
                className={`px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1 ${
                  isEntrega
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-blue-100 text-blue-800 border border-blue-300'
                }`}
              >
                {isEntrega ? (
                  <>
                    <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>ENTREGA</span>
                  </>
                ) : (
                  <>
                    <ArrowDownLeft className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>RECOLHIMENTO</span>
                  </>
                )}
              </div>
            </div>

            {/* Meta information row */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span>{dataFormatada}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span>{horaFormatada}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 col-span-2">
                <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span>
                  Porteiro: <strong className="text-slate-800">{movimentacao.usuarioNome}</strong> ({movimentacao.turnoNome})
                </span>
              </div>
            </div>

            {movimentacao.motivoCorrecao && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-900 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Correção Auditada:</span> {movimentacao.motivoCorrecao}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 border-t border-slate-200 p-3 sm:p-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>

          <button
            id="btn-compartilhar-foto-evidencia"
            type="button"
            onClick={handleShare}
            className="flex-1 sm:flex-initial px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg cursor-pointer select-none"
          >
            {shareStatus === 'sharing' ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Compartilhando...</span>
              </>
            ) : shareStatus === 'shared' ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>COMPARTILHADO!</span>
              </>
            ) : shareStatus === 'copied' ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>DADOS COPIADOS!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 stroke-[2.5]" />
                <span>COMPARTILHAR</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
