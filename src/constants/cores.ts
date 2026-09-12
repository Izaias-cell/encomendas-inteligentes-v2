import { CorConfig } from '../types';

export const CORES_DISPONIVEIS: CorConfig[] = [
  {
    id: 'azul',
    nome: 'Azul',
    hex: '#2563eb',
    bgClass: 'bg-blue-600',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-500',
    badgeBg: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  {
    id: 'vermelho',
    nome: 'Vermelho',
    hex: '#dc2626',
    bgClass: 'bg-red-600',
    textClass: 'text-red-700',
    borderClass: 'border-red-500',
    badgeBg: 'bg-red-100 text-red-800 border-red-300',
  },
  {
    id: 'verde',
    nome: 'Verde',
    hex: '#16a34a',
    bgClass: 'bg-green-600',
    textClass: 'text-green-700',
    borderClass: 'border-green-500',
    badgeBg: 'bg-green-100 text-green-800 border-green-300',
  },
  {
    id: 'amarelo',
    nome: 'Amarelo',
    hex: '#ca8a04',
    bgClass: 'bg-yellow-500',
    textClass: 'text-yellow-800',
    borderClass: 'border-yellow-400',
    badgeBg: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  },
  {
    id: 'laranja',
    nome: 'Laranja',
    hex: '#ea580c',
    bgClass: 'bg-orange-600',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-500',
    badgeBg: 'bg-orange-100 text-orange-800 border-orange-300',
  },
  {
    id: 'branco',
    nome: 'Branco',
    hex: '#f8fafc',
    bgClass: 'bg-slate-100',
    textClass: 'text-slate-800',
    borderClass: 'border-slate-300',
    badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  {
    id: 'preto',
    nome: 'Preto',
    hex: '#0f172a',
    bgClass: 'bg-slate-900',
    textClass: 'text-slate-900',
    borderClass: 'border-slate-800',
    badgeBg: 'bg-slate-900 text-white border-slate-700',
  },
  {
    id: 'cinza',
    nome: 'Cinza',
    hex: '#64748b',
    bgClass: 'bg-slate-500',
    textClass: 'text-slate-600',
    borderClass: 'border-slate-400',
    badgeBg: 'bg-slate-200 text-slate-700 border-slate-400',
  },
  {
    id: 'roxo',
    nome: 'Roxo',
    hex: '#9333ea',
    bgClass: 'bg-purple-600',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-500',
    badgeBg: 'bg-purple-100 text-purple-800 border-purple-300',
  },
];

export function getCorConfig(corIdOrNome: string): CorConfig {
  const normalized = (corIdOrNome || '').toLowerCase().trim();
  const found = CORES_DISPONIVEIS.find(
    (c) => c.id === normalized || c.nome.toLowerCase() === normalized
  );
  if (found) return found;

  // Fallback seguro
  return {
    id: normalized || 'personalizado',
    nome: corIdOrNome || 'Outro',
    hex: '#64748b',
    bgClass: 'bg-slate-600',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-400',
    badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
  };
}
