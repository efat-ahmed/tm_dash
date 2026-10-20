import type {
  Chaser,
  Coin,
  EngineCallbacks,
  GameState,
  Obstacle,
  ObstacleType,
  Particle,
  Player,
  ScooterRider,
} from './types';
import { SoundManager } from './sound';

const BEST_KEY = 'tmdash_best';
const COIN_KEY = 'tmdash_coins_total';

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): ColorRGB {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.substring(0, 2), 16),
    g: parseInt(c.substring(2, 4), 16),
    b: parseInt(c.substring(4, 6), 16),
  };
}

function lerpColor(c1: string, c2: string, t: number): string {
  const a = parseHex(c1);
  const b = parseHex(c2);
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bl = Math.round(a.b + (b.b - a.b) * clamped);
  return `rgb(${r},${g},${bl})`;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private sound: SoundManager;

  private raf = 0;
  private idleRaf = 0;
  private lastTime = 0;
  private state: GameState = 'ready';

  // Logical world size — renders to 900x360 virtual space,
  // letterboxed to fit any display.
  readonly W = 900;
  readonly H = 360;
  private groundY: number;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;

  private player: Player;
  private chasers: Chaser[] = [];
  private scooters: ScooterRider[] = [];
  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];
  private particles: Particle[] = [];

  private speed = 6;
  private baseSpeed = 6;
  private maxSpeed = 18;
  private distance = 0;
  private score = 0;
  private coinCount = 0;
  private best = 0;
  private totalCoinsSaved = 0;

  private spawnTimer = 0;
  private nextSpawn = 90;
  private coinTimer = 0;
  private nextCoin = 140;

  // Background and environment state
  private waveOffset = 0;
  private cloudOffset = 0;
  private sandOffset = 0;
  private shake = 0;
  private flash = 0;
  private timeAlive = 0;
  readonly dayCycleDuration = 72; // seconds for a full 24h continuous cycle

  // Pre-generated static scenery elements
  private clouds: { x: number; y: number; w: number; h: number; speed: number; opacity: number }[] = [];
  private islands: { x: number; w: number; h: number }[] = [];
  private palmTrees: { x: number; height: number; fronds: number }[] = [];
  private shells: { x: number; y: number; r: number; color: string }[] = [];

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.cb = cb;
    this.sound = new SoundManager();

    this.groundY = this.H - 64; // y=296 is the walkable sand surface
    this.best = Number(localStorage.getItem(BEST_KEY) || 0);
    this.totalCoinsSaved = Number(localStorage.getItem(COIN_KEY) || 0);

    this.player = {
      x: 120,
      y: this.groundY - 48,
      w: 38,
      h: 48,
      vy: 0,
      onGround: true,
      jumpsLeft: 2,
      runFrame: 0,
    };

    this.initScenery();
    this.chasers = this.initChasers();
    this.scooters = this.initScooters();
    this.resize();
  }

  // ---- public API ----

  resumeAudio() {
    this.sound.resume();
  }

  start() {
    cancelAnimationFrame(this.idleRaf);
    this.reset();
    this.setState('running');
    this.sound.resume();
    this.sound.play('start');
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  idleRender() {
    cancelAnimationFrame(this.idleRaf);
    if (this.state !== 'ready') return;
    this.waveOffset = (this.waveOffset + 0.8) % 600;
    this.cloudOffset = (this.cloudOffset + 0.15) % 900;
    this.sandOffset = (this.sandOffset + 2) % 60;
    this.timeAlive += 0.016;

    this.player.runFrame += 0.15;
    for (const c of this.chasers) {
      c.runFrame += 0.15;
    }

    this.render();
    if (this.state === 'ready') {
      this.idleRaf = requestAnimationFrame(() => this.idleRender());
    }
  }

  togglePause() {
    if (this.state === 'running') {
      this.setState('paused');
      cancelAnimationFrame(this.raf);
    } else if (this.state === 'paused') {
      this.setState('running');
      this.lastTime = performance.now();
      this.loop(this.lastTime);
    }
  }

  restart() {
    this.start();
  }

  jump() {
    if (this.state !== 'running') return;
    if (this.player.jumpsLeft <= 0) return;
    const isFirst = this.player.onGround;
    this.player.vy = isFirst ? -13.5 : -11;
    this.player.onGround = false;
    this.player.jumpsLeft -= 1;
    this.sound.play('jump');
    // sand burst particles
    this.spawnSandDust(this.player.x + 8, this.groundY, 8);
  }

  setSoundEnabled(enabled: boolean) {
    this.sound.enabled = enabled;
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
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.idleRaf);
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;

    // contain letterboxing into virtual 900x360 canvas
    const sx = cw / this.W;
    const sy = ch / this.H;
    this.scale = Math.min(sx, sy);
    this.offsetX = (cw - this.W * this.scale) / 2;
    this.offsetY = (ch - this.H * this.scale) / 2;

    if (this.state !== 'running') {
      this.render();
    }
  }

  // ---- internal setup ----

  private initScenery() {
    // Tropical clouds
    this.clouds = [
      { x: 50, y: 35, w: 90, h: 28, speed: 0.12, opacity: 0.75 },
      { x: 260, y: 55, w: 120, h: 32, speed: 0.18, opacity: 0.8 },
      { x: 490, y: 25, w: 85, h: 24, speed: 0.14, opacity: 0.7 },
      { x: 710, y: 48, w: 110, h: 30, speed: 0.16, opacity: 0.85 },
      { x: 880, y: 65, w: 75, h: 22, speed: 0.13, opacity: 0.65 },
    ];

    // Distant tropical islands
    this.islands = [
      { x: 110, w: 160, h: 42 },
      { x: 420, w: 220, h: 58 },
      { x: 740, w: 180, h: 46 },
    ];

    // Palm trees in background dunes
    this.palmTrees = [
      { x: 80, height: 85, fronds: 5 },
      { x: 290, height: 78, fronds: 5 },
      { x: 520, height: 92, fronds: 6 },
      { x: 760, height: 82, fronds: 5 },
    ];

    // Shells scattered on the beach
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
        baseX: 62,
        x: 62,
        y: this.groundY - 46,
        w: 36,
        h: 46,
        vy: 0,
        onGround: true,
        runFrame: 0,
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
        attackCooldown: 6.0,
        stickAngle: -0.6,
        stickLength: 46,
        lungeX: 0,
      },
      {
        id: 'DADA',
        name: 'DADA',
        baseX: 14,
        x: 14,
        y: this.groundY - 46,
        w: 36,
        h: 46,
        vy: 0,
        onGround: true,
        runFrame: 0.5,
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
        attackCooldown: 13.0,
        stickAngle: -0.6,
        stickLength: 46,
        lungeX: 0,
      },
    ];
  }

  private initScooters(): ScooterRider[] {
    return [
      {
        id: 'HM',
        name: 'HM',
        x: this.W + 80,
        y: this.groundY - 48,
        w: 48,
        h: 48,
        speed: 7.5,
        vy: 0,
        onGround: true,
        wheelRotation: 0,
        bobPhase: 0,
        active: false,
        spawnCooldown: 10,
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
        y: this.groundY - 48,
        w: 48,
        h: 48,
        speed: 8.5,
        vy: 0,
        onGround: true,
        wheelRotation: 0,
        bobPhase: 1.5,
        active: false,
        spawnCooldown: 22,
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

  private setState(s: GameState) {
    this.state = s;
    this.cb.onStateChange(s);
    if (s === 'ready') this.cb.onReady?.();
  }

  private reset() {
    this.speed = this.baseSpeed;
    this.distance = 0;
    this.score = 0;
    this.coinCount = 0;
    this.timeAlive = 0;
    this.obstacles = [];
    this.coins = [];
    this.particles = [];
    this.spawnTimer = 0;
    this.nextSpawn = 80;
    this.coinTimer = 0;
    this.nextCoin = 120;
    this.shake = 0;
    this.flash = 0;
    this.player.y = this.groundY - this.player.h;
    this.player.vy = 0;
    this.player.onGround = true;
    this.player.jumpsLeft = 2;
    this.chasers = this.initChasers();
    this.scooters = this.initScooters();
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    if (dt > 0.05) dt = 0.05; // prevent runaway jumps after frame lag
    if (this.state === 'running') {
      this.update(dt);
    }
    this.render();
  };

  private update(dt: number) {
    const step = dt * 60; // normalize to 60fps unit steps
    this.timeAlive += dt;

    // Difficulty curve
    this.speed = Math.min(
      this.maxSpeed,
      this.baseSpeed + this.distance * 0.0012
    );
    this.distance += this.speed * step;
    this.score = Math.floor(this.distance / 6);
    this.cb.onScore(this.score, this.coinCount);

    // Player physics
    const gravity = 0.75;
    this.player.vy += gravity * step;
    this.player.y += this.player.vy * step;
    if (this.player.y >= this.groundY - this.player.h) {
      this.player.y = this.groundY - this.player.h;
      if (!this.player.onGround) this.spawnSandDust(this.player.x + 8, this.groundY, 5);
      this.player.vy = 0;
      this.player.onGround = true;
      this.player.jumpsLeft = 2;
    }
    this.player.runFrame += step * 0.4;

    // Background & beach offsets
    this.waveOffset = (this.waveOffset + this.speed * step * 0.25) % 600;
    this.cloudOffset = (this.cloudOffset + this.speed * step * 0.06) % 900;
    this.sandOffset = (this.sandOffset + this.speed * step) % 60;

    // Spawn beach obstacles
    this.spawnTimer += step;
    if (this.spawnTimer >= this.nextSpawn) {
      this.spawnTimer = 0;
      this.nextSpawn = this.randomSpawnGap();
      this.spawnBeachObstacle();
    }

    // Spawn coins
    this.coinTimer += step;
    if (this.coinTimer >= this.nextCoin) {
      this.coinTimer = 0;
      this.nextCoin = 90 + Math.random() * 140;
      this.spawnCoinPattern();
    }

    // Move obstacles
    for (const o of this.obstacles) {
      o.x -= this.speed * step;
      if (o.type === 'beachball' && o.rotation !== undefined) {
        o.rotation += step * 0.12;
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -30);

    // Move coins
    for (const c of this.coins) {
      c.x -= this.speed * step;
      c.phase += step * 0.15;
    }
    this.coins = this.coins.filter((c) => !c.collected && c.x + c.r > -20);

    // Update Particles
    for (const p of this.particles) {
      p.vy += p.gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.life -= step;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Update Scooters (HM and CM)
    this.updateScooters(dt, step);

    // Update AI Chasers (EFOT and DADA)
    this.updateChasers(dt, step);
    if (this.state !== 'running') return;

    // Collisions
    this.checkCollisions();

    // Decay effects
    if (this.shake > 0) this.shake = Math.max(0, this.shake - step * 1.5);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - step * 0.05);

    // Beach sand dust while running
    if (this.player.onGround && Math.random() < 0.08 * step) {
      this.spawnSandDust(this.player.x, this.groundY, 1);
    }
  }

  private randomSpawnGap(): number {
    const base = 110 - (this.speed - this.baseSpeed) * 4;
    return Math.max(55, base + Math.random() * 60);
  }

  private spawnBeachObstacle() {
    const r = Math.random();
    let type: ObstacleType;
    let w = 36;
    let h = 32;

    if (r < 0.28) {
      type = 'driftwood';
      w = 44 + Math.random() * 10;
      h = 24 + Math.random() * 6;
    } else if (r < 0.50) {
      type = 'beachball';
      w = 34;
      h = 34;
    } else if (r < 0.72) {
      type = 'rock';
      w = 36 + Math.random() * 8;
      h = 30 + Math.random() * 8;
    } else if (r < 0.88) {
      type = 'sandmound';
      w = 46 + Math.random() * 12;
      h = 26 + Math.random() * 6;
    } else {
      type = 'umbrella';
      w = 36;
      h = 60 + Math.random() * 12;
    }

    this.obstacles.push({
      x: this.W + 30,
      y: this.groundY - h,
      w,
      h,
      type,
      scored: false,
      rotation: type === 'beachball' ? 0 : undefined,
      colorIndex: Math.floor(Math.random() * 4),
    });
  }

  private spawnCoinPattern() {
    const pattern = Math.floor(Math.random() * 3);
    const baseY = this.groundY - 60 - Math.random() * 70;
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      let y = baseY;
      if (pattern === 1) y = baseY + Math.sin(i * 0.7) * 24;
      if (pattern === 2) y = baseY - i * 10;
      this.coins.push({
        x: this.W + 30 + i * 38,
        y,
        r: 9,
        collected: false,
        phase: i * 0.4,
      });
    }
  }

  private spawnSandDust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 18,
        y: y - Math.random() * 5,
        vx: -this.speed * 0.3 + (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2,
        life: 18 + Math.random() * 12,
        maxLife: 30,
        size: 2 + Math.random() * 3,
        color: 'rgba(235,190,120,',
        gravity: 0.06,
      });
    }
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 20 + Math.random() * 20,
        maxLife: 40,
        size: 2 + Math.random() * 4,
        color,
        gravity: 0.1,
      });
    }
  }

  // ---- Scooter Riders (HM & CM) ----

  private updateScooters(dt: number, step: number) {
    for (const sc of this.scooters) {
      if (!sc.active) {
        sc.spawnCooldown -= dt;
        if (sc.spawnCooldown <= 0) {
          // Check that other scooter isn't right at entrance
          const other = this.scooters.find((s) => s.id !== sc.id);
          if (!other || !other.active || other.x < this.W - 120) {
            sc.active = true;
            sc.x = this.W + 40;
            sc.y = this.groundY - sc.h;
            sc.vy = 0;
            sc.onGround = true;
            // Play scooter horn
            this.sound.play('beep');
          }
        }
      } else {
        // Move across the beach from right to left
        // Moves at relative speed so it cruises dynamically
        sc.x -= (this.speed * 0.85 + sc.speed * 0.25) * step;
        sc.wheelRotation += step * 0.2;
        sc.bobPhase += step * 0.15;

        // Scooter physics
        const gravity = 0.75;
        sc.vy += gravity * step;
        sc.y += sc.vy * step;
        if (sc.y >= this.groundY - sc.h) {
          sc.y = this.groundY - sc.h;
          sc.vy = 0;
          sc.onGround = true;
        }

        // Scooter auto-jump over approaching obstacles
        if (sc.onGround) {
          for (const o of this.obstacles) {
            const dist = o.x - (sc.x + sc.w);
            if (dist > -10 && dist < 40) {
              sc.vy = -12.5;
              sc.onGround = false;
              this.spawnSandDust(sc.x, this.groundY, 4);
              break;
            }
          }
        }

        // Deactivate once exited off the left side
        if (sc.x + sc.w < -60) {
          sc.active = false;
          // Random cooldown before next pass (16 - 28s)
          sc.spawnCooldown = 16 + Math.random() * 12;
        }
      }
    }
  }

  // ---- AI Chasers (EFOT & DADA) ----

  private updateChasers(dt: number, step: number) {
    const isAnyOtherAttacking = this.chasers.some(
      (c) => c.attackPhase === 'windup' || c.attackPhase === 'strike'
    );

    for (const c of this.chasers) {
      c.runFrame += step * 0.4;

      const gravity = 0.75;
      c.vy += gravity * step;
      c.y += c.vy * step;
      if (c.y >= this.groundY - c.h) {
        c.y = this.groundY - c.h;
        c.vy = 0;
        c.onGround = true;
      }

      // Jump over obstacles
      if (c.onGround) {
        for (const o of this.obstacles) {
          const distToObstacle = o.x - (c.x + c.w);
          if (distToObstacle > -10 && distToObstacle < 50) {
            c.vy = -12.5;
            c.onGround = false;
            this.spawnSandDust(c.x, this.groundY, 4);
            break;
          }
        }
      }

      // Attack State Machine
      if (c.attackPhase === 'idle') {
        c.attackCooldown -= dt;
        c.lungeX = 0;
        c.stickAngle = -0.6 + Math.sin(c.runFrame * 2) * 0.1;
        c.x = c.baseX;

        if (c.attackCooldown <= 0 && !isAnyOtherAttacking && this.timeAlive > 4) {
          c.attackPhase = 'windup';
          c.phaseTimer = 0.75;
          this.sound.play('warning');
          this.burst(c.x + c.w / 2, c.y - 10, c.colorTheme.glow, 6);
        }
      } else if (c.attackPhase === 'windup') {
        c.phaseTimer -= dt;
        const windupProgress = 1 - Math.max(0, c.phaseTimer / 0.75);
        c.stickAngle = -0.6 - windupProgress * 1.4;

        const maxLunge = c.id === 'EFOT' ? 30 : 44;
        c.lungeX = windupProgress * maxLunge;
        c.x = c.baseX + c.lungeX;

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'strike';
          c.phaseTimer = 0.22;
          this.sound.play('swing');
        }
      } else if (c.attackPhase === 'strike') {
        c.phaseTimer -= dt;
        const strikeProgress = 1 - Math.max(0, c.phaseTimer / 0.22);
        c.stickAngle = -2.0 + strikeProgress * 2.8;

        const handX = c.x + c.w - 4;
        const handY = c.y + c.h * 0.55;
        const tipX = handX + Math.cos(c.stickAngle) * c.stickLength;
        const tipY = handY + Math.sin(c.stickAngle) * c.stickLength;

        if (strikeProgress >= 0.2 && strikeProgress <= 0.8) {
          const stickLeft = Math.min(handX, tipX);
          const stickRight = Math.max(handX, tipX);
          const stickTop = Math.min(handY, tipY);
          const stickBottom = Math.max(handY, tipY);

          const p = this.player;
          const playerLeft = p.x + 4;
          const playerRight = p.x + p.w - 4;
          const playerTop = p.y + 4;
          const playerBottom = p.y + p.h;

          const horizontalHit = stickRight > playerLeft && stickLeft < playerRight;
          const verticalHit = stickBottom > playerTop && stickTop < playerBottom;

          // FAIR DODGE: Jump completely over the sweeping stick
          const isDodgingAirborne = playerBottom < this.groundY - 26;

          if (horizontalHit && verticalHit && !isDodgingAirborne) {
            this.sound.play('whack');
            this.burst(p.x + p.w / 2, p.y + p.h / 2, c.colorTheme.stickGlow, 24);
            this.die();
            return;
          }
        }

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'recovery';
          c.phaseTimer = 0.5;
        }
      } else if (c.attackPhase === 'recovery') {
        c.phaseTimer -= dt;
        const recProgress = 1 - Math.max(0, c.phaseTimer / 0.5);
        const maxLunge = c.id === 'EFOT' ? 30 : 44;
        c.lungeX = maxLunge * (1 - recProgress);
        c.x = c.baseX + c.lungeX;
        c.stickAngle = 0.8 - recProgress * 1.4;

        if (c.phaseTimer <= 0) {
          c.attackPhase = 'idle';
          c.lungeX = 0;
          c.x = c.baseX;
          c.stickAngle = -0.6;
          c.attackCooldown = 8.0 + Math.random() * 6.0;
        }
      }
    }
  }

  // ---- Collisions ----

  private checkCollisions() {
    const p = this.player;
    const pad = 6;
    const px = p.x + pad;
    const py = p.y + pad;
    const pw = p.w - pad * 2;
    const ph = p.h - pad * 2;

    for (const o of this.obstacles) {
      let ox = o.x + 4;
      const oy = o.y + 4;
      let ow = o.w - 8;
      const oh = o.h - 8;

      if (o.type === 'spike') {
        ox = o.x + 8;
        ow = o.w - 16;
      } else if (o.type === 'umbrella') {
        ox = o.x + 10;
        ow = o.w - 20;
      }

      if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) {
        this.die();
        return;
      }
    }

    // Coins
    for (const c of this.coins) {
      if (c.collected) continue;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const dx = cx - c.x;
      const dy = cy - c.y;
      if (dx * dx + dy * dy < (c.r + 22) * (c.r + 22)) {
        c.collected = true;
        this.coinCount += 1;
        this.score += 5;
        this.distance += 30;
        this.sound.play('coin');
        this.burst(c.x, c.y, 'rgba(255,210,80,', 12);
      }
    }
  }

  private die() {
    this.sound.play('crash');
    this.shake = 14;
    this.flash = 1;
    this.burst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 'rgba(255,70,90,', 26);
    const finalScore = this.score;
    const finalCoins = this.coinCount;
    if (finalScore > this.best) {
      this.best = finalScore;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.totalCoinsSaved += finalCoins;
    localStorage.setItem(COIN_KEY, String(this.totalCoinsSaved));
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

  // ---- Rendering ----

  private render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake
      );
    }

    const cycle = this.getDayCycleProgress();

    // 1. Sky & Sun/Moon/Stars
    this.drawSky(ctx, cycle);
    this.drawSunMoon(ctx, cycle);
    this.drawClouds(ctx, cycle);
    this.drawIslands(ctx, cycle);

    // 2. Ocean with animated waves & sun reflection
    this.drawOcean(ctx, cycle);

    // 3. Sandy Beach Ground & Palms
    this.drawBeachGround(ctx, cycle);
    this.drawPalms(ctx, cycle);

    // 4. Coins & Beach Obstacles
    this.drawCoins(ctx);
    this.drawObstacles(ctx);

    // 5. Passing Scooter Riders (HM and CM)
    for (const sc of this.scooters) {
      if (sc.active) {
        this.drawScooter(ctx, sc);
      }
    }

    // 6. Particles
    this.drawParticles(ctx);

    // 7. Chasers (EFOT & DADA)
    const sortedChasers = [...this.chasers].sort((a, b) => a.x - b.x);
    for (const c of sortedChasers) {
      this.drawChaser(ctx, c);
    }

    // 8. Main Player (TM)
    this.drawPlayer(ctx);

    // Flash on hit
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,60,80,${this.flash * 0.4})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    ctx.restore();
  }

  // ---- Beach Background & Day Cycle Drawing ----

  private drawSky(ctx: CanvasRenderingContext2D, t: number) {
    // Determine sky colors by phase
    let skyTop = '#1e6fb6';
    let skyMid = '#48a6e8';
    let skyBot = '#9ce0ff';

    if (t < 0.22) {
      // Sunrise: deep purple -> vibrant dawn gold
      const p = t / 0.22;
      skyTop = lerpColor('#1b1233', '#1e6fb6', p);
      skyMid = lerpColor('#c85060', '#48a6e8', p);
      skyBot = lerpColor('#ff8e53', '#9ce0ff', p);
    } else if (t < 0.52) {
      // Daytime: radiant blue tropical sky
      skyTop = '#1864ab';
      skyMid = '#339af0';
      skyBot = '#a5d8ff';
    } else if (t < 0.78) {
      // Sunset: fiery orange, magenta, violet
      const p = (t - 0.52) / 0.26;
      skyTop = lerpColor('#1864ab', '#2b0938', p);
      skyMid = lerpColor('#339af0', '#c2255c', p);
      skyBot = lerpColor('#a5d8ff', '#f76707', p);
    } else {
      // Night: midnight sapphire, starry sky
      const p = (t - 0.78) / 0.22;
      skyTop = lerpColor('#2b0938', '#070b19', p);
      skyMid = lerpColor('#141529', '#0d1326', p);
      skyBot = lerpColor('#1f2d4d', '#152238', p);
    }

    const g = ctx.createLinearGradient(0, 0, 0, this.groundY - 70);
    g.addColorStop(0, skyTop);
    g.addColorStop(0.65, skyMid);
    g.addColorStop(1, skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.groundY);

    // Stars at night
    if (t > 0.72) {
      const starAlpha = t > 0.78 ? Math.min(1, (t - 0.78) * 6) : (t - 0.72) * 10;
      ctx.fillStyle = `rgba(255,255,255,${starAlpha * 0.8})`;
      for (let i = 0; i < 35; i++) {
        const sx = (i * 79 + this.cloudOffset * 0.2) % this.W;
        const sy = (i * 23) % (this.groundY - 100);
        const sz = 1 + ((i * 7) % 3);
        ctx.fillRect(sx, sy, sz, sz);
      }
    }
  }

  private drawSunMoon(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;

    if (t < 0.78) {
      // Sun is up: rises at left, peaks at mid, sets at right
      let sunX: number;
      let sunY: number;
      let sunColor = 'rgba(255, 240, 160, 0.95)';
      let glowColor = 'rgba(255, 200, 80, 0.35)';

      if (t < 0.22) {
        // Rising
        const p = t / 0.22;
        sunX = 140 + p * 200;
        sunY = horizonY - p * 110;
        sunColor = 'rgba(255, 170, 70, 0.95)';
        glowColor = 'rgba(255, 120, 50, 0.45)';
      } else if (t < 0.52) {
        // High noon
        const p = (t - 0.22) / 0.30;
        sunX = 340 + p * 240;
        sunY = horizonY - 110 + Math.sin(p * Math.PI) * -15;
      } else {
        // Setting
        const p = (t - 0.52) / 0.26;
        sunX = 580 + p * 200;
        sunY = horizonY - 110 + p * 110;
        sunColor = 'rgba(255, 100, 70, 0.95)';
        glowColor = 'rgba(255, 80, 80, 0.5)';
      }

      // Sun glow corona
      const sg = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 70);
      sg.addColorStop(0, glowColor);
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 70, 0, Math.PI * 2);
      ctx.fill();

      // Sun body
      ctx.fillStyle = sunColor;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 20, 0, Math.PI * 2);
      ctx.fill();

      // Sun reflection beam down into the sea
      ctx.save();
      const refGrad = ctx.createLinearGradient(sunX, horizonY, sunX, this.groundY - 10);
      refGrad.addColorStop(0, glowColor);
      refGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = refGrad;
      ctx.fillRect(sunX - 25, horizonY, 50, this.groundY - horizonY);
      ctx.restore();
    } else {
      // Moon at night
      const p = (t - 0.78) / 0.22;
      const moonX = 640 - p * 300;
      const moonY = 65 + Math.sin(p * Math.PI) * -10;

      // Moon halo
      const mg = ctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, 45);
      mg.addColorStop(0, 'rgba(210, 235, 255, 0.4)');
      mg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 45, 0, Math.PI * 2);
      ctx.fill();

      // Crescent moon
      ctx.fillStyle = '#f0f9ff';
      ctx.beginPath();
      ctx.arc(moonX, moonY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#070b19';
      ctx.beginPath();
      ctx.arc(moonX + 6, moonY - 3, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawClouds(ctx: CanvasRenderingContext2D, t: number) {
    let cloudColor = 'rgba(255, 255, 255, ';
    if (t >= 0.52 && t < 0.78) {
      cloudColor = 'rgba(255, 210, 200, ';
    } else if (t >= 0.78 || t < 0.08) {
      cloudColor = 'rgba(120, 140, 180, ';
    }

    for (const c of this.clouds) {
      const cx = (c.x - this.cloudOffset * c.speed * 4) % (this.W + 120);
      const x = cx < -100 ? cx + this.W + 200 : cx;
      ctx.fillStyle = `${cloudColor}${c.opacity * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, c.y, c.h * 0.6, 0, Math.PI * 2);
      ctx.arc(x + c.w * 0.28, c.y - c.h * 0.25, c.h * 0.8, 0, Math.PI * 2);
      ctx.arc(x + c.w * 0.6, c.y, c.h * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawIslands(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;
    let islandColor = '#1e3d59';
    if (t < 0.22) islandColor = '#3b254a';
    else if (t < 0.52) islandColor = '#105265';
    else if (t < 0.78) islandColor = '#4a154b';
    else islandColor = '#0b1626';

    ctx.fillStyle = islandColor;
    for (const is of this.islands) {
      const ix = (is.x - this.cloudOffset * 0.05) % (this.W + 200);
      const x = ix < -200 ? ix + this.W + 400 : ix;

      ctx.beginPath();
      ctx.moveTo(x, horizonY);
      ctx.quadraticCurveTo(x + is.w * 0.5, horizonY - is.h, x + is.w, horizonY);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawOcean(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;
    const seaHeight = 55;

    let deepSea = '#0077b6';
    let midSea = '#0096c7';
    let crestColor = '#48cae4';

    if (t < 0.22) {
      deepSea = '#2c3e50';
      midSea = '#34495e';
      crestColor = '#f39c12';
    } else if (t < 0.52) {
      deepSea = '#0077b6';
      midSea = '#0096c7';
      crestColor = '#90e0ef';
    } else if (t < 0.78) {
      deepSea = '#3d1635';
      midSea = '#5c1d4a';
      crestColor = '#ff758f';
    } else {
      deepSea = '#071626';
      midSea = '#0b253a';
      crestColor = '#2a4d69';
    }

    // Sea gradient
    const sg = ctx.createLinearGradient(0, horizonY, 0, horizonY + seaHeight);
    sg.addColorStop(0, deepSea);
    sg.addColorStop(1, midSea);
    ctx.fillStyle = sg;
    ctx.fillRect(0, horizonY, this.W, seaHeight);

    // Animated ocean wave layers
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = crestColor;
    for (let layer = 0; layer < 3; layer++) {
      const ly = horizonY + 12 + layer * 14;
      const speedMult = 0.8 + layer * 0.4;
      const offset = (this.waveOffset * speedMult) % 80;

      ctx.beginPath();
      ctx.moveTo(-40, ly);
      for (let x = -40; x <= this.W + 40; x += 30) {
        const wy = ly + Math.sin((x + offset) * 0.05) * (2.5 + layer);
        ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
  }

  private drawBeachGround(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;
    const shoreY = horizonY + 50;

    let sandTop = '#e9c46a';
    let sandBottom = '#d4a373';
    let foamColor = 'rgba(255, 255, 255, 0.75)';

    if (t < 0.22) {
      sandTop = '#e0a96d';
      sandBottom = '#a66b38';
    } else if (t < 0.52) {
      sandTop = '#f4a261';
      sandBottom = '#e76f51';
    } else if (t < 0.78) {
      sandTop = '#d88373';
      sandBottom = '#9e4770';
      foamColor = 'rgba(255, 220, 200, 0.7)';
    } else {
      sandTop = '#34495e';
      sandBottom = '#1e272e';
      foamColor = 'rgba(180, 210, 240, 0.5)';
    }

    // Gentle wave foam wash on the shore
    ctx.fillStyle = foamColor;
    const wash = Math.sin(this.waveOffset * 0.05) * 5;
    ctx.beginPath();
    ctx.moveTo(0, shoreY + wash);
    for (let x = 0; x <= this.W; x += 40) {
      const fy = shoreY + wash + Math.sin((x + this.waveOffset) * 0.06) * 3;
      ctx.lineTo(x, fy);
    }
    ctx.lineTo(this.W, this.H);
    ctx.lineTo(0, this.H);
    ctx.closePath();
    ctx.fill();

    // Sand ground fill
    const sandGrad = ctx.createLinearGradient(0, this.groundY - 8, 0, this.H);
    sandGrad.addColorStop(0, sandTop);
    sandGrad.addColorStop(1, sandBottom);
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, this.groundY, this.W, this.H - this.groundY);

    // Warm shoreline contour edge
    ctx.strokeStyle = '#fff3bf';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.W, this.groundY);
    ctx.stroke();

    // Sand shells
    for (const sh of this.shells) {
      ctx.fillStyle = sh.color;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI);
      ctx.fill();
    }
  }

  private drawPalms(ctx: CanvasRenderingContext2D, t: number) {
    const horizonY = this.groundY - 80;
    const palmY = horizonY + 36;
    let trunkColor = '#7f4f24';
    let leafColor = '#2d6a4f';

    if (t >= 0.78 || t < 0.08) {
      trunkColor = '#1e293b';
      leafColor = '#0f3a28';
    } else if (t >= 0.52) {
      trunkColor = '#5c3d2e';
      leafColor = '#704214';
    }

    for (const p of this.palmTrees) {
      const px = (p.x - this.cloudOffset * 0.3) % (this.W + 200);
      const x = px < -100 ? px + this.W + 300 : px;

      // Curved trunk
      ctx.strokeStyle = trunkColor;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x, palmY);
      ctx.quadraticCurveTo(x + 12, palmY - p.height * 0.5, x + 20, palmY - p.height);
      ctx.stroke();

      // Fronds
      const tipX = x + 20;
      const tipY = palmY - p.height;
      const sway = Math.sin(this.waveOffset * 0.04 + x) * 4;

      ctx.strokeStyle = leafColor;
      ctx.lineWidth = 3;
      for (let f = 0; f < p.fronds; f++) {
        const ang = (f / (p.fronds - 1) - 0.5) * 1.6;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.quadraticCurveTo(
          tipX + Math.sin(ang) * 26 + sway,
          tipY - 10 + Math.cos(ang) * 6,
          tipX + Math.sin(ang) * 45 + sway * 1.5,
          tipY + Math.cos(ang) * 20
        );
        ctx.stroke();
      }

      // Coconuts
      ctx.fillStyle = '#4a2810';
      ctx.beginPath();
      ctx.arc(tipX - 2, tipY + 2, 3.5, 0, Math.PI * 2);
      ctx.arc(tipX + 3, tipY + 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Beach Obstacles Rendering ----

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    for (const o of this.obstacles) {
      ctx.save();
      const gy = o.y + o.h;

      if (o.type === 'driftwood') {
        // Weathered beach log
        ctx.fillStyle = '#8b5a2b';
        ctx.strokeStyle = '#5c3a21';
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, o.x, gy - o.h, o.w, o.h, 6);
        ctx.fill();
        ctx.stroke();

        // Branch stub
        ctx.fillStyle = '#6e431f';
        ctx.fillRect(o.x + o.w * 0.6, gy - o.h - 5, 8, 6);

        // Wood rings/stripes
        ctx.strokeStyle = '#a06a38';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x + 8, gy - o.h + 6);
        ctx.lineTo(o.x + o.w - 8, gy - o.h + 6);
        ctx.moveTo(o.x + 12, gy - 8);
        ctx.lineTo(o.x + o.w - 12, gy - 8);
        ctx.stroke();
      } else if (o.type === 'rock') {
        // Smooth granite rocks
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, gy);
        grad.addColorStop(0, '#94a3b8');
        grad.addColorStop(1, '#475569');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(o.x + 4, gy);
        ctx.lineTo(o.x + o.w * 0.3, o.y);
        ctx.lineTo(o.x + o.w * 0.7, o.y + 4);
        ctx.lineTo(o.x + o.w - 4, gy);
        ctx.closePath();
        ctx.fill();

        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(o.x + o.w * 0.35, o.y + 3, o.w * 0.3, 4);
      } else if (o.type === 'beachball') {
        // Striped beach ball with roll rotation
        const r = o.w / 2;
        const cx = o.x + r;
        const cy = o.y + r;
        const rot = o.rotation || 0;

        ctx.translate(cx, cy);
        ctx.rotate(rot);

        // 4 color segments: red, yellow, cyan, white
        const colors = ['#ef4444', '#eab308', '#06b6d4', '#f8fafc'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = colors[i];
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
          ctx.closePath();
          ctx.fill();
        }

        // Center hub circle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.stroke();
      } else if (o.type === 'sandmound') {
        // Sandy mound with starfish / mini flag
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, gy);
        grad.addColorStop(0, '#fde047');
        grad.addColorStop(1, '#ca8a04');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(o.x, gy);
        ctx.quadraticCurveTo(o.x + o.w * 0.5, o.y, o.x + o.w, gy);
        ctx.closePath();
        ctx.fill();

        // Mini red beach flag
        ctx.strokeStyle = '#92400e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x + o.w * 0.5, gy - o.h + 2);
        ctx.lineTo(o.x + o.w * 0.5, gy - o.h - 12);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(o.x + o.w * 0.5, gy - o.h - 12);
        ctx.lineTo(o.x + o.w * 0.5 + 10, gy - o.h - 7);
        ctx.lineTo(o.x + o.w * 0.5, gy - o.h - 2);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === 'umbrella') {
        // Beach umbrella parasol (tall)
        // Pole
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(o.x + o.w * 0.5, gy);
        ctx.lineTo(o.x + o.w * 0.5, o.y + 12);
        ctx.stroke();

        // Canopy stripes
        const cx = o.x + o.w * 0.5;
        const cy = o.y + 14;
        const colors = ['#f43f5e', '#38bdf8', '#fbbf24', '#f43f5e'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = colors[i];
          const span = (o.w * 0.5) / 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 12);
          ctx.lineTo(cx - o.w * 0.5 + i * span, cy);
          ctx.lineTo(cx - o.w * 0.5 + (i + 1) * span, cy);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Fallback for legacy blocks
        ctx.fillStyle = '#f59e0b';
        this.roundRect(ctx, o.x, o.y, o.w, o.h, 6);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ---- Scooter Riders (HM and CM) Rendering ----

  private drawScooter(ctx: CanvasRenderingContext2D, sc: ScooterRider) {
    ctx.save();
    const bob = Math.sin(sc.bobPhase) * 1.5;
    ctx.translate(sc.x, sc.y + bob);

    // Scooter Deck and Frame
    ctx.fillStyle = sc.colorTheme.scooter;
    this.roundRect(ctx, 4, sc.h - 12, sc.w - 12, 5, 2);
    ctx.fill();

    // Steering Column & Handlebars
    ctx.strokeStyle = sc.colorTheme.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(8, sc.h - 12);
    ctx.lineTo(6, sc.h - 32);
    ctx.stroke();

    // Handlebar grip
    ctx.fillStyle = '#1e293b';
    this.roundRect(ctx, 2, sc.h - 34, 10, 4, 1.5);
    ctx.fill();

    // Headlight with warm glow
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#fef08a';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(4, sc.h - 28, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Front Wheel
    this.drawWheel(ctx, 8, sc.h - 6, 6, sc.wheelRotation, sc.colorTheme.wheels);
    // Rear Wheel
    this.drawWheel(ctx, sc.w - 12, sc.h - 6, 6, sc.wheelRotation, sc.colorTheme.wheels);

    // Rider Character
    const rx = sc.w * 0.45;
    const ry = sc.h - 34;

    // Body / Shirt
    ctx.fillStyle = sc.colorTheme.shirt;
    this.roundRect(ctx, rx - 6, ry, 13, 16, 4);
    ctx.fill();

    // Head / Helmet
    ctx.fillStyle = sc.colorTheme.rider;
    ctx.beginPath();
    ctx.arc(rx, ry - 6, 7, 0, Math.PI * 2);
    ctx.fill();

    // Sunglasses / Visor
    ctx.fillStyle = '#0f172a';
    this.roundRect(ctx, rx - 7, ry - 7, 7, 4, 1);
    ctx.fill();

    // Arms reaching to handlebar
    ctx.strokeStyle = sc.colorTheme.rider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx - 2, ry + 4);
    ctx.lineTo(8, sc.h - 30);
    ctx.stroke();

    ctx.restore();

    // Exact name label attached above scooter rider
    this.drawNameLabel(
      ctx,
      sc.name,
      sc.x + sc.w * 0.5,
      sc.y + bob - 12,
      sc.colorTheme.labelColor,
      sc.colorTheme.labelBg
    );
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

    // Tire
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Rim
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Spokes
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

  private drawNameLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    topY: number,
    color: string,
    bgColor: string,
    showWarning = false
  ) {
    ctx.save();
    ctx.font = 'bold 11px monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(text).width;
    const paddingX = 6;
    const badgeW = textWidth + paddingX * 2;
    const badgeH = 15;
    const badgeX = centerX - badgeW / 2;
    const badgeY = topY - badgeH - 5;

    ctx.fillStyle = bgColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = color;
    ctx.fillText(text, centerX, badgeY + badgeH / 2);

    if (showWarning) {
      const warnY = badgeY - 14;
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      this.roundRect(ctx, centerX - 20, warnY, 40, 12, 3);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace, sans-serif';
      ctx.fillText('! SWING', centerX, warnY + 6);
    }

    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 14;

    // Body
    const bodyGrad = ctx.createLinearGradient(0, 0, 0, p.h);
    bodyGrad.addColorStop(0, '#5cff5c');
    bodyGrad.addColorStop(1, '#1faf1f');
    ctx.fillStyle = bodyGrad;
    this.roundRect(ctx, 2, 6, p.w - 4, p.h - 8, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Visor
    ctx.fillStyle = '#06280a';
    this.roundRect(ctx, 6, 12, p.w - 12, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#aaffaa';
    ctx.fillRect(8, 14, p.w - 16, 3);

    // Legs (running)
    ctx.fillStyle = '#0c8a0c';
    const swing = Math.sin(p.runFrame * Math.PI) * (p.onGround ? 6 : 0);
    this.roundRect(ctx, 8, p.h - 10, 9, 12 + swing, 3);
    ctx.fill();
    this.roundRect(ctx, p.w - 17, p.h - 10, 9, 12 - swing, 3);
    ctx.fill();

    // Arms
    const armSwing = Math.sin(p.runFrame * Math.PI + Math.PI) * (p.onGround ? 5 : 0);
    this.roundRect(ctx, -3, 16, 7, 14 + armSwing, 3);
    ctx.fill();
    this.roundRect(ctx, p.w - 4, 16, 7, 14 - armSwing, 3);
    ctx.fill();

    ctx.restore();

    // Exact label for TM
    this.drawNameLabel(ctx, 'TM', p.x + p.w / 2, p.y, '#22d3ee', '#082f49');
  }

  private drawChaser(ctx: CanvasRenderingContext2D, c: Chaser) {
    ctx.save();
    ctx.translate(c.x, c.y);

    ctx.shadowColor = c.colorTheme.glow;
    ctx.shadowBlur = c.attackPhase === 'windup' ? 22 : 12;

    const bodyGrad = ctx.createLinearGradient(0, 0, 0, c.h);
    bodyGrad.addColorStop(0, c.colorTheme.primary);
    bodyGrad.addColorStop(1, c.colorTheme.secondary);
    ctx.fillStyle = bodyGrad;
    this.roundRect(ctx, 2, 6, c.w - 4, c.h - 8, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.fillStyle = '#0f172a';
    this.roundRect(ctx, 6, 12, c.w - 12, 13, 4);
    ctx.fill();
    ctx.fillStyle = c.colorTheme.visor;
    ctx.fillRect(8, 14, c.w - 16, 3);

    // Legs
    ctx.fillStyle = c.colorTheme.secondary;
    const swing = Math.sin(c.runFrame * Math.PI) * (c.onGround ? 6 : 0);
    this.roundRect(ctx, 8, c.h - 10, 8, 12 + swing, 3);
    ctx.fill();
    this.roundRect(ctx, c.w - 16, c.h - 10, 8, 12 - swing, 3);
    ctx.fill();

    // Arms & Stick
    const armSwing = Math.sin(c.runFrame * Math.PI + Math.PI) * (c.onGround ? 5 : 0);
    this.roundRect(ctx, -2, 16, 6, 13 - armSwing, 3);
    ctx.fill();

    const handX = c.w - 2;
    const handY = 22 + armSwing * 0.4;

    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(c.stickAngle);

    if (c.attackPhase === 'strike') {
      ctx.save();
      ctx.shadowColor = c.colorTheme.stickGlow;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = `${c.colorTheme.stickGlow}77`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(0, 0, c.stickLength * 0.85, -1.2, 0.4);
      ctx.stroke();
      ctx.restore();
    }

    // Grip
    ctx.fillStyle = '#334155';
    this.roundRect(ctx, -3, -3, 9, 6, 2);
    ctx.fill();

    // Shaft
    ctx.shadowColor = c.colorTheme.stickGlow;
    ctx.shadowBlur = 10;
    const stickGrad = ctx.createLinearGradient(0, 0, c.stickLength, 0);
    stickGrad.addColorStop(0, '#94a3b8');
    stickGrad.addColorStop(0.35, c.colorTheme.stickColor);
    stickGrad.addColorStop(1, '#ffffff');
    ctx.fillStyle = stickGrad;
    this.roundRect(ctx, 4, -3, c.stickLength, 6, 3);
    ctx.fill();

    // Tip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.stickLength + 2, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.roundRect(ctx, c.w - 6, 16, 7, 13 + armSwing, 3);
    ctx.fill();

    ctx.restore();

    const isTelegraphing = c.attackPhase === 'windup' || c.attackPhase === 'strike';
    this.drawNameLabel(
      ctx,
      c.name,
      c.x + c.w / 2,
      c.y,
      c.colorTheme.primary,
      c.colorTheme.labelBg,
      isTelegraphing
    );
  }

  private drawCoins(ctx: CanvasRenderingContext2D) {
    for (const c of this.coins) {
      const wobble = Math.sin(c.phase) * 3;
      const sx = Math.abs(Math.cos(c.phase * 1.5));
      ctx.save();
      ctx.translate(c.x, c.y + wobble);
      ctx.shadowColor = '#ffd633';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * (0.4 + sx * 0.6), c.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * (0.2 + sx * 0.35), c.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(180,120,0,0.5)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (sx > 0.5) ctx.fillText('T', 0, 0);
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `${p.color}${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
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
