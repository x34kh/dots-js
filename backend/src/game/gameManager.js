/**
 * Game Manager
 * Manages all active games and matchmaking
 */

import { v4 as uuidv4 } from 'uuid';
import { GameState, GameStatus } from './gameState.js';

export class GameManager {
  constructor(eloService) {
    this.eloService = eloService;
    this.games = new Map(); // gameId -> GameState
    this.playerGames = new Map(); // playerId -> gameId
    this.rankedQueue = []; // Players waiting for ranked match
    this.unrankedQueue = []; // Players waiting for unranked match
  }

  /**
   * Create a new game
   */
  createGame(playerId, playerData) {
    const gameId = uuidv4();
    const game = new GameState(gameId);
    
    const result = game.addPlayer(playerId, playerData);
    if (!result.success) {
      return result;
    }

    this.games.set(gameId, game);
    this.playerGames.set(playerId, gameId);

    return {
      success: true,
      gameId,
      playerNumber: result.playerNumber
    };
  }

  /**
   * Join an existing game
   */
  joinGame(gameId, playerId, playerData) {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== GameStatus.WAITING) {
      return { success: false, error: 'Game already started or finished' };
    }

    const result = game.addPlayer(playerId, playerData);
    if (!result.success) {
      return result;
    }

    this.playerGames.set(playerId, gameId);

    return {
      success: true,
      gameId,
      playerNumber: result.playerNumber,
      game: this.getGameInfo(gameId)
    };
  }

  /**
   * Add player to matchmaking queue
   */
  addToMatchmaking(playerId, playerData, isRanked = false) {
    // Remove if already in queue
    this.removeFromMatchmaking(playerId);
    
    const queueEntry = {
      playerId,
      playerData,
      joinedAt: Date.now(),
      isRanked
    };

    const queue = isRanked ? this.rankedQueue : this.unrankedQueue;
    queue.push(queueEntry);

    // Try to match players
    return this.tryMatch(playerId, isRanked);
  }

  /**
   * Remove player from matchmaking queue
   */
  removeFromMatchmaking(playerId) {
    this.rankedQueue = this.rankedQueue.filter(p => p.playerId !== playerId);
    this.unrankedQueue = this.unrankedQueue.filter(p => p.playerId !== playerId);
  }

  /**
   * Try to match waiting players
   */
  tryMatch(playerId, isRanked = false) {
    const queue = isRanked ? this.rankedQueue : this.unrankedQueue;
    
    if (queue.length < 2) {
      return { success: false, waiting: true };
    }

    // Find two players to match
    const player1 = queue.shift();
    const player2 = queue.shift();

    // Create game
    const gameId = uuidv4();
    const game = new GameState(gameId);
    game.isRanked = isRanked; // Mark game as ranked/unranked
    
    game.addPlayer(player1.playerId, player1.playerData, 1);
    game.addPlayer(player2.playerId, player2.playerData, 2);

    this.games.set(gameId, game);
    this.playerGames.set(player1.playerId, gameId);
    this.playerGames.set(player2.playerId, gameId);

    return {
      success: true,
      gameId,
      player1: player1.playerId,
      player2: player2.playerId,
      game: this.getGameInfo(gameId),
      isRanked
    };
  }

  /**
   * Make a move in a game
   */
  makeMove(playerId, x, y) {
    const gameId = this.playerGames.get(playerId);
    if (!gameId) {
      return { success: false, error: 'Not in a game' };
    }

    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const result = game.makeMove(playerId, x, y);

    if (result.success && result.gameOver) {
      this.handleGameOver(gameId);
    }

    return {
      ...result,
      gameId,
      playerNum: game.getPlayerNumber(playerId)
    };
  }

  /**
   * Handle game over - update ELO
   */
  async handleGameOver(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    const player1Id = game.players[1]?.id;
    const player2Id = game.players[2]?.id;
    const player1Name = game.players[1]?.name || player1Id;
    const player2Name = game.players[2]?.name || player2Id;

    console.log(`Game over: ${gameId}, isRanked: ${game.isRanked}, winner: ${game.winner}`);

    if (player1Id && player2Id) {
      // Determine outcome
      let result;
      if (game.winner === 1) {
        result = 1;
      } else if (game.winner === 2) {
        result = 0;
      } else {
        result = 0.5; // Draw
      }

      // Only update ELO for ranked games
      if (game.isRanked) {
        console.log(`Updating ELO for ranked game: ${player1Name} vs ${player2Name}`);
        await this.eloService.updateRatings(player1Id, player2Id, result);
      } else {
        console.log(`Skipping ELO update for unranked game: ${player1Name} vs ${player2Name}`);
      }

      // Store match record with detailed info
      await this.eloService.recordMatch({
        gameId,
        player1Id,
        player1Name,
        player1Score: game.scores[1] || 0,
        player2Id,
        player2Name,
        player2Score: game.scores[2] || 0,
        winnerId: game.winner === 1 ? player1Id : game.winner === 2 ? player2Id : null,
        isRanked: game.isRanked || false,
        completedAt: new Date()
      });
    }
  }

  /**
   * Handle player disconnection
   */
  handleDisconnect(playerId) {
    const gameId = this.playerGames.get(playerId);
    if (!gameId) return null;

    const game = this.games.get(gameId);
    if (!game) return null;

    const result = game.removePlayer(playerId);
    this.playerGames.delete(playerId);

    // Also remove from matchmaking
    this.removeFromMatchmaking(playerId);

    return {
      gameId,
      ...result
    };
  }

  /**
   * Get game information
   */
  getGame(gameId) {
    return this.games.get(gameId);
  }

  /**
   * Get simplified game info for clients
   */
  getGameInfo(gameId) {
    const game = this.games.get(gameId);
    if (!game) return null;

    return {
      id: game.id,
      players: game.players,
      scores: game.scores,
      currentPlayer: game.currentPlayer,
      status: game.status,
      winner: game.winner,
      isRanked: game.isRanked || false
    };
  }

  /**
   * Get game for a player
   */
  getPlayerGame(playerId) {
    const gameId = this.playerGames.get(playerId);
    return gameId ? this.games.get(gameId) : null;
  }

  /**
   * Get queue stats
   */
  getQueueStats() {
    return {
      rankedQueue: this.rankedQueue.length,
      unrankedQueue: this.unrankedQueue.length,
      activeGames: this.games.size
    };
  }

  /**
   * Remove finished games periodically
   */
  cleanup() {
    const now = Date.now();
    const timeout = 24 * 60 * 60 * 1000; // 24 hours

    for (const [gameId, game] of this.games) {
      if (game.status === GameStatus.FINISHED || game.status === GameStatus.ABANDONED) {
        if (now - game.finishedAt > timeout) {
          // Remove game and player references
          for (const num of [1, 2]) {
            if (game.players[num]) {
              this.playerGames.delete(game.players[num].id);
            }
          }
          this.games.delete(gameId);
        }
      }
    }
  }
}
