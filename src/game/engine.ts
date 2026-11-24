import type {
  Chaser,
  Coin,
  EngineCallbacks,
  GameState,
  GraphicsQuality,
  Obstacle,
  ObstacleType,
  Particle,
  PerformanceMetrics,
  Player,
  QualityMode,
  RenderResolutionConfig,
  ScooterRider,
  StickGeometry,
} from './types';
import { SoundManager } from './sound';
import { AdaptivePerformanceController } from './performance';

const BEST_KEY = 'tmdash_best';
const COIN_KEY = 'tmdash_coins_total';
const QUALITY_KEY = 'tmdash_quality_mode';
const SCOOTER_SCALE = 1.6;
const HM_CRUISE = 3.8;
const CM_CRUISE = 4.4;

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;
const MAX_ACCUMULATOR = FIXED_DT * 4;
const MAX_PARTICLES = 128;
const COIN_FRAMES = 16;
const COIN_SPRITE_SIZE = 44;
const SPRITE_SCALE = 2;

type RGBTuple = readonly [number, number, number];

const SKY_SUNRISE_TOP_A: RGBTuple = [27, 18, 51];
const SKY_SUNRISE_TOP_B: RGBTuple = [30, 111, 182];
const SKY_SUNRISE_MID_A: RGBTuple = [200, 80, 96];
const SKY_SUNRISE_MID_B: RGBTuple = [72, 166, 232];
const SKY_SUNRISE_BOT_A: RGBTuple = [255, 142, 83];
const SKY_SUNRISE_BOT_B: RGBTuple = [156, 224, 255];

const SKY_SUNSET_TOP_A: RGBTuple = [24, 100, 171];
const SKY_SUNSET_TOP_B: RGBTuple = [43, 9, 56];
const SKY_SUNSET_MID_A: RGBTuple = [51, 154, 240];
const SKY_SUNSET_MID_B: RGBTuple = [194, 37, 92];
const SKY_SUNSET_BOT_A: RGBTuple = [165, 216, 255];
const SKY_SUNSET_BOT_B: RGBTuple = [247, 103, 7];

const SKY_NIGHT_TOP_A: RGBTuple = [43, 9, 56];
const SKY_NIGHT_TOP_B: RGBTuple = [7, 11, 25];
const SKY_NIGHT_MID_A: RGBTuple = [20, 21, 41];
const SKY_NIGHT_MID_B: RGBTuple = [13, 19, 38];
const SKY_NIGHT_BOT_A: RGBTuple = [31, 45, 77];
const SKY_NIGHT_BOT_B: RGBTuple = [21, 34, 56];

const BEACHBALL_COLORS = ['#ef4444', '#eab308', '#06b6d4', '#f8fafc'] as const;
const UMBRELLA_COLORS = ['#f43f5e', '#38bdf8', '#fbbf24', '#f43f5e'] as const;

function lerpRgbString(a: RGBTuple, b: RGBTuple, t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = Math.round(a[0] + (b[0] - a[0]) * c);
  const g = Math.round(a[1] + (b[1] - a[1]) * c);
  const bl = Math.round(a[2] + (b[2] - a[2]) * c);
  return `rgb(${r},${g},${bl})`;
}

function readStoredNumber(key: string): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    const raw = window.localStorage.getItem(key);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, String(Math.floor(value)));
  } catch {
    /* private browsing / blocked storage / quota exceeded — keep running in memory */
  }
}

function readStoredQualityMode(): QualityMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'auto';
    const raw = window.localStorage.getItem(QUALITY_KEY);
    if (raw === 'auto' || raw === 'high' || raw === 'medium' || raw === 'low') {
      return raw;
    }
    return 'auto';
  } catch {
    return 'auto';
  }
}

function writeStoredQualityMode(mode: QualityMode): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(QUALITY_KEY, mode);
  } catch {
    /* ignore blocked storage */
  }
}

interface LabelSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

interface PalmTree {
  x: number;
  height: number;
  fronds: number;
  frondSin: number[];
  frondCos: number[];
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  alpha: number;
}

interface Island {
  x: number;
  w: number;
  h: number;
}

interface Shell {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface RunnerVisual {
  primary: string;
  secondary: string;
  visorBg: string;
  visorAccent: string;
  glowStroke: string;
  legColor: string;
  drawFrontArm: boolean;
  torsoGrad: CanvasGradient;
}

interface QualityProfile {
  dprCap: number;
  resolutionScale: number;
  maxParticles: number;
  waveLayers: number;
  waveStep: number;
  foamStep: number;
  starCount: number;
  cloudCount: number;
  islandCount: number;
  drawGroundShadows: boolean;
  drawSunReflection: boolean;
  drawRunnerAura: boolean;
  drawStickGlow: boolean;
  drawDustWhileRunning: boolean;
  useStaticPalms: boolean;
  skyBuckets: number;
  smoothingQuality: ImageSmoothingQuality;
}

const QUALITY_PROFILES: Record<GraphicsQuality, QualityProfile> = {
  high: {
    dprCap: 2,
    resolutionScale: 1,
    maxParticles: 128,
    waveLayers: 3,
    waveStep: 32,
    foamStep: 40,
    starCount: 35,
    cloudCount: 5,
    islandCount: 3,
    drawGroundShadows: true,
    drawSunReflection: true,
    drawRunnerAura: true,
    drawStickGlow: true,
    drawDustWhileRunning: true,
    useStaticPalms: false,
    skyBuckets: 240,
    smoothingQuality: 'high',
  },
  medium: {
    dprCap: 1.25,
    resolutionScale: 1,
    maxParticles: 72,
    waveLayers: 2,
    waveStep: 50,
    foamStep: 75,
    starCount: 20,
    cloudCount: 4,
    islandCount: 3,
    drawGroundShadows: true,
    drawSunReflection: true,
    drawRunnerAura: true,
    drawStickGlow: false,
    drawDustWhileRunning: true,
    useStaticPalms: false,
    skyBuckets: 120,
    smoothingQuality: 'medium',
  },
  low: {
    dprCap: 1,
    resolutionScale: 1,
    maxParticles: 36,
    waveLayers: 1,
    waveStep: 90,
    foamStep: 120,
    starCount: 12,
    cloudCount: 3,
    islandCount: 2,
    drawGroundShadows: false,
    drawSunReflection: false,
    drawRunnerAura: false,
    drawStickGlow: false,
    drawDustWhileRunning: false,
    useStaticPalms: true,
    skyBuckets: 64,
    smoothingQuality: 'low',
  },
};

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private sound: SoundManager;

  private raf = 0;
  private idleRaf = 0;
  private lastTime = 0;
  private idleLastTime = 0;
  private accumulator = 0;
  private state: GameState = 'ready';
  private diedAt = 0;
  private destroyed = false;

  // Logical world size — renders to 900x360 virtual space,
  // letterboxed to fit any display.
  readonly W = 900;
  readonly H = 360;
  private groundY: number;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private isMobileLike: boolean;
  private qualityMode: QualityMode = 'auto';
  private quality: GraphicsQuality = 'high';
  private profile: QualityProfile = QUALITY_PROFILES.high;
  private customDprCap?: number;
  private customResScale?: number;
  private cssW = 0;
  private cssH = 0;

  // Adaptive quality/DPR performance monitor
  private perfController: AdaptivePerformanceController;
  private adaptiveScale = 1;
  private metricsEnabled = false;
  private lastMetricsEmitAt = 0;

  private player: Player;
  private chasers: Chaser[] = [];
  private scooters: ScooterRider[] = [];
  private obstacles: Obstacle[] = [];
  private obstaclePool: Obstacle[] = [];
  private coins: Coin[] = [];
  private coinPool: Coin[] = [];

  // Fixed-capacity particle pool (zero runtime heap churn)
  private particlePool: Particle[] = [];
  private activeParticleCount = 0;

  // Reusable scratch object for stick geometry
  private stickGeom: StickGeometry = { handX: 0, handY: 0, tipX: 0, tipY: 0 };

  // Balanced speeds: gradual progression, capped max speed
  private speed = 4.0;
  private baseSpeed = 4.0;
  private maxSpeed = 7.8;
  private distance = 0;
  private score = 0;
  private coinCount = 0;
  private best = 0;
  private totalCoinsSaved = 0;
  private lastReportedScore = -1;
  private lastReportedCoins = -1;
  private lastTimeOfDay = 'Daytime';

  // Generous obstacle and coin spacing
  private spawnTimer = 0;
  private nextSpawn = 180;
  private coinTimer = 0;
  private nextCoin = 160;

  // Background and environment state
  private waveOffset = 0;
  private cloudOffset = 0;
  private sandOffset = 0;
  private shake = 0;
  private flash = 0;
  private timeAlive = 0;
  readonly dayCycleDuration = 76;

  // Pre-generated static scenery elements
  private clouds: Cloud[] = [];
  private islands: Island[] = [];
  private palmTrees: PalmTree[] = [];
  private shells: Shell[] = [];

  // Cached gradients & offscreen sprites
  private cachedSkyBucket = -1;
  private cachedSkyGrad: CanvasGradient | null = null;
  private oceanGrads: CanvasGradient[] = [];
  private sunReflectGrads: CanvasGradient[] = [];
  private rockGrad!: CanvasGradient;
  private sandmoundGrad!: CanvasGradient;
  private stickGrads: CanvasGradient[] = [];

  private tmVisual!: RunnerVisual;
  private efotVisual!: RunnerVisual;
  private dadaVisual!: RunnerVisual;

  private sunCoronas: HTMLCanvasElement[] = [];
  private moonSprite!: HTMLCanvasElement;
  private beachballSprite!: HTMLCanvasElement;
  private umbrellaSprite!: HTMLCanvasElement;
  private coinSheet!: HTMLCanvasElement;
  private beachGroundLayers: HTMLCanvasElement[] = [];
  private palmSpritesByTheme: HTMLCanvasElement[][] = [];
  private labelSprites: Record<string, LabelSprite> = {};
  private swingBadgeSprite!: LabelSprite;

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx =
      canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.cb = cb;
    this.sound = new SoundManager();

    this.isMobileLike =
      typeof window !== 'undefined' &&
      (window.innerWidth < 1024 || navigator.maxTouchPoints > 0);
    this.qualityMode = readStoredQualityMode();
    this.quality =
      this.qualityMode === 'auto' ? this.detectInitialQuality() : this.qualityMode;
    this.profile = QUALITY_PROFILES[this.quality];
    this.perfController = new AdaptivePerformanceController(this.quality);
    this.cb.onQualityChange?.(this.quality);

    this.groundY = this.H - 64; // y=296 is the walkable sand surface
    this.best = readStoredNumber(BEST_KEY);
    this.totalCoinsSaved = readStoredNumber(COIN_KEY);

    this.player = {
      x: 200,
      y: this.groundY - 48,
      w: 38,
      h: 48,
      vy: 0,
      onGround: true,
      jumpsLeft: 2,
      runFrame: 0,
      squashTimer: 0,
    };

    // Pre-allocate particle pool
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particlePool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 2,
        color: '#ffffff',
        gravity: 0,
      });
    }

    this.initScenery();
    this.chasers = this.initChasers();
    this.scooters = this.initScooters();
    this.initCachedGradientsAndSprites();
    this.resize();
  }

  // ---- public API ----

  resumeAudio() {
    this.sound.resume();
  }

  suspendAudio() {
    this.sound.suspend();
  }

  getState(): GameState {
    return this.state;
  }

  handleVisibilityChange(hidden: boolean) {
    if (this.destroyed) return;
    if (hidden) {
      this.sound.suspend();
      this.lastTime = 0;
      this.idleLastTime = 0;
      this.accumulator = 0;
      if (this.state === 'running') {
        this.togglePause();
      } else if (this.idleRaf) {
        cancelAnimationFrame(this.idleRaf);
        this.idleRaf = 0;
      }
    } else {
      this.resize();
      if (this.state === 'ready') {
        this.idleRender();
      } else {
        this.render();
      }
    }
  }

  start() {
    this.cancelLoops();
    if (this.state === 'running' || this.state === 'paused') {
      this.bankRun();
    }
    this.reset();
    this.setState('running');
    this.sound.resume();
    this.sound.play('start');
    this.lastTime = 0;
    this.accumulator = FIXED_DT; // step once immediately on first rAF
    this.perfController.onResumeOrStart(performance.now());
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  }

  idleRender(t?: number) {
    if (this.destroyed || this.state !== 'ready') return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (t === undefined) {
      cancelAnimationFrame(this.idleRaf);
      this.idleRaf = 0;
      this.idleLastTime = 0;
      this.render();
      this.idleRaf = requestAnimationFrame(this.idleLoop);
      return;
    }

    this.idleLoop(t);
  }

  private idleLoop = (t: number) => {
    this.idleRaf = 0;
    if (this.destroyed || this.state !== 'ready') return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.idleLastTime = 0;
      return;
    }

    let dt = this.idleLastTime ? (t - this.idleLastTime) / 1000 : FIXED_DT;
    this.idleLastTime = t;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = FIXED_DT;
    const step = dt * 60;

    this.waveOffset = (this.waveOffset + 0.6 * step) % 600;
    this.cloudOffset = (this.cloudOffset + 0.12 * step) % 900;
    this.sandOffset = (this.sandOffset + 1.4 * step) % 60;
    this.timeAlive += dt;
    this.emitTimeOfDayIfChanged();

    this.player.runFrame += 0.12 * step;
    for (let i = 0; i < this.chasers.length; i++) {
      this.chasers[i].runFrame += 0.12 * step;
    }

    this.render();
    if (!this.destroyed && this.state === 'ready') {
      this.idleRaf = requestAnimationFrame(this.idleLoop);
    }
  };

  togglePause() {
    if (this.state === 'running') {
      this.setState('paused');
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.lastTime = 0;
      this.accumulator = 0;
    } else if (this.state === 'paused') {
      this.setState('running');
      this.sound.resume();
      this.lastTime = 0;
      this.accumulator = 0;
      this.perfController.onResumeOrStart(performance.now());
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  restart() {
    this.start();
  }

  canRestart() {
    return this.state !== 'gameover' || performance.now() - this.diedAt > 700;
  }

  jump() {
    if (this.state !== 'running') return;
    if (this.player.jumpsLeft <= 0) return;
    const isFirst = this.player.onGround;
    this.player.vy = isFirst ? -11.6 : -9.8;
    this.player.onGround = false;
    this.player.jumpsLeft -= 1;
    this.sound.play('jump');
    this.spawnSandDust(this.player.x + 8, this.groundY, 6);
  }

  setSoundEnabled(enabled: boolean) {
    this.sound.setEnabled(enabled);
  }

  isSoundEnabled() {
    return this.sound.enabled;
  }

  getBest() {
    return this.best;
  }

  getTotalCoins() {
    return this.totalCoinsSaved;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelLoops();
    this.sound.dispose();

    // Release active entities & pools
    for (let i = 0; i < this.scooters.length; i++) {
      this.scooters[i].lastHopped = null;
    }
    this.obstacles.length = 0;
    this.obstaclePool.length = 0;
    this.coins.length = 0;
    this.coinPool.length = 0;
    this.particlePool.length = 0;
    this.activeParticleCount = 0;

    // Release cached gradients & offscreen canvas backing stores
    this.cachedSkyGrad = null;
    this.oceanGrads.length = 0;
    this.sunReflectGrads.length = 0;
    this.stickGrads.length = 0;

    const releaseCanvas = (c?: HTMLCanvasElement) => {
      if (!c) return;
      c.width = 0;
      c.height = 0;
    };
    for (let i = 0; i < this.sunCoronas.length; i++) releaseCanvas(this.sunCoronas[i]);
    this.sunCoronas.length = 0;
    releaseCanvas(this.moonSprite);
    releaseCanvas(this.beachballSprite);
    releaseCanvas(this.umbrellaSprite);
    releaseCanvas(this.coinSheet);
    for (let i = 0; i < this.beachGroundLayers.length; i++) {
      releaseCanvas(this.beachGroundLayers[i]);
    }
    this.beachGroundLayers.length = 0;
    for (let i = 0; i < this.palmSpritesByTheme.length; i++) {
      const themeSprites = this.palmSpritesByTheme[i];
      for (let j = 0; j < themeSprites.length; j++) releaseCanvas(themeSprites[j]);
    }
    this.palmSpritesByTheme.length = 0;
    for (const key of Object.keys(this.labelSprites)) {
      releaseCanvas(this.labelSprites[key].canvas);
      delete this.labelSprites[key];
    }
    releaseCanvas(this.swingBadgeSprite?.canvas);
  }

  setQualityMode(mode: QualityMode) {
    this.qualityMode = mode;
    writeStoredQualityMode(mode);
    this.adaptiveScale = 1;
    const nextQuality = mode === 'auto' ? this.detectInitialQuality() : mode;
    this.perfController.setInitialQuality(nextQuality);
    this.applyQuality(nextQuality, true);
    if (this.metricsEnabled) {
      this.emitPerformanceMetrics(performance.now(), true);
    }
  }

  getQuality(): GraphicsQuality {
    return this.quality;
  }

  getQualityMode(): QualityMode {
    return this.qualityMode;
  }

  getEffectiveRenderScale(): number {
    return this.dpr;
  }

  setMetricsEnabled(enabled: boolean) {
    this.metricsEnabled = enabled;
    if (enabled) {
      this.emitPerformanceMetrics(performance.now(), true);
    }
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return this.perfController.getMetrics(this.quality, this.qualityMode, this.dpr);
  }

  setResolutionConfig(config: RenderResolutionConfig) {
    this.customDprCap = config.dprCap;
    this.customResScale = config.resolutionScale;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const presetCap =
      this.quality === 'high' && this.isMobileLike ? 1.5 : this.profile.dprCap;
    const dprCap = this.customDprCap ?? presetCap;
    const baseDpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const autoScale =
      this.quality === 'low' && cw <= 360
        ? this.qualityMode === 'auto'
          ? Math.max(0.85, this.adaptiveScale)
          : 1
        : this.profile.resolutionScale *
          (this.qualityMode === 'auto' ? this.adaptiveScale : 1);
    const resScale = this.customResScale ?? autoScale;
    const nextDpr = Math.max(0.7, baseDpr * resScale);

    const targetW = Math.max(1, Math.round(cw * nextDpr));
    const targetH = Math.max(1, Math.round(ch * nextDpr));

    const sx = cw / this.W;
    const sy = ch / this.H;
    const nextScale = Math.min(sx, sy);
    const nextOffsetX = (cw - this.W * nextScale) / 2;
    const nextOffsetY = (ch - this.H * nextScale) / 2;

    if (
      this.canvas.width === targetW &&
      this.canvas.height === targetH &&
      this.dpr === nextDpr &&
      this.cssW === cw &&
      this.cssH === ch
    ) {
      return;
    }

    this.dpr = nextDpr;
    this.cssW = cw;
    this.cssH = ch;
    this.scale = nextScale;
    this.offsetX = nextOffsetX;
    this.offsetY = nextOffsetY;

    this.canvas.width = targetW;
    this.canvas.height = targetH;
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;

    if (this.state !== 'running') {
      this.render();
    }
  }

  private detectInitialQuality(): GraphicsQuality {
    if (typeof window === 'undefined' || !this.isMobileLike) return 'high';
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if ((mem !== undefined && mem <= 2) || cores <= 4) {
      return mem !== undefined && mem <= 2 && cores <= 4 ? 'low' : 'medium';
    }
    if (mem !== undefined && mem <= 4) {
      return 'medium';
    }
    return 'high';
  }

  private applyQuality(next: GraphicsQuality, forceResize: boolean) {
    const changed = next !== this.quality;
    this.quality = next;
    this.profile = QUALITY_PROFILES[next];
    this.cachedSkyBucket = -1;
    if (changed) {
      this.cb.onQualityChange?.(next);
    }
    if (forceResize || changed) {
      this.resize();
      if (this.state !== 'running') {
        this.render();
      }
    }
  }

  // ---- internal setup ----

  private cancelLoops() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.idleRaf) {
      cancelAnimationFrame(this.idleRaf);
      this.idleRaf = 0;
    }
  }

  private initScenery() {
    this.clouds = [
      { x: 50, y: 35, w: 90, h: 28, speed: 0.12, alpha: 0.75 * 0.7 },
      { x: 260, y: 55, w: 120, h: 32, speed: 0.18, alpha: 0.8 * 0.7 },
      { x: 490, y: 25, w: 85, h: 24, speed: 0.14, alpha: 0.7 * 0.7 },
      { x: 710, y: 48, w: 110, h: 30, speed: 0.16, alpha: 0.85 * 0.7 },
      { x: 880, y: 65, w: 75, h: 22, speed: 0.13, alpha: 0.65 * 0.7 },
    ];

    this.islands = [
      { x: 110, w: 160, h: 42 },
      { x: 420, w: 220, h: 58 },
      { x: 740, w: 180, h: 46 },
    ];

    const rawPalms = [
      { x: 80, height: 85, fronds: 5 },
      { x: 290, height: 78, fronds: 5 },
      { x: 520, height: 92, fronds: 6 },
      { x: 760, height: 82, fronds: 5 },
    ];
    this.palmTrees = rawPalms.map((p) => {
      const frondSin: number[] = [];
      const frondCos: number[] = [];
      for (let f = 0; f < p.fronds; f++) {
        const ang = (f / (p.fronds - 1) - 0.5) * 1.6;
        frondSin.push(Math.sin(ang));
        frondCos.push(Math.cos(ang));
      }
      return { ...p, frondSin, frondCos };
    });

    this.shells = [];
    for (let i = 0; i < 18; i++) {
      this.shells.push({
        x: (i * 53) % this.W,
        y: this.groundY + 12 + ((i * 19) % 36),
        r: 3 + ((i * 3) % 4),
        color: i % 2 === 0 ? '#ffedd5' : '#fed7aa',
      });
    }
  }

  private initChasers(): Chaser[] {
    return [
      {
        id: 'EFOT',
        name: 'EFOT',
        baseX: 96,
        strikeX: 150,
        x: 96,
        y: this.groundY - 46,
        w: 36,
        h: 46,
        vy: 0,
        onGround: true,
        runFrame: 0,
        squashTimer: 0,
        colorTheme: {
          primary: '#f97316',
          secondary: '#c2410c',
          visor: '#fef08a',
          glow: '#ea580c',
          labelBg: '#431407',
          stickColor: '#fb923c',
          stickGlow: '#f97316',
        },
        attackPhase: 'idle',
        phaseTimer: 0,
        attackCooldown: 20.0,
        stickAngle: -0.6,
        stickLength: 46,
        lungeX: 0,
      },
      {
        id: 'DADA',
        name: 'DADA',
        baseX: 28,
        strikeX: 130,
        x: 28,
        y: this.groundY - 46,
        w: 36,
        h: 46,
        vy: 0,
        onGround: true,
        runFrame: 0.5,
        squashTimer: 0,
        colorTheme: {
          primary: '#d946ef',
          secondary: '#9333ea',
          visor: '#f5d0fe',
          glow: '#c026d3',
          labelBg: '#3b0764',
          stickColor: '#f43f5e',
          stickGlow: '#fb7185',
        },
        attackPhase: 'idle',
        phaseTimer: 0,
        attackCooldown: 36.0,
        stickAngle: -0.6,
        stickLength: 56,
        lungeX: 0,
      },
    ];
  }

  private initScooters(): ScooterRider[] {
    const size = 48 * SCOOTER_SCALE;
    return [
      {
        id: 'HM',
        name: 'HM',
        x: this.W + 80,
        y: this.groundY - size,
        w: size,
        h: size,
        cruise: HM_CRUISE,
        vy: 0,
        onGround: true,
        wheelRotation: 0,
        bobPhase: 0,
        active: false,
        spawnCooldown: 18,
        lastHopped: null,
        colorTheme: {
          rider: '#059669',
          shirt: '#10b981',
          scooter: '#06b6d4',
          wheels: '#0e7490',
          accent: '#a7f3d0',
          labelColor: '#10b981',
          labelBg: '#064e3b',
        },
      },
      {
        id: 'CM',
        name: 'CM',
        x: this.W + 160,
        y: this.groundY - size,
        w: size,
        h: size,
        cruise: CM_CRUISE,
        vy: 0,
        onGround: true,
        wheelRotation: 0,
        bobPhase: 1.5,
        active: false,
        spawnCooldown: 36,
        lastHopped: null,
        colorTheme: {
          rider: '#e11d48',
          shirt: '#fb7185',
          scooter: '#f59e0b',
          wheels: '#b45309',
          accent: '#fecdd3',
          labelColor: '#fb7185',
          labelBg: '#4c0519',
        },
      },
    ];
  }

  private initCachedGradientsAndSprites() {
    const ctx = this.ctx;
    const horizonY = this.groundY - 80;
    const seaHeight = 55;

    // 4 discrete ocean gradients
    const oceanPairs: [string, string][] = [
      ['#2c3e50', '#34495e'],
      ['#0077b6', '#0096c7'],
      ['#3d1635', '#5c1d4a'],
      ['#071626', '#0b253a'],
    ];
    this.oceanGrads = oceanPairs.map(([top, bot]) => {
      const g = ctx.createLinearGradient(0, horizonY, 0, horizonY + seaHeight);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      return g;
    });

    // 4 discrete sand color pairs (baked into beachGroundLayers)
    const sandPairs: [string, string][] = [
      ['#e0a96d', '#a66b38'],
      ['#f4a261', '#e76f51'],
      ['#d88373', '#9e4770'],
      ['#34495e', '#1e272e'],
    ];

    // 3 discrete sun reflection beam gradients (vertical only, independent of sunX)
    const sunGlowColors = [
      'rgba(255, 120, 50, 0.45)',
      'rgba(255, 200, 80, 0.35)',
      'rgba(255, 80, 80, 0.5)',
    ];
    this.sunReflectGrads = sunGlowColors.map((glowColor) => {
      const g = ctx.createLinearGradient(0, horizonY, 0, this.groundY - 10);
      g.addColorStop(0, glowColor);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      return g;
    });

    // Local-coordinate obstacle gradients
    this.rockGrad = ctx.createLinearGradient(0, 0, 0, 26);
    this.rockGrad.addColorStop(0, '#94a3b8');
    this.rockGrad.addColorStop(1, '#475569');

    this.sandmoundGrad = ctx.createLinearGradient(0, 0, 0, 24);
    this.sandmoundGrad.addColorStop(0, '#fde047');
    this.sandmoundGrad.addColorStop(1, '#ca8a04');

    // Runner torso gradients (local 0..h)
    const makeRunnerGrad = (h: number, primary: string, secondary: string) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, primary);
      g.addColorStop(1, secondary);
      return g;
    };

    this.tmVisual = {
      primary: '#5cff5c',
      secondary: '#1faf1f',
      visorBg: '#06280a',
      visorAccent: '#aaffaa',
      glowStroke: 'rgba(57, 255, 20, 0.38)',
      legColor: '#0c8a0c',
      drawFrontArm: true,
      torsoGrad: makeRunnerGrad(this.player.h, '#5cff5c', '#1faf1f'),
    };

    const efot = this.chasers[0];
    this.efotVisual = {
      primary: efot.colorTheme.primary,
      secondary: efot.colorTheme.secondary,
      visorBg: '#0f172a',
      visorAccent: efot.colorTheme.visor,
      glowStroke: 'rgba(234, 88, 12, 0.38)',
      legColor: efot.colorTheme.secondary,
      drawFrontArm: false,
      torsoGrad: makeRunnerGrad(efot.h, efot.colorTheme.primary, efot.colorTheme.secondary),
    };

    const dada = this.chasers[1];
    this.dadaVisual = {
      primary: dada.colorTheme.primary,
      secondary: dada.colorTheme.secondary,
      visorBg: '#0f172a',
      visorAccent: dada.colorTheme.visor,
      glowStroke: 'rgba(192, 38, 211, 0.38)',
      legColor: dada.colorTheme.secondary,
      drawFrontArm: false,
      torsoGrad: makeRunnerGrad(dada.h, dada.colorTheme.primary, dada.colorTheme.secondary),
    };

    // Chaser stick gradients
    this.stickGrads = this.chasers.map((c) => {
      const g = ctx.createLinearGradient(0, 0, c.stickLength, 0);
      g.addColorStop(0, '#94a3b8');
      g.addColorStop(0.35, c.colorTheme.stickColor);
      g.addColorStop(1, '#ffffff');
      return g;
    });

    // Sun corona + body offscreen sprites (3 phases)
    const sunBodyColors = [
      'rgba(255, 170, 70, 0.95)',
      'rgba(255, 240, 160, 0.95)',
      'rgba(255, 100, 70, 0.95)',
    ];
    this.sunCoronas = sunGlowColors.map((glow, idx) => {
      const c = document.createElement('canvas');
      c.width = 140;
      c.height = 140;
      const gctx = c.getContext('2d');
      if (gctx) {
        const sg = gctx.createRadialGradient(70, 70, 6, 70, 70, 70);
        sg.addColorStop(0, glow);
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        gctx.fillStyle = sg;
        gctx.beginPath();
        gctx.arc(70, 70, 70, 0, Math.PI * 2);
        gctx.fill();

        gctx.fillStyle = sunBodyColors[idx];
        gctx.beginPath();
        gctx.arc(70, 70, 20, 0, Math.PI * 2);
        gctx.fill();
      }
      return c;
    });

    // Moon corona + crescent sprite
    this.moonSprite = document.createElement('canvas');
    this.moonSprite.width = 90;
    this.moonSprite.height = 90;
    {
      const mctx = this.moonSprite.getContext('2d');
      if (mctx) {
        const mg = mctx.createRadialGradient(45, 45, 4, 45, 45, 45);
        mg.addColorStop(0, 'rgba(210, 235, 255, 0.4)');
        mg.addColorStop(1, 'rgba(255,255,255,0)');
        mctx.fillStyle = mg;
        mctx.beginPath();
        mctx.arc(45, 45, 45, 0, Math.PI * 2);
        mctx.fill();

        mctx.fillStyle = '#f0f9ff';
        mctx.beginPath();
        mctx.arc(45, 45, 15, 0, Math.PI * 2);
        mctx.fill();

        mctx.fillStyle = '#070b19';
        mctx.beginPath();
        mctx.arc(51, 42, 13, 0, Math.PI * 2);
        mctx.fill();
      }
    }

    // Beachball sprite (32x32 logical, 2x oversampled)
    this.beachballSprite = document.createElement('canvas');
    this.beachballSprite.width = 32 * SPRITE_SCALE;
    this.beachballSprite.height = 32 * SPRITE_SCALE;
    {
      const bctx = this.beachballSprite.getContext('2d');
      if (bctx) {
        bctx.scale(SPRITE_SCALE, SPRITE_SCALE);
        bctx.translate(16, 16);
        for (let i = 0; i < 4; i++) {
          bctx.fillStyle = BEACHBALL_COLORS[i];
          bctx.beginPath();
          bctx.moveTo(0, 0);
          bctx.arc(0, 0, 16, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          bctx.closePath();
          bctx.fill();
        }
        bctx.fillStyle = '#ffffff';
        bctx.beginPath();
        bctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        bctx.fill();
        bctx.strokeStyle = 'rgba(0,0,0,0.15)';
        bctx.lineWidth = 1;
        bctx.stroke();
      }
    }

    // Umbrella sprite (34x56 logical, 2x oversampled)
    this.umbrellaSprite = document.createElement('canvas');
    this.umbrellaSprite.width = 34 * SPRITE_SCALE;
    this.umbrellaSprite.height = 56 * SPRITE_SCALE;
    {
      const uctx = this.umbrellaSprite.getContext('2d');
      if (uctx) {
        uctx.scale(SPRITE_SCALE, SPRITE_SCALE);
        const w = 34;
        const h = 56;
        uctx.strokeStyle = '#e2e8f0';
        uctx.lineWidth = 3;
        uctx.beginPath();
        uctx.moveTo(w * 0.5, h);
        uctx.lineTo(w * 0.5, 12);
        uctx.stroke();

        const cx = w * 0.5;
        const cy = 14;
        const span = (w * 0.5) / 2;
        for (let i = 0; i < 4; i++) {
          uctx.fillStyle = UMBRELLA_COLORS[i];
          uctx.beginPath();
          uctx.moveTo(cx, cy - 10);
          uctx.lineTo(cx - w * 0.5 + i * span, cy);
          uctx.lineTo(cx - w * 0.5 + (i + 1) * span, cy);
          uctx.closePath();
          uctx.fill();
        }
      }
    }

    // Pre-rendered coin animation sprite sheet (no live shadowBlur/text per frame)
    this.coinSheet = document.createElement('canvas');
    this.coinSheet.width = COIN_FRAMES * COIN_SPRITE_SIZE * SPRITE_SCALE;
    this.coinSheet.height = COIN_SPRITE_SIZE * SPRITE_SCALE;
    {
      const cctx = this.coinSheet.getContext('2d');
      if (cctx) {
        cctx.scale(SPRITE_SCALE, SPRITE_SCALE);
        const r = 9;
        const half = COIN_SPRITE_SIZE / 2;
        for (let f = 0; f < COIN_FRAMES; f++) {
          const sx = f / (COIN_FRAMES - 1);
          const cx = f * COIN_SPRITE_SIZE + half;
          const cy = half;
          cctx.save();
          cctx.translate(cx, cy);
          cctx.shadowColor = '#ffd633';
          cctx.shadowBlur = 10;
          cctx.fillStyle = '#ffcc00';
          cctx.beginPath();
          cctx.ellipse(0, 0, r * (0.4 + sx * 0.6), r, 0, 0, Math.PI * 2);
          cctx.fill();
          cctx.shadowBlur = 0;
          cctx.fillStyle = '#fff3b0';
          cctx.beginPath();
          cctx.ellipse(0, 0, r * (0.2 + sx * 0.35), r * 0.55, 0, 0, Math.PI * 2);
          cctx.fill();
          if (sx > 0.5) {
            cctx.fillStyle = 'rgba(180,120,0,0.5)';
            cctx.font = 'bold 10px monospace';
            cctx.textAlign = 'center';
            cctx.textBaseline = 'middle';
            cctx.fillText('T', 0, 0);
          }
          cctx.restore();
        }
      }
    }

    // Pre-rendered character name badges & ! SWING alert
    this.labelSprites = {
      TM: this.bakeLabelSprite('TM', '#22d3ee', '#082f49', 11),
      EFOT: this.bakeLabelSprite(
        'EFOT',
        efot.colorTheme.primary,
        efot.colorTheme.labelBg,
        11
      ),
      DADA: this.bakeLabelSprite(
        'DADA',
        dada.colorTheme.primary,
        dada.colorTheme.labelBg,
        11
      ),
      HM: this.bakeLabelSprite(
        'HM',
        this.scooters[0].colorTheme.labelColor,
        this.scooters[0].colorTheme.labelBg,
        13
      ),
      CM: this.bakeLabelSprite(
        'CM',
        this.scooters[1].colorTheme.labelColor,
        this.scooters[1].colorTheme.labelBg,
        13
      ),
    };
    this.swingBadgeSprite = this.bakeSwingBadgeSprite();

    // Pre-rendered static beach sand + shells per day/night phase (4 layers)
    const groundH = this.H - this.groundY;
    this.beachGroundLayers = sandPairs.map(([top, bot]) => {
      const layer = document.createElement('canvas');
      layer.width = this.W * SPRITE_SCALE;
      layer.height = groundH * SPRITE_SCALE;
      const bctx = layer.getContext('2d');
      if (bctx) {
        bctx.scale(SPRITE_SCALE, SPRITE_SCALE);
        const sg = bctx.createLinearGradient(0, -8, 0, groundH);
        sg.addColorStop(0, top);
        sg.addColorStop(1, bot);
        bctx.fillStyle = sg;
        bctx.fillRect(0, 0, this.W, groundH);

        bctx.strokeStyle = '#fff3bf';
        bctx.lineWidth = 2.5;
        bctx.beginPath();
        bctx.moveTo(0, 0);
        bctx.lineTo(this.W, 0);
        bctx.stroke();

        for (let i = 0; i < this.shells.length; i++) {
          const sh = this.shells[i];
          bctx.fillStyle = sh.color;
          bctx.beginPath();
          bctx.arc(sh.x, sh.y - this.groundY, sh.r, 0, Math.PI);
          bctx.fill();
        }
      }
      return layer;
    });

    // Pre-rendered static palm tree sprites per theme (used in LOW quality mode)
    const palmThemes: [string, string][] = [
      ['#7f4f24', '#2d6a4f'], // day / sunrise
      ['#5c3d2e', '#704214'], // sunset
      ['#1e293b', '#0f3a28'], // night
    ];
    this.palmSpritesByTheme = palmThemes.map(([trunkColor, leafColor]) =>
      this.palmTrees.map((p) => {
        const spriteW = 130;
        const spriteH = 130;
        const c = document.createElement('canvas');
        c.width = spriteW * SPRITE_SCALE;
        c.height = spriteH * SPRITE_SCALE;
        const pctx = c.getContext('2d');
        if (pctx) {
          pctx.scale(SPRITE_SCALE, SPRITE_SCALE);
          const baseX = 45;
          const baseY = spriteH - 8;
          pctx.strokeStyle = trunkColor;
          pctx.lineWidth = 4.5;
          pctx.beginPath();
          pctx.moveTo(baseX, baseY);
          pctx.quadraticCurveTo(
            baseX + 12,
            baseY - p.height * 0.5,
            baseX + 20,
            baseY - p.height
          );
          pctx.stroke();

          const tipX = baseX + 20;
          const tipY = baseY - p.height;
          pctx.strokeStyle = leafColor;
          pctx.lineWidth = 3;
          for (let f = 0; f < p.fronds; f++) {
            const sAng = p.frondSin[f];
            const cAng = p.frondCos[f];
            pctx.beginPath();
            pctx.moveTo(tipX, tipY);
            pctx.quadraticCurveTo(
              tipX + sAng * 26,
              tipY - 10 + cAng * 6,
              tipX + sAng * 45,
              tipY + cAng * 20
            );
            pctx.stroke();
          }

          pctx.fillStyle = '#4a2810';
          pctx.beginPath();
          pctx.arc(tipX - 2, tipY + 2, 3.5, 0, Math.PI * 2);
          pctx.arc(tipX + 3, tipY + 3, 3.5, 0, Math.PI * 2);
          pctx.fill();
        }
        return c;
      })
    );
  }

  private bakeLabelSprite(
    text: string,
    color: string,
    bgColor: string,
    fontSize: number
  ): LabelSprite {
    const pad = 8; // room for baked glow
    const canvas = document.createElement('canvas');
    const tmpCtx = canvas.getContext('2d')!;
    tmpCtx.font = `bold ${fontSize}px monospace, sans-serif`;
    const textWidth = tmpCtx.measureText(text).width;
    const badgeW = Math.ceil(textWidth + 12);
    const badgeH = fontSize + 4;
    const w = badgeW + pad * 2;
    const h = badgeH + pad * 2;

    canvas.width = w * SPRITE_SCALE;
    canvas.height = h * SPRITE_SCALE;

    const lctx = canvas.getContext('2d')!;
    lctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    lctx.font = `bold ${fontSize}px monospace, sans-serif`;
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';

    lctx.fillStyle = bgColor;
    lctx.strokeStyle = color;
    lctx.lineWidth = 1.5;
    lctx.shadowColor = color;
    lctx.shadowBlur = 6;
    this.roundRect(lctx, pad, pad, badgeW, badgeH, 4);
    lctx.fill();
    lctx.stroke();
    lctx.shadowBlur = 0;

    lctx.lineWidth = 2.5;
    lctx.strokeStyle = '#0f172a';
    lctx.strokeText(text, pad + badgeW / 2, pad + badgeH / 2);
    lctx.fillStyle = color;
    lctx.fillText(text, pad + badgeW / 2, pad + badgeH / 2);

    return { canvas, w, h };
  }

  private bakeSwingBadgeSprite(): LabelSprite {
    const pad = 10;
    const warnW = 40;
    const warnH = 12;
    const w = warnW + pad * 2;
    const h = warnH + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * SPRITE_SCALE;
    canvas.height = h * SPRITE_SCALE;

    const sctx = canvas.getContext('2d')!;
    sctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    sctx.fillStyle = '#ef4444';
    sctx.strokeStyle = '#fef08a';
    sctx.lineWidth = 1;
    sctx.shadowColor = '#ef4444';
    sctx.shadowBlur = 8;
    this.roundRect(sctx, pad, pad, warnW, warnH, 3);
    sctx.fill();
    sctx.stroke();
    sctx.shadowBlur = 0;

    sctx.fillStyle = '#ffffff';
    sctx.font = 'bold 9px monospace, sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('! SWING', pad + warnW / 2, pad + 6);

    return { canvas, w, h };
  }

  private setState(s: GameState) {
    this.state = s;
    this.cb.onStateChange(s);
    if (s === 'ready') this.cb.onReady?.();
  }

  private emitScoreIfChanged(force = false) {
    if (
      force ||
      this.score !== this.lastReportedScore ||
      this.coinCount !== this.lastReportedCoins
    ) {
      this.lastReportedScore = this.score;
      this.lastReportedCoins = this.coinCount;
      this.cb.onScore(this.score, this.coinCount);
    }
  }

  private emitTimeOfDayIfChanged() {
    const tod = this.getTimeOfDayName();
    if (tod !== this.lastTimeOfDay) {
      this.lastTimeOfDay = tod;
      this.cb.onTimeOfDayChange?.(tod);
    }
  }

  private reset() {
    this.speed = this.baseSpeed;
    this.distance = 0;
    this.score = 0;
    this.coinCount = 0;
    this.lastReportedScore = -1;
    this.lastReportedCoins = -1;
    this.timeAlive = 0;
    this.emitTimeOfDayIfChanged();

    // Return active entities to pools without retaining references
    for (let i = 0; i < this.obstacles.length; i++) {
      this.obstaclePool.push(this.obstacles[i]);
    }
    this.obstacles.length = 0;

    for (let i = 0; i < this.coins.length; i++) {
      this.coinPool.push(this.coins[i]);
    }
    this.coins.length = 0;

    this.activeParticleCount = 0;

    this.spawnTimer = 0;
    this.nextSpawn = 180;
    this.coinTimer = 0;
    this.nextCoin = 160;
    this.shake = 0;
    this.flash = 0;
    this.player.x = 200;
    this.player.y = this.groundY - this.player.h;
    this.player.vy = 0;
    this.player.onGround = true;
    this.player.jumpsLeft = 2;
    this.player.squashTimer = 0;

    this.resetChasersInPlace();
    this.resetScootersInPlace();
    this.emitScoreIfChanged(true);
  }

  private resetChasersInPlace() {
    const efot = this.chasers[0];
    efot.x = efot.baseX;
    efot.y = this.groundY - efot.h;
    efot.vy = 0;
    efot.onGround = true;
    efot.runFrame = 0;
    efot.squashTimer = 0;
    efot.attackPhase = 'idle';
    efot.phaseTimer = 0;
    efot.attackCooldown = 20.0;
    efot.stickAngle = -0.6;
    efot.lungeX = 0;

    const dada = this.chasers[1];
    dada.x = dada.baseX;
    dada.y = this.groundY - dada.h;
    dada.vy = 0;
    dada.onGround = true;
    dada.runFrame = 0.5;
    dada.squashTimer = 0;
    dada.attackPhase = 'idle';
    dada.phaseTimer = 0;
    dada.attackCooldown = 36.0;
    dada.stickAngle = -0.6;
    dada.lungeX = 0;
  }

  private resetScootersInPlace() {
    const s0 = this.scooters[0];
    s0.x = this.W + 80;
    s0.y = this.groundY - s0.h;
    s0.vy = 0;
    s0.onGround = true;
    s0.wheelRotation = 0;
    s0.bobPhase = 0;
    s0.active = false;
    s0.spawnCooldown = 18;
    s0.lastHopped = null;

    const s1 = this.scooters[1];
    s1.x = this.W + 160;
    s1.y = this.groundY - s1.h;
    s1.vy = 0;
    s1.onGround = true;
    s1.wheelRotation = 0;
    s1.bobPhase = 1.5;
    s1.active = false;
    s1.spawnCooldown = 36;
    s1.lastHopped = null;
  }

  private loop = (t: number) => {
    this.raf = 0;
    if (this.destroyed) return;

    if (this.lastTime === 0) {
      this.lastTime = t;
    }

    let dt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    if (dt < 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    if (this.state === 'running') {
      // Snap near-60Hz jitter to exact FIXED_DT so 60Hz devices never skip/double steps
      if (Math.abs(dt - FIXED_DT) < 0.0025) {
        dt = FIXED_DT;
      }
      this.accumulator += dt;
      if (this.accumulator > MAX_ACCUMULATOR) {
        this.accumulator = MAX_ACCUMULATOR;
      }

      const stepStart = performance.now();
      let steps = 0;
      while (this.accumulator >= FIXED_DT && this.state === 'running') {
        this.fixedStep(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }

      if (steps > 0 || this.state !== 'running') {
        this.render();
        const now = performance.now();
        this.recordFramePerformance(now, now - stepStart);
      }
    } else if (this.state === 'gameover') {
      if (this.shake > 0 || this.flash > 0) {
        const decayStep = dt * 60;
        if (this.shake > 0) {
          this.shake = Math.max(0, this.shake - decayStep * 1.5);
        }
        if (this.flash > 0) {
          this.flash = Math.max(0, this.flash - decayStep * 0.05);
        }
        this.render();
      }
      if (this.shake <= 0 && this.flash <= 0) {
        return; // Settled — stop rAF until restart
      }
    } else {
      return;
    }

    if (!this.destroyed && (this.state === 'running' || this.state === 'gameover')) {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private recordFramePerformance(now: number, workMs: number) {
    const nextTier = this.perfController.recordFrame(
      now,
      workMs,
      this.qualityMode === 'auto'
    );
    if (nextTier) {
      this.adaptiveScale = nextTier.adaptiveScale;
      this.applyQuality(nextTier.quality, true);
      if (this.metricsEnabled) {
        this.emitPerformanceMetrics(now, true);
      }
    } else if (this.metricsEnabled) {
      this.emitPerformanceMetrics(now, false);
    }
  }

  private emitPerformanceMetrics(now: number, force: boolean) {
    if (!this.cb.onPerformanceMetrics) return;
    if (!force && now - this.lastMetricsEmitAt < 250) return;
    this.lastMetricsEmitAt = now;
    this.cb.onPerformanceMetrics(
      this.perfController.getMetrics(this.quality, this.qualityMode, this.dpr)
    );
  }

  private fixedStep(dt: number) {
    const step = 1; // FIXED_DT = 1/60 => step === 1.0 exactly
    this.timeAlive += dt;
    this.emitTimeOfDayIfChanged();

    this.speed = Math.min(
      this.maxSpeed,
      this.baseSpeed + this.distance * 0.0003
    );
    this.distance += this.speed * step;
    this.score = Math.floor(this.distance / 7);

    // Player physics
    const gravity = 0.58;
    this.player.vy += gravity * step;
    this.player.y += this.player.vy * step;
    if (this.player.y >= this.groundY - this.player.h) {
      this.player.y = this.groundY - this.player.h;
      if (!this.player.onGround) {
        this.player.squashTimer = 0.08;
        this.spawnSandDust(this.player.x + 8, this.groundY, 4);
      }
      this.player.vy = 0;
      this.player.onGround = true;
      this.player.jumpsLeft = 2;
    }
    if (this.player.squashTimer > 0) {
      this.player.squashTimer = Math.max(0, this.player.squashTimer - dt);
    }
    this.player.runFrame += step * 0.28;

    // Background & beach offsets
    this.waveOffset = (this.waveOffset + this.speed * step * 0.18) % 600;
    this.cloudOffset = (this.cloudOffset + this.speed * step * 0.04) % 900;
    this.sandOffset = (this.sandOffset + this.speed * step * 0.8) % 60;

    // Check if a scooter rider is currently passing across center screen
    let isScooterCrossing = false;
    for (let i = 0; i < this.scooters.length; i++) {
      const s = this.scooters[i];
      if (s.active && s.x > 250 && s.x < 750) {
        isScooterCrossing = true;
        break;
      }
    }

    // Spawn beach obstacles
    this.spawnTimer += step;
    if (this.spawnTimer >= this.nextSpawn) {
      if (!isScooterCrossing) {
        this.spawnTimer = 0;
        this.nextSpawn = this.randomSpawnGap();
        this.spawnBeachObstacle();
      } else {
        this.spawnTimer = this.nextSpawn - 40;
      }
    }

    // Spawn coins
    this.coinTimer += step;
    if (this.coinTimer >= this.nextCoin) {
      this.coinTimer = 0;
      this.nextCoin = 130 + Math.random() * 120;
      this.spawnCoinPattern();
    }

    // Move & compact obstacles in place
    let obsWrite = 0;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      o.x -= this.speed * step;
      if (o.type === 'beachball' && o.rotation !== undefined) {
        o.rotation += step * 0.08;
      }
      if (o.x + o.w > -30) {
        this.obstacles[obsWrite++] = o;
      } else {
        for (let j = 0; j < this.scooters.length; j++) {
          if (this.scooters[j].lastHopped === o) {
            this.scooters[j].lastHopped = null;
          }
        }
        this.obstaclePool.push(o);
      }
    }
    this.obstacles.length = obsWrite;

    // Move & compact coins in place
    let coinWrite = 0;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      c.x -= this.speed * step;
      c.phase += step * 0.12;
      if (!c.collected && c.x + c.r > -20) {
        this.coins[coinWrite++] = c;
      } else {
        this.coinPool.push(c);
      }
    }
    this.coins.length = coinWrite;

    // Update active particles in pool (swap-and-pop removal)
    let pIdx = 0;
    while (pIdx < this.activeParticleCount) {
      const p = this.particlePool[pIdx];
      p.vy += p.gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.life -= step;
      if (p.life > 0) {
        pIdx++;
      } else {
        this.activeParticleCount--;
        if (pIdx < this.activeParticleCount) {
          const last = this.particlePool[this.activeParticleCount];
          this.particlePool[this.activeParticleCount] = p;
          this.particlePool[pIdx] = last;
        }
      }
    }

    // Update Scooters (HM and CM)
    this.updateScooters(dt, step);

    // Update AI Chasers (EFOT and DADA)
    this.updateChasers(dt, step);
    if (this.state !== 'running') return;

    // Collisions
    this.checkCollisions();
    if (this.state !== 'running') return;

    // Emit score update to UI only when score/coins actually change
    this.emitScoreIfChanged();

    // Decay effects
    if (this.shake > 0) this.shake = Math.max(0, this.shake - step * 1.5);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - step * 0.05);

    // Beach sand dust while running
    if (
      this.profile.drawDustWhileRunning &&
      this.player.onGround &&
      Math.random() < 0.06 * step
    ) {
      this.spawnSandDust(this.player.x, this.groundY, 1);
    }
  }

  private randomSpawnGap(): number {
    const base = 180 - (this.speed - this.baseSpeed) * 8;
    return Math.max(140, base + Math.random() * 90);
  }

  private spawnBeachObstacle() {
    const r = Math.random();
    let type: ObstacleType;
    let w = 36;
    let h = 26;

    if (r < 0.32) {
      type = 'driftwood';
      w = 42 + Math.random() * 8;
      h = 22;
    } else if (r < 0.56) {
      type = 'beachball';
      w = 32;
      h = 32;
    } else if (r < 0.76) {
      type = 'rock';
      w = 34 + Math.random() * 6;
      h = 26;
    } else if (r < 0.9) {
      type = 'sandmound';
      w = 44 + Math.random() * 8;
      h = 24;
    } else {
      type = 'umbrella';
      w = 34;
      h = 56;
    }

    const o = this.obstaclePool.pop();
    if (o) {
      o.x = this.W + 40;
      o.y = this.groundY - h;
      o.w = w;
      o.h = h;
      o.type = type;
      o.scored = false;
      o.rotation = type === 'beachball' ? 0 : undefined;
      o.colorIndex = Math.floor(Math.random() * 4);
      this.obstacles.push(o);
    } else {
      this.obstacles.push({
        x: this.W + 40,
        y: this.groundY - h,
        w,
        h,
        type,
        scored: false,
        rotation: type === 'beachball' ? 0 : undefined,
        colorIndex: Math.floor(Math.random() * 4),
      });
    }
  }

  private spawnCoinPattern() {
    const pattern = Math.floor(Math.random() * 3);
    const baseY = this.groundY - 55 - Math.random() * 55;
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let y = baseY;
      if (pattern === 1) y = baseY + Math.sin(i * 0.7) * 20;
      if (pattern === 2) y = baseY - i * 8;
      const c = this.coinPool.pop();
      if (c) {
        c.x = this.W + 40 + i * 40;
        c.y = y;
        c.r = 9;
        c.collected = false;
        c.phase = i * 0.4;
        this.coins.push(c);
      } else {
        this.coins.push({
          x: this.W + 40 + i * 40,
          y,
          r: 9,
          collected: false,
          phase: i * 0.4,
        });
      }
    }
  }

  private spawnSandDust(x: number, y: number, n: number) {
    const cap = this.profile.maxParticles;
    for (let i = 0; i < n; i++) {
      if (this.activeParticleCount >= cap) return;
      const p = this.particlePool[this.activeParticleCount++];
      p.x = x + (Math.random() - 0.5) * 16;
      p.y = y - Math.random() * 4;
      p.vx = -this.speed * 0.25 + (Math.random() - 0.5) * 1.5;
      p.vy = -Math.random() * 1.8;
      p.life = 18 + Math.random() * 12;
      p.maxLife = 30;
      p.size = 2 + Math.random() * 2.5;
      p.color = '#ebbe78';
      p.gravity = 0.05;
    }
  }

  private burst(x: number, y: number, color: string, n: number) {
    const cap = this.profile.maxParticles;
    for (let i = 0; i < n; i++) {
      if (this.activeParticleCount >= cap) return;
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3.5;
      const p = this.particlePool[this.activeParticleCount++];
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = 20 + Math.random() * 20;
      p.maxLife = 40;
      p.size = 2 + Math.random() * 3.5;
      p.color = color;
      p.gravity = 0.08;
    }
  }

  // ---- Scooter Riders (HM & CM) ----

  private updateScooters(dt: number, step: number) {
    for (let i = 0; i < this.scooters.length; i++) {
      const sc = this.scooters[i];
      if (!sc.active) {
        sc.spawnCooldown -= dt;
        if (sc.spawnCooldown <= 0) {
          const other = this.scooters[i === 0 ? 1 : 0];
          if (!other || !other.active || other.x < this.W - (sc.w + 120)) {
            sc.active = true;
            sc.x = this.W + 50;
            sc.y = this.groundY - sc.h;
            sc.vy = 0;
            sc.onGround = true;
            sc.lastHopped = null;
            this.sound.play('beep');
          }
        }
      } else {
        const vs = this.speed + sc.cruise;
        sc.x -= vs * step;
        sc.wheelRotation -= step * 0.14;
        sc.bobPhase += step * 0.08;

        const gravity = 0.58;
        sc.vy += gravity * step;
        sc.y += sc.vy * step;
        if (sc.y >= this.groundY - sc.h) {
          sc.y = this.groundY - sc.h;
          sc.vy = 0;
          sc.onGround = true;
        }

        if (sc.onGround) {
          const maxGap = sc.cruise * 12;
          for (let j = 0; j < this.obstacles.length; j++) {
            const o = this.obstacles[j];
            if (sc.lastHopped === o) continue;
            const gap = sc.x - (o.x + o.w);
            if (gap > 0 && gap < maxGap) {
              sc.vy = -10.5;
              sc.onGround = false;
              sc.lastHopped = o;
              this.spawnSandDust(sc.x + sc.w * 0.3, this.groundY, 3);
              break;
            }
          }
        }

        if (sc.x + sc.w < -60) {
          sc.active = false;
          sc.lastHopped = null;
          sc.spawnCooldown = 28 + Math.random() * 18;
        }
      }
    }
  }

  // ---- AI Chasers (EFOT & DADA) ----

  private maxLunge(c: Chaser) {
    return c.strikeX - c.baseX;
  }

  private updateStickGeometry(c: Chaser): StickGeometry {
    const handX = c.x + c.w - 2;
    const handY = c.y + 22;
    const reach = c.stickLength + 5.5;
    this.stickGeom.handX = handX;
    this.stickGeom.handY = handY;
    this.stickGeom.tipX = handX + Math.cos(c.stickAngle) * reach;
    this.stickGeom.tipY = handY + Math.sin(c.stickAngle) * reach;
    return this.stickGeom;
  }

  private updateChasers(dt: number, step: number) {
    let isAnyOtherAttacking = false;
    for (let i = 0; i < this.chasers.length; i++) {
      const ph = this.chasers[i].attackPhase;
      if (ph === 'windup' || ph === 'strike') {
        isAnyOtherAttacking = true;
        break;
      }
    }

    for (let i = 0; i < this.chasers.length; i++) {
      const c = this.chasers[i];
      c.runFrame += step * 0.28;

      const gravity = 0.58;
      c.vy += gravity * step;
      c.y += c.vy * step;
      if (c.y >= this.groundY - c.h) {
        c.y = this.groundY - c.h;
        if (!c.onGround) c.squashTimer = 0.08;
        c.vy = 0;
        c.onGround = true;
      }
      if (c.squashTimer > 0) {
        c.squashTimer = Math.max(0, c.squashTimer - dt);
      }

      if (c.onGround) {
        const cRight = c.x + c.w;
        for (let j = 0; j < this.obstacles.length; j++) {
          const o = this.obstacles[j];
          const distToObstacle = o.x - cRight;
          if (distToObstacle > -10 && distToObstacle < 55) {
            c.vy = -10.8;
            c.onGround = false;
            this.spawnSandDust(c.x, this.groundY, 3);
            break;
          }
        }
      }

      if (c.attackPhase === 'idle') {
        c.attackCooldown -= dt;
        c.lungeX = 0;
        c.stickAngle = -0.6 + Math.sin(c.runFrame * 2) * 0.08;
        c.x += (c.baseX - c.x) * (step * 0.06);

        if (c.attackCooldown <= 0 && !isAnyOtherAttacking && this.timeAlive > 18) {
          c.attackPhase = 'windup';
          c.phaseTimer = 1.25;
          isAnyOtherAttacking = true;
          this.sound.play('warning');
          this.burst(c.x + c.w / 2, c.y - 10, c.colorTheme.glow, 6);
        }
      } else if (c.attackPhase === 'windup') {
        c.phaseTimer -= dt;
        const windupProgress = 1 - Math.max(0, c.phaseTimer / 1.25);
        c.stickAngle = -0.6 - windupProgress * 1.3;

        const maxLunge = this.maxLunge(c);
        c.lungeX = windupProgress * maxLunge;
        const targetX = c.baseX + c.lungeX;
        c.x += (targetX - c.x) * (step * 0.1);

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'strike';
          c.phaseTimer = 0.2;
          this.sound.play('swing');
        }
      } else if (c.attackPhase === 'strike') {
        const strikeLunge = this.maxLunge(c);
        c.x += (c.baseX + strikeLunge - c.x) * (step * 0.25);
        c.phaseTimer -= dt;
        const strikeProgress = 1 - Math.max(0, c.phaseTimer / 0.2);
        c.stickAngle = -1.9 + strikeProgress * 2.7;

        const sg = this.updateStickGeometry(c);

        if (strikeProgress >= 0.25 && strikeProgress <= 0.75) {
          const stickLeft = sg.handX < sg.tipX ? sg.handX : sg.tipX;
          const stickRight = sg.handX > sg.tipX ? sg.handX : sg.tipX;
          const stickTop = sg.handY < sg.tipY ? sg.handY : sg.tipY;
          const stickBottom = sg.handY > sg.tipY ? sg.handY : sg.tipY;

          const p = this.player;
          const playerLeft = p.x + 6;
          const playerRight = p.x + p.w - 6;
          const playerTop = p.y + 6;
          const playerBottom = p.y + p.h;

          const horizontalHit = stickRight > playerLeft && stickLeft < playerRight;
          const verticalHit = stickBottom > playerTop && stickTop < playerBottom;
          const isDodgingAirborne = playerBottom < this.groundY - 20;

          if (horizontalHit && verticalHit && !isDodgingAirborne) {
            this.sound.play('whack');
            this.burst(p.x + p.w / 2, p.y + p.h / 2, c.colorTheme.stickGlow, 22);
            this.die();
            return;
          }
        }

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'recovery';
          c.phaseTimer = 0.7;
        }
      } else if (c.attackPhase === 'recovery') {
        c.phaseTimer -= dt;
        const recProgress = 1 - Math.max(0, c.phaseTimer / 0.7);
        const maxLunge = this.maxLunge(c);
        c.lungeX = maxLunge * (1 - recProgress);

        const targetX = c.baseX + c.lungeX;
        c.x += (targetX - c.x) * (step * 0.08);
        c.stickAngle = 0.8 - recProgress * 1.4;

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'idle';
          c.lungeX = 0;
          c.stickAngle = -0.6;
          c.attackCooldown = 20.0 + Math.random() * 12.0;
        }
      }
    }
  }

  // ---- Collisions with forgiving bounds & early X-culling ----

  private checkCollisions() {
    const p = this.player;
    const pad = 8;
    const px = p.x + pad;
    const py = p.y + pad;
    const pw = p.w - pad * 2;
    const ph = p.h - pad * 2;
    const pxRight = px + pw;
    const pyBottom = py + ph;

    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      // Fast horizontal broad-phase rejection
      if (o.x > pxRight || o.x + o.w < px) continue;

      if (o.type === 'beachball') {
        const r = o.w / 2 - 3;
        const cx = o.x + o.w / 2;
        const cy = o.y + o.h / 2;
        const closestX = cx < px ? px : cx > pxRight ? pxRight : cx;
        const closestY = cy < py ? py : cy > pyBottom ? pyBottom : cy;
        const dx = cx - closestX;
        const dy = cy - closestY;
        if (dx * dx + dy * dy < r * r) {
          this.die();
          return;
        }
      } else {
        let ox = o.x + 5;
        const oy = o.y + 4;
        let ow = o.w - 10;
        const oh = o.h - 6;

        if (o.type === 'umbrella') {
          ox = o.x + 12;
          ow = o.w - 24;
        }

        if (px < ox + ow && pxRight > ox && py < oy + oh && pyBottom > oy) {
          this.die();
          return;
        }
      }
    }

    // Coins with horizontal broad-phase rejection
    const pcx = p.x + p.w / 2;
    const pcy = p.y + p.h / 2;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.collected) continue;
      const dx = pcx - c.x;
      if (dx > 34 || dx < -34) continue;
      const dy = pcy - c.y;
      const hitDist = c.r + 24;
      if (dx * dx + dy * dy < hitDist * hitDist) {
        c.collected = true;
        this.coinCount += 1;
        this.score += 5;
        this.distance += 25;
        this.sound.play('coin');
        this.burst(c.x, c.y, '#ffd250', 10);
      }
    }
  }

  private bankRun() {
    const finalScore = Math.floor(this.distance / 7);
    const finalCoins = this.coinCount;
    if (finalScore > this.best) {
      this.best = finalScore;
      writeStoredNumber(BEST_KEY, this.best);
    }
    if (finalCoins > 0) {
      this.totalCoinsSaved += finalCoins;
      writeStoredNumber(COIN_KEY, this.totalCoinsSaved);
    }
    this.cb.onReady?.();
    return { finalScore, finalCoins };
  }

  private die() {
    this.sound.play('crash');
    this.shake = 12;
    this.flash = 1;
    this.burst(
      this.player.x + this.player.w / 2,
      this.player.y + this.player.h / 2,
      '#ff465a',
      24
    );
    const { finalScore, finalCoins } = this.bankRun();
    this.score = finalScore;
    this.emitScoreIfChanged(true);
    this.diedAt = performance.now();
    this.setState('gameover');
    this.cb.onGameOver(finalScore, finalCoins, this.best);
  }

  // ---- Day/Night Cycle calculations ----

  public getDayCycleProgress(): number {
    return (this.timeAlive % this.dayCycleDuration) / this.dayCycleDuration;
  }

  public getTimeOfDayName(): string {
    const t = this.getDayCycleProgress();
    if (t < 0.22) return 'Sunrise';
    if (t < 0.52) return 'Daytime';
    if (t < 0.78) return 'Sunset';
    return 'Night';
  }

  private getPhaseIndex(t: number): number {
    if (t < 0.22) return 0;
    if (t < 0.52) return 1;
    if (t < 0.78) return 2;
    return 3;
  }

  // ---- Rendering ----

  private render() {
    const ctx = this.ctx;
    const scaleX = this.cssW > 0 ? this.canvas.width / this.cssW : this.dpr;
    const scaleY = this.cssH > 0 ? this.canvas.height / this.cssH : this.dpr;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = this.profile.smoothingQuality;

    const hasLetterbox = this.offsetX > 0.5 || this.offsetY > 0.5;
    if (hasLetterbox) {
      ctx.fillStyle = '#050b14';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    if (hasLetterbox) {
      ctx.beginPath();
      ctx.rect(0, 0, this.W, this.H);
      ctx.clip();
    }

    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake
      );
    }

    const cycle = this.getDayCycleProgress();
    const phase = this.getPhaseIndex(cycle);

    // 1. Sky & Sun/Moon/Stars
    this.drawSky(ctx, cycle);
    this.drawSunMoon(ctx, cycle, phase);
    this.drawClouds(ctx, cycle);
    this.drawIslands(ctx, phase);

    // 2. Ocean with animated waves & sun reflection
    this.drawOcean(ctx, phase);

    // 3. Sandy Beach Ground & Palms
    this.drawBeachGround(ctx, phase);
    this.drawPalms(ctx, cycle);

    // 4. Coins & Beach Obstacles
    this.drawCoins(ctx);
    this.drawObstacles(ctx);

    // 5. Passing Scooter Riders (HM and CM)
    for (let i = 0; i < this.scooters.length; i++) {
      const sc = this.scooters[i];
      if (sc.active) {
        this.drawScooter(ctx, sc);
      }
    }

    // 6. Particles
    this.drawParticles(ctx);

    // 7. Chasers (EFOT & DADA) sorted back-to-front without array allocation
    const c0 = this.chasers[0];
    const c1 = this.chasers[1];
    if (c0.x <= c1.x) {
      this.drawChaser(ctx, c0, 0);
      this.drawChaser(ctx, c1, 1);
    } else {
      this.drawChaser(ctx, c1, 1);
      this.drawChaser(ctx, c0, 0);
    }

    // 8. Main Player (TM)
    this.drawPlayer(ctx);

    // Flash on hit
    if (this.flash > 0) {
      ctx.fillStyle = '#ff3c50';
      ctx.globalAlpha = this.flash * 0.4;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ---- Beach Background & Day Cycle Drawing ----

  private drawSky(ctx: CanvasRenderingContext2D, t: number) {
    const bucket = (t * this.profile.skyBuckets) | 0;
    if (bucket !== this.cachedSkyBucket || !this.cachedSkyGrad) {
      this.cachedSkyBucket = bucket;
      let skyTop: string;
      let skyMid: string;
      let skyBot: string;

      if (t < 0.22) {
        const p = t / 0.22;
        skyTop = lerpRgbString(SKY_SUNRISE_TOP_A, SKY_SUNRISE_TOP_B, p);
        skyMid = lerpRgbString(SKY_SUNRISE_MID_A, SKY_SUNRISE_MID_B, p);
        skyBot = lerpRgbString(SKY_SUNRISE_BOT_A, SKY_SUNRISE_BOT_B, p);
      } else if (t < 0.52) {
        skyTop = '#1864ab';
        skyMid = '#339af0';
        skyBot = '#a5d8ff';
      } else if (t < 0.78) {
        const p = (t - 0.52) / 0.26;
        skyTop = lerpRgbString(SKY_SUNSET_TOP_A, SKY_SUNSET_TOP_B, p);
        skyMid = lerpRgbString(SKY_SUNSET_MID_A, SKY_SUNSET_MID_B, p);
        skyBot = lerpRgbString(SKY_SUNSET_BOT_A, SKY_SUNSET_BOT_B, p);
      } else {
        const p = (t - 0.78) / 0.22;
        skyTop = lerpRgbString(SKY_NIGHT_TOP_A, SKY_NIGHT_TOP_B, p);
        skyMid = lerpRgbString(SKY_NIGHT_MID_A, SKY_NIGHT_MID_B, p);
        skyBot = lerpRgbString(SKY_NIGHT_BOT_A, SKY_NIGHT_BOT_B, p);
      }

      const g = ctx.createLinearGradient(0, 0, 0, this.groundY - 70);
      g.addColorStop(0, skyTop);
      g.addColorStop(0.65, skyMid);
      g.addColorStop(1, skyBot);
      this.cachedSkyGrad = g;
    }

    ctx.fillStyle = this.cachedSkyGrad;
    ctx.fillRect(0, 0, this.W, this.groundY);

    // Stars at night
    if (t > 0.72) {
      const starAlpha = t > 0.78 ? Math.min(1, (t - 0.78) * 6) : (t - 0.72) * 10;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = starAlpha * 0.8;
      const starOffset = this.cloudOffset * 0.2;
      const starMaxY = this.groundY - 100;
      const starCount = this.profile.starCount;
      for (let i = 0; i < starCount; i++) {
        const sx = (i * 79 + starOffset) % this.W;
        const sy = (i * 23) % starMaxY;
        const sz = 1 + ((i * 7) % 3);
        ctx.fillRect(sx, sy, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawSunMoon(ctx: CanvasRenderingContext2D, t: number, phase: number) {
    const horizonY = this.groundY - 80;

    if (phase < 3) {
      let sunX: number;
      let sunY: number;

      if (phase === 0) {
        const p = t / 0.22;
        sunX = 140 + p * 200;
        sunY = horizonY - p * 110;
      } else if (phase === 1) {
        const p = (t - 0.22) / 0.3;
        sunX = 340 + p * 240;
        sunY = horizonY - 110 + Math.sin(p * Math.PI) * -15;
      } else {
        const p = (t - 0.52) / 0.26;
        sunX = 580 + p * 200;
        sunY = horizonY - 110 + p * 110;
      }

      ctx.drawImage(this.sunCoronas[phase], sunX - 70, sunY - 70);

      if (this.profile.drawSunReflection) {
        ctx.fillStyle = this.sunReflectGrads[phase];
        ctx.fillRect(sunX - 25, horizonY, 50, this.groundY - horizonY);
      }
    } else {
      const p = (t - 0.78) / 0.22;
      const moonX = 640 - p * 300;
      const moonY = 65 + Math.sin(p * Math.PI) * -10;
      ctx.drawImage(this.moonSprite, moonX - 45, moonY - 45);
    }
  }

  private drawClouds(ctx: CanvasRenderingContext2D, t: number) {
    let cloudHex = '#ffffff';
    if (t >= 0.52 && t < 0.78) {
      cloudHex = '#ffd2c8';
    } else if (t >= 0.78 || t < 0.08) {
      cloudHex = '#788cb4';
    }

    ctx.fillStyle = cloudHex;
    const span = this.W + 120;
    const wrap = this.W + 200;
    const count = Math.min(this.clouds.length, this.profile.cloudCount);
    for (let i = 0; i < count; i++) {
      const c = this.clouds[i];
      const cx = (c.x - this.cloudOffset * c.speed * 4) % span;
      const x = cx < -100 ? cx + wrap : cx;
      ctx.globalAlpha = c.alpha;
      ctx.beginPath();
      ctx.arc(x, c.y, c.h * 0.6, 0, Math.PI * 2);
      ctx.arc(x + c.w * 0.28, c.y - c.h * 0.25, c.h * 0.8, 0, Math.PI * 2);
      ctx.arc(x + c.w * 0.6, c.y, c.h * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawIslands(ctx: CanvasRenderingContext2D, phase: number) {
    const horizonY = this.groundY - 80;
    let islandColor = '#0b1626';
    if (phase === 0) islandColor = '#3b254a';
    else if (phase === 1) islandColor = '#105265';
    else if (phase === 2) islandColor = '#4a154b';

    ctx.fillStyle = islandColor;
    const span = this.W + 200;
    const wrap = this.W + 400;
    const drift = this.cloudOffset * 0.05;
    const count = Math.min(this.islands.length, this.profile.islandCount);
    for (let i = 0; i < count; i++) {
      const is = this.islands[i];
      const ix = (is.x - drift) % span;
      const x = ix < -200 ? ix + wrap : ix;

      ctx.beginPath();
      ctx.moveTo(x, horizonY);
      ctx.quadraticCurveTo(x + is.w * 0.5, horizonY - is.h, x + is.w, horizonY);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawOcean(ctx: CanvasRenderingContext2D, phase: number) {
    const horizonY = this.groundY - 80;
    const seaHeight = 55;

    let crestColor = '#2a4d69';
    if (phase === 0) crestColor = '#f39c12';
    else if (phase === 1) crestColor = '#90e0ef';
    else if (phase === 2) crestColor = '#ff758f';

    ctx.fillStyle = this.oceanGrads[phase];
    ctx.fillRect(0, horizonY, this.W, seaHeight);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = crestColor;
    const waveLayers = this.profile.waveLayers;
    const waveStep = this.profile.waveStep;
    for (let layer = 0; layer < waveLayers; layer++) {
      const ly = horizonY + 12 + layer * 14;
      const amp = 2.5 + layer;
      const offset = (this.waveOffset * (0.8 + layer * 0.4)) % 80;

      ctx.beginPath();
      ctx.moveTo(-40, ly);
      for (let x = -40; x <= this.W + 40; x += waveStep) {
        const wy = ly + Math.sin((x + offset) * 0.05) * amp;
        ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
  }

  private drawBeachGround(ctx: CanvasRenderingContext2D, phase: number) {
    const horizonY = this.groundY - 80;
    const shoreY = horizonY + 50;

    let foamColor = 'rgba(180, 210, 240, 0.5)';
    if (phase === 0 || phase === 1) foamColor = 'rgba(255, 255, 255, 0.75)';
    else if (phase === 2) foamColor = 'rgba(255, 220, 200, 0.7)';

    ctx.fillStyle = foamColor;
    const wash = shoreY + Math.sin(this.waveOffset * 0.05) * 5;
    if (this.quality === 'low') {
      ctx.fillRect(0, wash, this.W, this.groundY - wash + 2);
    } else {
      const foamStep = this.profile.foamStep;
      ctx.beginPath();
      ctx.moveTo(0, wash);
      for (let x = 0; x <= this.W; x += foamStep) {
        const fy = wash + Math.sin((x + this.waveOffset) * 0.06) * 3;
        ctx.lineTo(x, fy);
      }
      ctx.lineTo(this.W, this.groundY + 2);
      ctx.lineTo(0, this.groundY + 2);
      ctx.closePath();
      ctx.fill();
    }

    // Blit pre-rendered static sand + shoreline highlight + shells layer
    ctx.drawImage(
      this.beachGroundLayers[phase],
      0,
      this.groundY,
      this.W,
      this.H - this.groundY
    );
  }

  private drawPalms(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;
    const palmY = horizonY + 36;
    const span = this.W + 200;
    const wrap = this.W + 300;
    const drift = this.cloudOffset * 0.3;

    if (this.profile.useStaticPalms) {
      let themeIdx = 0;
      if (t >= 0.78 || t < 0.08) themeIdx = 2;
      else if (t >= 0.52) themeIdx = 1;
      const sprites = this.palmSpritesByTheme[themeIdx];
      for (let i = 0; i < this.palmTrees.length; i++) {
        const p = this.palmTrees[i];
        const px = (p.x - drift) % span;
        const x = px < -100 ? px + wrap : px;
        ctx.drawImage(sprites[i], x - 45, palmY - 122, 130, 130);
      }
      return;
    }

    let trunkColor = '#7f4f24';
    let leafColor = '#2d6a4f';

    if (t >= 0.78 || t < 0.08) {
      trunkColor = '#1e293b';
      leafColor = '#0f3a28';
    } else if (t >= 0.52) {
      trunkColor = '#5c3d2e';
      leafColor = '#704214';
    }

    for (let i = 0; i < this.palmTrees.length; i++) {
      const p = this.palmTrees[i];
      const px = (p.x - drift) % span;
      const x = px < -100 ? px + wrap : px;

      ctx.strokeStyle = trunkColor;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x, palmY);
      ctx.quadraticCurveTo(x + 12, palmY - p.height * 0.5, x + 20, palmY - p.height);
      ctx.stroke();

      const tipX = x + 20;
      const tipY = palmY - p.height;
      const sway = Math.sin(this.waveOffset * 0.04 + x) * 4;

      ctx.strokeStyle = leafColor;
      ctx.lineWidth = 3;
      for (let f = 0; f < p.fronds; f++) {
        const sAng = p.frondSin[f];
        const cAng = p.frondCos[f];
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.quadraticCurveTo(
          tipX + sAng * 26 + sway,
          tipY - 10 + cAng * 6,
          tipX + sAng * 45 + sway * 1.5,
          tipY + cAng * 20
        );
        ctx.stroke();
      }

      ctx.fillStyle = '#4a2810';
      ctx.beginPath();
      ctx.arc(tipX - 2, tipY + 2, 3.5, 0, Math.PI * 2);
      ctx.arc(tipX + 3, tipY + 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Beach Obstacles Rendering ----

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      const gy = o.y + o.h;

      if (o.type === 'driftwood') {
        ctx.fillStyle = '#8b5a2b';
        ctx.strokeStyle = '#5c3a21';
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, o.x, o.y, o.w, o.h, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#6e431f';
        ctx.fillRect(o.x + o.w * 0.6, o.y - 4, 7, 5);

        ctx.strokeStyle = '#a06a38';
        ctx.beginPath();
        ctx.moveTo(o.x + 6, o.y + 5);
        ctx.lineTo(o.x + o.w - 6, o.y + 5);
        ctx.moveTo(o.x + 10, gy - 6);
        ctx.lineTo(o.x + o.w - 10, gy - 6);
        ctx.stroke();
      } else if (o.type === 'rock') {
        ctx.translate(o.x, o.y);
        ctx.fillStyle = this.rockGrad;
        ctx.beginPath();
        ctx.moveTo(4, o.h);
        ctx.lineTo(o.w * 0.3, 0);
        ctx.lineTo(o.w * 0.7, 3);
        ctx.lineTo(o.w - 4, o.h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(o.w * 0.35, 3, o.w * 0.3, 3);
        ctx.translate(-o.x, -o.y);
      } else if (o.type === 'beachball') {
        const r = o.w / 2;
        const cx = o.x + r;
        const cy = o.y + r;
        const rot = o.rotation || 0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.drawImage(this.beachballSprite, -r, -r, o.w, o.h);
        ctx.restore();
      } else if (o.type === 'sandmound') {
        ctx.translate(o.x, o.y);
        ctx.fillStyle = this.sandmoundGrad;
        ctx.beginPath();
        ctx.moveTo(0, o.h);
        ctx.quadraticCurveTo(o.w * 0.5, 0, o.w, o.h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#92400e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(o.w * 0.5, 2);
        ctx.lineTo(o.w * 0.5, -10);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(o.w * 0.5, -10);
        ctx.lineTo(o.w * 0.5 + 9, -6);
        ctx.lineTo(o.w * 0.5, -2);
        ctx.closePath();
        ctx.fill();
        ctx.translate(-o.x, -o.y);
      } else if (o.type === 'umbrella') {
        ctx.drawImage(this.umbrellaSprite, o.x, o.y, o.w, o.h);
      } else {
        ctx.fillStyle = '#f59e0b';
        this.roundRect(ctx, o.x, o.y, o.w, o.h, 6);
        ctx.fill();
      }
    }
  }

  // ---- Scooter Riders (HM and CM) Rendering ----

  private drawScooter(ctx: CanvasRenderingContext2D, sc: ScooterRider) {
    const DESIGN_W = 48;
    const DESIGN_H = 48;
    const bob = Math.sin(sc.bobPhase) * 1.2;

    this.drawGroundShadow(ctx, sc.x + sc.w * 0.5, sc.y + sc.h, 28);

    ctx.save();
    const cx = sc.x + sc.w * 0.5;
    const cy = sc.y + sc.h * 0.5 + bob;
    const tilt = sc.onGround ? 0 : Math.max(-0.2, Math.min(0.2, sc.vy * 0.02));
    ctx.translate(cx, cy);
    if (tilt !== 0) ctx.rotate(tilt);
    ctx.scale(SCOOTER_SCALE, SCOOTER_SCALE);
    ctx.translate(-DESIGN_W * 0.5, -DESIGN_H * 0.5);

    // Scooter Deck
    ctx.fillStyle = sc.colorTheme.scooter;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 4, DESIGN_H - 12, DESIGN_W - 12, 5, 2);
    ctx.fill();
    ctx.stroke();

    // Steering Column & Handlebars
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(8, DESIGN_H - 12);
    ctx.lineTo(6, DESIGN_H - 32);
    ctx.stroke();

    ctx.strokeStyle = sc.colorTheme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(8, DESIGN_H - 12);
    ctx.lineTo(6, DESIGN_H - 32);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 2, DESIGN_H - 34, 10, 4, 1.5);
    ctx.fill();
    ctx.stroke();

    // Headlight (layered soft halo instead of shadowBlur)
    ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
    ctx.beginPath();
    ctx.arc(4, DESIGN_H - 28, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(4, DESIGN_H - 28, 3, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    this.drawWheel(ctx, 8, DESIGN_H - 6, 6, sc.wheelRotation, sc.colorTheme.wheels);
    this.drawWheel(
      ctx,
      DESIGN_W - 12,
      DESIGN_H - 6,
      6,
      sc.wheelRotation,
      sc.colorTheme.wheels
    );

    // Rider Character
    const rx = DESIGN_W * 0.46;
    const ry = DESIGN_H - 34;

    ctx.fillStyle = sc.colorTheme.shirt;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, rx - 7.5, ry, 15, 18, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = sc.colorTheme.rider;
    ctx.beginPath();
    ctx.arc(rx, ry - 7, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    this.roundRect(ctx, rx - 9, ry - 9, 10, 5, 1.5);
    ctx.fill();
    ctx.fillStyle = sc.colorTheme.rider;
    ctx.fillRect(rx - 8, ry - 8, 7, 2.5);

    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(rx - 2, ry + 5);
    ctx.lineTo(8, DESIGN_H - 30);
    ctx.stroke();

    ctx.strokeStyle = sc.colorTheme.rider;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rx - 2, ry + 5);
    ctx.lineTo(8, DESIGN_H - 30);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.restore();

    this.drawNameLabel(ctx, sc.name, sc.x + sc.w * 0.5, sc.y + bob - 6, false);
  }

  private drawWheel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    rot: number,
    color: string
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(r * 0.6, 0);
    ctx.moveTo(0, -r * 0.6);
    ctx.lineTo(0, r * 0.6);
    ctx.stroke();

    ctx.restore();
  }

  // ---- Characters (TM, EFOT, DADA) and Labels ----

  private drawGroundShadow(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    bottomY: number,
    baseRadiusX: number
  ) {
    if (!this.profile.drawGroundShadows) return;
    const height = Math.max(0, this.groundY - bottomY);
    const t = Math.max(0, 1 - height / 140);
    const alpha = 0.34 * t;
    if (alpha <= 0.01) return;

    const rx = baseRadiusX * (0.45 + 0.55 * t);
    const ry = 4 * (0.5 + 0.5 * t);

    ctx.fillStyle = '#050b14';
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(centerX, this.groundY + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawNameLabel(
    ctx: CanvasRenderingContext2D,
    name: string,
    centerX: number,
    topY: number,
    showWarning = false
  ) {
    const sprite = this.labelSprites[name];
    if (!sprite) return;
    const pad = 8;
    const badgeW = sprite.w - pad * 2;
    const badgeH = sprite.h - pad * 2;
    const badgeX = Math.max(4, Math.min(this.W - badgeW - 4, centerX - badgeW / 2));
    const badgeY = topY - badgeH - 5;

    ctx.drawImage(sprite.canvas, badgeX - pad, badgeY - pad, sprite.w, sprite.h);

    if (showWarning) {
      const sPad = 10;
      const warnW = this.swingBadgeSprite.w - sPad * 2;
      const warnX = Math.max(4, Math.min(this.W - warnW - 4, centerX - warnW / 2));
      const warnY = badgeY - 14;
      ctx.drawImage(
        this.swingBadgeSprite.canvas,
        warnX - sPad,
        warnY - sPad,
        this.swingBadgeSprite.w,
        this.swingBadgeSprite.h
      );
    }
  }

  private drawRunnerBody(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    vy: number,
    onGround: boolean,
    runFrame: number,
    squashTimer: number,
    vis: RunnerVisual,
    highGlow: boolean
  ) {
    const bob = onGround ? Math.sin(runFrame * Math.PI * 2) * 1.3 - 0.4 : 0;
    const lean = onGround ? 0.05 : Math.max(-0.15, Math.min(0.15, vy * 0.02));
    const sq = squashTimer > 0 ? squashTimer / 0.08 : 0;
    const sx = 1 + 0.06 * sq;
    const sy = 1 - 0.08 * sq;

    ctx.save();
    ctx.translate(x + w / 2, y + h);
    if (sq > 0) ctx.scale(sx, sy);
    ctx.rotate(lean);
    ctx.translate(-w / 2, -h + bob);

    const legW = w >= 38 ? 9 : 8;
    const legH = 12;
    const hipY = h - 12;
    const frontLegAngle = onGround ? Math.sin(runFrame * Math.PI) * 0.6 : 0.3;
    const backLegAngle = onGround ? Math.sin(runFrame * Math.PI + Math.PI) * 0.6 : -0.35;
    const backArmAngle = onGround ? Math.sin(runFrame * Math.PI + Math.PI) * 0.6 : 0.35;
    const frontArmAngle = onGround ? Math.sin(runFrame * Math.PI) * 0.6 : -0.35;

    // Back arm
    ctx.save();
    ctx.translate(2, 18);
    ctx.rotate(backArmAngle);
    ctx.fillStyle = vis.legColor;
    this.roundRect(ctx, -3, 0, 6, 13, 3);
    ctx.fill();
    ctx.restore();

    // Back leg
    ctx.save();
    ctx.translate(12, hipY);
    ctx.rotate(backLegAngle);
    ctx.fillStyle = vis.legColor;
    this.roundRect(ctx, -legW / 2, 0, legW, legH, 3);
    ctx.fill();
    ctx.restore();

    // Torso path + quality-scaled neon aura stroke
    this.roundRect(ctx, 2, 6, w - 4, h - 8, 8);
    if (this.profile.drawRunnerAura) {
      ctx.strokeStyle = vis.glowStroke;
      ctx.lineWidth = highGlow ? 7 : 4.5;
      ctx.stroke();
    }
    ctx.fillStyle = vis.torsoGrad;
    ctx.fill();

    // Visor
    ctx.fillStyle = vis.visorBg;
    this.roundRect(ctx, 6, 12, w - 12, 14, 4);
    ctx.fill();
    ctx.fillStyle = vis.visorAccent;
    ctx.fillRect(8, 14, w - 16, 3);

    // Front leg
    ctx.save();
    ctx.translate(w - 12, hipY);
    ctx.rotate(frontLegAngle);
    ctx.fillStyle = vis.legColor;
    this.roundRect(ctx, -legW / 2, 0, legW, legH, 3);
    ctx.fill();
    ctx.restore();

    // Front arm
    if (vis.drawFrontArm) {
      ctx.save();
      ctx.translate(w - 2, 18);
      ctx.rotate(frontArmAngle);
      ctx.fillStyle = vis.legColor;
      this.roundRect(ctx, -3, 0, 6, 13, 3);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    this.drawGroundShadow(ctx, p.x + p.w / 2, p.y + p.h, 17);

    this.drawRunnerBody(
      ctx,
      p.x,
      p.y,
      p.w,
      p.h,
      p.vy,
      p.onGround,
      p.runFrame,
      p.squashTimer,
      this.tmVisual,
      false
    );

    this.drawNameLabel(ctx, 'TM', p.x + p.w / 2, p.y, false);
  }

  private drawChaser(ctx: CanvasRenderingContext2D, c: Chaser, idx: number) {
    this.drawGroundShadow(ctx, c.x + c.w / 2, c.y + c.h, 16);

    const vis = idx === 0 ? this.efotVisual : this.dadaVisual;
    this.drawRunnerBody(
      ctx,
      c.x,
      c.y,
      c.w,
      c.h,
      c.vy,
      c.onGround,
      c.runFrame,
      c.squashTimer,
      vis,
      c.attackPhase === 'windup'
    );

    const sg = this.updateStickGeometry(c);

    ctx.save();
    ctx.translate(sg.handX, sg.handY);
    ctx.rotate(c.stickAngle);

    if (c.attackPhase === 'strike') {
      ctx.strokeStyle = c.colorTheme.stickGlow;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.arc(0, 0, c.stickLength * 0.85, -1.2, 0.4);
      ctx.stroke();

      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Grip
    ctx.fillStyle = '#334155';
    this.roundRect(ctx, -3, -3, 9, 6, 2);
    ctx.fill();

    // Shaft with quality-scaled aura stroke + cached gradient
    this.roundRect(ctx, 4, -3, c.stickLength, 6, 3);
    if (this.profile.drawStickGlow) {
      ctx.strokeStyle = c.colorTheme.stickGlow;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = this.stickGrads[idx];
    ctx.fill();

    // Tip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.stickLength + 2, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Front arm holding stick
    ctx.fillStyle = c.colorTheme.secondary;
    this.roundRect(ctx, c.x + c.w - 6, c.y + 16, 7, 11, 3);
    ctx.fill();

    const isTelegraphing = c.attackPhase === 'windup' || c.attackPhase === 'strike';
    this.drawNameLabel(ctx, c.name, c.x + c.w / 2, c.y, isTelegraphing);
  }

  private drawCoins(ctx: CanvasRenderingContext2D) {
    const half = COIN_SPRITE_SIZE / 2;
    const srcSize = COIN_SPRITE_SIZE * SPRITE_SCALE;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      const wobble = Math.sin(c.phase) * 2.5;
      const sx = Math.abs(Math.cos(c.phase * 1.5));
      const frame = Math.min(COIN_FRAMES - 1, Math.round(sx * (COIN_FRAMES - 1)));
      ctx.drawImage(
        this.coinSheet,
        frame * srcSize,
        0,
        srcSize,
        srcSize,
        c.x - half,
        c.y + wobble - half,
        COIN_SPRITE_SIZE,
        COIN_SPRITE_SIZE
      );
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    if (this.activeParticleCount === 0) return;
    for (let i = 0; i < this.activeParticleCount; i++) {
      const p = this.particlePool[i];
      const a = p.life / p.maxLife;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
