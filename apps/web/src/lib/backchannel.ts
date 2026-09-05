/** Sparse acknowledgments, never a timer-driven semantic interruption. */
export class BackchannelGate {
  private answerStarted: number | null = null;
  private lastSpeech = 0;
  private lastAcknowledged = -Infinity;

  sample(now: number, candidateSpeaking: boolean, blocked: boolean): boolean {
    if (blocked) {
      this.answerStarted = null;
      return false;
    }
    if (!candidateSpeaking) {
      if (now - this.lastSpeech > 1500) this.answerStarted = null;
      return false;
    }
    this.lastSpeech = now;
    this.answerStarted ??= now;
    if (now - this.answerStarted < 18000 || now - this.lastAcknowledged < 60000) return false;
    this.lastAcknowledged = now;
    this.answerStarted = now;
    return true;
  }
}
