/**
 * Utilitário seguro para cópia na área de transferência com fallback
 * Funciona tanto com Clipboard API (HTTPS) quanto com fallback de textarea
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Clipboard API direta falhou, utilizando fallback:', err);
  }

  // Fallback universal compatível com todos os navegadores
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Falha no fallback de cópia:', err);
    return false;
  }
}

/**
 * Extrai e padroniza a identificação da casa para as mensagens
 * Ex: "426" -> "426", "Casa 426" -> "426", "Apto 12" -> "Apto 12"
 */
export function formatarNumeroCasa(casa: string): string {
  if (!casa) return '';
  const trimmed = String(casa).trim();
  const cleaned = trimmed.replace(/^casa\s*:?\s*/i, '').trim();
  return cleaned || trimmed;
}

/**
 * Formata a mensagem padrão de RETIRADA / ENTREGA de prisma para cópia automática
 * Formato: Casa 426 retirou prisma 28.
 */
export function formatMensagemEntrega(numero: string, corNome: string, casa: string): string {
  const num = String(numero || '').trim();
  const casaLimpa = formatarNumeroCasa(casa);
  return `Casa ${casaLimpa} retirou prisma ${num}.`;
}

/**
 * Formata a mensagem padrão de DEVOLUÇÃO / RECOLHIMENTO de prisma para cópia automática
 * Formato: Casa 426 entregou prisma 28.
 */
export function formatMensagemRecolhimento(numero: string, corNome: string, casa: string): string {
  const num = String(numero || '').trim();
  const casaLimpa = formatarNumeroCasa(casa);
  return `Casa ${casaLimpa} entregou prisma ${num}.`;
}

/**
 * Valida e extrai número de casa no intervalo permitido de 01 a 311.
 * Normaliza variações como "01", "1", "Casa 01", "Casa 1", "001".
 * Retorna o número inteiro (1..311) ou null se for inválido / fora do escopo.
 */
export function extrairNumeroCasaValido(raw: string): number | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const cleaned = trimmed
    .replace(/^casa\s*:?\s*/i, '')
    .replace(/^cs\s*:?\s*/i, '')
    .replace(/^#\s*/, '')
    .trim();
  const parsed = parseInt(cleaned, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 311) {
    return null;
  }
  return parsed;
}

/**
 * Formata o número da casa para exibição padronizada no RÁPIDO:
 * - Menor que 10: com zero à esquerda ("01", "08", "09")
 * - 10 ou maior: número normal ("10", "43", "127", "311")
 */
export function formatarCasaExibicao(num: number): string {
  if (num < 10) {
    return `0${num}`;
  }
  return String(num);
}


