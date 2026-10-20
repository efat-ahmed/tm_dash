import type { Coin, EngineCallbacks, GameState, Obstacle, Particle, Player } from './types';
import { SoundManager } from './sound';

const BEST_KEY = 'tmdash_best';
const COIN_KEY = 'tmdash_coins_total';

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private sound: SoundManager;

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private state: GameState = 'ready';

  // Logical world size — game renders to this fixed virtual width/height,
  // then letterboxes to fit any device.
  readonly W = 900;
  readonly H = 360;
  private groundY: number;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;

  private player: Player;
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

  private bgOffset = 0;
  private starOffset = 0;
  private gridOffset = 0;
  private shake = 0;
  private flash = 0;
  private timeAlive = 0;

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.cb = cb;
    this.sound = new SoundManager();

    this.groundY = this.H - 64;
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

    this.resize();
  }

  // ---- public API ----

  start() {
    this.reset();
    this.setState('running');
    this.sound.resume();
    this.sound.play('start');
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.loop(this.lastTime);
  }

  idleRender() {
    // animate the background slowly while on the start screen
    if (this.state !== 'ready') return;
    this.bgOffset = (this.bgOffset + 0.6) % 300;
    this.starOffset = (this.starOffset + 0.15) % 900;
    this.gridOffset = (this.gridOffset + 2) % 60;
    this.render();
    if (this.state === 'ready') {
      requestAnimationFrame(() => this.idleRender());
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
    // dust burst
    this.spawnDust(this.player.x, this.groundY, 8);
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

    // fit virtual world into container with "contain" letterboxing
    const sx = cw / this.W;
    const sy = ch / this.H;
    this.scale = Math.min(sx, sy);
    this.offsetX = (cw - this.W * this.scale) / 2;
    this.offsetY = (ch - this.H * this.scale) / 2;
  }

  // ---- internal ----

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
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp big frame gaps
    if (this.state === 'running') {
      this.update(dt);
    }
    this.render();
  };

  private update(dt: number) {
    const step = dt * 60; // normalize to ~60fps units
    this.timeAlive += dt;

    // difficulty ramp
    this.speed = Math.min(
      this.maxSpeed,
      this.baseSpeed + this.distance * 0.0012
    );
    this.distance += this.speed * step;
    this.score = Math.floor(this.distance / 6);
    this.cb.onScore(this.score, this.coinCount);

    // player physics
    const gravity = 0.75;
    this.player.vy += gravity * step;
    this.player.y += this.player.vy * step;
    if (this.player.y >= this.groundY - this.player.h) {
      this.player.y = this.groundY - this.player.h;
      if (!this.player.onGround) this.spawnDust(this.player.x, this.groundY, 5);
      this.player.vy = 0;
      this.player.onGround = true;
      this.player.jumpsLeft = 2;
    }
    this.player.runFrame += step * 0.4;

    // background scroll
    this.bgOffset = (this.bgOffset + this.speed * step * 0.2) % 300;
    this.starOffset = (this.starOffset + this.speed * step * 0.05) % 900;
    this.gridOffset = (this.gridOffset + this.speed * step) % 60;

    // spawn obstacles
    this.spawnTimer += step;
    if (this.spawnTimer >= this.nextSpawn) {
      this.spawnTimer = 0;
      this.nextSpawn = this.randomSpawnGap();
      this.spawnObstacle();
    }

    // spawn coins
    this.coinTimer += step;
    if (this.coinTimer >= this.nextCoin) {
      this.coinTimer = 0;
      this.nextCoin = 90 + Math.random() * 140;
      this.spawnCoinPattern();
    }

    // move obstacles
    for (const o of this.obstacles) {
      o.x -= this.speed * step;
    }
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -20);

    // move coins
    for (const c of this.coins) {
      c.x -= this.speed * step;
      c.phase += step * 0.15;
    }
    this.coins = this.coins.filter((c) => !c.collected && c.x + c.r > -20);

    // move particles
    for (const p of this.particles) {
      p.vy += p.gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.life -= step;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // collisions
    this.checkCollisions();

    // decay effects
    if (this.shake > 0) this.shake = Math.max(0, this.shake - step * 1.5);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - step * 0.05);

    // running dust
    if (this.player.onGround && Math.random() < 0.08 * step) {
      this.spawnDust(this.player.x, this.groundY, 1);
    }
  }

  private randomSpawnGap(): number {
    // gap shrinks as speed grows
    const base = 110 - (this.speed - this.baseSpeed) * 4;
    return Math.max(55, base + Math.random() * 60);
  }

  private spawnObstacle() {
    const r = Math.random();
    let type: Obstacle['type'];
    let w: number;
    let h: number;
    if (r < 0.45) {
      type = 'block';
      w = 34 + Math.random() * 20;
      h = 36 + Math.random() * 18;
    } else if (r < 0.75) {
      type = 'spike';
      w = 28;
      h = 34;
    } else {
      type = 'tall';
      w = 30;
      h = 60 + Math.random() * 20;
    }
    this.obstacles.push({
      x: this.W + 20,
      y: this.groundY - h,
      w,
      h,
      type,
      scored: false,
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

  private spawnDust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y - Math.random() * 6,
        vx: -this.speed * 0.3 + (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2,
        life: 18 + Math.random() * 12,
        maxLife: 30,
        size: 2 + Math.random() * 3,
        color: 'rgba(120,220,255,',
        gravity: 0.05,
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

  private checkCollisions() {
    const p = this.player;
    const pad = 6; // forgiving hitbox
    const px = p.x + pad;
    const py = p.y + pad;
    const pw = p.w - pad * 2;
    const ph = p.h - pad * 2;

    for (const o of this.obstacles) {
      let ox = o.x + 4;
      let oy = o.y + 4;
      let ow = o.w - 8;
      let oh = o.h - 8;
      if (o.type === 'spike') {
        // triangle-ish: shrink horizontally
        ox = o.x + 8;
        ow = o.w - 16;
      }
      if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) {
        this.die();
        return;
      }
    }

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

  // ---- rendering ----

  private render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // shake
    if (this.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake
      );
    }

    this.drawBackground(ctx);
    this.drawGround(ctx);
    this.drawCoins(ctx);
    this.drawObstacles(ctx);
    this.drawParticles(ctx);
    this.drawPlayer(ctx);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,60,80,${this.flash * 0.4})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#070b1a');
    g.addColorStop(0.5, '#0c1230');
    g.addColorStop(1, '#101a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // stars
    ctx.fillStyle = 'rgba(180,210,255,0.7)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 73 - this.starOffset) % this.W;
      const x = sx < 0 ? sx + this.W : sx;
      const y = (i * 37) % (this.groundY - 80);
      const tw = 0.5 + ((i * 13) % 10) / 10;
      ctx.globalAlpha = 0.3 + tw * 0.5;
      ctx.fillRect(x, y, tw * 2, tw * 2);
    }
    ctx.globalAlpha = 1;

    // neon sun
    const sunX = this.W * 0.72;
    const sunY = this.groundY - 120;
    const sg = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 90);
    sg.addColorStop(0, 'rgba(255,120,180,0.9)');
    sg.addColorStop(0.4, 'rgba(255,80,150,0.5)');
    sg.addColorStop(1, 'rgba(255,80,150,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - 90, sunY - 90, 180, 180);

    // sun bars
    ctx.fillStyle = '#0c1230';
    for (let i = 0; i < 6; i++) {
      const yy = sunY + i * 12 - 20;
      ctx.fillRect(sunX - 60, yy, 120, 4 + i);
    }

    // far mountains (parallax)
    ctx.fillStyle = 'rgba(40,60,120,0.5)';
    this.drawMountains(ctx, this.bgOffset * 0.5, this.groundY, 80, 220);
    ctx.fillStyle = 'rgba(60,80,150,0.6)';
    this.drawMountains(ctx, this.bgOffset * 0.9, this.groundY, 60, 150);
  }

  private drawMountains(ctx: CanvasRenderingContext2D, off: number, base: number, height: number, period: number) {
    ctx.beginPath();
    ctx.moveTo(0, base);
    const o = -((off) % period);
    for (let x = o; x <= this.W + period; x += period / 2) {
      const peak = x + period / 4;
      ctx.lineTo(x, base);
      ctx.lineTo(peak, base - height);
    }
    ctx.lineTo(this.W, base);
    ctx.closePath();
    ctx.fill();
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    // ground fill
    ctx.fillStyle = '#0a1028';
    ctx.fillRect(0, this.groundY, this.W, this.H - this.groundY);

    // neon ground line
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.W, this.groundY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // perspective grid
    ctx.strokeStyle = 'rgba(0,229,255,0.25)';
    ctx.lineWidth = 1;
    const gy = this.groundY;
    const gh = this.H - gy;
    // horizontal lines
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      const y = gy + gh * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.W, y);
      ctx.stroke();
    }
    // vertical scrolling lines
    for (let x = -this.gridOffset; x < this.W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      const vx = this.W / 2 + (x - this.W / 2) * 2.2;
      ctx.lineTo(vx, this.H);
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, p.y);

    // glow
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 18;

    // body
    const bodyGrad = ctx.createLinearGradient(0, 0, 0, p.h);
    bodyGrad.addColorStop(0, '#5cff5c');
    bodyGrad.addColorStop(1, '#1faf1f');
    ctx.fillStyle = bodyGrad;
    this.roundRect(ctx, 2, 6, p.w - 4, p.h - 8, 8);
    ctx.fill();

    ctx.shadowBlur = 0;

    // visor
    ctx.fillStyle = '#06280a';
    this.roundRect(ctx, 6, 12, p.w - 12, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#aaffaa';
    ctx.fillRect(8, 14, p.w - 16, 3);

    // legs (running animation)
    ctx.fillStyle = '#0c8a0c';
    const swing = Math.sin(p.runFrame * Math.PI) * (p.onGround ? 6 : 0);
    this.roundRect(ctx, 8, p.h - 10, 9, 12 + swing, 3);
    ctx.fill();
    this.roundRect(ctx, p.w - 17, p.h - 10, 9, 12 - swing, 3);
    ctx.fill();

    // arms
    ctx.fillStyle = '#0c8a0c';
    const armSwing = Math.sin(p.runFrame * Math.PI + Math.PI) * (p.onGround ? 5 : 0);
    this.roundRect(ctx, -3, 16, 7, 14 + armSwing, 3);
    ctx.fill();
    this.roundRect(ctx, p.w - 4, 16, 7, 14 - armSwing, 3);
    ctx.fill();

    ctx.restore();
  }

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    for (const o of this.obstacles) {
      ctx.save();
      if (o.type === 'spike') {
        ctx.shadowColor = '#ff3366';
        ctx.shadowBlur = 14;
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        grad.addColorStop(0, '#ff5577');
        grad.addColorStop(1, '#aa1133');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y + o.h);
        ctx.lineTo(o.x + o.w / 2, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,180,200,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        const color = o.type === 'tall' ? '#ff8800' : '#ffcc00';
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        if (o.type === 'tall') {
          grad.addColorStop(0, '#ffaa33');
          grad.addColorStop(1, '#cc5500');
        } else {
          grad.addColorStop(0, '#ffe34d');
          grad.addColorStop(1, '#cc9900');
        }
        ctx.fillStyle = grad;
        this.roundRect(ctx, o.x, o.y, o.w, o.h, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
        // inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        this.roundRect(ctx, o.x + 3, o.y + 3, o.w - 6, 6, 3);
        ctx.fill();
        // hazard stripes
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 3;
        for (let yy = o.y + 8; yy < o.y + o.h - 4; yy += 10) {
          ctx.beginPath();
          ctx.moveTo(o.x + 2, yy);
          ctx.lineTo(o.x + o.w - 2, yy + 6);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawCoins(ctx: CanvasRenderingContext2D) {
    for (const c of this.coins) {
      const wobble = Math.sin(c.phase) * 3;
      const sx = Math.abs(Math.cos(c.phase * 1.5)); // spin width
      ctx.save();
      ctx.translate(c.x, c.y + wobble);
      ctx.shadowColor = '#ffd633';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * (0.4 + sx * 0.6), c.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * (0.2 + sx * 0.35), c.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // TM star mark
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

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
