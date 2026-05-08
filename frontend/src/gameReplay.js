/**
 * GameReplay
 * Fetches a completed game's moves and animates them on a lightweight canvas overlay.
 */

import { BoardLogic } from './boardLogic.js';

export class GameReplay {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.intervalMs = 1000;
    this.moves = [];
    this.currentMoveIndex = 0;
    this.playing = false;
    this.timer = null;
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.gridSize = 10;
    this.replayData = null;
  }

  getApiUrl() {
    if (this.serverUrl) {
      return this.serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
    }
    if (window.GAME_CONFIG?.backendUrl) return window.GAME_CONFIG.backendUrl;
    const port = window.location.hostname === 'localhost' ? ':3001' : '';
    return `${window.location.protocol}//${window.location.hostname}${port}`;
  }

  async load(gameId) {
    const url = `${this.getApiUrl()}/api/replay/${gameId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Replay not available for this game');
    this.replayData = await res.json();
    this.gridSize = this.replayData.gridSize || 10;
    this.moves = this.replayData.moves || [];
    return this.replayData;
  }

  show(gameId, intervalMs = 1000) {
    this.intervalMs = intervalMs;
    this.currentMoveIndex = 0;
    this.playing = false;

    this._buildOverlay();
    this.load(gameId)
      .then(() => {
        this._renderBoard();
        this._updateControls();
      })
      .catch(err => {
        this._showError(err.message);
      });
  }

  _buildOverlay() {
    // Remove any existing overlay
    this._cleanup();

    this.overlay = document.createElement('div');
    this.overlay.id = 'replay-overlay';
    this.overlay.innerHTML = `
      <div class="replay-modal">
        <div class="replay-header">
          <span class="replay-title">Game Replay</span>
          <button class="replay-close" id="replay-close-btn">✕</button>
        </div>
        <div class="replay-info" id="replay-info">Loading…</div>
        <canvas id="replay-canvas"></canvas>
        <div class="replay-controls">
          <button class="replay-btn" id="replay-prev-btn">⏮</button>
          <button class="replay-btn replay-play-btn" id="replay-play-btn">▶</button>
          <button class="replay-btn" id="replay-next-btn">⏭</button>
          <span class="replay-counter" id="replay-counter">Move 0 / 0</span>
          <label class="replay-speed-label">
            Speed:
            <input type="range" id="replay-speed" min="100" max="3000" step="100" value="1000">
            <span id="replay-speed-val">1.0s</span>
          </label>
        </div>
      </div>
    `;

    this._injectStyles();
    document.body.appendChild(this.overlay);

    this.canvas = document.getElementById('replay-canvas');
    this.ctx = this.canvas.getContext('2d');

    document.getElementById('replay-close-btn').addEventListener('click', () => this.close());
    document.getElementById('replay-play-btn').addEventListener('click', () => this._togglePlay());
    document.getElementById('replay-prev-btn').addEventListener('click', () => this._stepBackward());
    document.getElementById('replay-next-btn').addEventListener('click', () => this._stepForward());

    const speedSlider = document.getElementById('replay-speed');
    speedSlider.addEventListener('input', (e) => {
      this.intervalMs = parseInt(e.target.value);
      document.getElementById('replay-speed-val').textContent = (this.intervalMs / 1000).toFixed(1) + 's';
      if (this.playing) {
        this._stopTimer();
        this._startTimer();
      }
    });

    // Resize canvas to its CSS size
    this._resizeCanvas();
  }

  _resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width || 460;
    this.canvas.height = rect.height || 460;
  }

  _renderBoard() {
    if (!this.ctx || !this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = 24;
    const cellW = (w - pad * 2) / (this.gridSize - 1);
    const cellH = (h - pad * 2) / (this.gridSize - 1);
    const cell = Math.min(cellW, cellH);
    const offX = (w - cell * (this.gridSize - 1)) / 2;
    const offY = (h - cell * (this.gridSize - 1)) / 2;

    const dotX = (col) => offX + col * cell;
    const dotY = (row) => offY + row * cell;
    // X matches Three.js directly (left→right). Y is flipped: Three.js Y grows upward,
    // canvas Y grows downward, so game y=0 must map to the bottom of the canvas.
    const toCanvasX = (x) => dotX(x);
    const toCanvasY = (y) => dotY((this.gridSize - 1) - y);
    const r = Math.max(5, cell * 0.14);

    const replayState = this._buildReplayState(this.currentMoveIndex);

    const colors = { 1: '#00ffff', 2: '#ff00ff' };
    const dimmed = 'rgba(74,74,106,0.5)';

    // Background
    this.ctx.fillStyle = '#0a0a15';
    this.ctx.fillRect(0, 0, w, h);

    // Grid lines
    this.ctx.strokeStyle = 'rgba(40,40,80,0.8)';
    this.ctx.lineWidth = 1;
    for (let i = 0; i < this.gridSize; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(dotX(0), dotY(i));
      this.ctx.lineTo(dotX(this.gridSize - 1), dotY(i));
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(dotX(i), dotY(0));
      this.ctx.lineTo(dotX(i), dotY(this.gridSize - 1));
      this.ctx.stroke();
    }

    // Captured territory fill — same cell-based approach as createCapturedAreaMesh in renderer.js
    const capturedGroups = new Map();
    for (const [, dot] of replayState.dots) {
      if (!dot.captured || !dot.capturedBy) continue;
      if (!capturedGroups.has(dot.capturedBy)) capturedGroups.set(dot.capturedBy, []);
      capturedGroups.get(dot.capturedBy).push(dot);
    }
    for (const [player, capturedDots] of capturedGroups) {
      const colorHex = colors[player] || '#7f8cff';
      const capturedSet = new Set(capturedDots.map(d => `${d.x},${d.y}`));

      // Find boundary dots: owned by this player and adjacent (8-dir) to a captured dot
      const boundaryDots = new Set();
      for (const { x, y } of capturedDots) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
              const nb = replayState.dots.get(`${nx},${ny}`);
              if (nb && nb.owner === player) boundaryDots.add(`${nx},${ny}`);
            }
          }
        }
      }

      const allPoints = new Set([...capturedSet, ...boundaryDots]);

      // Compute bounding box
      let minGX = this.gridSize, maxGX = 0, minGY = this.gridSize, maxGY = 0;
      for (const key of allPoints) {
        const [xs, ys] = key.split(',');
        const gx = parseInt(xs), gy = parseInt(ys);
        if (gx < minGX) minGX = gx; if (gx > maxGX) maxGX = gx;
        if (gy < minGY) minGY = gy; if (gy > maxGY) maxGY = gy;
      }

      this.ctx.fillStyle = this._hexToRgba(colorHex, 0.18);

      // First pass: fill every complete rectangular cell (all 4 corners present)
      const processedCells = new Set();
      for (let cy = minGY; cy < maxGY; cy++) {
        for (let cx = minGX; cx < maxGX; cx++) {
          const cellKey = `${cx},${cy}`;
          if (processedCells.has(cellKey)) continue;
          const corners = [`${cx},${cy}`, `${cx+1},${cy}`, `${cx+1},${cy+1}`, `${cx},${cy+1}`];
          if (corners.every(k => allPoints.has(k))) {
            processedCells.add(cellKey);
            // toCanvasY flips Y: the "top" canvas edge of this cell is at game y = cy+1
            this.ctx.fillRect(toCanvasX(cx), toCanvasY(cy + 1), cell, cell);
          }
        }
      }

      // Second pass: fan-triangulate remaining captured dots (same as renderer.js)
      for (const { x, y } of capturedDots) {
        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nKey = `${x+dx},${y+dy}`;
            if (allPoints.has(nKey)) neighbors.push({ x: x+dx, y: y+dy, dx, dy });
          }
        }
        neighbors.sort((a, b) => Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx));
        const cx0 = toCanvasX(x), cy0 = toCanvasY(y);
        for (let i = 0; i < neighbors.length; i++) {
          const n1 = neighbors[i];
          const n2 = neighbors[(i + 1) % neighbors.length];
          if (Math.abs(n1.dx - n2.dx) + Math.abs(n1.dy - n2.dy) <= 2) {
            this.ctx.beginPath();
            this.ctx.moveTo(cx0, cy0);
            this.ctx.lineTo(toCanvasX(n1.x), toCanvasY(n1.y));
            this.ctx.lineTo(toCanvasX(n2.x), toCanvasY(n2.y));
            this.ctx.closePath();
            this.ctx.fill();
          }
        }
      }
    }

    // Dots
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const key = `${x},${y}`;
        const dot = replayState.dots.get(key);
        const owner = dot?.owner ?? null;
        const cx = toCanvasX(x);
        const cy = toCanvasY(y);

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);

        if (owner) {
          const col = colors[owner];
          this.ctx.fillStyle = col;
          this.ctx.shadowColor = col;
          this.ctx.shadowBlur = 10;
        } else if (dot?.captured && dot?.capturedBy) {
          const col = colors[dot.capturedBy];
          this.ctx.fillStyle = this._hexToRgba(col, 0.35);
          this.ctx.shadowBlur = 0;
        } else {
          this.ctx.fillStyle = dimmed;
          this.ctx.shadowBlur = 0;
        }
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
      }
    }

    // Highlight last move
    if (this.currentMoveIndex > 0) {
      const last = this.moves[this.currentMoveIndex - 1];
      const cx = toCanvasX(last.x);
      const cy = toCanvasY(last.y);
      const col = colors[last.player];
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
      this.ctx.strokeStyle = col;
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 0.7;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }

    // Info
    if (this.replayData) {
      const p1 = this.replayData.player1Name || 'Player 1';
      const p2 = this.replayData.player2Name || 'Player 2';
      document.getElementById('replay-info').innerHTML =
        `<span style="color:${colors[1]}">${p1}</span> vs <span style="color:${colors[2]}">${p2}</span>` +
        ` &nbsp;|&nbsp; ${this.replayData.gridSize}×${this.replayData.gridSize}`;
    }

    this._updateControls();
  }

  _buildReplayState(moveCount) {
    const board = new BoardLogic(this.gridSize);
    const limit = Math.min(moveCount, this.moves.length);

    for (let i = 0; i < limit; i++) {
      const m = this.moves[i];
      board.occupyDot(m.x, m.y, m.player);
    }

    return { dots: board.dots };
  }

  _hexToRgba(hex, alpha) {
    const cleaned = (hex || '').replace('#', '');
    if (cleaned.length !== 6) return `rgba(127,127,127,${alpha})`;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _updateControls() {
    const counter = document.getElementById('replay-counter');
    if (counter) counter.textContent = `Move ${this.currentMoveIndex} / ${this.moves.length}`;
    const btn = document.getElementById('replay-play-btn');
    if (btn) btn.textContent = this.playing ? '⏸' : '▶';
  }

  _togglePlay() {
    if (this.playing) {
      this._stopTimer();
      this.playing = false;
    } else {
      if (this.currentMoveIndex >= this.moves.length) this.currentMoveIndex = 0;
      this.playing = true;
      this._startTimer();
    }
    this._updateControls();
  }

  _startTimer() {
    this.timer = setInterval(() => {
      if (this.currentMoveIndex < this.moves.length) {
        this.currentMoveIndex++;
        this._renderBoard();
      } else {
        this._stopTimer();
        this.playing = false;
        this._updateControls();
      }
    }, this.intervalMs);
  }

  _stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _stepForward() {
    this._stopTimer();
    this.playing = false;
    if (this.currentMoveIndex < this.moves.length) {
      this.currentMoveIndex++;
      this._renderBoard();
    }
  }

  _stepBackward() {
    this._stopTimer();
    this.playing = false;
    if (this.currentMoveIndex > 0) {
      this.currentMoveIndex--;
      this._renderBoard();
    }
  }

  _showError(msg) {
    const info = document.getElementById('replay-info');
    if (info) info.textContent = `⚠ ${msg}`;
  }

  close() {
    this._stopTimer();
    this._cleanup();
  }

  _cleanup() {
    this._stopTimer();
    const existing = document.getElementById('replay-overlay');
    if (existing) existing.remove();
    const style = document.getElementById('replay-styles');
    if (style) style.remove();
  }

  _injectStyles() {
    if (document.getElementById('replay-styles')) return;
    const s = document.createElement('style');
    s.id = 'replay-styles';
    s.textContent = `
      #replay-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.8);
        z-index: 9000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .replay-modal {
        background: #0e0e1e;
        border: 2px solid rgba(255,255,255,0.15);
        border-radius: 12px;
        padding: 20px;
        width: min(520px, 95vw);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .replay-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .replay-title {
        font-size: 1.2em;
        font-weight: bold;
        color: white;
      }
      .replay-close {
        background: none;
        border: none;
        color: rgba(255,255,255,0.6);
        font-size: 1.2em;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .replay-close:hover { color: white; background: rgba(255,255,255,0.1); }
      .replay-info {
        font-size: 0.9em;
        color: rgba(255,255,255,0.7);
        text-align: center;
      }
      #replay-canvas {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .replay-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .replay-btn {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        color: white;
        border-radius: 6px;
        padding: 6px 14px;
        cursor: pointer;
        font-size: 1em;
        transition: background 0.15s;
      }
      .replay-btn:hover { background: rgba(255,255,255,0.2); }
      .replay-play-btn { min-width: 44px; }
      .replay-counter {
        color: rgba(255,255,255,0.6);
        font-size: 0.9em;
        min-width: 100px;
        text-align: center;
      }
      .replay-speed-label {
        color: rgba(255,255,255,0.6);
        font-size: 0.85em;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #replay-speed { width: 80px; cursor: pointer; }
    `;
    document.head.appendChild(s);
  }
}
