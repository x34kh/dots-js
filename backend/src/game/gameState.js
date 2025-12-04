/**
 * Game State
 * Represents a single game instance
 */

import { BoardLogic } from './boardLogic.js';

export const GameStatus = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished',
  ABANDONED: 'abandoned'
};

export class GameState {
  constructor(gameId, gridSize = 5) {
    this.id = gameId;
    this.boardLogic = new BoardLogic(gridSize);
    this.players = {
      1: null,
      2: null
    };
    this.scores = {
      1: 0,
      2: 0
    };
    this.currentPlayer = 1;
    this.status = GameStatus.WAITING;
    this.createdAt = new Date();
    this.startedAt = null;
    this.finishedAt = null;
    this.moves = [];
    this.winner = null;
  }

  addPlayer(playerId, playerData, playerNumber = null) {
    // Auto-assign player number if not specified
    if (playerNumber === null) {
      if (!this.players[1]) {
        playerNumber = 1;
      } else if (!this.players[2]) {
        playerNumber = 2;
      } else {
        return { success: false, error: 'Game is full' };
      }
    }

    if (this.players[playerNumber]) {
      return { success: false, error: 'Player slot taken' };
    }

    this.players[playerNumber] = {
      id: playerId,
      ...playerData
    };

    // Start game if both players present
    if (this.players[1] && this.players[2]) {
      this.status = GameStatus.PLAYING;
      this.startedAt = new Date();
    }

    return { success: true, playerNumber };
  }

  removePlayer(playerId) {
    for (const num of [1, 2]) {
      if (this.players[num] && this.players[num].id === playerId) {
        this.players[num] = null;
        
        if (this.status === GameStatus.PLAYING) {
          this.status = GameStatus.ABANDONED;
          // Other player wins by forfeit
          this.winner = num === 1 ? 2 : 1;
        }
        
        return { success: true, playerNumber: num };
      }
    }
    return { success: false, error: 'Player not in game' };
  }

  getPlayerNumber(playerId) {
    if (this.players[1] && this.players[1].id === playerId) return 1;
    if (this.players[2] && this.players[2].id === playerId) return 2;
    return null;
  }

  isPlayerTurn(playerId) {
    return this.getPlayerNumber(playerId) === this.currentPlayer;
  }

  makeMove(playerId, x1, y1, x2, y2) {
    // Validate it's player's turn
    if (!this.isPlayerTurn(playerId)) {
      return { success: false, error: 'Not your turn' };
    }

    // Validate game is in progress
    if (this.status !== GameStatus.PLAYING) {
      return { success: false, error: 'Game not in progress' };
    }

    const playerNum = this.currentPlayer;
    const result = this.boardLogic.placeLine(x1, y1, x2, y2, playerNum);

    if (!result.success) {
      return { success: false, error: 'Invalid move' };
    }

    // Record move
    this.moves.push({
      player: playerNum,
      move: { x1, y1, x2, y2 },
      captures: result.capturedTerritories,
      timestamp: new Date()
    });

    // Handle captures and scoring
    let continuesTurn = false;
    if (result.capturedTerritories.length > 0) {
      const points = result.capturedTerritories.reduce((sum, t) => sum + t.area, 0);
      this.scores[playerNum] += points;
      continuesTurn = true;
    } else {
      // Switch turns
      this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    }

    // Check game over
    if (this.boardLogic.isGameOver()) {
      this.finishGame();
    }

    return {
      success: true,
      captures: result.capturedTerritories,
      continuesTurn,
      currentPlayer: this.currentPlayer,
      gameOver: this.status === GameStatus.FINISHED
    };
  }

  finishGame() {
    this.status = GameStatus.FINISHED;
    this.finishedAt = new Date();
    
    if (this.scores[1] > this.scores[2]) {
      this.winner = 1;
    } else if (this.scores[2] > this.scores[1]) {
      this.winner = 2;
    } else {
      this.winner = null; // Draw
    }
  }

  serialize() {
    return {
      id: this.id,
      board: this.boardLogic.serialize(),
      players: this.players,
      scores: this.scores,
      currentPlayer: this.currentPlayer,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      moves: this.moves,
      winner: this.winner
    };
  }

  static deserialize(data) {
    const game = new GameState(data.id);
    game.boardLogic.deserialize(data.board);
    game.players = data.players;
    game.scores = data.scores;
    game.currentPlayer = data.currentPlayer;
    game.status = data.status;
    game.createdAt = new Date(data.createdAt);
    game.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    game.finishedAt = data.finishedAt ? new Date(data.finishedAt) : null;
    game.moves = data.moves;
    game.winner = data.winner;
    return game;
  }
}
