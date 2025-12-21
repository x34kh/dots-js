/**
 * Board Logic (Shared with Frontend)
 * Server-side game validation and territory capture
 * 
 * Game Rules:
 * - Players take turns occupying unowned dots
 * - When a dot is occupied, check if any areas are enclosed
 * - Enclosed areas are captured and dots within become non-clickable
 * - Uses greedy algorithm to calculate captured territories
 */

export class BoardLogic {
  constructor(gridSize = 5) {
    this.gridSize = gridSize;
    this.dots = new Map(); // key: "x,y", value: { x, y, owner: null | playerNum, captured: boolean }
    this.capturedAreas = []; // Array of { player, dots: [{x, y}] }
    this.initDots();
  }

  initDots() {
    this.dots = new Map();
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const key = `${x},${y}`;
        this.dots.set(key, { x, y, owner: null, captured: false });
      }
    }
  }

  /**
   * Get dot at position
   */
  getDot(x, y) {
    return this.dots.get(`${x},${y}`);
  }

  /**
   * Check if a dot can be clicked/occupied
   */
  isDotClickable(x, y) {
    const dot = this.getDot(x, y);
    if (!dot) return false;
    // Dot is clickable if it's not owned and not captured
    return dot.owner === null && !dot.captured;
  }

  /**
   * Check if a position is within bounds
   */
  isWithinBounds(x, y) {
    return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
  }

  /**
   * Check if position is on the border of the grid
   */
  isBorderPosition(x, y) {
    return x === 0 || x === this.gridSize - 1 || y === 0 || y === this.gridSize - 1;
  }

  /**
   * Occupy a dot and calculate captured territories
   */
  occupyDot(x, y, playerNum) {
    console.log(`BoardLogic.occupyDot: x=${x}, y=${y}, playerNum=${playerNum}`);
    const dot = this.getDot(x, y);
    console.log('Dot state:', dot ? { owner: dot.owner, captured: dot.captured, capturedBy: dot.capturedBy } : 'null');
    
    if (!this.isDotClickable(x, y)) {
      console.log('Dot is not clickable');
      return { success: false, capturedDots: [] };
    }

    dot.owner = playerNum;
    console.log('Dot occupied successfully');

    // Calculate captured territories using greedy flood-fill algorithm
    const capturedDots = this.calculateCapturedTerritories(playerNum);
    console.log('Captured dots:', capturedDots.length);

    return {
      success: true,
      capturedDots,
      occupiedDot: { x, y }
    };
  }

  /**
   * Get all adjacent positions (orthogonal and diagonal)
   */
  getAdjacentPositions(x, y) {
    const positions = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (this.isWithinBounds(nx, ny)) {
          positions.push({ x: nx, y: ny });
        }
      }
    }
    return positions;
  }

  /**
   * Get orthogonal neighbors only (up, down, left, right)
   */
  getOrthogonalNeighbors(x, y) {
    const positions = [];
    const directions = [
      { dx: 0, dy: -1 }, // up
      { dx: 0, dy: 1 },  // down
      { dx: -1, dy: 0 }, // left
      { dx: 1, dy: 0 }   // right
    ];
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.isWithinBounds(nx, ny)) {
        positions.push({ x: nx, y: ny });
      }
    }
    return positions;
  }

  /**
   * Calculate captured territories using flood-fill algorithm
   * An area is captured when it's completely surrounded by one player's dots
   * Also handles recapturing dots that were previously captured by another player
   * Enemy dots inside an enclosure are also captured (their ownership is taken)
   */
  calculateCapturedTerritories(playerNum) {
    const allCapturedDots = [];
    const visited = new Set();

    // For each unowned dot (or captured by another player), check if it's enclosed by playerNum's dots
    for (const [key, dot] of this.dots) {
      // Skip dots owned by the capturing player (they are boundary dots)
      if (dot.owner === playerNum) continue;
      // Skip if already visited
      if (visited.has(key)) continue;
      // Skip dots already captured by this same player
      if (dot.captured && dot.capturedBy === playerNum) continue;
      
      const { enclosed, enclosedDots, enemyDots, touchesBorder } = this.floodFillCheck(
        dot.x, dot.y, playerNum, visited
      );

      if (enclosed && !touchesBorder && (enclosedDots.length > 0 || enemyDots.length > 0)) {
        // Mark all neutral dots as captured
        for (const capturedDot of enclosedDots) {
          const d = this.getDot(capturedDot.x, capturedDot.y);
          if (d && d.owner === null) {
            const wasAlreadyCapturedByThisPlayer = d.captured && d.capturedBy === playerNum;
            d.captured = true;
            d.capturedBy = playerNum;
            // Only add to result if not already captured by this player
            if (!wasAlreadyCapturedByThisPlayer) {
              allCapturedDots.push(capturedDot);
            }
          }
        }

        // Mark enemy dots as captured (they lose their ownership)
        for (const capturedDot of enemyDots) {
          const d = this.getDot(capturedDot.x, capturedDot.y);
          if (d && d.owner !== null && d.owner !== playerNum) {
            d.owner = null; // Remove enemy ownership
            d.captured = true;
            d.capturedBy = playerNum;
            allCapturedDots.push(capturedDot);
          }
        }

        const allDots = [...enclosedDots, ...enemyDots];
        if (allDots.length > 0) {
          this.capturedAreas.push({
            player: playerNum,
            dots: allDots
          });
        }
      }
    }

    return allCapturedDots;
  }

  /**
   * Flood fill to check if an area is enclosed by a player's dots
   * Includes dots that were captured by another player as part of the enclosed area
   * Enemy dots inside an enclosure are also included (they get captured along with neutral dots)
   * Returns: { enclosed: boolean, enclosedDots: [], enemyDots: [], touchesBorder: boolean }
   */
  floodFillCheck(startX, startY, playerNum, globalVisited) {
    const queue = [{ x: startX, y: startY }];
    const localVisited = new Set();
    const enclosedDots = [];
    const enemyDots = [];
    let touchesBorder = false;
    let enclosed = true;

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      const key = `${x},${y}`;

      if (localVisited.has(key)) continue;
      localVisited.add(key);
      globalVisited.add(key);

      const dot = this.getDot(x, y);

      // If this dot is owned by the player, it's part of the boundary (don't include in enclosed)
      if (dot.owner === playerNum) {
        continue;
      }

      // Check if we're at the border of the grid
      if (this.isBorderPosition(x, y)) {
        touchesBorder = true;
      }

      // If this dot is owned by opponent, it's inside the enclosure and will be captured
      // We still need to check neighbors to find all enclosed dots
      if (dot.owner !== null && dot.owner !== playerNum) {
        enemyDots.push({ x, y });
      } else {
        // This is an unowned dot (may be uncaptured or captured by another player), add to enclosed area
        enclosedDots.push({ x, y });
      }

      // Check all orthogonal neighbors
      const neighbors = this.getOrthogonalNeighbors(x, y);
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;
        if (!localVisited.has(neighborKey)) {
          queue.push(neighbor);
        }
      }
    }

    return { enclosed, enclosedDots, enemyDots, touchesBorder };
  }

  /**
   * Preview what dots would be captured if player occupies a dot
   */
  previewCapture(x, y, playerNum) {
    if (!this.isDotClickable(x, y)) {
      return [];
    }

    // Temporarily occupy the dot
    const dot = this.getDot(x, y);
    const originalOwner = dot.owner;
    dot.owner = playerNum;

    // Calculate what would be captured
    const visited = new Set();
    const previewCaptured = [];

    for (const [key, d] of this.dots) {
      // Skip dots owned by the capturing player (they are boundary dots)
      if (d.owner === playerNum) continue;
      // Skip if already visited
      if (visited.has(key)) continue;
      // Skip dots already captured by this player
      if (d.captured && d.capturedBy === playerNum) continue;

      const { enclosed, enclosedDots, enemyDots, touchesBorder } = this.floodFillCheck(
        d.x, d.y, playerNum, visited
      );

      if (enclosed && !touchesBorder && (enclosedDots.length > 0 || enemyDots.length > 0)) {
        previewCaptured.push(...enclosedDots);
        previewCaptured.push(...enemyDots);
      }
    }

    // Restore the dot
    dot.owner = originalOwner;

    return previewCaptured;
  }

  /**
   * Get all dots owned by a player
   */
  getPlayerDots(playerNum) {
    const playerDots = [];
    for (const [, dot] of this.dots) {
      if (dot.owner === playerNum) {
        playerDots.push(dot);
      }
    }
    return playerDots;
  }

  /**
   * Get all captured dots for a player
   */
  getCapturedDotsForPlayer(playerNum) {
    const captured = [];
    for (const [, dot] of this.dots) {
      if (dot.captured && dot.capturedBy === playerNum) {
        captured.push(dot);
      }
    }
    return captured;
  }

  /**
   * Calculate score for a player (owned dots + captured dots)
   */
  calculateScore(playerNum) {
    let score = 0;
    for (const [, dot] of this.dots) {
      if (dot.owner === playerNum) {
        score += 1;
      }
      if (dot.captured && dot.capturedBy === playerNum) {
        score += 1;
      }
    }
    return score;
  }

  /**
   * Check if the game is over (no more clickable dots)
   */
  isGameOver() {
    for (const [, dot] of this.dots) {
      if (dot.owner === null && !dot.captured) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get all clickable dots
   */
  getClickableDots() {
    const clickable = [];
    for (const [, dot] of this.dots) {
      if (dot.owner === null && !dot.captured) {
        clickable.push(dot);
      }
    }
    return clickable;
  }

  /**
   * Serialize the board state
   */
  serialize() {
    return {
      gridSize: this.gridSize,
      dots: Array.from(this.dots.entries()),
      capturedAreas: this.capturedAreas
    };
  }

  /**
   * Deserialize board state
   */
  deserialize(data) {
    this.gridSize = data.gridSize;
    this.dots = new Map(data.dots);
    this.capturedAreas = data.capturedAreas || [];
  }

  /**
   * Reset the board
   */
  reset() {
    this.capturedAreas = [];
    this.initDots();
  }
}
