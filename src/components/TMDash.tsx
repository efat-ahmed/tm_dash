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
  Sun,
  Sunset,
  Moon,
  Sunrise,
  ArrowUp,
  Waves,
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
  const [timeOfDay, setTimeOfDay] = useState<string>('Daytime');
  const bestRef = useRef(0);
  const lastTouchTime = useRef(0);

  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onStateChange: setState,
      onScore: (s, c) => {
        setScore(s);
        setCoins(c);
      },
      onGameOver: (_s, _c, b) => {
        setIsNewBest(_s > bestRef.current && _s > 0);
        setBest(b);
        setTotalCoins(engine.getTotalCoins());
      },
      onReady: () => {
        setBest(engine.getBest());
        setTotalCoins(engine.getTotalCoins());
      },
      onTimeOfDayChange: (tod) => {
        setTimeOfDay(tod);
      },
    });
    engineRef.current = engine;
    setBest(engine.getBest());
    setTotalCoins(engine.getTotalCoins());

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // Initial render loop for animated idle background on start screen
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

  // Update time of day periodically from engine
  useEffect(() => {
    if (state !== 'running') return;
    const timer = setInterval(() => {
      if (engineRef.current) {
        setTimeOfDay(engineRef.current.getTimeOfDayName());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  const handleStart = useCallback(() => {
    engineRef.current?.resumeAudio();
    engineRef.current?.start();
    setIsNewBest(false);
  }, []);

  const handleRestart = useCallback(() => {
    engineRef.current?.resumeAudio();
    engineRef.current?.restart();
    setIsNewBest(false);
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleJump = useCallback(() => {
    engineRef.current?.resumeAudio();
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

  // Debounced input to avoid double-triggering across touchstart and pointerdown
  const handleTouchJump = useCallback(() => {
    const now = performance.now();
    if (now - lastTouchTime.current < 90) return;
    lastTouchTime.current = now;
    handleJump();
  }, [handleJump]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    engineRef.current?.setSoundEnabled(next);
  }, [soundOn]);

  // Handle visibility change: safely pause when app is switched to background
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && state === 'running') {
        engineRef.current?.togglePause();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [state]);

  // Keyboard controls
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

  // Mobile direct touch on canvas
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      e.preventDefault();
      handleTouchJump();
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [handleTouchJump]);

  const fmt = (n: number) => n.toLocaleString();

  // Time of day icon
  const renderTimeIcon = () => {
    switch (timeOfDay) {
      case 'Sunrise':
        return <Sunrise className="w-3.5 h-3.5 text-amber-300" />;
      case 'Sunset':
        return <Sunset className="w-3.5 h-3.5 text-orange-400" />;
      case 'Night':
        return <Moon className="w-3.5 h-3.5 text-indigo-300" />;
      default:
        return <Sun className="w-3.5 h-3.5 text-yellow-300" />;
    }
  };

  return (
    <div
      className="relative w-full h-[100dvh] max-h-[100dvh] bg-[#050b14] text-white flex flex-col justify-between items-center px-2 sm:px-4 py-1.5 sm:py-2 select-none overflow-hidden touch-none"
      style={{
        paddingTop: 'max(0.4rem, var(--sat))',
        paddingBottom: 'max(0.4rem, var(--sab))',
        paddingLeft: 'max(0.5rem, var(--sal))',
        paddingRight: 'max(0.5rem, var(--sar))',
      }}
    >
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 opacity-40">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-500/10 blur-[130px] rounded-full" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-cyan-500/10 blur-[130px] rounded-full" />
      </div>

      {/* Header bar */}
      <header className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-1 py-0.5">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Waves className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <h1 className="text-lg sm:text-2xl font-extrabold tracking-wider">
            <span className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">TM</span>{' '}
            <span className="text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">DASH</span>
            <span className="hidden sm:inline-block ml-2 text-xs font-mono font-normal text-amber-300/70 border border-amber-400/30 px-2 py-0.5 rounded-full">
              BEACH RUNNER
            </span>
          </h1>
        </div>

        {/* Character badges */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono">
          <span className="text-white/40 text-[10px] uppercase">Roster:</span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-400/50 text-cyan-300 font-bold">TM</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-orange-400/50 text-orange-400 font-bold">EFOT</span>
          <span className="px-1.5 py-0.5 rounded bg-purple-950/80 border border-fuchsia-400/50 text-fuchsia-300 font-bold">DADA</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold">HM</span>
          <span className="px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-400/50 text-rose-300 font-bold">CM</span>
        </div>

        {/* Time of Day Badge */}
        <div className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
          {renderTimeIcon()}
          <span className="capitalize text-white/90 font-medium">{timeOfDay}</span>
        </div>
      </header>

      {/* HUD Bar */}
      <div className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-2 text-xs sm:text-sm font-mono my-0.5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="text-cyan-500/70 text-[11px]">SCORE</span>
            <span className="text-base sm:text-lg font-bold tabular-nums drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]">
              {fmt(score)}
            </span>
          </span>
          <span className="flex items-center gap-1 text-amber-300">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold tabular-nums">{coins}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-1 text-fuchsia-300">
            <Trophy className="w-3.5 h-3.5 text-fuchsia-400" />
            <span className="font-bold tabular-nums">{fmt(best)}</span>
          </span>
          <button
            onClick={toggleSound}
            className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95"
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          >
            {soundOn ? (
              <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-300" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/50" />
            )}
          </button>
          {state === 'running' && (
            <button
              onClick={handlePause}
              className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95"
              aria-label="Pause"
            >
              <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </button>
          )}
          {state === 'paused' && (
            <button
              onClick={handlePause}
              className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95"
              aria-label="Resume"
            >
              <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Main Game Stage Container */}
      <div
        ref={wrapRef}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button')) return;
          handleTouchJump();
        }}
        className="relative z-10 w-full max-w-[1000px] flex-1 max-h-[calc(100dvh-130px)] aspect-[900/360] rounded-2xl overflow-hidden border border-amber-500/30 shadow-[0_0_40px_rgba(251,191,36,0.15)] touch-none bg-[#091524] cursor-pointer mx-auto flex items-center justify-center"
      >
        <canvas ref={canvasRef} className="block w-full h-full object-contain" />

        {/* Start screen */}
        {state === 'ready' && (
          <Overlay>
            <div className="text-center px-4 sm:px-6 max-w-md">
              <div className="text-3xl sm:text-5xl mb-2 font-extrabold tracking-widest">
                <span className="text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.9)]">TM</span>{' '}
                <span className="text-amber-400 drop-shadow-[0_0_20px_rgba(251,191,36,0.9)]">DASH</span>
              </div>
              <p className="text-white/85 mb-2.5 text-xs sm:text-sm leading-relaxed">
                Run along the tropical beach as <strong className="text-cyan-300">TM</strong>! Dodge driftwood, rolling beach balls & rocks while outrunning <strong className="text-orange-400">EFOT</strong> & <strong className="text-fuchsia-400">DADA</strong> and waving to scooter riders <strong className="text-emerald-300">HM</strong> & <strong className="text-rose-300">CM</strong>!
              </p>
              <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-200 text-[11px] sm:text-xs font-mono">
                <span>⚠️ When you see <strong className="text-white">! SWING</strong>, jump to dodge the stick!</span>
              </div>
              <div>
                <NeonButton onClick={handleStart} variant="cyan">
                  <Play className="w-5 h-5" /> PLAY BEACH DASH
                </NeonButton>
              </div>
              <div className="mt-3 text-[11px] sm:text-xs text-white/50 font-mono space-y-0.5">
                <p>SPACE / ↑ / TAP to jump (double-jump in air)</p>
                <p>P or ESC to pause</p>
              </div>
            </div>
          </Overlay>
        )}

        {/* Paused */}
        {state === 'paused' && (
          <Overlay>
            <div className="text-center px-4">
              <div className="text-2xl sm:text-3xl font-extrabold tracking-widest text-cyan-300 mb-3 drop-shadow-[0_0_16px_rgba(34,211,238,0.7)]">
                PAUSED
              </div>
              <div className="mb-2 text-xs font-mono text-white/70">
                Current Time: <span className="text-amber-300 font-bold">{timeOfDay}</span>
              </div>
              <NeonButton onClick={handlePause} variant="cyan">
                <Play className="w-5 h-5" /> RESUME
              </NeonButton>
              <div className="mt-2.5">
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
            <div className="text-center px-4 sm:px-6 max-w-sm">
              <div className="text-2xl sm:text-3xl font-extrabold tracking-widest text-rose-400 mb-1.5 drop-shadow-[0_0_16px_rgba(251,113,133,0.8)]">
                GAME OVER
              </div>
              {isNewBest && (
                <div className="text-amber-300 text-xs sm:text-sm font-bold mb-2 animate-pulse flex items-center justify-center gap-1.5">
                  <Trophy className="w-4 h-4" /> NEW BEACH BEST!
                </div>
              )}
              <div className="flex justify-center gap-4 sm:gap-6 mb-4 font-mono">
                <div>
                  <div className="text-[10px] text-white/50">SCORE</div>
                  <div className="text-xl sm:text-2xl font-bold text-cyan-300">{fmt(score)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/50">COINS</div>
                  <div className="text-xl sm:text-2xl font-bold text-amber-300">{coins}</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/50">BEST</div>
                  <div className="text-xl sm:text-2xl font-bold text-fuchsia-300">{fmt(best)}</div>
                </div>
              </div>
              <NeonButton onClick={handleRestart} variant="cyan">
                <RotateCcw className="w-5 h-5" /> PLAY AGAIN
              </NeonButton>
            </div>
          </Overlay>
        )}
      </div>

      {/* Footer / Mobile Controls */}
      <footer className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-2 pt-1 pb-0.5">
        <div className="text-[11px] text-white/40 font-mono">
          Total Coins: <span className="text-amber-400 font-bold">{totalCoins}</span>
        </div>

        {/* Mobile On-Screen Jump Button */}
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            handleTouchJump();
          }}
          className="md:hidden w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-cyan-500/25 border-2 border-cyan-400/70 text-cyan-100 flex flex-col items-center justify-center active:bg-cyan-500/50 active:scale-95 transition shadow-[0_0_24px_rgba(34,211,238,0.5)] touch-none cursor-pointer"
          aria-label="Jump"
        >
          <ArrowUp className="w-7 h-7" />
          <span className="text-[9px] font-bold tracking-wider -mt-1 font-mono">JUMP</span>
        </button>

        <p className="hidden md:block text-xs text-white/40 font-mono">
          SPACE / ↑ to jump • Jump over stick attacks
        </p>
      </footer>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease]">
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
    cyan: 'border-cyan-400/70 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:bg-cyan-400/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)]',
    fuchsia: 'border-fuchsia-400/70 text-fuchsia-200 shadow-[0_0_24px_rgba(232,121,249,0.35)] hover:bg-fuchsia-400/20',
    muted: 'border-white/30 text-white/80 hover:bg-white/10',
  }[variant];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 ${small ? 'px-4 py-1.5 text-xs' : 'px-6 py-2.5 text-sm sm:text-base'} font-bold tracking-wider rounded-xl border-2 bg-white/5 transition active:scale-95 ${styles} cursor-pointer`}
    >
      {children}
    </button>
  );
}
