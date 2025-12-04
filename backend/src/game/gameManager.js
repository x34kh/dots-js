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
    this.matchmakingQueue = []; // Players waiting for a match
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
  addToMatchmaking(playerId, playerData) {
    // Remove if already in queue
    this.removeFromMatchmaking(playerId);
    
    this.matchmakingQueue.push({
      playerId,
      playerData,
      joinedAt: Date.now()
    });

    // Try to match players
    return this.tryMatch(playerId);
  }

  /**
   * Remove player from matchmaking queue
   */
  removeFromMatchmaking(playerId) {
    this.matchmakingQueue = this.matchmakingQueue.filter(p => p.playerId !== playerId);
  }

  /**
   * Try to match waiting players
   */
  tryMatch(playerId) {
    if (this.matchmakingQueue.length < 2) {
      return { success: false, waiting: true };
    }

    // Find two players to match
    const player1 = this.matchmakingQueue.shift();
    const player2 = this.matchmakingQueue.shift();

    // Create game
    const gameId = uuidv4();
    const game = new GameState(gameId);
    
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
      game: this.getGameInfo(gameId)
    };
  }

  /**
   * Make a move in a game
   */
  makeMove(playerId, x1, y1, x2, y2) {
    const gameId = this.playerGames.get(playerId);
    if (!gameId) {
      return { success: false, error: 'Not in a game' };
    }

    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    const result = game.makeMove(playerId, x1, y1, x2, y2);

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

      // Update ELO
      await this.eloService.updateRatings(player1Id, player2Id, result);

      // Store match record
      await this.eloService.recordMatch({
        gameId,
        player1Id,
        player2Id,
        winner: game.winner,
        scores: game.scores,
        timestamp: new Date()
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
      winner: game.winner
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
