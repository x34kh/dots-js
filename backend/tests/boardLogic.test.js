/**
 * Board Logic Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { BoardLogic } from '../src/game/boardLogic.js';

describe('BoardLogic', () => {
  let board;

  beforeEach(() => {
    board = new BoardLogic(5);
  });

  describe('initialization', () => {
    it('should create a 5x5 grid of dots', () => {
      assert.strictEqual(board.dots.length, 25);
    });

    it('should start with no lines', () => {
      assert.strictEqual(board.lines.size, 0);
    });

    it('should start with no territories', () => {
      assert.strictEqual(board.territories.size, 0);
    });
  });

  describe('line key generation', () => {
    it('should generate consistent keys regardless of direction', () => {
      const key1 = board.getLineKey(0, 0, 1, 0);
      const key2 = board.getLineKey(1, 0, 0, 0);
      assert.strictEqual(key1, key2);
    });

    it('should generate unique keys for different lines', () => {
      const key1 = board.getLineKey(0, 0, 1, 0);
      const key2 = board.getLineKey(0, 0, 0, 1);
      assert.notStrictEqual(key1, key2);
    });
  });

  describe('adjacency check', () => {
    it('should return true for horizontally adjacent dots', () => {
      assert.strictEqual(board.areAdjacent(0, 0, 1, 0), true);
    });

    it('should return true for vertically adjacent dots', () => {
      assert.strictEqual(board.areAdjacent(0, 0, 0, 1), true);
    });

    it('should return true for diagonally adjacent dots', () => {
      assert.strictEqual(board.areAdjacent(0, 0, 1, 1), true);
    });

    it('should return false for non-adjacent dots', () => {
      assert.strictEqual(board.areAdjacent(0, 0, 2, 0), false);
    });

    it('should return false for the same dot', () => {
      assert.strictEqual(board.areAdjacent(0, 0, 0, 0), false);
    });
  });

  describe('line validation', () => {
    it('should allow valid lines between adjacent dots', () => {
      assert.strictEqual(board.isValidLine(0, 0, 1, 0), true);
    });

    it('should reject lines between non-adjacent dots', () => {
      assert.strictEqual(board.isValidLine(0, 0, 2, 0), false);
    });

    it('should reject lines to dots outside the grid', () => {
      assert.strictEqual(board.isValidLine(0, 0, -1, 0), false);
      assert.strictEqual(board.isValidLine(4, 4, 5, 4), false);
    });

    it('should reject duplicate lines', () => {
      board.placeLine(0, 0, 1, 0, 1);
      assert.strictEqual(board.isValidLine(0, 0, 1, 0), false);
      assert.strictEqual(board.isValidLine(1, 0, 0, 0), false);
    });
  });

  describe('line placement', () => {
    it('should successfully place a valid line', () => {
      const result = board.placeLine(0, 0, 1, 0, 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(board.lines.size, 1);
    });

    it('should fail to place an invalid line', () => {
      const result = board.placeLine(0, 0, 2, 0, 1);
      assert.strictEqual(result.success, false);
    });

    it('should return captured territories when a polygon is closed', () => {
      // Create a triangle
      board.placeLine(0, 0, 1, 0, 1);
      board.placeLine(1, 0, 0, 1, 1);
      const result = board.placeLine(0, 1, 0, 0, 1);
      
      assert.strictEqual(result.success, true);
      assert.ok(result.capturedTerritories.length > 0);
    });
  });

  describe('area calculation (Shoelace formula)', () => {
    it('should calculate area of a unit square correctly', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ];
      const area = board.calculateArea(points);
      assert.strictEqual(area, 1);
    });

    it('should calculate area of a triangle correctly', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 2 }
      ];
      const area = board.calculateArea(points);
      assert.strictEqual(area, 2);
    });
  });

  describe('game over detection', () => {
    it('should return false when valid lines remain', () => {
      assert.strictEqual(board.isGameOver(), false);
    });

    it('should return true when no valid lines remain', () => {
      // Fill all possible lines on a 2x2 grid for faster testing
      const smallBoard = new BoardLogic(2);
      
      // All horizontal lines
      smallBoard.placeLine(0, 0, 1, 0, 1);
      smallBoard.placeLine(0, 1, 1, 1, 1);
      
      // All vertical lines
      smallBoard.placeLine(0, 0, 0, 1, 1);
      smallBoard.placeLine(1, 0, 1, 1, 1);
      
      // All diagonal lines
      smallBoard.placeLine(0, 0, 1, 1, 1);
      smallBoard.placeLine(1, 0, 0, 1, 1);
      
      assert.strictEqual(smallBoard.isGameOver(), true);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      board.placeLine(0, 0, 1, 0, 1);
      board.placeLine(1, 0, 1, 1, 2);
      
      const serialized = board.serialize();
      
      const newBoard = new BoardLogic(5);
      newBoard.deserialize(serialized);
      
      assert.strictEqual(newBoard.lines.size, board.lines.size);
      assert.strictEqual(newBoard.gridSize, board.gridSize);
    });
  });

  describe('reset', () => {
    it('should clear all lines and territories', () => {
      board.placeLine(0, 0, 1, 0, 1);
      board.placeLine(1, 0, 0, 1, 1);
      board.placeLine(0, 1, 0, 0, 1);
      
      board.reset();
      
      assert.strictEqual(board.lines.size, 0);
      assert.strictEqual(board.territories.size, 0);
    });
  });
});

describe('Territory Detection', () => {
  let board;

  beforeEach(() => {
    board = new BoardLogic(5);
  });

  it('should detect a triangle closure', () => {
    board.placeLine(0, 0, 1, 0, 1);
    board.placeLine(1, 0, 0, 1, 1);
    const result = board.placeLine(0, 1, 0, 0, 1);
    
    assert.ok(result.capturedTerritories.length >= 1);
  });

  it('should detect a square closure', () => {
    board.placeLine(0, 0, 1, 0, 1);
    board.placeLine(1, 0, 1, 1, 1);
    board.placeLine(1, 1, 0, 1, 1);
    const result = board.placeLine(0, 1, 0, 0, 1);
    
    assert.ok(result.capturedTerritories.length >= 1);
  });

  it('should preview territory capture correctly', () => {
    board.placeLine(0, 0, 1, 0, 1);
    board.placeLine(1, 0, 0, 1, 1);
    
    const preview = board.previewCapture(0, 1, 0, 0);
    
    assert.ok(preview.length >= 1);
    // Line should not be placed
    assert.strictEqual(board.lines.size, 2);
  });
});
