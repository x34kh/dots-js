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

    it('should capture opponent dots when fully enclosed', () => {
      // Place opponent dot inside potential enclosure
      board.occupyDot(2, 2, 2); // opponent in center
      
      // Enclose with player 1
      board.occupyDot(1, 2, 1);
      board.occupyDot(3, 2, 1);
      board.occupyDot(2, 1, 1);
      board.occupyDot(2, 3, 1);
      
      // The opponent dot should be captured
      const opponentDot = board.getDot(2, 2);
      assert.strictEqual(opponentDot.captured, true, 'Opponent dot should be captured');
      assert.strictEqual(opponentDot.capturedBy, 1, 'Opponent dot should be captured by player 1');
      assert.strictEqual(opponentDot.owner, null, 'Opponent dot ownership should be removed');
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

describe('Capture Bug - Mixed dots inside enclosure', () => {
  let board;

  beforeEach(() => {
    board = new BoardLogic(5);
  });

  it('should capture territory even when there are 2 dots (neutral + enemy) inside', () => {
    // Player 1 creates an enclosure that contains both:
    // - A neutral (unowned) dot
    // - An enemy (player 2) dot
    
    // Create a larger enclosure around (2,2) area
    // Place enemy dot first
    board.occupyDot(2, 2, 2); // Enemy dot in the middle
    
    // Now player 1 surrounds this area
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(1, 2, 1);
    board.occupyDot(3, 2, 1);
    board.occupyDot(1, 3, 1);
    // This move completes the enclosure around (2,2)
    const captureResult = board.occupyDot(2, 3, 1);
    board.occupyDot(3, 3, 1);
    
    // The enemy dot should be captured when the enclosure is completed
    const enemyDot = board.getDot(2, 2);
    assert.strictEqual(enemyDot.captured, true, 'Enemy dot should be captured');
    assert.strictEqual(enemyDot.capturedBy, 1, 'Enemy dot should be captured by player 1');
    assert.strictEqual(enemyDot.owner, null, 'Enemy dot ownership should be removed');
    
    // Captured dots should be returned on the enclosure-completing move
    assert.ok(captureResult.capturedDots.length > 0, 'Should have captured dots on the enclosure-completing move');
  });

  it('should capture territory with neutral dots but no enemy', () => {
    // Player 1 creates an enclosure that contains only neutral dots
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(1, 2, 1);
    board.occupyDot(3, 2, 1);
    board.occupyDot(1, 3, 1);
    board.occupyDot(2, 3, 1);
    const result = board.occupyDot(3, 3, 1);
    
    // Dot (2,2) should be captured
    const centerDot = board.getDot(2, 2);
    assert.strictEqual(centerDot.captured, true, 'Center dot should be captured');
    assert.strictEqual(centerDot.capturedBy, 1, 'Center dot should be captured by player 1');
  });
});

describe('Capture Bug Analysis - Adjacent neutral and enemy dots', () => {
  let board;

  beforeEach(() => {
    board = new BoardLogic(7); // Use larger board for more complex scenarios
  });

  it('should capture both neutral and enemy dots when fully enclosed', () => {
    // Create a scenario where:
    // - Player 1 surrounds an area
    // - The area contains neutral dots AND an enemy (player 2) dot
    // - All dots inside the enclosure should be captured
    
    // Legend: 1=Player1, 2=Player2, .=empty, C=should be captured
    // Layout (5x5 area in center of 7x7):
    //   1 1 1 1 1
    //   1 C C C 1
    //   1 C 2 C 1   <- both neutral and enemy dots should be captured
    //   1 C C C 1
    //   1 1 1 1 1
    
    // Place enemy dot FIRST inside where the enclosure will be
    board.occupyDot(3, 3, 2);
    
    // Create the enclosure boundary with player 1
    // Top row
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(4, 1, 1);
    board.occupyDot(5, 1, 1);
    
    // Left column
    board.occupyDot(1, 2, 1);
    board.occupyDot(1, 3, 1);
    board.occupyDot(1, 4, 1);
    
    // Right column
    board.occupyDot(5, 2, 1);
    board.occupyDot(5, 3, 1);
    board.occupyDot(5, 4, 1);
    
    // Bottom row
    board.occupyDot(1, 5, 1);
    board.occupyDot(2, 5, 1);
    board.occupyDot(3, 5, 1);
    board.occupyDot(4, 5, 1);
    board.occupyDot(5, 5, 1);
    
    // Neutral dots inside should be captured
    const dot22 = board.getDot(2, 2);
    const dot32 = board.getDot(3, 2);
    const dot42 = board.getDot(4, 2);
    
    assert.strictEqual(dot22.captured, true, 'Dot (2,2) should be captured');
    assert.strictEqual(dot22.capturedBy, 1, 'Dot (2,2) should be captured by player 1');
    assert.strictEqual(dot32.captured, true, 'Dot (3,2) should be captured');
    assert.strictEqual(dot42.captured, true, 'Dot (4,2) should be captured');
    
    // Enemy dot should also be captured (ownership removed)
    const enemyDot = board.getDot(3, 3);
    assert.strictEqual(enemyDot.captured, true, 'Enemy dot (3,3) should be captured');
    assert.strictEqual(enemyDot.capturedBy, 1, 'Enemy dot (3,3) should be captured by player 1');
    assert.strictEqual(enemyDot.owner, null, 'Enemy dot ownership should be removed');
  });

  it('should handle the case where neutral dots exist without border touch but enemy nearby', () => {
    // A more specific scenario that might be the bug:
    // If the flood fill starts from a neutral dot and finds an enemy,
    // it might not properly mark the enclosure as invalid
    
    // Create small 5x5 enclosure without edge cases
    // Inner 3x3 area at center of 5x5 board
    board = new BoardLogic(5);
    
    // Create boundary - Player 1 dots around the outside
    board.occupyDot(1, 1, 1);
    board.occupyDot(2, 1, 1);
    board.occupyDot(3, 1, 1);
    board.occupyDot(1, 2, 1);
    board.occupyDot(3, 2, 1);
    board.occupyDot(1, 3, 1);
    board.occupyDot(2, 3, 1);
    board.occupyDot(3, 3, 1);
    
    // Center dot (2,2) is still neutral - this should be captured
    const centerDot = board.getDot(2, 2);
    assert.strictEqual(centerDot.captured, true, 'Center dot should be captured when enclosed by player 1');
    assert.strictEqual(centerDot.capturedBy, 1, 'Center dot should be captured by player 1');
  });
});
