'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#5b8dd9', // J - blue
  '#ffb74d', // L - orange
  '#b8a060', // Tuerca - bronce
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca (hueco en el centro)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const POWERUPS = [
  { key: 'bomb',    icon: '💣', label: 'Bomba',    color: '#ff5252' },
  { key: 'ray',     icon: '⚡', label: 'Rayo',     color: '#ffee00' },
  { key: 'tint',    icon: '🎨', label: 'Tinte',    color: '#ff80ab' },
  { key: 'gravity', icon: '🪐', label: 'Gravedad', color: '#40c4ff' },
  { key: 'freeze',  icon: '❄️', label: 'Congelar', color: '#80deea' },
];
const POWERUP_EVERY = 3;
const FREEZE_MS = 5000;
const FLASH_MS = 500;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let powerUpPending, nextPowerUpAt, freezeRemaining, flashCells, flashRemaining;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerUp() {
  const pu = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
  return { power: pu.key, icon: pu.icon, color: pu.color, shape: [[1]], x: Math.floor(COLS / 2), y: 0 };
}

function nextPiece() {
  if (powerUpPending) { powerUpPending = false; return randomPowerUp(); }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    // Power-up milestone — use while in case multiple thresholds crossed at once
    while (lines >= nextPowerUpAt) {
      powerUpPending = true;
      nextPowerUpAt += POWERUP_EVERY;
    }
    updateHUD();
  }
}

function applyPowerUp(p) {
  const cx = p.x, cy = p.y;
  const touched = [];

  switch (p.power) {
    case 'bomb': {
      for (let r = cy - 1; r <= cy + 1; r++)
        for (let c = cx - 1; c <= cx + 1; c++)
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
            if (board[r][c]) touched.push([r, c]);
            board[r][c] = 0;
          }
      break;
    }
    case 'ray': {
      for (let c = 0; c < COLS; c++) { if (board[cy][c]) touched.push([cy, c]); board[cy][c] = 0; }
      for (let r = 0; r < ROWS; r++) { if (board[r][cx]) touched.push([r, cx]); board[r][cx] = 0; }
      break;
    }
    case 'tint': {
      const counts = new Array(COLORS.length).fill(0);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c]) counts[board[r][c]]++;
      let maxIdx = 0, maxCount = 0;
      for (let i = 1; i < COLORS.length; i++) {
        if (counts[i] > maxCount) { maxCount = counts[i]; maxIdx = i; }
      }
      if (maxCount > 0) {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === maxIdx) { touched.push([r, c]); board[r][c] = 0; }
      }
      break;
    }
    case 'gravity': {
      // Each column: collect non-zero values (bottom-to-top), restack from bottom
      for (let c = 0; c < COLS; c++) {
        const stack = [];
        for (let r = ROWS - 1; r >= 0; r--) if (board[r][c]) stack.push(board[r][c]);
        for (let r = ROWS - 1; r >= 0; r--) {
          board[r][c] = stack.length > 0 ? stack.shift() : 0;
          if (board[r][c]) touched.push([r, c]);
        }
      }
      break;
    }
    case 'freeze': {
      freezeRemaining = FREEZE_MS;
      touched.push([cy, cx]);
      break;
    }
  }

  if (touched.length) {
    flashCells = touched;
    flashRemaining = FLASH_MS;
  }

  // All structural effects check for newly completed lines
  if (p.power !== 'freeze') clearLines();
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.power) {
    applyPowerUp(current);
  } else {
    merge();
    clearLines();
  }
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  const statusEl = document.getElementById('powerup-status');
  if (statusEl) {
    if (freezeRemaining > 0) {
      statusEl.textContent = `❄️ ${Math.ceil(freezeRemaining / 1000)}s`;
      statusEl.classList.add('active');
    } else {
      statusEl.textContent = '';
      statusEl.classList.remove('active');
    }
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawPowerUpBlock(context, x, y, color, icon, size, alpha) {
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  const a = alpha ?? 1;
  context.globalAlpha = a;
  context.fillStyle = color;
  context.fillRect(px, py, s, s);
  context.fillStyle = 'rgba(255,255,255,0.3)';
  context.fillRect(px, py, s, 4);
  context.font = `${Math.floor(size * 0.62)}px serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icon, x * size + size / 2, y * size + size / 2);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = document.body.classList.contains('light-mode') ? '#c8cae0' : '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // Board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // Flash overlay (fades out after effect)
  if (flashRemaining > 0) {
    const alpha = (flashRemaining / FLASH_MS) * 0.55;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    for (const [r, c] of flashCells) {
      ctx.fillRect(c * BLOCK + 1, r * BLOCK + 1, BLOCK - 2, BLOCK - 2);
    }
    ctx.restore();
  }

  // Ghost
  const gy = ghostY();
  if (current.power) {
    drawPowerUpBlock(ctx, current.x, gy, current.color, current.icon, BLOCK, 0.22);
  } else {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);
  }

  // Current piece
  if (current.power) {
    drawPowerUpBlock(ctx, current.x, current.y, current.color, current.icon, BLOCK);
  } else {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  // Freeze: animated border glow
  if (freezeRemaining > 0) {
    const pulse = 0.4 + 0.3 * Math.sin(Date.now() / 200);
    ctx.save();
    ctx.strokeStyle = `rgba(100, 220, 255, ${pulse})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.restore();
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);

  if (next.power) {
    const offX = Math.floor((4 - 1) / 2);
    const offY = Math.floor((4 - 1) / 2);
    drawPowerUpBlock(nextCtx, offX, offY, next.color, next.icon, NB);
    return;
  }

  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver) return;
  const dt = ts - lastTime;
  lastTime = ts;

  // Flash countdown (independent of freeze)
  if (flashRemaining > 0) flashRemaining = Math.max(0, flashRemaining - dt);

  // Freeze: count down via dt so it pauses correctly with the game loop
  if (freezeRemaining > 0) {
    freezeRemaining = Math.max(0, freezeRemaining - dt);
    updateHUD();
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
        if (gameOver) return;
      }
    }
  }

  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  powerUpPending = false;
  nextPowerUpAt = POWERUP_EVERY;
  freezeRemaining = 0;
  flashCells = [];
  flashRemaining = 0;
  next = nextPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
if (localStorage.getItem('tetris-theme') === 'light') {
  document.body.classList.add('light-mode');
  themeToggle.checked = true;
  themeIcon.textContent = '☀️';
}
themeToggle.addEventListener('change', () => {
  const isLight = themeToggle.checked;
  document.body.classList.toggle('light-mode', isLight);
  themeIcon.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
});

init();
