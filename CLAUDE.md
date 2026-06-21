# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

No build step. Open directly or serve statically:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

Then open `http://localhost:8000`.

## Architecture

Three files, no dependencies, no bundler:

- **`index.html`** — DOM structure: `<canvas id="board">` (300×600px), `<canvas id="next-canvas">` (120×120px), side panel with HUD elements (`#score`, `#lines`, `#level`), and `#overlay` for pause/game-over states.
- **`style.css`** — Dark retro theme. Overlay uses `backdrop-filter: blur`.
- **`game.js`** — All game logic (~305 lines, `'use strict'`, no modules).

### game.js key concepts

- **Board**: `ROWS×COLS` matrix; `0` = empty, `1–7` = piece color index.
- **Piece object**: `{ type, shape, x, y }` where `shape` is a 2D array.
- **Rotation**: `rotateCW()` transposes + reverses rows. `tryRotate()` applies wall kicks (offsets `[0, -1, 1, -2, 2]`).
- **Collision**: `collide(shape, ox, oy)` — checks bounds and board occupancy.
- **Game loop**: `requestAnimationFrame`-based; accumulates `dropAccum` ms and drops piece when `dropAccum >= dropInterval`.
- **Speed formula**: `dropInterval = Math.max(100, 1000 - (level - 1) * 90)` ms.
- **Scoring**: `LINE_SCORES[cleared] * level`; hard drop +2/cell, soft drop +1/row.
- **Ghost piece**: `ghostY()` projects piece downward; rendered at `globalAlpha = 0.2`.

### Tunable constants (top of game.js)

| Constant | Default | Note |
|---|---|---|
| `COLS` / `ROWS` | 10 / 20 | Must match canvas `width`/`height` (`COLS×BLOCK` / `ROWS×BLOCK`) |
| `BLOCK` | 30 | Pixel size per cell |
| `COLORS` | 7 colors | Index 0 = null (empty) |
| `LINE_SCORES` | `[0,100,300,500,800]` | Indexed by lines cleared |
