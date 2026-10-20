export type GameState = 'ready' | 'running' | 'paused' | 'gameover';

export interface EngineCallbacks {
  onStateChange: (state: GameState) => void;
  onScore: (score: number, coins: number) => void;
  onGameOver: (score: number, coins: number, best: number) => void;
  onReady?: () => void;
}

export interface Player {
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  onGround: boolean;
  jumpsLeft: number;
  runFrame: number;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'block' | 'tall' | 'spike';
  scored: boolean;
}

export interface Coin {
  x: number;
  y: number;
  r: number;
  collected: boolean;
  phase: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}
