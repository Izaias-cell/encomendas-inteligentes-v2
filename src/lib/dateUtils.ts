import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const formatSafeDateTime = (value: any) => {
  if (!value) return "-";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "-";
    return format(d, 'dd/MM/yyyy HH:mm:ss', { locale: ptBR });
  } catch (e) {
    return "-";
  }
};

export const formatSafeDate = (value: any) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
};

export const formatSafeTime = (value: any) => {
  if (!value) return "-";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "-" : d.toLocaleTimeString("pt-BR");
};

export const formatDate = (date: any, formatStr: string, options?: any) => {
  if (!date) return '-';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return format(d, formatStr, options || { locale: ptBR });
  } catch (e) {
    return '-';
  }
};
