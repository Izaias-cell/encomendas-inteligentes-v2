
/**
 * Feedback Utility
 * Manages audio and haptic feedback for the application.
 */

class FeedbackService {
  private audioCtx: AudioContext | null = null;
  private lastFeedbackTime: number = 0;
  private lastQrRecognizedTime: number = 0;
  private lastDeliveryConfirmedTime: number = 0;
  private readonly COOLDOWN = 150; // ms to avoid overlapping duplicate cues
  private readonly QR_RECOGNIZED_COOLDOWN = 250;
  private readonly DELIVERY_CONFIRMED_COOLDOWN = 250;

  private initAudio(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.audioCtx) {
      try {
        const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtxCtor) return null;
        this.audioCtx = new AudioCtxCtor();
      } catch (e) {
        console.warn("Web Audio API not supported");
        return null;
      }
    }

    try {
      // Resume context if suspended (browser security)
      if (this.audioCtx?.state === 'suspended') {
        const maybePromise = this.audioCtx.resume();
        if (maybePromise && typeof (maybePromise as any).catch === 'function') {
          (maybePromise as Promise<void>).catch(() => {
            // Ignora bloqueio de autoplay sem interromper o fluxo operacional
          });
        }
      }
    } catch {
      // Ignora erro de resume quando áudio estiver bloqueado pelo navegador
    }

    return this.audioCtx;
  }

  private safeVibrate(pattern: number | number[]) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignora indisponibilidade ou bloqueio de vibração
    }
  }

  /**
   * 1º sinal sonoro (Portaria): QR Code reconhecido pelo leitor da câmera.
   * Toque curto, nítido e neutro/positivo — indica apenas captura da leitura,
   * não autorizando nem confirmando baixa.
   */
  public qrRecognized(): boolean {
    const now = Date.now();
    if (now - this.lastQrRecognizedTime < this.QR_RECOGNIZED_COOLDOWN) return false;
    this.lastQrRecognizedTime = now;

    const ctx = this.initAudio();
    if (!ctx) return false;

    try {
      const t0 = ctx.currentTime;
      const g = ctx.createGain();
      const o = ctx.createOscillator();

      o.type = 'sine';
      // Pulso curto e nítido de captura (D5 -> A5 em 110ms)
      o.frequency.setValueAtTime(587.33, t0);
      o.frequency.setValueAtTime(880.00, t0 + 0.055);

      const volume = 0.13;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(volume, t0 + 0.012);
      g.gain.setValueAtTime(volume, t0 + 0.09);
      g.gain.exponentialRampToValueAtTime(0.005, t0 + 0.15);

      o.connect(g);
      g.connect(ctx.destination);

      o.start(t0);
      o.stop(t0 + 0.16);

      this.safeVibrate(20);
      return true;
    } catch (e) {
      console.warn("Error playing QR recognized sound:", e);
      return false;
    }
  }

  /**
   * 2º sinal sonoro (Portaria): Baixa/Retirada concluída com sucesso pelo servidor.
   * Identidade sonora suave da marca (tríade maior E5 -> A5 -> C#6), claramente
   * distinta do 1º som de captura e do alerta periódico de inatividade.
   * Possui cooldown independente para nunca ser silenciada pelo 1º sinal.
   */
  public deliveryConfirmed(): boolean {
    const now = Date.now();
    if (now - this.lastDeliveryConfirmedTime < this.DELIVERY_CONFIRMED_COOLDOWN) return false;
    this.lastDeliveryConfirmedTime = now;

    const ctx = this.initAudio();
    if (!ctx) return false;

    try {
      const t0 = ctx.currentTime;
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const o3 = ctx.createOscillator();

      o1.type = 'sine';
      o2.type = 'sine';
      o3.type = 'sine';

      // Progressão harmônica positiva: E5 (659.25) -> A5 (880.00) -> C#6 (1108.73)
      o1.frequency.setValueAtTime(659.25, t0);
      o2.frequency.setValueAtTime(880.00, t0 + 0.08);
      o3.frequency.setValueAtTime(1108.73, t0 + 0.16);

      const volume = 0.18;
      g1.gain.setValueAtTime(0, t0);
      g1.gain.linearRampToValueAtTime(volume * 0.85, t0 + 0.025);
      g1.gain.exponentialRampToValueAtTime(0.008, t0 + 0.36);

      g2.gain.setValueAtTime(0, t0 + 0.08);
      g2.gain.linearRampToValueAtTime(volume, t0 + 0.17);
      g2.gain.exponentialRampToValueAtTime(0.006, t0 + 0.62);

      o1.connect(g1);
      g1.connect(ctx.destination);

      o2.connect(g2);
      o3.connect(g2);
      g2.connect(ctx.destination);

      o1.start(t0);
      o1.stop(t0 + 0.37);

      o2.start(t0 + 0.08);
      o2.stop(t0 + 0.63);

      o3.start(t0 + 0.16);
      o3.stop(t0 + 0.63);

      this.safeVibrate([35, 35, 50]);
      return true;
    } catch (e) {
      console.warn("Error playing delivery confirmed sound:", e);
      return false;
    }
  }

  /**
   * Play a soft success UI sound with haptic feedback
   */
  public success() {
    const now = Date.now();
    if (now - this.lastFeedbackTime < this.COOLDOWN) return;
    this.lastFeedbackTime = now;

    const ctx = this.initAudio();
    if (!ctx) return;

    try {
      const g = ctx.createGain();
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();

      // Soft success frequencies (musical major intervals)
      o1.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      o2.frequency.setValueAtTime(880.00, ctx.currentTime); // A5

      o1.type = 'sine';
      o2.type = 'sine';

      // Envelope: Soft attack, exponential decay
      const volume = 0.18;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      o1.connect(g);
      o2.connect(g);
      g.connect(ctx.destination);

      o1.start(ctx.currentTime);
      o2.start(ctx.currentTime + 0.05);
      o1.stop(ctx.currentTime + 0.5);
      o2.stop(ctx.currentTime + 0.5);

      this.safeVibrate(35);
    } catch (e) {
      console.warn("Error playing success sound:", e);
    }
  }

  /**
   * Play a discrete error sound
   */
  public error() {
    const now = Date.now();
    if (now - this.lastFeedbackTime < this.COOLDOWN) return;
    this.lastFeedbackTime = now;

    const ctx = this.initAudio();
    if (!ctx) return;

    try {
      const g = ctx.createGain();
      const o = ctx.createOscillator();

      // Slightly lower and harsher for error
      o.frequency.setValueAtTime(220.00, ctx.currentTime); // A3
      o.type = 'triangle';

      const volume = 0.15;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);

      o.connect(g);
      g.connect(ctx.destination);

      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.3);

      this.safeVibrate([40, 30, 40]);
    } catch (e) {
      console.warn("Error playing error sound:", e);
    }
  }
}

export const feedback = new FeedbackService();
