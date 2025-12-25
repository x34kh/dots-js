/**
 * Async/Turn-based Game Manager
 * Handles persistent turn-based games with time limits
 */

export class AsyncGameManager {
  constructor(eloService) {
    this.eloService = eloService;
    this.games = new Map(); // gameId -> game state
    this.playerGames = new Map(); // userId -> Set of gameIds
    this.maxGamesPerPlayer = 5;
    
    // Time limits in milliseconds
    this.timeLimits = {
      ranked: 24 * 60 * 60 * 1000, // 1 day for ranked
      unranked: 7 * 24 * 60 * 60 * 1000 // 7 days for unranked
    };
    
    // Start timeout checker
    this.startTimeoutChecker();
  }

  /**
   * Create a new async game
   */
  createGame(player1Id, player2Id, gridSize = 10, isRanked = false, player1Name = 'Player 1', player2Name = 'Player 2', player1Nickname = null, player2Nickname = null) {
    // Check player game limits
    if (this.getPlayerActiveGameCount(player1Id) >= this.maxGamesPerPlayer) {
      throw new Error('Player 1 has reached maximum active games');
    }
    if (this.getPlayerActiveGameCount(player2Id) >= this.maxGamesPerPlayer) {
      throw new Error('Player 2 has reached maximum active games');
    }

    const gameId = this.generateGameId();
    const timeLimit = isRanked ? this.timeLimits.ranked : this.timeLimits.unranked;
    
    const game = {
      id: gameId,
      player1Id,
      player2Id,
      player1Name,
      player2Name,
      player1Nickname,
      player2Nickname,
      gridSize,
      isRanked,
      currentPlayer: 1,
      board: this.createEmptyBoard(gridSize),
      scores: { 1: 0, 2: 0 },
      moves: [],
      turnDeadline: Date.now() + timeLimit,
      timeLimit,
      status: 'active', // active, completed, timeout
      createdAt: Date.now(),
      lastMoveAt: Date.now()
    };

    this.games.set(gameId, game);
    this.addGameToPlayer(player1Id, gameId);
    this.addGameToPlayer(player2Id, gameId);

    return game;
  }

  /**
   * Make a move in an async game
   */
  makeMove(gameId, userId, x, y) {
    console.log(`AsyncGameManager.makeMove: gameId=${gameId}, userId=${userId}, x=${x}, y=${y}`);
    const game = this.games.get(gameId);
    if (!game) {
      console.error('Game not found:', gameId);
      throw new Error('Game not found');
    }

    console.log('Current game state:', { 
      currentPlayer: game.currentPlayer, 
      moveCount: game.moves.length,
      status: game.status 
    });

    if (game.status !== 'active') {
      throw new Error('Game is not active');
    }

    // Verify it's the player's turn
    const playerNum = game.player1Id === userId ? 1 : 2;
    console.log(`Player ${userId} is player number ${playerNum}`);
    if (game.currentPlayer !== playerNum) {
      throw new Error('Not your turn');
    }

    // Check if move is valid
    if (game.board[y][x] !== 0) {
      throw new Error('Position already occupied');
    }

    // Apply move
    game.board[y][x] = playerNum;
    const moveData = { x, y, player: playerNum, timestamp: Date.now() };
    game.moves.push(moveData);
    console.log('Move added to game.moves array:', moveData);
    console.log('Total moves now:', game.moves.length);

    // Calculate captured dots (simplified - you'll need to integrate with boardLogic)
    const capturedDots = this.calculateCapture(game, x, y, playerNum);
    const points = 1 + capturedDots.length;
    game.scores[playerNum] += points;

    // Mark captured dots
    for (const dot of capturedDots) {
      game.board[dot.y][dot.x] = -playerNum; // Negative indicates captured
    }

    // Switch turn
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;
    game.lastMoveAt = Date.now();
    game.turnDeadline = Date.now() + game.timeLimit;
    console.log('Turn switched to player', game.currentPlayer);

    // Check if game is over
    if (this.isGameComplete(game)) {
      this.endGame(gameId);
    }

    return {
      success: true,
      game: this.getGameInfo(gameId, userId),
      capturedDots
    };
  }

  /**
   * Calculate captured territory (simplified version)
   * TODO: Integrate with actual BoardLogic for accurate capture detection
   */
  calculateCapture(game, x, y, playerNum) {
    // This is a placeholder - you should integrate with your actual BoardLogic
    // For now, return empty array
    return [];
  }

  /**
   * Check if game is complete
   */
  isGameComplete(game) {
    // Game is complete if all dots are occupied or captured
    for (let y = 0; y < game.gridSize; y++) {
      for (let x = 0; x < game.gridSize; x++) {
        if (game.board[y][x] === 0) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * End a game
   */
  endGame(gameId, reason = 'completed') {
    const game = this.games.get(gameId);
    if (!game) return;

    game.status = reason;
    game.completedAt = Date.now();

    // Determine winner
    // If game already has a winner set (e.g., from forfeit), use it
    // Otherwise determine by score
    let winnerId;
    if (game.winner) {
      // Winner already set (forfeit, disconnect, etc.)
      winnerId = game.winner === 1 ? game.player1Id : game.player2Id;
    } else {
      // Determine winner by score
      winnerId = game.scores[1] > game.scores[2] ? game.player1Id : 
                 game.scores[2] > game.scores[1] ? game.player2Id : null;
    }

    console.log(`Async game over: ${gameId}, isRanked: ${game.isRanked}, winner: ${winnerId}, reason: ${reason}`);

    // Update ELO if ranked
    if (game.isRanked && winnerId) {
      console.log(`Updating ELO for ranked async game: ${game.player1Name} vs ${game.player2Name}`);
      const result = winnerId === game.player1Id ? 1 : 0;
      this.eloService.updateRatings(game.player1Id, game.player2Id, result);
    } else {
      console.log(`Skipping ELO update for async game (isRanked: ${game.isRanked}, winnerId: ${winnerId})`);
    }

    // Record match
    this.eloService.recordMatch({
      gameId: game.id,
      player1Id: game.player1Id,
      player1Name: game.player1Name || 'Player 1',
      player1Score: game.scores[1],
      player2Id: game.player2Id,
      player2Name: game.player2Name || 'Player 2',
      player2Score: game.scores[2],
      winnerId,
      isRanked: game.isRanked,
      gameType: 'async'
    });

    return game;
  }

  /**
   * Get game information for a player
   */
  getGameInfo(gameId, userId) {
    const game = this.games.get(gameId);
    if (!game) return null;

    const playerNum = game.player1Id === userId ? 1 : 2;
    const opponentId = playerNum === 1 ? game.player2Id : game.player1Id;
    const opponentName = playerNum === 1 ? game.player2Name : game.player1Name;
    const opponentNickname = playerNum === 1 ? game.player2Nickname : game.player1Nickname;
    const opponentRating = this.eloService.getRating(opponentId);

    return {
      id: game.id,
      opponentId,
      opponentName: opponentName || opponentId,
      opponentNickname,
      opponentRating: opponentRating.rating,
      myScore: game.scores[playerNum],
      opponentScore: game.scores[playerNum === 1 ? 2 : 1],
      isMyTurn: game.currentPlayer === playerNum,
      turnDeadline: game.turnDeadline,
      timeRemaining: Math.max(0, game.turnDeadline - Date.now()),
      isRanked: game.isRanked,
      status: game.status,
      gridSize: game.gridSize,
      moveCount: game.moves.length,
      createdAt: game.createdAt,
      lastMoveAt: game.lastMoveAt
    };
  }

  /**
   * Get all active games for a player
   */
  getPlayerGames(userId) {
    const gameIds = this.playerGames.get(userId);
    if (!gameIds) return [];

    return Array.from(gameIds)
      .map(gameId => this.getGameInfo(gameId, userId))
      .filter(game => game && game.status === 'active')
      .sort((a, b) => {
        // Sort by: your turn first, then by time remaining
        if (a.isMyTurn !== b.isMyTurn) {
          return a.isMyTurn ? -1 : 1;
        }
        return a.timeRemaining - b.timeRemaining;
      });
  }

  /**
   * Get full game state for resuming
   */
  getGameState(gameId, userId) {
    const game = this.games.get(gameId);
    if (!game) return null;

    // Verify player is in the game
    if (game.player1Id !== userId && game.player2Id !== userId) {
      throw new Error('Not authorized to view this game');
    }

    return {
      ...game,
      info: this.getGameInfo(gameId, userId)
    };
  }

  /**
   * Get count of active games for a player
   */
  getPlayerActiveGameCount(userId) {
    const gameIds = this.playerGames.get(userId);
    if (!gameIds) return 0;

    return Array.from(gameIds).filter(gameId => {
      const game = this.games.get(gameId);
      return game && game.status === 'active';
    }).length;
  }

  /**
   * Check for timed-out games
   */
  checkTimeouts() {
    const now = Date.now();
    
    for (const [gameId, game] of this.games) {
      if (game.status === 'active' && now > game.turnDeadline) {
        console.log(`Game ${gameId} timed out`);
        
        // Player who's turn it is loses by timeout
        const losingPlayer = game.currentPlayer;
        const winningPlayer = losingPlayer === 1 ? 2 : 1;
        
        // Award maximum points to winner
        game.scores[winningPlayer] = 999;
        
        this.endGame(gameId, 'timeout');
      }
    }
  }

  /**
   * Start background timeout checker
   */
  startTimeoutChecker() {
    // Check every minute
    setInterval(() => {
      this.checkTimeouts();
    }, 60000);
  }

  // Helper methods
  createEmptyBoard(size) {
    return Array(size).fill(null).map(() => Array(size).fill(0));
  }

  generateGameId() {
    return `async_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  addGameToPlayer(userId, gameId) {
    if (!this.playerGames.has(userId)) {
      this.playerGames.set(userId, new Set());
    }
    this.playerGames.get(userId).add(gameId);
  }

  removeGameFromPlayer(userId, gameId) {
    const games = this.playerGames.get(userId);
    if (games) {
      games.delete(gameId);
    }
  }

  /**
   * Delete a game (cleanup old completed games)
   */
  deleteGame(gameId) {
    const game = this.games.get(gameId);
    if (game) {
      this.removeGameFromPlayer(game.player1Id, gameId);
      this.removeGameFromPlayer(game.player2Id, gameId);
      this.games.delete(gameId);
    }
  }

  /**
   * Cleanup old completed games (call periodically)
   */
  cleanupOldGames(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    
    for (const [gameId, game] of this.games) {
      if (game.status !== 'active' && game.completedAt && 
          (now - game.completedAt) > maxAge) {
        this.deleteGame(gameId);
      }
    }
  }
}
