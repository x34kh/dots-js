/**
 * WebSocket Handler
 * Manages WebSocket connections and game communication
 */

export class WebSocketHandler {
  constructor(wss, authService, gameManager, asyncGameManager) {
    this.wss = wss;
    this.authService = authService;
    this.gameManager = gameManager;
    this.asyncGameManager = asyncGameManager;
    this.clients = new Map(); // ws -> { userId, user }
    this.userSockets = new Map(); // userId -> ws
    this.gameToAsync = new Map(); // realtime gameId -> async gameId
    this.gameRooms = new Map(); // gameId -> Set of userIds

    this.setupServer();
  }

  setupServer() {
    this.wss.on('connection', (ws) => {
      console.log('Client connected');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Failed to parse message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  async handleMessage(ws, message) {
    switch (message.type) {
      case 'auth':
        await this.handleAuth(ws, message);
        break;
      case 'auth_anonymous':
        await this.handleAnonymousAuth(ws, message);
        break;
      case 'create_game':
        this.handleCreateGame(ws);
        break;
      case 'join_game':
        this.handleJoinGame(ws, message.gameId);
        break;
      case 'leave_game':
        this.handleLeaveGame(ws, message.gameId);
        break;
      case 'find_match':
        this.handleFindMatch(ws, message.isRanked);
        break;
      case 'cancel_match':
        this.handleCancelMatch(ws);
        break;
      case 'move':
        this.handleMove(ws, message.move);
        break;
      case 'rematch':
        this.handleRematch(ws);
        break;
      case 'resign':
        this.handleResign(ws);
        break;
      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  async handleAuth(ws, message) {
    const result = await this.authService.verifyToken(message.token);

    if (result.success) {
      this.clients.set(ws, { userId: result.user.id, user: result.user });
      this.userSockets.set(result.user.id, ws);

      this.send(ws, {
        type: 'auth_success',
        data: {
          userId: result.user.id,
          name: result.user.name,
          nickname: result.user.nickname,
          picture: result.user.picture
        }
      });
      
      // Broadcast updated online count
      this.broadcastQueueStats();
    } else {
      this.send(ws, {
        type: 'auth_error',
        error: result.error
      });
    }
  }

  async handleAnonymousAuth(ws, message) {
    // Validate the anonymous token (HMAC signature)
    const { anonymousId, username, signature } = message;
    
    if (!anonymousId || !username || !signature) {
      this.send(ws, {
        type: 'auth_error',
        error: 'Invalid anonymous credentials'
      });
      return;
    }

    // Verify signature (this should match what the frontend generates)
    const isValid = this.authService.verifyAnonymousToken(anonymousId, username, signature);
    
    if (!isValid) {
      this.send(ws, {
        type: 'auth_error',
        error: 'Invalid anonymous token signature'
      });
      return;
    }

    const user = {
      id: anonymousId,
      name: username,
      picture: null,
      isAnonymous: true
    };

    this.clients.set(ws, { userId: anonymousId, user });
    this.userSockets.set(anonymousId, ws);

    this.send(ws, {
      type: 'auth_success',
      data: {
        userId: anonymousId,
        name: username,
        picture: null,
        isAnonymous: true
      }
    });
    
    // Broadcast updated online count
    this.broadcastQueueStats();
  }

  handleCreateGame(ws) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const result = this.gameManager.createGame(client.userId, {
      name: client.user.name,
      nickname: client.user.nickname,
      picture: client.user.picture
    });

    if (result.success) {
      this.send(ws, {
        type: 'game_created',
        data: {
          gameId: result.gameId,
          playerNumber: result.playerNumber
        }
      });
    } else {
      this.sendError(ws, result.error);
    }
  }

  handleJoinGame(ws, gameId) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    // Try to join or rejoin the game in realtime gameManager
    let result = this.gameManager.joinGame(gameId, client.userId, {
      name: client.user.name,
      nickname: client.user.nickname,
      picture: client.user.picture
    });

    // If game not found in realtime, check if it's an async game
    if (!result.success && result.error === 'Game not found') {
      console.log(`Game ${gameId} not in realtime manager, checking async...`);
      
      // Get async game state
      const asyncGame = this.asyncGameManager.games.get(gameId);
      if (asyncGame) {
        console.log(`Found async game ${gameId}, creating room for presence tracking`);
        
        // Determine player number
        const isPlayer1 = asyncGame.player1Id === client.userId;
        const isPlayer2 = asyncGame.player2Id === client.userId;
        
        if (isPlayer1 || isPlayer2) {
          result = {
            success: true,
            gameId,
            playerNumber: isPlayer1 ? 1 : 2,
            game: {
              players: {
                1: { id: asyncGame.player1Id, name: asyncGame.player1Name, nickname: asyncGame.player1Nickname },
                2: { id: asyncGame.player2Id, name: asyncGame.player2Name, nickname: asyncGame.player2Nickname }
              }
            }
          };
        } else {
          this.sendError(ws, 'Not a player in this game');
          return;
        }
      }
    }

    // If game is already playing, player might be rejoining
    if (!result.success && result.error === 'Game already started or finished') {
      const game = this.gameManager.getGameInfo(gameId);
      if (game) {
        // Check if this user is one of the players
        const isPlayer1 = game.players[1]?.id === client.userId;
        const isPlayer2 = game.players[2]?.id === client.userId;
        
        if (isPlayer1 || isPlayer2) {
          // Player is rejoining - allow it
          result = {
            success: true,
            gameId,
            playerNumber: isPlayer1 ? 1 : 2,
            game
          };
        }
      }
    }

    if (result.success) {
      // Add player to game room
      if (!this.gameRooms.has(gameId)) {
        this.gameRooms.set(gameId, new Set());
      }
      this.gameRooms.get(gameId).add(client.userId);
      
      console.log(`Player ${client.userId} joined/rejoined game ${gameId} as player ${result.playerNumber}`);
      
      this.send(ws, {
        type: 'game_joined',
        data: {
          gameId: result.gameId,
          playerNumber: result.playerNumber
        }
      });

      // Notify both players game is starting (for new games only)
      const game = result.game;
      if (game && game.status === 'playing') {
        // Save game to async storage so it can be resumed
        this.saveGameToAsync(gameId, game, false); // Not ranked for join games
        
        this.broadcastToGame(gameId, {
          type: 'game_start',
          data: {
            gameId,
            player1: game.players[1],
            player2: game.players[2],
            currentPlayer: game.currentPlayer
          }
        });
      }
      
      // Notify about player presence
      this.broadcastPresenceUpdate(gameId);
    } else {
      this.sendError(ws, result.error);
    }
  }

  handleLeaveGame(ws, gameId) {
    const client = this.clients.get(ws);
    if (!client) {
      return;
    }

    console.log(`Player ${client.userId} leaving game ${gameId}`);
    
    // Remove from game room
    const playersInRoom = this.gameRooms.get(gameId);
    if (playersInRoom) {
      playersInRoom.delete(client.userId);
      console.log(`Removed player from room. Remaining players:`, Array.from(playersInRoom));
      
      // Broadcast updated presence
      this.broadcastPresenceUpdate(gameId);
      
      // Clean up empty rooms
      if (playersInRoom.size === 0) {
        this.gameRooms.delete(gameId);
        console.log(`Deleted empty room ${gameId}`);
      }
    }
  }

  handleFindMatch(ws, isRanked = false) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    const result = this.gameManager.addToMatchmaking(client.userId, {
      name: client.user.name,
      nickname: client.user.nickname,
      picture: client.user.picture
    }, isRanked);

    if (result.waiting) {
      this.send(ws, {
        type: 'matchmaking',
        data: { 
          status: 'waiting',
          isRanked
        }
      });
      
      // Broadcast queue stats to all clients
      this.broadcastQueueStats();
    } else if (result.success) {
      // Match found - notify both players
      const ws1 = this.userSockets.get(result.player1);
      const ws2 = this.userSockets.get(result.player2);

      const startMessage = {
        type: 'game_start',
        data: {
          gameId: result.gameId,
          player1: result.game.players[1],
          player2: result.game.players[2],
          currentPlayer: result.game.currentPlayer,
          isRanked: result.isRanked
        }
      };

      // Save game to async storage
      this.saveGameToAsync(result.gameId, result.game, result.isRanked);

      // Add both players to game room for presence tracking
      if (!this.gameRooms.has(result.gameId)) {
        this.gameRooms.set(result.gameId, new Set());
      }
      this.gameRooms.get(result.gameId).add(result.player1);
      this.gameRooms.get(result.gameId).add(result.player2);
      console.log(`Added players to game room ${result.gameId}:`, Array.from(this.gameRooms.get(result.gameId)));

      if (ws1) {
        this.send(ws1, { ...startMessage, data: { ...startMessage.data, playerNumber: 1 } });
      }
      if (ws2) {
        this.send(ws2, { ...startMessage, data: { ...startMessage.data, playerNumber: 2 } });
      }
      
      // Broadcast presence update to both players
      this.broadcastPresenceUpdate(result.gameId);
      
      // Broadcast updated queue stats
      this.broadcastQueueStats();
    }
  }

  handleCancelMatch(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    this.gameManager.removeFromMatchmaking(client.userId);
    this.send(ws, {
      type: 'matchmaking',
      data: { status: 'cancelled' }
    });
    
    // Broadcast updated queue stats
    this.broadcastQueueStats();
  }

  broadcastQueueStats() {
    const stats = this.gameManager.getQueueStats();
    const playersInQueue = stats.rankedQueue + stats.unrankedQueue;
    const playersPlaying = stats.activeGames * 2;
    
    const message = {
      type: 'queue_stats',
      data: {
        playersOnline: this.clients.size,
        playersInQueue,
        playersPlaying,
        rankedQueue: stats.rankedQueue,
        unrankedQueue: stats.unrankedQueue,
        activeGames: stats.activeGames
      }
    };
    
    // Broadcast to all connected clients
    for (const ws of this.clients.keys()) {
      this.send(ws, message);
    }
  }

  broadcastPresenceUpdate(gameId) {
    const playersInRoom = this.gameRooms.get(gameId);
    if (!playersInRoom) {
      console.log(`No room found for game ${gameId}`);
      return;
    }
    
    // Try to get game from realtime manager first
    let game = this.gameManager.getGameInfo(gameId);
    let player1Id, player2Id;
    
    if (game) {
      // Game is in realtime manager
      player1Id = game.players[1]?.id || game.players[1]?.userId;
      player2Id = game.players[2]?.id || game.players[2]?.userId;
    } else {
      // Check async manager
      const asyncGame = this.asyncGameManager.games.get(gameId);
      if (asyncGame) {
        console.log(`Broadcasting presence for async game ${gameId}`);
        player1Id = asyncGame.player1Id;
        player2Id = asyncGame.player2Id;
      } else {
        console.log(`No game found for ${gameId} in either manager`);
        return;
      }
    }
    
    // Debug logging
    console.log(`Game ${gameId} presence:`, {
      player1Id,
      player2Id,
      playersInRoom: Array.from(playersInRoom)
    });
    
    const presence = {
      player1Online: player1Id ? playersInRoom.has(player1Id) : false,
      player2Online: player2Id ? playersInRoom.has(player2Id) : false
    };
    
    console.log('Broadcasting presence update:', { gameId, presence, player1Id, player2Id });
    
    this.broadcastToGame(gameId, {
      type: 'presence_update',
      data: presence
    });
  }

  handleMove(ws, move) {
    const client = this.clients.get(ws);
    if (!client) {
      this.sendError(ws, 'Not authenticated');
      return;
    }

    console.log(`handleMove: client.userId=${client.userId}, move:`, move);

    const result = this.gameManager.makeMove(
      client.userId,
      move.x,
      move.y
    );

    console.log(`handleMove result:`, result);

    if (result.success) {
      // Sync move to async storage
      this.syncMoveToAsync(result.gameId, move.x, move.y, client.userId);
      
      // Send result to moving player
      this.send(ws, {
        type: 'move_result',
        data: {
          success: true,
          move,
          playerNum: result.playerNum,
          captures: result.captures,
          continuesTurn: result.continuesTurn,
          currentPlayer: result.currentPlayer,
          gameOver: result.gameOver
        }
      });

      // Notify opponent
      const game = this.gameManager.getGame(result.gameId);
      if (game) {
        const opponentNum = result.playerNum === 1 ? 2 : 1;
        const opponent = game.players[opponentNum];
        if (opponent) {
          const opponentWs = this.userSockets.get(opponent.id);
          if (opponentWs && opponentWs !== ws) {
            this.send(opponentWs, {
              type: 'opponent_move',
              data: {
                move,
                playerNum: result.playerNum,
                captures: result.captures,
                currentPlayer: result.currentPlayer,
                gameOver: result.gameOver
              }
            });
          }
        }

        // Handle game over
        if (result.gameOver) {
          this.broadcastToGame(result.gameId, {
            type: 'game_over',
            data: {
              winner: game.winner,
              scores: game.scores,
              players: game.players
            }
          });
        }
      }
    } else {
      this.send(ws, {
        type: 'move_result',
        data: { success: false, error: result.error }
      });
    }
  }

  handleRematch(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    const game = this.gameManager.getPlayerGame(client.userId);
    if (!game) return;

    // Notify opponent about rematch request
    const playerNum = game.getPlayerNumber(client.userId);
    const opponentNum = playerNum === 1 ? 2 : 1;
    const opponent = game.players[opponentNum];

    if (opponent) {
      const opponentWs = this.userSockets.get(opponent.id);
      if (opponentWs) {
        this.send(opponentWs, {
          type: 'rematch_request',
          data: { from: client.user.name }
        });
      }
    }
  }

  handleResign(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    const result = this.gameManager.handleDisconnect(client.userId);
    if (result && result.gameId) {
      const game = this.gameManager.getGame(result.gameId);
      if (game) {
        // Handle game over in realtime game manager (records ELO)
        this.gameManager.handleGameOver(result.gameId);
        
        // Also end the async game if it exists
        const asyncGameId = this.gameToAsync.get(result.gameId);
        if (asyncGameId) {
          try {
            const asyncGame = this.asyncGameManager.games.get(asyncGameId);
            if (asyncGame && asyncGame.status === 'active') {
              // Set winner before ending game (so endGame uses correct winner)
              asyncGame.winner = game.winner;
              asyncGame.status = 'completed';
              this.asyncGameManager.endGame(asyncGameId, 'forfeit');
              console.log(`Ended async game ${asyncGameId} due to forfeit with winner ${game.winner}`);
            }
          } catch (error) {
            console.error('Failed to end async game on forfeit:', error);
          }
        }
        
        this.broadcastToGame(result.gameId, {
          type: 'game_over',
          data: {
            winner: game.winner,
            scores: game.scores,
            resigned: client.userId
          }
        });
      }
    } else {
      // No realtime game found - check if it's an async-only game
      // Look through all game rooms to find which game this user is in
      for (const [gameId, players] of this.gameRooms.entries()) {
        if (players.has(client.userId)) {
          const asyncGame = this.asyncGameManager.games.get(gameId);
          if (asyncGame && asyncGame.status === 'active') {
            // Determine winner (the other player)
            const isPlayer1 = asyncGame.player1Id === client.userId;
            const winner = isPlayer1 ? 2 : 1;
            
            asyncGame.winner = winner;
            asyncGame.status = 'completed';
            this.asyncGameManager.endGame(gameId, 'forfeit');
            console.log(`Ended async-only game ${gameId} due to forfeit, winner: player ${winner}`);
            
            // Broadcast game over to both players
            this.broadcastToGame(gameId, {
              type: 'game_over',
              data: {
                winner: winner,
                resigned: client.userId
              }
            });
            break;
          }
        }
      }
    }
  }

  handleDisconnect(ws) {
    const client = this.clients.get(ws);
    if (client) {
      console.log('Client disconnected:', client.userId);

      // Remove from game rooms and notify
      for (const [gameId, players] of this.gameRooms.entries()) {
        if (players.has(client.userId)) {
          players.delete(client.userId);
          this.broadcastPresenceUpdate(gameId);
          if (players.size === 0) {
            this.gameRooms.delete(gameId);
          }
        }
      }

      // For games that have async storage, don't remove player or end game
      // Just notify opponent they disconnected - game continues in async mode
      const gameId = this.gameManager.playerGames.get(client.userId);
      if (gameId) {
        const hasAsyncVersion = this.gameToAsync.has(gameId);
        
        if (hasAsyncVersion) {
          // Game is saved to async - don't end it, just notify opponent
          console.log(`Player ${client.userId} disconnected from async-enabled game ${gameId}`);
          const game = this.gameManager.getGame(gameId);
          if (game) {
            // Find opponent and notify
            for (const [num, player] of Object.entries(game.players)) {
              if (player && player.id !== client.userId) {
                const opponentWs = this.userSockets.get(player.id);
                if (opponentWs) {
                  this.send(opponentWs, { type: 'opponent_disconnected' });
                }
              }
            }
          }
        } else {
          // Not async - handle disconnect normally (end game)
          const result = this.gameManager.handleDisconnect(client.userId);
          if (result && result.gameId) {
            const game = this.gameManager.getGame(result.gameId);
            if (game) {
              const opponentNum = result.playerNumber === 1 ? 2 : 1;
              const opponent = game.players[opponentNum];
              if (opponent) {
                const opponentWs = this.userSockets.get(opponent.id);
                if (opponentWs) {
                  this.send(opponentWs, { type: 'opponent_disconnected' });
                }
              }
            }
          }
        }
      }

      // Remove from matchmaking
      this.gameManager.removeFromMatchmaking(client.userId);

      this.userSockets.delete(client.userId);
      this.clients.delete(ws);
      
      // Broadcast updated online count
      this.broadcastQueueStats();
    }
  }

  send(ws, message) {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  sendError(ws, error) {
    this.send(ws, { type: 'error', error });
  }

  broadcastToGame(gameId, message) {
    // First try using gameRooms (for rejoined async games)
    const playersInRoom = this.gameRooms.get(gameId);
    if (playersInRoom && playersInRoom.size > 0) {
      console.log(`Broadcasting to game room ${gameId}, ${playersInRoom.size} players`);
      for (const playerId of playersInRoom) {
        const ws = this.userSockets.get(playerId);
        if (ws) {
          this.send(ws, message);
        } else {
          console.log(`No socket found for player ${playerId}`);
        }
      }
      return;
    }
    
    // Fallback to realtime game players (for non-async games)
    const game = this.gameManager.getGame(gameId);
    if (!game) {
      console.log(`No game found for ${gameId}, cannot broadcast`);
      return;
    }

    console.log(`Broadcasting to realtime game ${gameId}`);
    for (const num of [1, 2]) {
      if (game.players[num]) {
        const ws = this.userSockets.get(game.players[num].id);
        if (ws) {
          this.send(ws, message);
        }
      }
    }
  }
  
  /**
   * Save a realtime game to async storage for persistence
   */
  saveGameToAsync(realtimeGameId, game, isRanked) {
    try {
      const player1Id = game.players[1].id;
      const player2Id = game.players[2].id;
      // Use nickname if available, fallback to name
      const player1Name = game.players[1].name || 'Player 1';
      const player2Name = game.players[2].name || 'Player 2';
      const player1Nickname = game.players[1].nickname;
      const player2Nickname = game.players[2].nickname;
      
      // Create async game with same grid size as realtime game
      const asyncGame = this.asyncGameManager.createGame(
        player1Id,
        player2Id,
        game.gridSize || 10, // Use stored gridSize, default to 10
        isRanked,
        player1Name,
        player2Name,
        player1Nickname,
        player2Nickname
      );
      
      // Map realtime gameId to async gameId
      this.gameToAsync.set(realtimeGameId, asyncGame.id);
      
      console.log(`Saved realtime game ${realtimeGameId} (gridSize: ${game.gridSize}) as async game ${asyncGame.id}`);
    } catch (error) {
      console.error('Failed to save game to async storage:', error);
    }
  }
  
  /**
   * Sync a move from realtime game to async storage
   */
  syncMoveToAsync(realtimeGameId, x, y, userId) {
    const asyncGameId = this.gameToAsync.get(realtimeGameId);
    if (!asyncGameId) {
      console.warn('No async game found for realtime game:', realtimeGameId);
      return;
    }
    
    console.log(`Syncing move to async storage: gameId=${asyncGameId}, x=${x}, y=${y}, userId=${userId}`);
    try {
      const result = this.asyncGameManager.makeMove(asyncGameId, userId, x, y);
      console.log('Async sync result:', result);
    } catch (error) {
      console.error('Failed to sync move to async storage:', error);
    }
  }
}
