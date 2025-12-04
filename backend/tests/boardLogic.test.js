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
      assert.strictEqual(board.dots.size, 25);
    });

    it('should start with no captured areas', () => {
      assert.strictEqual(board.capturedAreas.length, 0);
    });

    it('should have all dots unowned and uncaptured', () => {
      for (const [, dot] of board.dots) {
        assert.strictEqual(dot.owner, null);
        assert.strictEqual(dot.captured, false);
      }
    });
  });

  describe('dot access', () => {
    it('should get dot at valid position', () => {
      const dot = board.getDot(2, 3);
      assert.strictEqual(dot.x, 2);
      assert.strictEqual(dot.y, 3);
    });

    it('should return undefined for invalid position', () => {
      const dot = board.getDot(10, 10);
      assert.strictEqual(dot, undefined);
    });
  });

  describe('dot clickability', () => {
    it('should return true for unowned uncaptured dots', () => {
      assert.strictEqual(board.isDotClickable(2, 2), true);
    });

    it('should return false for owned dots', () => {
      board.occupyDot(2, 2, 1);
      assert.strictEqual(board.isDotClickable(2, 2), false);
    });

    it('should return false for out of bounds', () => {
      assert.strictEqual(board.isDotClickable(-1, 0), false);
      assert.strictEqual(board.isDotClickable(5, 0), false);
    });
  });

  describe('dot occupation', () => {
    it('should successfully occupy an unowned dot', () => {
      const result = board.occupyDot(2, 2, 1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(board.getDot(2, 2).owner, 1);
    });

    it('should fail to occupy an already owned dot', () => {
      board.occupyDot(2, 2, 1);
      const result = board.occupyDot(2, 2, 2);
      assert.strictEqual(result.success, false);
    });

    it('should return captured dots on successful occupation', () => {
      const result = board.occupyDot(2, 2, 1);
      assert.ok(Array.isArray(result.capturedDots));
    });
  });

  describe('territory capture (enclosure)', () => {
    it('should capture enclosed dots when surrounded', () => {
      // Create a 3x3 enclosure pattern
      // Player 1 surrounds dot (2,2) with dots at cardinal directions
      board.occupyDot(1, 2, 1); // left
      board.occupyDot(3, 2, 1); // right  
      board.occupyDot(2, 1, 1); // top
      const result = board.occupyDot(2, 3, 1); // bottom - completes enclosure
      
      // The center dot (2,2) should now be captured
      const centerDot = board.getDot(2, 2);
      assert.strictEqual(centerDot.captured, true);
      assert.strictEqual(centerDot.capturedBy, 1);
    });

    it('should not capture dots touching the border', () => {
      // Try to enclose corner area
      board.occupyDot(1, 0, 1); // top edge
      board.occupyDot(0, 1, 1); // left edge
      
      // Corner dot (0,0) touches the border, should not be captured
      const cornerDot = board.getDot(0, 0);
      assert.strictEqual(cornerDot.captured, false);
    });

    it('should not capture dots with opponent dots inside', () => {
      // Place opponent dot inside potential enclosure
      board.occupyDot(2, 2, 2); // opponent in center
      
      // Try to enclose with player 1
      board.occupyDot(1, 2, 1);
      board.occupyDot(3, 2, 1);
      board.occupyDot(2, 1, 1);
      board.occupyDot(2, 3, 1);
      
      // Adjacent unowned dots should not be captured because opponent breaks enclosure
      const adjacentDot = board.getDot(1, 1);
      assert.strictEqual(adjacentDot.captured, false);
    });
  });

  describe('preview capture', () => {
    it('should preview captured dots correctly', () => {
      // Set up almost-enclosure
      board.occupyDot(1, 2, 1);
      board.occupyDot(3, 2, 1);
      board.occupyDot(2, 1, 1);
      
      // Preview what happens if we complete the enclosure
      const preview = board.previewCapture(2, 3, 1);
      
      // Should preview capture of (2,2)
      assert.ok(preview.length > 0);
      
      // The dot should still be unoccupied after preview
      assert.strictEqual(board.getDot(2, 3).owner, null);
    });

    it('should return empty array for invalid move', () => {
      board.occupyDot(2, 2, 1);
      const preview = board.previewCapture(2, 2, 2);
      assert.strictEqual(preview.length, 0);
    });
  });

  describe('game over detection', () => {
    it('should return false when clickable dots remain', () => {
      assert.strictEqual(board.isGameOver(), false);
    });

    it('should return true when no clickable dots remain', () => {
      // Fill entire 2x2 grid
      const smallBoard = new BoardLogic(2);
      smallBoard.occupyDot(0, 0, 1);
      smallBoard.occupyDot(1, 0, 2);
      smallBoard.occupyDot(0, 1, 1);
      smallBoard.occupyDot(1, 1, 2);
      
      assert.strictEqual(smallBoard.isGameOver(), true);
    });
  });

  describe('score calculation', () => {
    it('should calculate score correctly', () => {
      board.occupyDot(0, 0, 1);
      board.occupyDot(1, 1, 1);
      
      const score = board.calculateScore(1);
      assert.strictEqual(score, 2);
    });

    it('should include captured dots in score', () => {
      // Create enclosure
      board.occupyDot(1, 2, 1);
      board.occupyDot(3, 2, 1);
      board.occupyDot(2, 1, 1);
      board.occupyDot(2, 3, 1);
      
      const score = board.calculateScore(1);
      // 4 owned dots + captured dots
      assert.ok(score >= 4);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      board.occupyDot(0, 0, 1);
      board.occupyDot(1, 1, 2);
      
      const serialized = board.serialize();
      
      const newBoard = new BoardLogic(5);
      newBoard.deserialize(serialized);
      
      assert.strictEqual(newBoard.dots.size, board.dots.size);
      assert.strictEqual(newBoard.gridSize, board.gridSize);
    });
  });

  describe('reset', () => {
    it('should clear all dot ownership and captures', () => {
      board.occupyDot(0, 0, 1);
      board.occupyDot(1, 1, 2);
      
      board.reset();
      
      assert.strictEqual(board.capturedAreas.length, 0);
      for (const [, dot] of board.dots) {
        assert.strictEqual(dot.owner, null);
        assert.strictEqual(dot.captured, false);
      }
    });
  });
});

describe('Territory Detection', () => {
  let board;

  beforeEach(() => {
    board = new BoardLogic(5);
  });

  it('should detect simple enclosure', () => {
    // Create a simple box enclosure around (2,2)
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(1, 2, 1);
    board.occupyDot(3, 2, 1);
    board.occupyDot(1, 3, 1);
    board.occupyDot(2, 3, 1);
    board.occupyDot(3, 3, 1);
    
    const centerDot = board.getDot(2, 2);
    assert.strictEqual(centerDot.captured, true);
  });

  it('should handle multiple captures', () => {
    // Create enclosure with multiple dots inside
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(4, 1, 1);
    board.occupyDot(1, 2, 1);
    board.occupyDot(4, 2, 1);
    board.occupyDot(1, 3, 1);
    board.occupyDot(4, 3, 1);
    board.occupyDot(1, 4, 1);
    board.occupyDot(2, 4, 1);
    board.occupyDot(3, 4, 1);
    board.occupyDot(4, 4, 1);
    
    // Multiple dots should be captured
    const capturedCount = board.getCapturedDotsForPlayer(1).length;
    assert.ok(capturedCount >= 4);
  });
});
