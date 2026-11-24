type SoundName =
  | 'jump'
  | 'coin'
  | 'crash'
  | 'click'
  | 'start'
  | 'warning'
  | 'swing'
  | 'whack'
  | 'beep'
  | 'splash';

const MAX_VOICES = 10;
const MASTER_VOLUME = 0.25;

const SOUND_COOLDOWN_MS: Record<SoundName, number> = {
  jump: 45,
  coin: 40,
  crash: 200,
  click: 40,
  start: 100,
  warning: 150,
  swing: 120,
  whack: 120,
  beep: 150,
  splash: 120,
};

// Module-level shared Web Audio resources so remounts (e.g., React StrictMode)
// reuse a single AudioContext instead of hitting browser context limits (~6).
let sharedCtx: AudioContext | null = null;
let sharedMaster: GainNode | null = null;
let sharedCrashBuf: AudioBuffer | null = null;
let sharedSplashBuf: AudioBuffer | null = null;
let sharedWhackBuf: AudioBuffer | null = null;
let activeManagers = 0;

function getOrCreateAudioGraph(): {
  ctx: AudioContext;
  master: GainNode;
} | null {
  if (typeof window === 'undefined') return null;

  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
    sharedMaster = sharedCtx.createGain();
    sharedMaster.gain.value = MASTER_VOLUME;
    sharedMaster.connect(sharedCtx.destination);
    initNoiseBuffers(sharedCtx);
  }

  if (!sharedMaster) {
    sharedMaster = sharedCtx.createGain();
    sharedMaster.gain.value = MASTER_VOLUME;
    sharedMaster.connect(sharedCtx.destination);
  }

  return { ctx: sharedCtx, master: sharedMaster };
}

function initNoiseBuffers(ctx: AudioContext) {
  const sr = ctx.sampleRate;

  const crashLen = Math.max(1, Math.floor(sr * 0.4));
  const crash = ctx.createBuffer(1, crashLen, sr);
  const crashData = crash.getChannelData(0);
  for (let i = 0; i < crashLen; i++) {
    crashData[i] = (Math.random() * 2 - 1) * (1 - i / crashLen);
  }
  sharedCrashBuf = crash;

  const splashLen = Math.max(1, Math.floor(sr * 0.25));
  const splash = ctx.createBuffer(1, splashLen, sr);
  const splashData = splash.getChannelData(0);
  for (let i = 0; i < splashLen; i++) {
    splashData[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (splashLen * 0.35));
  }
  sharedSplashBuf = splash;

  const whackLen = Math.max(1, Math.floor(sr * 0.15));
  const whack = ctx.createBuffer(1, whackLen, sr);
  const whackData = whack.getChannelData(0);
  for (let i = 0; i < whackLen; i++) {
    whackData[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (whackLen * 0.2));
  }
  sharedWhackBuf = whack;
}

export class SoundManager {
  enabled = true;
  private disposed = false;
  private activeVoices = 0;
  private lastPlayed: Partial<Record<SoundName, number>> = {};

  constructor() {
    activeManagers++;
  }

  private ensure(): { ctx: AudioContext; master: GainNode } | null {
    if (this.disposed) return null;
    const graph = getOrCreateAudioGraph();
    if (!graph) return null;

    const { ctx, master } = graph;
    master.gain.value = this.enabled ? MASTER_VOLUME : 0;

    const state = ctx.state as string;
    if (this.enabled && (state === 'suspended' || state === 'interrupted')) {
      void ctx.resume().catch(() => {
        /* waiting for user gesture */
      });
    }
    return graph;
  }

  resume() {
    if (!this.enabled || this.disposed) return;
    this.ensure();
  }

  suspend() {
    if (sharedCtx && sharedCtx.state === 'running') {
      void sharedCtx.suspend().catch(() => {
        /* ignore if unable to suspend */
      });
    }
  }

  setEnabled(next: boolean) {
    this.enabled = next;
    if (sharedMaster) {
      sharedMaster.gain.value = next ? MASTER_VOLUME : 0;
    }
    if (next) {
      this.resume();
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeVoices = 0;
    this.lastPlayed = {};
    activeManagers = Math.max(0, activeManagers - 1);
    if (activeManagers === 0 && sharedCtx && sharedCtx.state === 'running') {
      void sharedCtx.suspend().catch(() => {
        /* ignore */
      });
    }
  }

  private trackVoice(source: AudioScheduledSourceNode, gain: GainNode) {
    this.activeVoices++;
    source.onended = () => {
      source.onended = null;
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
  }

  play(name: SoundName) {
    if (!this.enabled || this.disposed) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const nowMs = performance.now();
    const prevMs = this.lastPlayed[name];
    if (prevMs !== undefined && nowMs - prevMs < SOUND_COOLDOWN_MS[name]) return;
    if (this.activeVoices >= MAX_VOICES) return;

    const graph = this.ensure();
    if (!graph) return;
    const { ctx, master } = graph;
    if (ctx.state === 'closed') return;

    // Avoid queuing background/AI sounds before user interaction unlocks audio
    if (
      ctx.state !== 'running' &&
      name !== 'start' &&
      name !== 'jump' &&
      name !== 'click'
    ) {
      return;
    }

    this.lastPlayed[name] = nowMs;
    const now = ctx.currentTime;

    if (name === 'crash') {
      if (!sharedCrashBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = sharedCrashBuf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      src.connect(g);
      g.connect(master);
      this.trackVoice(src, g);
      src.start(now);
      return;
    }

    if (name === 'splash') {
      if (!sharedSplashBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = sharedSplashBuf;
      const splashGain = ctx.createGain();
      splashGain.gain.setValueAtTime(0.3, now);
      splashGain.gain.exponentialRampToValueAtTime(0.01, now + 0.24);
      src.connect(splashGain);
      splashGain.connect(master);
      this.trackVoice(src, splashGain);
      src.start(now);
      return;
    }

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(master);
    this.trackVoice(osc, g);

    if (name === 'jump') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.12);
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (name === 'coin') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1320, now + 0.06);
      g.gain.setValueAtTime(0.45, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (name === 'click') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(420, now);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.09);
    } else if (name === 'start') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.3);
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.36);
    } else if (name === 'warning') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.linearRampToValueAtTime(1100, now + 0.08);
      osc.frequency.setValueAtTime(700, now + 0.1);
      osc.frequency.linearRampToValueAtTime(1300, now + 0.18);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (name === 'swing') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.22);
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (name === 'whack') {
      if (sharedWhackBuf && this.activeVoices < MAX_VOICES) {
        const src = ctx.createBufferSource();
        src.buffer = sharedWhackBuf;
        const strikeGain = ctx.createGain();
        strikeGain.gain.setValueAtTime(0.9, now);
        strikeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        src.connect(strikeGain);
        strikeGain.connect(master);
        this.trackVoice(src, strikeGain);
        src.start(now);
      }

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
      g.gain.setValueAtTime(0.6, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.19);
    } else if (name === 'beep') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.setValueAtTime(860, now + 0.07);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.17);
    }
  }
}
