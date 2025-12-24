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
  constructor(gameId, gridSize = 10) {
    this.id = gameId;
    this.gridSize = gridSize; // Store grid size
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
    console.log(`getPlayerNumber: looking for playerId=${playerId}`);
    console.log(`  Player 1: ${this.players[1] ? this.players[1].id : 'null'}`);
    console.log(`  Player 2: ${this.players[2] ? this.players[2].id : 'null'}`);
    
    if (this.players[1] && this.players[1].id === playerId) {
      console.log('  -> Found as Player 1');
      return 1;
    }
    if (this.players[2] && this.players[2].id === playerId) {
      console.log('  -> Found as Player 2');
      return 2;
    }
    console.log('  -> NOT FOUND!');
    return null;
  }

  isPlayerTurn(playerId) {
    const playerNum = this.getPlayerNumber(playerId);
    const isTurn = playerNum === this.currentPlayer;
    console.log(`isPlayerTurn: playerNum=${playerNum}, currentPlayer=${this.currentPlayer}, isTurn=${isTurn}`);
    return isTurn;
  }

  makeMove(playerId, x, y) {
    console.log(`GameState.makeMove: playerId=${playerId}, x=${x}, y=${y}, currentPlayer=${this.currentPlayer}`);
    
    // Validate it's player's turn
    if (!this.isPlayerTurn(playerId)) {
      console.log('Move rejected: not player turn. Player number:', this.getPlayerNumber(playerId));
      return { success: false, error: 'Not your turn' };
    }

    // Validate game is in progress
    if (this.status !== GameStatus.PLAYING) {
      console.log('Move rejected: game not in progress. Status:', this.status);
      return { success: false, error: 'Game not in progress' };
    }

    const playerNum = this.currentPlayer;
    console.log('Attempting occupyDot with playerNum:', playerNum);
    const result = this.boardLogic.occupyDot(x, y, playerNum);
    console.log('occupyDot result:', result);

    if (!result.success) {
      console.log('Move rejected by boardLogic - invalid position or dot not clickable');
      return { success: false, error: `Invalid move - position (${x},${y}) is not available` };
    }

    // Record move
    this.moves.push({
      player: playerNum,
      move: { x, y },
      captures: result.capturedDots,
      timestamp: new Date()
    });

    // Handle scoring: 1 for the dot + captured dots
    // First deduct points from players who lost territory
    if (result.lostByPlayers) {
      for (const [lostPlayerNum, lostDotCount] of result.lostByPlayers) {
        this.scores[lostPlayerNum] -= lostDotCount;
      }
    }
    
    // Then award points to capturing player
    const points = 1 + result.capturedDots.length;
    this.scores[playerNum] += points;

    // Always switch turns in dot occupation game
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    console.log('Turn switched to player:', this.currentPlayer);

    // Check game over
    if (this.boardLogic.isGameOver()) {
      this.finishGame();
    }

    return {
      success: true,
      captures: result.capturedDots,
      continuesTurn: false, // No extra turns in dot game
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
