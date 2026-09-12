import { Prisma } from '../types';

/**
 * Extrai o valor numérico primário do identificador do prisma
 * Ex: "01" -> 1, "2" -> 2, "08" -> 8, "10" -> 10, "PR-11" -> 11
 */
export function extrairNumeroPrisma(numeroStr: string): number {
  if (!numeroStr) return 0;
  const digits = String(numeroStr).replace(/\D/g, '');
  if (!digits) return 0;
  const parsed = parseInt(digits, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Função de comparação estritamente numérica crescente para prismas
 * 1º Critério: Número real como valor numérico (1, 2, 3, 8, 9, 10, 11...)
 * 2º Critério: String original com ordenação natural (desempate para formatos específicos)
 * 3º Critério: Cor do prisma (alfabética)
 * 4º Critério: ID único do prisma
 */
export function comparePrismasNumericos(a: Prisma, b: Prisma): number {
  const numA = extrairNumeroPrisma(a.numero);
  const numB = extrairNumeroPrisma(b.numero);

  if (numA !== numB) {
    return numA - numB;
  }

  // Desempate com ordenação natural para preservar formatações como "01" vs "1"
  const strCompare = (a.numero || '').localeCompare(b.numero || '', undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (strCompare !== 0) return strCompare;

  // Desempate por nome da cor
  const corCompare = (a.corNome || '').localeCompare(b.corNome || '', undefined, {
    sensitivity: 'base',
  });
  if (corCompare !== 0) return corCompare;

  return (a.id || '').localeCompare(b.id || '');
}

/**
 * Retorna uma nova lista de prismas ordenada numericamente em ordem crescente.
 * Não altera a identificação original nem mutaciona o array de entrada.
 */
export function sortPrismasNumericos(prismas: Prisma[]): Prisma[] {
  if (!prismas || !Array.isArray(prismas)) return [];
  return [...prismas].sort(comparePrismasNumericos);
}
