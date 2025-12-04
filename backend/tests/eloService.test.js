/**
 * ELO Service Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EloService } from '../src/elo/eloService.js';

describe('EloService', () => {
  let eloService;

  beforeEach(() => {
    eloService = new EloService();
  });

  describe('getRating', () => {
    it('should return default rating for new player', () => {
      const rating = eloService.getRating('new-player');
      assert.strictEqual(rating.rating, 1500);
      assert.strictEqual(rating.gamesPlayed, 0);
    });

    it('should return existing rating for known player', () => {
      eloService.ratings.set('existing-player', {
        rating: 1600,
        gamesPlayed: 10,
        wins: 6,
        losses: 4,
        draws: 0
      });
      
      const rating = eloService.getRating('existing-player');
      assert.strictEqual(rating.rating, 1600);
      assert.strictEqual(rating.gamesPlayed, 10);
    });
  });

  describe('expectedScore', () => {
    it('should return 0.5 for equal ratings', () => {
      const expected = eloService.expectedScore(1500, 1500);
      assert.strictEqual(expected, 0.5);
    });

    it('should return higher score for higher-rated player', () => {
      const expected = eloService.expectedScore(1600, 1400);
      assert.ok(expected > 0.5);
    });

    it('should return lower score for lower-rated player', () => {
      const expected = eloService.expectedScore(1400, 1600);
      assert.ok(expected < 0.5);
    });
  });

  describe('getKFactor', () => {
    it('should return provisional K for new players', () => {
      const playerData = { gamesPlayed: 5 };
      const k = eloService.getKFactor(playerData);
      assert.strictEqual(k, 64);
    });

    it('should return standard K for established players', () => {
      const playerData = { gamesPlayed: 15 };
      const k = eloService.getKFactor(playerData);
      assert.strictEqual(k, 32);
    });
  });

  describe('updateRatings', () => {
    it('should increase winner rating and decrease loser rating', async () => {
      const result = await eloService.updateRatings('player1', 'player2', 1);
      
      assert.ok(result.player1.change > 0);
      assert.ok(result.player2.change < 0);
    });

    it('should update both ratings equally for a draw', async () => {
      // Equal rated players
      const result = await eloService.updateRatings('player1', 'player2', 0.5);
      
      // For equal ratings drawing, changes should be 0 or very small
      assert.ok(Math.abs(result.player1.change) < 1);
      assert.ok(Math.abs(result.player2.change) < 1);
    });

    it('should update win/loss/draw counts', async () => {
      await eloService.updateRatings('player1', 'player2', 1);
      
      const p1 = eloService.getRating('player1');
      const p2 = eloService.getRating('player2');
      
      assert.strictEqual(p1.wins, 1);
      assert.strictEqual(p1.losses, 0);
      assert.strictEqual(p2.wins, 0);
      assert.strictEqual(p2.losses, 1);
    });

    it('should increment games played', async () => {
      await eloService.updateRatings('player1', 'player2', 1);
      
      const p1 = eloService.getRating('player1');
      const p2 = eloService.getRating('player2');
      
      assert.strictEqual(p1.gamesPlayed, 1);
      assert.strictEqual(p2.gamesPlayed, 1);
    });
  });

  describe('recordMatch', () => {
    it('should store match record', async () => {
      const match = await eloService.recordMatch({
        gameId: 'game-1',
        player1Id: 'p1',
        player2Id: 'p2',
        winner: 1,
        scores: { 1: 10, 2: 5 }
      });
      
      assert.ok(match.id);
      assert.strictEqual(match.gameId, 'game-1');
    });
  });

  describe('getPlayerStats', () => {
    it('should return player statistics', async () => {
      await eloService.updateRatings('player1', 'player2', 1);
      await eloService.updateRatings('player1', 'player3', 1);
      
      const stats = eloService.getPlayerStats('player1');
      
      assert.strictEqual(stats.gamesPlayed, 2);
      assert.strictEqual(stats.wins, 2);
      assert.strictEqual(stats.winRate, '100.0%');
    });
  });

  describe('getLeaderboard', () => {
    it('should return sorted leaderboard', async () => {
      eloService.ratings.set('p1', { rating: 1600, gamesPlayed: 5, wins: 3, losses: 2, draws: 0 });
      eloService.ratings.set('p2', { rating: 1800, gamesPlayed: 5, wins: 4, losses: 1, draws: 0 });
      eloService.ratings.set('p3', { rating: 1400, gamesPlayed: 5, wins: 2, losses: 3, draws: 0 });
      
      const leaderboard = eloService.getLeaderboard(3);
      
      assert.strictEqual(leaderboard.length, 3);
      assert.strictEqual(leaderboard[0].rating, 1800);
      assert.strictEqual(leaderboard[1].rating, 1600);
      assert.strictEqual(leaderboard[2].rating, 1400);
    });

    it('should limit results', () => {
      eloService.ratings.set('p1', { rating: 1600, gamesPlayed: 5, wins: 3, losses: 2, draws: 0 });
      eloService.ratings.set('p2', { rating: 1800, gamesPlayed: 5, wins: 4, losses: 1, draws: 0 });
      eloService.ratings.set('p3', { rating: 1400, gamesPlayed: 5, wins: 2, losses: 3, draws: 0 });
      
      const leaderboard = eloService.getLeaderboard(2);
      
      assert.strictEqual(leaderboard.length, 2);
    });
  });

  describe('getMatchHistory', () => {
    it('should return match history for a player', async () => {
      await eloService.recordMatch({ player1Id: 'p1', player2Id: 'p2', winner: 1 });
      await eloService.recordMatch({ player1Id: 'p1', player2Id: 'p3', winner: 1 });
      await eloService.recordMatch({ player1Id: 'p2', player2Id: 'p3', winner: 2 });
      
      const history = eloService.getMatchHistory('p1');
      
      assert.strictEqual(history.length, 2);
    });
  });
});
