/**
 * Utilitário de feedback sonoro discreto para confirmação de operações.
 * Utiliza a Web Audio API nativa com fallback silencioso.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Emite uma confirmação sonora curta, suave e discreta após a conclusão de uma operação de sucesso.
 * Se o dispositivo não suportar ou bloquear áudio, a função não gera erro e encerra silenciosamente.
 */
export function playSuccessSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Tom suave e discreto (sine wave 880Hz subindo suavemente para 1175Hz em 150ms)
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1175, now + 0.07);

    // Envelope de ganho com volume baixo e decaimento exponencial suave
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.17);
  } catch {
    // Falha silenciosa garantida
  }
}
