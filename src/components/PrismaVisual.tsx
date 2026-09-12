import React from 'react';
import { getCorConfig } from '../constants/cores';

interface PrismaVisualProps {
  numero: string;
  corIdOrNome: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const PrismaVisual: React.FC<PrismaVisualProps> = ({
  numero,
  corIdOrNome,
  size = 'md',
  className = '',
}) => {
  const corConfig = getCorConfig(corIdOrNome);
  const normalized = (corIdOrNome || '').toLowerCase().trim();

  // Determine text color for highest readability on the colored physical prism
  const isLightColor =
    normalized === 'branco' ||
    normalized === 'amarelo' ||
    normalized === 'white' ||
    normalized === 'yellow';

  const isBlue = normalized === 'azul' || normalized === 'blue';

  const textColor = isLightColor ? 'text-slate-950 font-black' : 'text-white font-black';
  const textShadow = isLightColor
    ? 'drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]'
    : isBlue
    ? ''
    : 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]';

  const trackingClass = size === 'sm' ? 'tracking-tight' : isBlue ? 'tracking-normal' : 'tracking-tight';

  // Size dimensions
  const sizeClasses = {
    sm: {
      container: 'w-11 h-14 rounded-t-lg rounded-b-md',
      base: 'h-1.5',
      number: 'text-lg sm:text-xl',
    },
    md: {
      container: 'w-14 h-18 sm:w-16 sm:h-20 rounded-t-xl rounded-b-md',
      base: 'h-1.5 sm:h-2',
      number: 'text-2xl sm:text-3xl',
    },
    lg: {
      container: 'w-20 h-26 rounded-t-2xl rounded-b-lg',
      base: 'h-2.5',
      number: 'text-3xl sm:text-4xl',
    },
  }[size];

  return (
    <div
      className={`relative flex flex-col items-center justify-between shadow-md select-none overflow-hidden transition-transform ${sizeClasses.container} ${className}`}
      style={{
        backgroundColor: corConfig.hex,
        border: isLightColor ? '1.5px solid #cbd5e1' : '1px solid rgba(0,0,0,0.15)',
      }}
    >
      {/* Top subtle 3D reflection facet */}
      <div className="w-full h-1.5 bg-white/25" />

      {/* Main Face: High-Contrast Prisma Number printed on physical body */}
      <div className="flex-1 flex items-center justify-center w-full px-1">
        <span
          className={`leading-none ${trackingClass} ${sizeClasses.number} ${textColor} ${textShadow}`}
        >
          {numero}
        </span>
      </div>

      {/* Magnetic Black Base of the physical vehicle roof cone */}
      <div className={`w-full bg-slate-900/90 ${sizeClasses.base}`} />
    </div>
  );
};
