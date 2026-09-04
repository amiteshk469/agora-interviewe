export type VoiceActivitySample = {
  speaking: boolean;
  visualLevel: number;
  noiseFloor: number;
  startThreshold: number;
};

type VoiceActivityOptions = {
  calibrationSamples: number;
  startSamples: number;
  releaseMs: number;
  minStartLevel: number;
  minContinueLevel: number;
};

const DEFAULT_OPTIONS: VoiceActivityOptions = {
  // Six 120 ms samples give the microphone a brief, Meet-like noise-floor
  // calibration instead of treating its first non-zero sample as speech.
  calibrationSamples: 6,
  startSamples: 2,
  releaseMs: 480,
  minStartLevel: 0.18,
  minContinueLevel: 0.1,
};

function clampLevel(level: number) {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

/**
 * Stateful speech indicator for Agora's normalized [0, 1] volume samples.
 *
 * The low percentile models the room noise, two consecutive samples reject
 * clicks, and hysteresis prevents word gaps from flashing the UI on and off.
 * It controls presentation only; Agora remains responsible for conversational
 * turn detection and barge-in.
 */
export class VoiceActivityDetector {
  private readonly options: VoiceActivityOptions;
  private readonly ambientSamples: number[] = [];
  private smoothedLevel = 0;
  private consecutiveVoiceSamples = 0;
  private lastVoiceAt = 0;
  private calibrated = false;
  private speaking = false;

  constructor(options: Partial<VoiceActivityOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  reset() {
    this.ambientSamples.length = 0;
    this.smoothedLevel = 0;
    this.consecutiveVoiceSamples = 0;
    this.lastVoiceAt = 0;
    this.calibrated = false;
    this.speaking = false;
  }

  sample(rawLevel: number, nowMs: number): VoiceActivitySample {
    const level = clampLevel(rawLevel);
    const smoothing = level > this.smoothedLevel ? 0.55 : 0.22;
    this.smoothedLevel += (level - this.smoothedLevel) * smoothing;

    // Freeze the ambient model while someone is speaking. Otherwise a long
    // answer would slowly become the new "silence" baseline.
    if (!this.speaking) {
      this.ambientSamples.push(level);
      if (this.ambientSamples.length > 48) this.ambientSamples.shift();
    }

    const noiseFloor = percentile(this.ambientSamples, 0.25);
    const startThreshold = Math.min(
      0.82,
      Math.max(this.options.minStartLevel, noiseFloor * 2.6, noiseFloor + 0.1),
    );
    const continueThreshold = Math.min(
      startThreshold * 0.82,
      Math.max(this.options.minContinueLevel, noiseFloor * 1.65, noiseFloor + 0.05),
    );

    if (!this.calibrated) {
      this.calibrated = this.ambientSamples.length >= this.options.calibrationSamples;
      return { speaking: false, visualLevel: 0, noiseFloor, startThreshold };
    }

    if (!this.speaking) {
      this.consecutiveVoiceSamples = level >= startThreshold && this.smoothedLevel >= continueThreshold
        ? this.consecutiveVoiceSamples + 1
        : 0;
      if (this.consecutiveVoiceSamples >= this.options.startSamples) {
        this.speaking = true;
        this.lastVoiceAt = nowMs;
      }
    } else if (level >= continueThreshold) {
      this.lastVoiceAt = nowMs;
    } else if (nowMs - this.lastVoiceAt > this.options.releaseMs) {
      this.speaking = false;
      this.consecutiveVoiceSamples = 0;
    }

    const visualLevel = this.speaking
      ? Math.min(1, Math.max(0.2, (this.smoothedLevel - noiseFloor) / Math.max(0.15, 1 - noiseFloor)))
      : 0;
    return { speaking: this.speaking, visualLevel, noiseFloor, startThreshold };
  }
}
