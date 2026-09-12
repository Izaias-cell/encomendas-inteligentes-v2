import React from 'react';
import { Prisma, PrismaEstado } from '../types';
import { PrismaVisual } from './PrismaVisual';
import { Clock, Home, Camera, AlertCircle } from 'lucide-react';

interface PrismaCardProps {
  prisma: Prisma;
  onClick: () => void;
  variant?: 'entrega' | 'receber' | 'geral';
  disabled?: boolean;
}

export const PrismaCard: React.FC<PrismaCardProps> = ({
  prisma,
  onClick,
  variant = 'geral',
  disabled = false,
}) => {
  const getStatusLabel = () => {
    switch (prisma.estado) {
      case PrismaEstado.DISPONIVEL:
        return 'DISPONÍVEL';
      case PrismaEstado.EM_USO:
        return 'EM USO';
      case PrismaEstado.PENDENTE:
        return 'PENDENTE';
      case PrismaEstado.INDISPONIVEL:
        return 'INDISPONÍVEL';
    }
  };

  const getStatusStyle = () => {
    switch (prisma.estado) {
      case PrismaEstado.DISPONIVEL:
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case PrismaEstado.EM_USO:
        return 'text-blue-700 bg-blue-50 border-blue-200';
      case PrismaEstado.PENDENTE:
        return 'text-amber-700 bg-amber-50 border-amber-200';
      case PrismaEstado.INDISPONIVEL:
        return 'text-slate-500 bg-slate-50 border-slate-200';
    }
  };

  // Time elapsed if in use
  const getElapsedFormatted = (dateStr?: string) => {
    if (!dateStr) return '';
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (diffMin < 60) return `Há ${diffMin} min`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `Há ${hours}h ${mins}m`;
  };

  const getTimeFormatted = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <button
      id={`prisma-card-${prisma.id}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`w-full group relative flex flex-col justify-between items-center p-2 sm:p-2.5 rounded-xl border text-center transition-all cursor-pointer select-none active:scale-[0.98] ${
        disabled
          ? 'opacity-40 cursor-not-allowed bg-slate-100 border-slate-200'
          : 'bg-white hover:bg-slate-50/90 border-slate-200 hover:border-slate-400 hover:shadow-xs'
      }`}
    >
      {/* 1. STATUS (CENTRALIZADO NO TOPO) */}
      <div className="w-full flex justify-center mb-1">
        <span
          className={`text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border leading-tight ${getStatusStyle()}`}
        >
          {getStatusLabel()}
        </span>
      </div>

      {/* 2. REPRESENTAÇÃO DO PRISMA COM NÚMERO GRANDE INTEGRADO */}
      <div className="my-0.5 flex items-center justify-center">
        <PrismaVisual numero={prisma.numero} corIdOrNome={prisma.corNome} size="md" />
      </div>

      {/* 3. NOME DA COR ABAIXO DO NÚMERO */}
      <div className="mt-1 text-center w-full">
        <span className="text-[11px] sm:text-xs font-black text-slate-800 uppercase tracking-wider block truncate">
          {prisma.corNome}
        </span>
      </div>

      {/* 4. INFORMAÇÕES DE DESTINO E HORÁRIO (QUANDO EM USO) */}
      {prisma.estado === PrismaEstado.EM_USO && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-100 w-full space-y-0.5 text-[10px] sm:text-[11px]">
          <div className="flex items-center justify-between font-bold text-slate-900">
            <div className="flex items-center gap-1 text-blue-800 truncate">
              <Home className="w-3 h-3 flex-shrink-0" />
              <span className="truncate font-black">{prisma.casaAtual || 'Casa não inf.'}</span>
            </div>

            {prisma.fotoEntregaAtual && (
              <span className="flex items-center gap-0.5 text-[9px] text-indigo-700 bg-indigo-50 px-1 py-0.2 rounded font-medium flex-shrink-0">
                <Camera className="w-2.5 h-2.5" /> Foto
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5 text-slate-400" />
              <span>{getTimeFormatted(prisma.horarioEntregaAtual)}</span>
            </span>
            <span className="font-semibold text-slate-600">
              {getElapsedFormatted(prisma.horarioEntregaAtual)}
            </span>
          </div>
        </div>
      )}

      {/* 5. INFORMAÇÕES DE PENDÊNCIA (QUANDO PENDENTE) */}
      {prisma.estado === PrismaEstado.PENDENTE && (
        <div className="mt-1.5 pt-1.5 border-t border-amber-200 text-[10px] text-amber-900 flex items-center justify-center gap-1 font-medium w-full">
          <AlertCircle className="w-3 h-3 text-amber-600 flex-shrink-0" />
          <span className="truncate">{prisma.observacao || 'Pendência aberta'}</span>
        </div>
      )}
    </button>
  );
};
