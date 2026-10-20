import { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/game/engine';
import type { GameState } from '@/game/types';
import {
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Coins,
  Trophy,
  Gamepad2,
  ArrowUp,
} from 'lucide-react';

export default function TMDash() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [state, setState] = useState<GameState>('ready');
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [best, setBest] = useState(0);
  const [totalCoins, setTotalCoins] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [isNewBest, setIsNewBest] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onStateChange: setState,
      onScore: (s, c) => {
        setScore(s);
        setCoins(c);
      },
      onGameOver: (_s, _c, b) => {
        setBest(b);
        setTotalCoins(engine.getTotalCoins());
        setIsNewBest(_s >= b && _s > 0);
      },
      onReady: () => {
        setBest(engine.getBest());
        setTotalCoins(engine.getTotalCoins());
      },
    });
    engineRef.current = engine;
    setBest(engine.getBest());
    setTotalCoins(engine.getTotalCoins());

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // start render loop in 'ready' state for animated idle background
    requestAnimationFrame(() => {
      engine.resize();
      engine.idleRender();
    });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      engine.destroy();
    };
  }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.start();
    setIsNewBest(false);
  }, []);

  const handleRestart = useCallback(() => {
    engineRef.current?.restart();
    setIsNewBest(false);
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleJump = useCallback(() => {
    if (state === 'ready') {
      handleStart();
      return;
    }
    if (state === 'gameover') {
      handleRestart();
      return;
    }
    engineRef.current?.jump();
  }, [state, handleStart, handleRestart]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    engineRef.current?.setSoundEnabled(next);
  }, [soundOn]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (state === 'paused') return;
        handleJump();
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        if (state === 'running' || state === 'paused') handlePause();
      } else if (e.code === 'Enter') {
        if (state === 'ready') handleStart();
        else if (state === 'gameover') handleRestart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, handleJump, handlePause, handleStart, handleRestart]);

  // prevent touch scrolling / pinch over the game
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const prevent = (e: TouchEvent) => {
      e.preventDefault();
    };
    el.addEventListener('touchstart', prevent, { passive: false });
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => {
      el.removeEventListener('touchstart', prevent);
      el.removeEventListener('touchmove', prevent);
    };
  }, []);

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="min-h-screen w-full bg-[#05070f] text-white flex flex-col items-center justify-center px-3 py-4 select-none overflow-hidden">
      {/* ambient glow */}
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-fuchsia-500/10 blur-[120px] rounded-full" />
      </div>

      <header className="relative z-10 mb-2 flex items-center gap-2">
        <Gamepad2 className="w-7 h-7 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[0.2em]">
          <span className="text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.8)]">TM</span>{' '}
          <span className="text-fuchsia-400 drop-shadow-[0_0_12px_rgba(232,121,249,0.8)]">DASH</span>
        </h1>
      </header>

      {/* HUD */}
      <div className="relative z-10 w-full max-w-[900px] flex items-center justify-between px-2 mb-1.5 text-sm font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-cyan-300">
            <span className="text-cyan-500/70 text-xs">SCORE</span>
            <span className="text-lg font-bold tabular-nums drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {fmt(score)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-amber-300">
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="font-bold tabular-nums">{coins}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-fuchsia-300">
            <Trophy className="w-4 h-4 text-fuchsia-400" />
            <span className="font-bold tabular-nums">{fmt(best)}</span>
          </span>
          <button
            onClick={toggleSound}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          >
            {soundOn ? (
              <Volume2 className="w-4 h-4 text-cyan-300" />
            ) : (
              <VolumeX className="w-4 h-4 text-white/50" />
            )}
          </button>
          {state === 'running' && (
            <button
              onClick={handlePause}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
              aria-label="Pause"
            >
              <Pause className="w-4 h-4 text-white" />
            </button>
          )}
          {state === 'paused' && (
            <button
              onClick={handlePause}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
              aria-label="Resume"
            >
              <Play className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Game stage */}
      <div
        ref={wrapRef}
        className="relative z-10 w-full max-w-[900px] aspect-[900/360] rounded-2xl overflow-hidden border border-cyan-500/30 shadow-[0_0_40px_rgba(34,211,238,0.15)] touch-none bg-[#070b1a]"
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {/* Start screen */}
        {state === 'ready' && (
          <Overlay>
            <div className="text-center px-6">
              <div className="text-5xl mb-3 font-extrabold tracking-widest">
                <span className="text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.9)]">TM</span>{' '}
                <span className="text-fuchsia-400 drop-shadow-[0_0_20px_rgba(232,121,249,0.9)]">DASH</span>
              </div>
              <p className="text-white/70 mb-5 text-sm max-w-xs mx-auto">
                Run, jump and grab coins. Survive as long as you can — the world speeds up the further you go.
              </p>
              <NeonButton onClick={handleStart} variant="cyan">
                <Play className="w-5 h-5" /> PLAY
              </NeonButton>
              <div className="mt-5 text-xs text-white/50 font-mono space-y-1">
                <p>SPACE / ↑ / TAP to jump (double-jump in air)</p>
                <p>P or ESC to pause</p>
              </div>
            </div>
          </Overlay>
        )}

        {/* Paused */}
        {state === 'paused' && (
          <Overlay>
            <div className="text-center">
              <div className="text-3xl font-extrabold tracking-widest text-cyan-300 mb-4 drop-shadow-[0_0_16px_rgba(34,211,238,0.7)]">
                PAUSED
              </div>
              <NeonButton onClick={handlePause} variant="cyan">
                <Play className="w-5 h-5" /> RESUME
              </NeonButton>
              <div className="mt-3">
                <NeonButton onClick={handleRestart} variant="muted" small>
                  <RotateCcw className="w-4 h-4" /> Restart
                </NeonButton>
              </div>
            </div>
          </Overlay>
        )}

        {/* Game over */}
        {state === 'gameover' && (
          <Overlay>
            <div className="text-center px-6">
              <div className="text-3xl font-extrabold tracking-widest text-rose-400 mb-2 drop-shadow-[0_0_16px_rgba(251,113,133,0.8)]">
                GAME OVER
              </div>
              {isNewBest && (
                <div className="text-amber-300 text-sm font-bold mb-2 animate-pulse flex items-center justify-center gap-1.5">
                  <Trophy className="w-4 h-4" /> NEW BEST!
                </div>
              )}
              <div className="flex justify-center gap-6 mb-5 font-mono">
                <div>
                  <div className="text-xs text-white/50">SCORE</div>
                  <div className="text-2xl font-bold text-cyan-300">{fmt(score)}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">COINS</div>
                  <div className="text-2xl font-bold text-amber-300">{coins}</div>
                </div>
                <div>
                  <div className="text-xs text-white/50">BEST</div>
                  <div className="text-2xl font-bold text-fuchsia-300">{fmt(best)}</div>
                </div>
              </div>
              <NeonButton onClick={handleRestart} variant="cyan">
                <RotateCcw className="w-5 h-5" /> PLAY AGAIN
              </NeonButton>
            </div>
          </Overlay>
        )}
      </div>

      {/* Mobile jump button */}
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          handleJump();
        }}
        className="md:hidden mt-3 z-10 w-20 h-20 rounded-full bg-cyan-500/20 border-2 border-cyan-400/60 text-cyan-200 flex items-center justify-center active:bg-cyan-500/40 active:scale-95 transition shadow-[0_0_30px_rgba(34,211,238,0.4)]"
        aria-label="Jump"
      >
        <ArrowUp className="w-9 h-9" />
      </button>

      <p className="hidden md:block relative z-10 mt-3 text-xs text-white/40 font-mono">
        Press SPACE or click the game to jump
      </p>

      <div className="relative z-10 mt-2 text-[11px] text-white/30 font-mono">
        Total coins collected: {totalCoins}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_0.2s_ease]">
      {children}
    </div>
  );
}

function NeonButton({
  children,
  onClick,
  variant = 'cyan',
  small = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'cyan' | 'fuchsia' | 'muted';
  small?: boolean;
}) {
  const styles = {
    cyan: 'border-cyan-400/70 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:bg-cyan-400/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)]',
    fuchsia: 'border-fuchsia-400/70 text-fuchsia-200 shadow-[0_0_24px_rgba(232,121,249,0.35)] hover:bg-fuchsia-400/20',
    muted: 'border-white/30 text-white/80 hover:bg-white/10',
  }[variant];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 ${small ? 'px-4 py-2 text-sm' : 'px-7 py-3 text-base'} font-bold tracking-wider rounded-xl border-2 bg-white/5 transition active:scale-95 ${styles}`}
    >
      {children}
    </button>
  );
}
