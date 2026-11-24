import { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/game/engine';
import type {
  GameState,
  GraphicsQuality,
  PerformanceMetrics,
  QualityMode,
} from '@/game/types';
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
  SlidersHorizontal,
  X,
} from 'lucide-react';

const DEV_PERF_KEY = 'tmdash_dev_perf';

function readDevPerfPref(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '1' || params.get('debug') === '1') return true;
    return window.localStorage?.getItem(DEV_PERF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDevPerfPref(enabled: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (enabled) {
      window.localStorage.setItem(DEV_PERF_KEY, '1');
    } else {
      window.localStorage.removeItem(DEV_PERF_KEY);
    }
  } catch {
    /* ignore blocked storage */
  }
}

const QUALITY_OPTIONS: readonly { mode: QualityMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'high', label: 'High' },
  { mode: 'medium', label: 'Medium' },
  { mode: 'low', label: 'Low' },
];

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityMode, setQualityMode] = useState<QualityMode>('auto');
  const [activeQuality, setActiveQuality] = useState<GraphicsQuality>('high');
  const [renderScale, setRenderScale] = useState(1);
  const [devUnlocked, setDevUnlocked] = useState<boolean>(() => readDevPerfPref());
  const [showPerfOverlay, setShowPerfOverlay] = useState<boolean>(() => readDevPerfPref());
  const [perfMetrics, setPerfMetrics] = useState<PerformanceMetrics | null>(null);

  const bestRef = useRef(0);
  const liveScoreRef = useRef(0);
  const liveCoinsRef = useRef(0);
  const scoreDomRef = useRef<HTMLSpanElement>(null);
  const coinsDomRef = useRef<HTMLSpanElement>(null);
  const activePointersRef = useRef<Set<number>>(new Set());
  const devTapCountRef = useRef(0);
  const devTapTimerRef = useRef(0);

  useEffect(() => {
    bestRef.current = best;
  }, [best]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onStateChange: (nextState) => {
        if (nextState !== 'running') {
          setScore(liveScoreRef.current);
          setCoins(liveCoinsRef.current);
        }
        setState(nextState);
      },
      onScore: (s, c) => {
        liveScoreRef.current = s;
        liveCoinsRef.current = c;
        if (scoreDomRef.current) {
          scoreDomRef.current.textContent = s.toLocaleString();
        }
        if (coinsDomRef.current) {
          coinsDomRef.current.textContent = String(c);
        }
        if (engine.getState() !== 'running') {
          setScore(s);
          setCoins(c);
        }
      },
      onGameOver: (s, c, b) => {
        liveScoreRef.current = s;
        liveCoinsRef.current = c;
        setScore(s);
        setCoins(c);
        setIsNewBest(s > bestRef.current && s > 0);
        setBest(b);
        setTotalCoins(engine.getTotalCoins());
      },
      onReady: () => {
        const nextBest = engine.getBest();
        const nextTotal = engine.getTotalCoins();
        setBest((prev) => (prev === nextBest ? prev : nextBest));
        setTotalCoins((prev) => (prev === nextTotal ? prev : nextTotal));
      },
      onTimeOfDayChange: (tod) => {
        setTimeOfDay((prev) => (prev === tod ? prev : tod));
      },
      onQualityChange: (q) => {
        setActiveQuality((prev) => (prev === q ? prev : q));
        setRenderScale(engine.getEffectiveRenderScale());
      },
      onPerformanceMetrics: (metrics) => {
        setPerfMetrics(metrics);
        setRenderScale(metrics.renderScale);
      },
    });
    engineRef.current = engine;
    setBest(engine.getBest());
    setTotalCoins(engine.getTotalCoins());
    setTimeOfDay(engine.getTimeOfDayName());
    setQualityMode(engine.getQualityMode());
    setActiveQuality(engine.getQuality());
    setRenderScale(engine.getEffectiveRenderScale());

    let resizeRaf = 0;
    let orientationTimer = 0;
    const scheduleResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        engine.resize();
      });
    };
    const onOrientationChange = () => {
      scheduleResize();
      window.clearTimeout(orientationTimer);
      orientationTimer = window.setTimeout(scheduleResize, 150);
    };

    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', onOrientationChange);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleResize);

    let ro: ResizeObserver | null = null;
    if (wrapRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleResize);
      ro.observe(wrapRef.current);
    }

    const initialRaf = requestAnimationFrame(() => {
      engine.resize();
      engine.idleRender();
    });

    const activePointers = activePointersRef.current;

    return () => {
      cancelAnimationFrame(initialRaf);
      cancelAnimationFrame(resizeRaf);
      window.clearTimeout(orientationTimer);
      window.clearTimeout(devTapTimerRef.current);
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      vv?.removeEventListener('resize', scheduleResize);
      ro?.disconnect();
      activePointers.clear();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setMetricsEnabled(showPerfOverlay);
    if (showPerfOverlay) {
      setPerfMetrics(engine.getPerformanceMetrics());
    } else {
      setPerfMetrics(null);
    }
  }, [showPerfOverlay]);

  const handleStart = useCallback(() => {
    engineRef.current?.resumeAudio();
    engineRef.current?.start();
    setIsNewBest(false);
  }, []);

  const handleRestart = useCallback(() => {
    if (engineRef.current && !engineRef.current.canRestart()) return;
    engineRef.current?.resumeAudio();
    engineRef.current?.restart();
    setIsNewBest(false);
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleJump = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.resumeAudio();
    const curState = engine.getState();
    if (curState === 'ready') {
      engine.start();
      setIsNewBest(false);
      return;
    }
    if (curState === 'gameover') {
      if (engine.canRestart()) {
        engine.restart();
        setIsNewBest(false);
      }
      return;
    }
    if (curState === 'running') {
      engine.jump();
    }
  }, []);

  const handleStagePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) return;
      if (activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.add(e.pointerId);
      if (e.pointerType !== 'mouse') {
        e.preventDefault();
      }
      handleJump();
    },
    [handleJump]
  );

  const handleJumpButtonPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.add(e.pointerId);
      handleJump();
    },
    [handleJump]
  );

  const handlePointerRelease = useCallback((e: React.PointerEvent<HTMLElement>) => {
    activePointersRef.current.delete(e.pointerId);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      engineRef.current?.setSoundEnabled(next);
      return next;
    });
  }, []);

  const handleToggleSettings = useCallback(() => {
    setSettingsOpen((prev) => {
      const next = !prev;
      const engine = engineRef.current;
      if (next && engine?.getState() === 'running') {
        engine.togglePause();
      }
      if (engine) {
        setRenderScale(engine.getEffectiveRenderScale());
      }
      return next;
    });
  }, []);

  const handleSelectQualityMode = useCallback((mode: QualityMode) => {
    const engine = engineRef.current;
    setQualityMode(mode);
    if (engine) {
      engine.setQualityMode(mode);
      setActiveQuality(engine.getQuality());
      setRenderScale(engine.getEffectiveRenderScale());
    }
  }, []);

  const toggleDevOverlay = useCallback(() => {
    setDevUnlocked(true);
    setShowPerfOverlay((prev) => {
      const next = !prev;
      writeDevPerfPref(next);
      return next;
    });
  }, []);

  const handleTitleDevTap = useCallback(() => {
    window.clearTimeout(devTapTimerRef.current);
    devTapCountRef.current += 1;
    if (devTapCountRef.current >= 5) {
      devTapCountRef.current = 0;
      toggleDevOverlay();
      return;
    }
    devTapTimerRef.current = window.setTimeout(() => {
      devTapCountRef.current = 0;
    }, 1500);
  }, [toggleDevOverlay]);

  // Page lifecycle: pause gameplay, suspend audio, clear held pointers on hide/blur
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        activePointersRef.current.clear();
      }
      engineRef.current?.handleVisibilityChange(document.hidden);
    };
    const onPageHide = () => {
      activePointersRef.current.clear();
      engineRef.current?.handleVisibilityChange(true);
    };
    const onPageShow = () => {
      engineRef.current?.handleVisibilityChange(document.hidden);
    };
    const onWindowBlur = () => {
      activePointersRef.current.clear();
    };
    const onWindowPointerEnd = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, []);

  // Keyboard controls (reads engine state directly to avoid listener churn)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const isInteractive =
        !!el &&
        (el.tagName === 'BUTTON' ||
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable);
      if (isInteractive && (e.code === 'Space' || e.code === 'Enter')) return;

      const curState = engineRef.current?.getState();
      if (e.code === 'F3' || (e.shiftKey && e.code === 'KeyD')) {
        e.preventDefault();
        if (!e.repeat) toggleDevOverlay();
        return;
      }
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (e.repeat || settingsOpen) return;
        if (curState === 'paused') return;
        handleJump();
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (curState === 'running' || curState === 'paused') handlePause();
      } else if (e.code === 'Enter') {
        if (e.repeat || settingsOpen) return;
        if (curState === 'ready') handleStart();
        else if (curState === 'gameover') handleRestart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleJump, handlePause, handleStart, handleRestart, settingsOpen, toggleDevOverlay]);

  const fmt = (n: number) => n.toLocaleString();

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
      className="relative w-full h-[100dvh] max-h-[100dvh] bg-[#050b14] text-white flex flex-col justify-between items-center px-2 sm:px-4 py-1.5 sm:py-2 select-none overflow-hidden"
      style={{
        paddingTop: 'max(0.4rem, var(--sat))',
        paddingBottom: 'max(0.4rem, var(--sab))',
        paddingLeft: 'max(0.5rem, var(--sal))',
        paddingRight: 'max(0.5rem, var(--sar))',
      }}
    >
      {/* Ambient background glow (cheap CSS radial gradients — no blur filter pass) */}
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 600px 260px at 50% 28%, rgba(245,158,11,0.10), transparent 70%), radial-gradient(ellipse 420px 260px at 25% 95%, rgba(6,182,212,0.10), transparent 70%)',
        }}
      />

      {/* Header bar */}
      <header className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-1 py-0.5">
        <div
          onClick={handleTitleDevTap}
          className="flex items-center gap-1.5 sm:gap-2"
        >
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
            <span ref={scoreDomRef} className="text-base sm:text-lg font-bold tabular-nums">
              0
            </span>
          </span>
          <span className="flex items-center gap-1 text-amber-300">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span ref={coinsDomRef} className="font-bold tabular-nums">0</span>
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-1 text-fuchsia-300">
            <Trophy className="w-3.5 h-3.5 text-fuchsia-400" />
            <span className="font-bold tabular-nums">{fmt(best)}</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              toggleSound();
              e.currentTarget.blur();
            }}
            className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95 touch-manipulation"
            aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          >
            {soundOn ? (
              <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-300" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/50" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              handleToggleSettings();
              e.currentTarget.blur();
            }}
            className={`p-1 sm:p-1.5 rounded-lg border transition active:scale-95 touch-manipulation ${
              settingsOpen
                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-300'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/80'
            }`}
            aria-label="Graphics settings"
            aria-expanded={settingsOpen}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          {state === 'running' && (
            <button
              type="button"
              onClick={handlePause}
              className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95 touch-manipulation"
              aria-label="Pause"
            >
              <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </button>
          )}
          {state === 'paused' && (
            <button
              type="button"
              onClick={handlePause}
              className="p-1 sm:p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition active:scale-95 touch-manipulation"
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
        onPointerDown={handleStagePointerDown}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerRelease}
        onLostPointerCapture={handlePointerRelease}
        className="game-surface relative z-10 w-full max-w-[min(1000px,calc((100dvh_-_130px)*2.5))] aspect-[900/360] rounded-2xl overflow-hidden border border-amber-500/30 shadow-[0_0_40px_rgba(251,191,36,0.15)] bg-[#091524] cursor-pointer mx-auto flex items-center justify-center"
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full object-contain pointer-events-none"
          role="img"
          aria-label="TM Dash beach runner game canvas"
        />

        {/* Developer-only performance diagnostics overlay (disabled for normal players) */}
        {showPerfOverlay && perfMetrics && (
          <div className="pointer-events-none absolute top-2 left-2 z-30 rounded-lg bg-[#050b14]/85 border border-cyan-400/40 px-2.5 py-1.5 text-[10px] sm:text-[11px] font-mono text-cyan-100 leading-tight shadow-md">
            <div className="flex items-center gap-3">
              <span>
                FPS <strong className="text-cyan-300 tabular-nums">{perfMetrics.currentFps}</strong>
              </span>
              <span>
                AVG <strong className="text-emerald-300 tabular-nums">{perfMetrics.avgFps}</strong>
              </span>
              <span>
                FRAME <strong className="text-amber-300 tabular-nums">{perfMetrics.frameTimeMs.toFixed(1)}ms</strong>
              </span>
            </div>
            <div className="flex items-center gap-3 text-white/80 mt-0.5">
              <span>
                QUAL{' '}
                <strong className="text-white uppercase">
                  {perfMetrics.quality}
                  {perfMetrics.qualityMode === 'auto' ? ' (AUTO)' : ''}
                </strong>
              </span>
              <span>
                SCALE <strong className="text-fuchsia-300 tabular-nums">{perfMetrics.renderScale.toFixed(2)}x</strong>
              </span>
            </div>
          </div>
        )}

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
                Time of Day: <span className="text-amber-300 font-bold">{timeOfDay}</span>
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

        {/* Graphics Quality Settings Panel */}
        {settingsOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-0 z-20 flex items-center justify-center bg-[#050b14]/85 px-3 animate-[fadeIn_0.15s_ease]"
          >
            <div className="w-full max-w-xs rounded-2xl bg-[#0b1628] border border-cyan-400/40 p-4 shadow-[0_0_28px_rgba(34,211,238,0.2)]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs sm:text-sm font-bold tracking-wider text-cyan-300 font-mono uppercase">
                  Graphics Quality
                </h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="p-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 touch-manipulation"
                  aria-label="Close settings"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                {QUALITY_OPTIONS.map((opt) => {
                  const selected = qualityMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() => handleSelectQualityMode(opt.mode)}
                      className={`py-2 px-1 rounded-lg text-xs font-mono font-bold border transition touch-manipulation cursor-pointer ${
                        selected
                          ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                          : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="text-[11px] font-mono text-white/70 flex items-center justify-between mb-1">
                <span>
                  Active:{' '}
                  <strong className="text-amber-300 uppercase">{activeQuality}</strong>
                </span>
                <span>
                  Scale:{' '}
                  <strong className="text-cyan-300 tabular-nums">
                    {renderScale.toFixed(2)}x
                  </strong>
                </span>
              </div>
              <p className="text-[10px] text-white/45 leading-snug">
                {qualityMode === 'auto'
                  ? 'Auto adapts visual effects and render scale to keep motion smooth.'
                  : 'Manual preset locked. Gameplay speed and physics never change.'}
              </p>

              {devUnlocked && (
                <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-white/70">
                    Dev Perf Overlay
                  </span>
                  <button
                    type="button"
                    onClick={toggleDevOverlay}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold border transition touch-manipulation ${
                      showPerfOverlay
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-white/5 border-white/15 text-white/60'
                    }`}
                  >
                    {showPerfOverlay ? 'ON' : 'OFF'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer / Mobile Controls */}
      <footer className="relative z-10 w-full max-w-[1000px] flex items-center justify-between px-2 pt-1 pb-0.5">
        <div className="text-[11px] text-white/40 font-mono">
          Total Coins: <span className="text-amber-400 font-bold">{totalCoins}</span>
        </div>

        {/* Mobile On-Screen Jump Button */}
        <button
          type="button"
          onPointerDown={handleJumpButtonPointerDown}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerRelease}
          onLostPointerCapture={handlePointerRelease}
          className="game-surface md:hidden w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-cyan-500/25 border-2 border-cyan-400/70 text-cyan-100 flex flex-col items-center justify-center active:bg-cyan-500/50 active:scale-95 transition shadow-[0_0_24px_rgba(34,211,238,0.5)] cursor-pointer"
          aria-label="Jump"
        >
          <ArrowUp className="w-7 h-7 pointer-events-none" />
          <span className="text-[9px] font-bold tracking-wider -mt-1 font-mono pointer-events-none">JUMP</span>
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
    <div className="absolute inset-0 flex items-center justify-center bg-[#050b14]/75 animate-[fadeIn_0.2s_ease]">
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
      type="button"
      onClick={onClick}
      className={`touch-manipulation inline-flex items-center justify-center gap-2 ${small ? 'px-4 py-1.5 text-xs' : 'px-6 py-2.5 text-sm sm:text-base'} font-bold tracking-wider rounded-xl border-2 bg-white/5 transition active:scale-95 ${styles} cursor-pointer`}
    >
      {children}
    </button>
  );
}
