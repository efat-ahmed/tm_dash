import type { GraphicsQuality, PerformanceMetrics, QualityMode } from './types';

export interface AdaptiveTierConfig {
  tier: number;
  quality: GraphicsQuality;
  adaptiveScale: number;
}

const ADAPTIVE_TIERS: readonly AdaptiveTierConfig[] = [
  { tier: 0, quality: 'low', adaptiveScale: 0.78 },
  { tier: 1, quality: 'low', adaptiveScale: 1.0 },
  { tier: 2, quality: 'medium', adaptiveScale: 1.0 },
  { tier: 3, quality: 'high', adaptiveScale: 1.0 },
];

const WINDOW_SIZE = 30;
const EVAL_INTERVAL = 15;
const WARMUP_FRAMES = 45;
const SPIKE_DELTA_MS = 28;
const JITTER_DELTA_MS = 12;
const DOWNGRADE_COOLDOWN_MS = 3500;
const UPGRADE_COOLDOWN_MS = 10000;
const POST_DOWNGRADE_UPGRADE_WAIT_MS = 12000;

export function qualityToTier(quality: GraphicsQuality): number {
  if (quality === 'high') return 3;
  if (quality === 'medium') return 2;
  return 1;
}

export class AdaptivePerformanceController {
  private deltaRing = new Float32Array(WINDOW_SIZE);
  private workRing = new Float32Array(WINDOW_SIZE);
  private spikeRing = new Uint8Array(WINDOW_SIZE);

  private ringIdx = 0;
  private ringCount = 0;
  private sumDelta = 0;
  private sumWork = 0;
  private spikeCount = 0;

  private lastFrameTimestamp = 0;
  private prevDeltaMs = 16.67;
  private smoothedDeltaMs = 16.67;
  private framesSinceReset = 0;
  private evalTick = 0;

  private badWindowStreak = 0;
  private goodWindowStreak = 0;

  private currentTier: number;
  private maxAutoTier = 3;
  private tierFailures = new Uint8Array(4);

  private nextDowngradeAllowedAt = 0;
  private nextUpgradeAllowedAt = 0;

  constructor(initialQuality: GraphicsQuality) {
    this.currentTier = qualityToTier(initialQuality);
  }

  getTierConfig(): AdaptiveTierConfig {
    return ADAPTIVE_TIERS[this.currentTier];
  }

  setInitialQuality(quality: GraphicsQuality) {
    this.currentTier = qualityToTier(quality);
    this.maxAutoTier = 3;
    this.tierFailures.fill(0);
    this.resetWindow(performance.now());
  }

  onResumeOrStart(now: number) {
    this.lastFrameTimestamp = 0;
    this.framesSinceReset = 0;
    this.badWindowStreak = 0;
    this.goodWindowStreak = 0;
    this.nextDowngradeAllowedAt = now + 1500;
  }

  private resetWindow(now: number) {
    this.deltaRing.fill(0);
    this.workRing.fill(0);
    this.spikeRing.fill(0);
    this.ringIdx = 0;
    this.ringCount = 0;
    this.sumDelta = 0;
    this.sumWork = 0;
    this.spikeCount = 0;
    this.framesSinceReset = 0;
    this.evalTick = 0;
    this.badWindowStreak = 0;
    this.goodWindowStreak = 0;
    this.lastFrameTimestamp = 0;
    this.prevDeltaMs = 16.67;
    this.smoothedDeltaMs = 16.67;
    if (this.nextDowngradeAllowedAt < now + 1500) {
      this.nextDowngradeAllowedAt = now + 1500;
    }
  }

  /**
   * Records a rendered frame. Returns a new tier config if auto-quality
   * adjusted, or null otherwise. Zero heap allocations.
   */
  recordFrame(
    now: number,
    workMs: number,
    autoEnabled: boolean
  ): AdaptiveTierConfig | null {
    if (this.lastFrameTimestamp <= 0) {
      this.lastFrameTimestamp = now;
      return null;
    }

    const rawDelta = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;

    // Ignore tab-switch or pause gaps
    if (rawDelta <= 1 || rawDelta > 200) {
      this.prevDeltaMs = 16.67;
      return null;
    }

    const deltaMs = rawDelta > 100 ? 100 : rawDelta;
    this.smoothedDeltaMs = this.smoothedDeltaMs * 0.75 + deltaMs * 0.25;

    const jitter = Math.abs(deltaMs - this.prevDeltaMs);
    this.prevDeltaMs = deltaMs;
    const isSpike = deltaMs > SPIKE_DELTA_MS || jitter > JITTER_DELTA_MS ? 1 : 0;

    if (this.ringCount < WINDOW_SIZE) {
      this.deltaRing[this.ringIdx] = deltaMs;
      this.workRing[this.ringIdx] = workMs;
      this.spikeRing[this.ringIdx] = isSpike;
      this.sumDelta += deltaMs;
      this.sumWork += workMs;
      this.spikeCount += isSpike;
      this.ringCount++;
    } else {
      this.sumDelta += deltaMs - this.deltaRing[this.ringIdx];
      this.sumWork += workMs - this.workRing[this.ringIdx];
      this.spikeCount += isSpike - this.spikeRing[this.ringIdx];
      this.deltaRing[this.ringIdx] = deltaMs;
      this.workRing[this.ringIdx] = workMs;
      this.spikeRing[this.ringIdx] = isSpike;
    }

    this.ringIdx = (this.ringIdx + 1) % WINDOW_SIZE;
    this.framesSinceReset++;

    if (!autoEnabled) return null;
    if (this.framesSinceReset < WARMUP_FRAMES || this.ringCount < WINDOW_SIZE) {
      return null;
    }

    this.evalTick++;
    if (this.evalTick < EVAL_INTERVAL) return null;
    this.evalTick = 0;

    const avgDelta = this.sumDelta / this.ringCount;
    const avgFps = avgDelta > 0 ? 1000 / avgDelta : 60;
    const avgWork = this.sumWork / this.ringCount;

    const isStruggling = avgFps < 46 || this.spikeCount >= 9 || avgWork > 15.0;
    const isHigh = avgFps >= 57 && this.spikeCount <= 1 && avgWork < 8.5;

    if (isStruggling) {
      this.badWindowStreak++;
      this.goodWindowStreak = 0;
      if (
        this.badWindowStreak >= 2 &&
        now >= this.nextDowngradeAllowedAt &&
        this.currentTier > 0
      ) {
        const failedTier = this.currentTier;
        this.tierFailures[failedTier]++;
        if (this.tierFailures[failedTier] >= 2 && this.maxAutoTier >= failedTier) {
          this.maxAutoTier = failedTier - 1;
        }
        this.currentTier--;
        this.nextDowngradeAllowedAt = now + DOWNGRADE_COOLDOWN_MS;
        this.nextUpgradeAllowedAt = now + POST_DOWNGRADE_UPGRADE_WAIT_MS;
        this.resetWindow(now);
        return ADAPTIVE_TIERS[this.currentTier];
      }
    } else if (isHigh) {
      this.goodWindowStreak++;
      if (this.badWindowStreak > 0) this.badWindowStreak--;
      if (
        this.goodWindowStreak >= 8 &&
        now >= this.nextUpgradeAllowedAt &&
        this.currentTier < this.maxAutoTier
      ) {
        this.currentTier++;
        this.nextUpgradeAllowedAt = now + UPGRADE_COOLDOWN_MS;
        this.nextDowngradeAllowedAt = now + DOWNGRADE_COOLDOWN_MS + 1000;
        this.resetWindow(now);
        return ADAPTIVE_TIERS[this.currentTier];
      }
    } else {
      if (this.badWindowStreak > 0) this.badWindowStreak--;
      if (this.goodWindowStreak > 0) this.goodWindowStreak--;
    }

    return null;
  }

  getMetrics(
    quality: GraphicsQuality,
    qualityMode: QualityMode,
    renderScale: number
  ): PerformanceMetrics {
    const currentFps =
      this.smoothedDeltaMs > 0 ? Math.min(240, Math.round(1000 / this.smoothedDeltaMs)) : 60;
    const avgDelta =
      this.ringCount > 0 ? this.sumDelta / this.ringCount : this.smoothedDeltaMs;
    const avgFps = avgDelta > 0 ? Math.min(240, Math.round(1000 / avgDelta)) : 60;
    const avgWork = this.ringCount > 0 ? this.sumWork / this.ringCount : 0;

    return {
      currentFps,
      avgFps,
      frameTimeMs: Number((avgWork > 0 ? avgWork : avgDelta).toFixed(1)),
      quality,
      qualityMode,
      renderScale: Number(renderScale.toFixed(2)),
    };
  }
}
