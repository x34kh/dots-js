/**
 * Board Logic
 * Handles the game board state, line placement, and territory detection
 */

export class BoardLogic {
  constructor(gridSize = 5) {
    this.gridSize = gridSize;
    this.dots = [];
    this.lines = new Map(); // key: "x1,y1-x2,y2", value: playerNum
    this.territories = new Map(); // key: polygon identifier, value: { player, points }
    this.initDots();
  }

  initDots() {
    this.dots = [];
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        this.dots.push({ x, y });
      }
    }
  }

  /**
   * Get the standardized line key (always sorted)
   */
  getLineKey(x1, y1, x2, y2) {
    // Sort to ensure consistent key regardless of direction
    if (x1 < x2 || (x1 === x2 && y1 < y2)) {
      return `${x1},${y1}-${x2},${y2}`;
    }
    return `${x2},${y2}-${x1},${y1}`;
  }

  /**
   * Check if two dots are adjacent (orthogonal or diagonal)
   */
  areAdjacent(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    return dx <= 1 && dy <= 1 && (dx + dy > 0);
  }

  /**
   * Check if a line can be placed between two dots
   */
  isValidLine(x1, y1, x2, y2) {
    // Check if dots are adjacent
    if (!this.areAdjacent(x1, y1, x2, y2)) {
      return false;
    }

    // Check if dots are within bounds
    if (x1 < 0 || x1 >= this.gridSize || y1 < 0 || y1 >= this.gridSize ||
        x2 < 0 || x2 >= this.gridSize || y2 < 0 || y2 >= this.gridSize) {
      return false;
    }

    // Check if line already exists
    const key = this.getLineKey(x1, y1, x2, y2);
    return !this.lines.has(key);
  }

  /**
   * Place a line and check for territory capture
   */
  placeLine(x1, y1, x2, y2, playerNum) {
    if (!this.isValidLine(x1, y1, x2, y2)) {
      return { success: false, capturedTerritories: [] };
    }

    const key = this.getLineKey(x1, y1, x2, y2);
    this.lines.set(key, playerNum);

    // Find newly captured territories
    const capturedTerritories = this.findNewTerritories(playerNum);

    return {
      success: true,
      capturedTerritories,
      lineKey: key
    };
  }

  /**
   * Get all lines connected to a dot
   */
  getConnectedLines(x, y) {
    const connected = [];
    this.lines.forEach((player, key) => {
      const [p1, p2] = key.split('-');
      const [x1, y1] = p1.split(',').map(Number);
      const [x2, y2] = p2.split(',').map(Number);
      
      if ((x1 === x && y1 === y) || (x2 === x && y2 === y)) {
        connected.push({ key, player, x1, y1, x2, y2 });
      }
    });
    return connected;
  }

  /**
   * Build adjacency graph from current lines
   */
  buildGraph() {
    const graph = new Map();
    
    // Initialize all dots
    this.dots.forEach(dot => {
      graph.set(`${dot.x},${dot.y}`, []);
    });

    // Add edges for each line
    this.lines.forEach((player, key) => {
      const [p1, p2] = key.split('-');
      const [x1, y1] = p1.split(',').map(Number);
      const [x2, y2] = p2.split(',').map(Number);
      
      graph.get(`${x1},${y1}`).push({ x: x2, y: y2 });
      graph.get(`${x2},${y2}`).push({ x: x1, y: y1 });
    });

    return graph;
  }

  /**
   * Find all cycles (closed polygons) in the graph using DFS
   */
  findCycles() {
    const graph = this.buildGraph();
    const visited = new Set();
    const cycles = [];
    
    // Find all minimal cycles using DFS
    const findCyclesFromNode = (startKey) => {
      const start = startKey.split(',').map(Number);
      const stack = [[{ x: start[0], y: start[1], path: [startKey] }]];
      
      while (stack.length > 0) {
        const level = stack.pop();
        
        for (const { x, y, path } of level) {
          const neighbors = graph.get(`${x},${y}`) || [];
          const nextLevel = [];
          
          for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y}`;
            
            // Check if we found a cycle back to start
            if (neighborKey === startKey && path.length >= 3) {
              // Verify it's a valid minimal cycle
              const cyclePoints = path.map(p => {
                const [px, py] = p.split(',').map(Number);
                return { x: px, y: py };
              });
              
              if (this.isValidCycle(cyclePoints)) {
                cycles.push(cyclePoints);
              }
            } else if (!path.includes(neighborKey) && path.length < 8) {
              // Continue exploring (limit depth to prevent infinite loops)
              nextLevel.push({
                x: neighbor.x,
                y: neighbor.y,
                path: [...path, neighborKey]
              });
            }
          }
          
          if (nextLevel.length > 0) {
            stack.push(nextLevel);
          }
        }
      }
    };

    // Start from each dot
    this.dots.forEach(dot => {
      const key = `${dot.x},${dot.y}`;
      if (!visited.has(key)) {
        findCyclesFromNode(key);
        visited.add(key);
      }
    });

    return this.deduplicateCycles(cycles);
  }

  /**
   * Validate that a cycle forms a proper polygon (no crossing edges)
   */
  isValidCycle(points) {
    if (points.length < 3) return false;

    // Check all edges exist
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const key = this.getLineKey(p1.x, p1.y, p2.x, p2.y);
      if (!this.lines.has(key)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Remove duplicate cycles (same cycle in different order/direction)
   */
  deduplicateCycles(cycles) {
    const unique = [];
    const seen = new Set();

    for (const cycle of cycles) {
      const normalized = this.normalizeCycle(cycle);
      const key = normalized.map(p => `${p.x},${p.y}`).join('|');
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(cycle);
      }
    }

    return unique;
  }

  /**
   * Normalize cycle to start from smallest point
   */
  normalizeCycle(points) {
    let minIdx = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].x < points[minIdx].x || 
          (points[i].x === points[minIdx].x && points[i].y < points[minIdx].y)) {
        minIdx = i;
      }
    }
    
    // Rotate to start from minimum
    const rotated = [...points.slice(minIdx), ...points.slice(0, minIdx)];
    
    // Ensure consistent direction (clockwise)
    const area = this.calculateSignedArea(rotated);
    if (area < 0) {
      rotated.reverse();
      rotated.unshift(rotated.pop()); // Keep start at beginning
    }
    
    return rotated;
  }

  /**
   * Calculate signed area of polygon using Shoelace formula
   */
  calculateSignedArea(points) {
    let area = 0;
    const n = points.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    
    return area / 2;
  }

  /**
   * Calculate absolute area of polygon
   */
  calculateArea(points) {
    return Math.abs(this.calculateSignedArea(points));
  }

  /**
   * Find newly captured territories after a line placement
   */
  findNewTerritories(playerNum) {
    const cycles = this.findCycles();
    const newTerritories = [];

    for (const cycle of cycles) {
      const cycleKey = this.normalizeCycle(cycle)
        .map(p => `${p.x},${p.y}`)
        .join('|');

      if (!this.territories.has(cycleKey)) {
        const area = this.calculateArea(cycle);
        this.territories.set(cycleKey, { player: playerNum, points: cycle, area });
        newTerritories.push({ points: cycle, area, player: playerNum });
      }
    }

    return newTerritories;
  }

  /**
   * Preview what territories would be captured by a hypothetical line
   */
  previewCapture(x1, y1, x2, y2) {
    if (!this.isValidLine(x1, y1, x2, y2)) {
      return [];
    }

    // Temporarily add the line
    const key = this.getLineKey(x1, y1, x2, y2);
    this.lines.set(key, 0); // Player 0 for preview

    // Find cycles with this line
    const cycles = this.findCycles();
    const previewTerritories = [];

    for (const cycle of cycles) {
      const cycleKey = this.normalizeCycle(cycle)
        .map(p => `${p.x},${p.y}`)
        .join('|');

      if (!this.territories.has(cycleKey)) {
        const area = this.calculateArea(cycle);
        previewTerritories.push({ points: cycle, area });
      }
    }

    // Remove the temporary line
    this.lines.delete(key);

    return previewTerritories;
  }

  /**
   * Check if the game is over (no more valid lines can be placed)
   */
  isGameOver() {
    for (let y1 = 0; y1 < this.gridSize; y1++) {
      for (let x1 = 0; x1 < this.gridSize; x1++) {
        for (let y2 = 0; y2 < this.gridSize; y2++) {
          for (let x2 = 0; x2 < this.gridSize; x2++) {
            if (this.isValidLine(x1, y1, x2, y2)) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Get all possible valid lines
   */
  getValidLines() {
    const validLines = [];
    for (let y1 = 0; y1 < this.gridSize; y1++) {
      for (let x1 = 0; x1 < this.gridSize; x1++) {
        for (let y2 = 0; y2 < this.gridSize; y2++) {
          for (let x2 = 0; x2 < this.gridSize; x2++) {
            if (this.isValidLine(x1, y1, x2, y2)) {
              validLines.push({ x1, y1, x2, y2 });
            }
          }
        }
      }
    }
    return validLines;
  }

  /**
   * Serialize the board state
   */
  serialize() {
    return {
      gridSize: this.gridSize,
      lines: Array.from(this.lines.entries()),
      territories: Array.from(this.territories.entries())
    };
  }

  /**
   * Deserialize board state
   */
  deserialize(data) {
    this.gridSize = data.gridSize;
    this.lines = new Map(data.lines);
    this.territories = new Map(data.territories);
    this.initDots();
  }

  /**
   * Reset the board
   */
  reset() {
    this.lines.clear();
    this.territories.clear();
    this.initDots();
  }
}
