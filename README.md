# TM Dash

A polished, mobile-friendly **2D endless runner** browser game with a neon arcade aesthetic. Run, jump over obstacles, collect coins, and survive as the world speeds up. Built with React, TypeScript, Tailwind CSS, and an HTML Canvas game engine — no external game assets required.

![TM Dash](https://bolt.new/static/og_default.png)

## Features

- **Auto-running character** with double-jump
- **Obstacles**: blocks, tall barriers, and spikes with accurate collision detection
- **Collectible coins** in arc patterns that boost your score
- **Progressive difficulty** — speed and spawn rate increase the further you go
- **Neon visuals**: glowing elements, parallax mountains, perspective grid, sun, stars, particle bursts, screen shake
- **Full game flow**: animated start screen, pause/resume, game-over screen with stats
- **Best score** and **total coins collected** saved to `localStorage`
- **Sound effects** via Web Audio API (jump, coin, crash) with mute toggle
- **Controls**: Space / Arrow Up / Enter / click / tap / dedicated mobile jump button
- **Mobile-optimized**: prevents accidental scrolling and pinch-zoom while playing
- **Responsive** letterboxed canvas that fits any screen size, desktop or mobile
- All graphics drawn in code — no copyrighted assets

## How to Play

| Action | Desktop | Mobile |
| --- | --- | --- |
| Jump | Space or ↑ | Tap the game or the jump button |
| Double jump | Press again in mid-air | Tap again in mid-air |
| Pause / Resume | P or Esc | Pause button in the HUD |
| Start / Restart | Enter or click PLAY | Tap PLAY / PLAY AGAIN |

You have **two jumps** per ground touch — use the second one to clear tall obstacles or reach high coin arcs.

## Tech Stack

- **React 18** + **TypeScript** — UI shell and screens
- **Vite** — dev server and build tool
- **Tailwind CSS** — styling
- **HTML Canvas 2D** — game rendering
- **Web Audio API** — procedural sound effects (no audio files)
- **lucide-react** — icons

## Getting Started

```bash
# install dependencies
npm install

# start the dev server
npm run dev

# build for production
npm run build

# preview the production build
npm run preview
```

The dev server runs at `http://localhost:5173`.

## Project Structure

```
src/
├── game/
│   ├── engine.ts      # core game loop, physics, rendering
│   ├── sound.ts       # Web Audio sound manager
│   └── types.ts       # shared types
├── components/
│   └── TMDash.tsx     # React UI: screens, HUD, controls
├── App.tsx
├── main.tsx
└── index.css
```

## Deploy to Vercel

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and import the repo.
3. Vercel auto-detects Vite — keep the defaults:
   - **Build command**: `npm run build`
   - **Output directory**: `dist`
4. Click **Deploy**.

Alternatively, use the Vercel CLI:

```bash
npm i -g vercel
vercel
```

## Browser Support

Works in any modern browser with Canvas and Web Audio support (Chrome, Firefox, Safari, Edge — desktop and mobile).

## License

Original project — all graphics and sounds are generated in code. Free to use and modify.
