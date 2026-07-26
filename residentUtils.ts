
/**
 * Feedback Utility
 * Manages audio and haptic feedback for the application.
 */

class FeedbackService {
  private audioCtx: AudioContext | null = null;
  private lastFeedbackTime: number = 0;
  private readonly COOLDOWN = 150; // ms to avoid overlapping sounds

  private initAudio() {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn("Web Audio API not supported");
      }
    }
    
    // Resume context if suspended (browser security)
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }
    
    return this.audioCtx;
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
      // Volume increased as requested (+30% approx)
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

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(35);
      }
    } catch (e) {
      console.error("Error playing success sound:", e);
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

      // Error vibration (slightly different pattern)
      if (navigator.vibrate) {
        navigator.vibrate([40, 30, 40]);
      }
    } catch (e) {
      console.error("Error playing error sound:", e);
    }
  }
}

export const feedback = new FeedbackService();
