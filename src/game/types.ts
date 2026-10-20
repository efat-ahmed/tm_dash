export type GameState = 'ready' | 'running' | 'paused' | 'gameover';

export interface EngineCallbacks {
  onStateChange: (state: GameState) => void;
  onScore: (score: number, coins: number) => void;
  onGameOver: (score: number, coins: number, best: number) => void;
  onReady?: () => void;
  onTimeOfDayChange?: (timeOfDay: string) => void;
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

export type ObstacleType =
  | 'block'
  | 'tall'
  | 'spike'
  | 'driftwood'
  | 'rock'
  | 'beachball'
  | 'sandmound'
  | 'umbrella';

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: ObstacleType;
  scored: boolean;
  rotation?: number; // for rolling beachball
  colorIndex?: number;
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

export type AttackPhase = 'idle' | 'windup' | 'strike' | 'recovery';

export interface Chaser {
  id: 'EFOT' | 'DADA';
  name: string;
  x: number;
  baseX: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  onGround: boolean;
  runFrame: number;
  colorTheme: {
    primary: string;
    secondary: string;
    visor: string;
    glow: string;
    labelBg: string;
    stickColor: string;
    stickGlow: string;
  };
  attackPhase: AttackPhase;
  phaseTimer: number; // countdown timer for current attack phase in seconds
  attackCooldown: number; // countdown until next attack can start
  stickAngle: number; // radians
  stickLength: number;
  lungeX: number; // temporary forward surge during strike
}

export interface ScooterRider {
  id: 'HM' | 'CM';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  vy: number;
  onGround: boolean;
  wheelRotation: number;
  bobPhase: number;
  active: boolean;
  spawnCooldown: number;
  colorTheme: {
    rider: string;
    shirt: string;
    scooter: string;
    wheels: string;
    accent: string;
    labelColor: string;
    labelBg: string;
  };
}
