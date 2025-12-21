/**
 * WebSocket Client for Online Mode
 * Handles server communication for authenticated games
 */

export class WebSocketClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl || this.getDefaultServerUrl();
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.listeners = new Map();
    this.gameId = null;
    this.authToken = null;
    this.pendingMessages = []; // Queue for messages sent while disconnected
    this.maxPendingMessages = 50;
  }

  getDefaultServerUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.hostname === 'localhost' ? ':8080' : '';
    return `${protocol}//${host}${port}/ws`;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  /**
   * Connect to the game server with Google auth
   */
  connect(authToken) {
    return new Promise((resolve, reject) => {
      this.authToken = authToken;
      this.isAnonymous = false;
      
      try {
        this.socket = new WebSocket(this.serverUrl);
        
        this.socket.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.emit('connected');
          
          // Authenticate with Google token
          this.send({
            type: 'auth',
            token: authToken
          });
          
          resolve();
        };

        this.socket.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.emit('disconnected');
          
          // Auto-reconnect if not a normal close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to the game server with anonymous credentials
   */
  connectAnonymous(credentials) {
    return new Promise((resolve, reject) => {
      this.anonymousCredentials = credentials;
      this.isAnonymous = true;
      
      try {
        this.socket = new WebSocket(this.serverUrl);
        
        this.socket.onopen = () => {
          console.log('WebSocket connected (anonymous)');
          this.reconnectAttempts = 0;
          this.emit('connected');
          
          // Authenticate with anonymous credentials
          this.send({
            type: 'auth_anonymous',
            anonymousId: credentials.anonymousId,
            username: credentials.username,
            signature: credentials.signature
          });
          
          resolve();
        };

        this.socket.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.emit('disconnected');
          
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  attemptReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * (2 ** (this.reconnectAttempts - 1));
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting');
    
    setTimeout(() => {
      if (this.isAnonymous && this.anonymousCredentials) {
        this.connectAnonymous(this.anonymousCredentials).catch(console.error);
      } else if (this.authToken) {
        this.connect(this.authToken).catch(console.error);
      }
    }, delay);
  }

  handleMessage(message) {
    switch (message.type) {
      case 'auth_success':
        this.emit('authenticated', message.data);
        // Flush any pending messages after successful auth
        this.flushPendingMessages();
        break;
      case 'auth_error':
        this.emit('authError', message.error);
        break;
      case 'game_created':
        this.gameId = message.data.gameId;
        this.emit('gameCreated', message.data);
        break;
      case 'game_joined':
        this.gameId = message.data.gameId;
        this.emit('gameJoined', message.data);
        break;
      case 'game_start':
        this.emit('gameStart', message.data);
        break;
      case 'move_result':
        this.emit('moveResult', message.data);
        break;
      case 'opponent_move':
        this.emit('opponentMove', message.data);
        break;
      case 'game_over':
        this.emit('gameOver', message.data);
        break;
      case 'opponent_disconnected':
        this.emit('opponentDisconnected');
        break;
      case 'opponent_reconnected':
        this.emit('opponentReconnected');
        break;
      case 'error':
        this.emit('error', message.error);
        break;
      case 'elo_update':
        this.emit('eloUpdate', message.data);
        break;
      case 'matchmaking':
        this.emit('matchmaking', message.data);
        break;
      case 'queue_stats':
        this.emit('queue_stats', message.data);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  /**
   * Send a message to the server
   */
  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      // Queue important messages for retry on reconnect (except auth messages)
      if (message.type !== 'auth' && message.type !== 'auth_anonymous') {
        console.warn('WebSocket not connected, queueing message:', message.type);
        this.queueMessage(message);
      } else {
        console.warn('WebSocket not connected, cannot send:', message.type);
      }
    }
  }

  /**
   * Queue a message to be sent when connection is restored
   */
  queueMessage(message) {
    // Don't queue duplicates of the same move
    const isDuplicate = this.pendingMessages.some(m => 
      m.type === message.type && 
      m.gameId === message.gameId &&
      JSON.stringify(m.move) === JSON.stringify(message.move)
    );
    
    if (!isDuplicate) {
      // Add timestamp to track age
      message._queuedAt = Date.now();
      this.pendingMessages.push(message);
      
      // Limit queue size
      if (this.pendingMessages.length > this.maxPendingMessages) {
        this.pendingMessages.shift();
      }
      
      console.log(`Queued message (${this.pendingMessages.length} pending):`, message.type);
    }
  }

  /**
   * Flush pending messages after reconnection
   */
  flushPendingMessages() {
    if (this.pendingMessages.length === 0) return;
    
    const messageCount = this.pendingMessages.length;
    console.log(`Flushing ${messageCount} pending messages`);
    
    // Remove old messages (older than 5 minutes)
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;
    this.pendingMessages = this.pendingMessages.filter(m => 
      (now - m._queuedAt) < maxAge
    );
    
    // Send all pending messages
    const messagesToSend = [...this.pendingMessages];
    this.pendingMessages = [];
    
    messagesToSend.forEach(message => {
      delete message._queuedAt;
      this.send(message);
    });
    
    // Emit event that messages were flushed
    if (messagesToSend.length > 0) {
      this.emit('messagesFlushed', { count: messagesToSend.length });
    }
  }

  /**
   * Create a new game
   */
  createGame() {
    this.send({
      type: 'create_game'
    });
  }

  /**
   * Join an existing game
   */
  joinGame(gameId) {
    this.send({
      type: 'join_game',
      gameId
    });
  }

  /**
   * Find a random opponent (matchmaking)
   */
  findMatch(isRanked = false) {
    this.send({
      type: 'find_match',
      isRanked
    });
  }

  /**
   * Cancel matchmaking
   */
  cancelMatch() {
    this.send({
      type: 'cancel_match'
    });
  }

  /**
   * Submit a move (dot occupation)
   */
  submitMove(x, y) {
    this.send({
      type: 'move',
      gameId: this.gameId,
      move: { x, y }
    });
  }

  /**
   * Request a rematch
   */
  requestRematch() {
    this.send({
      type: 'rematch',
      gameId: this.gameId
    });
  }

  /**
   * Resign from the current game
   */
  resign() {
    this.send({
      type: 'resign',
      gameId: this.gameId
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close(1000);
      this.socket = null;
    }
    this.gameId = null;
    this.authToken = null;
    this.pendingMessages = []; // Clear queue on intentional disconnect
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }
}
