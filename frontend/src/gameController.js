/**
 * Main Game Controller
 * Orchestrates all game components
 */

import { StateMachine, GameState, GameMode } from './stateMachine.js';
import { BoardLogic } from './boardLogic.js';
import { GameRenderer } from './renderer.js';
import { P2PNetwork, URLSignaling } from './p2p.js';
import { WebSocketClient } from './websocket.js';
import { GoogleAuth } from './auth.js';

export class GameController {
  constructor(config = {}) {
    this.config = {
      gridSize: config.gridSize || 5,
      googleClientId: config.googleClientId || null,
      serverUrl: config.serverUrl || null
    };

    this.canvas = document.getElementById('game-canvas');
    this.stateMachine = new StateMachine();
    this.boardLogic = new BoardLogic(this.config.gridSize);
    this.renderer = null;
    this.p2p = null;
    this.wsClient = null;
    this.auth = new GoogleAuth(this.config.googleClientId);

    this.init();
  }

  async init() {
    // Initialize renderer
    this.renderer = new GameRenderer(this.canvas, this.boardLogic);

    // Setup event listeners
    this.setupUIEvents();
    this.setupInputEvents();
    this.setupStateMachineEvents();

    // Initialize auth (optional)
    try {
      await this.auth.init();
    } catch (error) {
      console.warn('Google Auth not available:', error);
    }

    // Check for join parameters
    this.checkJoinParams();

    // Start render loop
    this.animate();
  }

  setupUIEvents() {
    // Menu buttons
    document.getElementById('btn-local-mode').addEventListener('click', () => {
      this.startLocalGame();
    });

    document.getElementById('btn-demo-mode').addEventListener('click', () => {
      this.startDemoGame();
    });

    document.getElementById('btn-online-mode').addEventListener('click', () => {
      this.startOnlineGame();
    });

    document.getElementById('btn-anonymous-mode').addEventListener('click', () => {
      this.startAnonymousGame();
    });

    document.getElementById('btn-google-login').addEventListener('click', () => {
      this.auth.signIn();
    });

    document.getElementById('btn-sign-out').addEventListener('click', () => {
      this.signOut();
    });

    document.getElementById('btn-copy-link').addEventListener('click', async () => {
      const linkInput = document.getElementById('share-link');
      try {
        await navigator.clipboard.writeText(linkInput.value);
      } catch {
        // Fallback for older browsers
        linkInput.select();
        document.execCommand('copy');
      }
    });

    // Game over buttons
    document.getElementById('btn-rematch').addEventListener('click', () => {
      this.requestRematch();
    });

    document.getElementById('btn-new-game').addEventListener('click', () => {
      this.returnToMenu();
    });
  }

  setupInputEvents() {
    // Mouse events
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancelSelection();
    });

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.handleClick({ clientX: touch.clientX, clientY: touch.clientY });
    });
  }

  setupStateMachineEvents() {
    this.stateMachine.on('stateChange', ({ oldState, newState }) => {
      this.updateUIForState(newState);
    });

    this.stateMachine.on('turnChange', (playerNum) => {
      this.updateTurnIndicator(playerNum);
    });

    this.stateMachine.on('scoreChange', ({ playerNum, score }) => {
      this.updateScoreDisplay(playerNum, score);
    });
  }

  checkJoinParams() {
    const { gameId, offer } = URLSignaling.getJoinParams();
    if (gameId && offer) {
      this.joinDemoGame(offer);
      URLSignaling.clearParams();
    }
  }

  /**
   * Start a local game for 2 players on the same device
   */
  startLocalGame() {
    this.stateMachine.setMode(GameMode.LOCAL);
    this.stateMachine.isLocalMode = true;
    
    // Set up both players (no authentication needed for local play)
    this.stateMachine.localPlayerId = 1;
    this.stateMachine.setPlayer(1, {
      id: 'local-player-1',
      name: 'Player 1'
    });
    this.stateMachine.setPlayer(2, {
      id: 'local-player-2',
      name: 'Player 2'
    });
    
    // Start the game immediately
    this.startGame();
  }

  async startDemoGame() {
    this.stateMachine.setMode(GameMode.DEMO);
    
    // Create guest user if not signed in
    if (!this.auth.isSignedIn()) {
      this.auth.createGuestUser();
    }
    
    // Initialize P2P
    this.p2p = new P2PNetwork();
    this.setupP2PEvents();
    
    try {
      // Create game and get link
      const { gameId, link } = await this.p2p.createGame();
      this.stateMachine.gameId = gameId;
      
      // Show share link
      document.getElementById('share-link').value = link;
      document.getElementById('share-link-container').classList.remove('hidden');
      
      // Set local player as player 1
      this.stateMachine.localPlayerId = 1;
      this.stateMachine.setPlayer(1, {
        id: this.auth.getUser().id,
        name: this.auth.getUser().name
      });
      
      // Wait for opponent
      this.stateMachine.setState(GameState.WAITING);
      
    } catch (error) {
      console.error('Failed to create demo game:', error);
      alert('Failed to create game. Please try again.');
    }
  }

  async joinDemoGame(offerString) {
    this.stateMachine.setMode(GameMode.DEMO);
    
    // Create guest user if not signed in
    if (!this.auth.isSignedIn()) {
      this.auth.createGuestUser();
    }
    
    // Initialize P2P
    this.p2p = new P2PNetwork();
    this.setupP2PEvents();
    
    try {
      // Join the game
      const answer = await this.p2p.joinGame(offerString);
      
      // Set local player as player 2
      this.stateMachine.localPlayerId = 2;
      this.stateMachine.setPlayer(2, {
        id: this.auth.getUser().id,
        name: this.auth.getUser().name
      });
      
      this.stateMachine.setState(GameState.WAITING);
      
      // In a real implementation, the answer would be sent back to the host
      // For simplicity, we'll show it for manual exchange
      console.log('Answer (share with host):', answer);
      
    } catch (error) {
      console.error('Failed to join game:', error);
      alert('Failed to join game. Please try again.');
    }
  }

  async startAnonymousGame() {
    this.stateMachine.setMode(GameMode.ONLINE);
    
    // Create or retrieve anonymous user
    try {
      await this.auth.createAnonymousUser();
      this.updateUserDisplay();
      await this.connectToServer(true); // isAnonymous = true
    } catch (error) {
      console.error('Failed to start anonymous game:', error);
      alert('Failed to connect. Please try again.');
    }
  }

  signOut() {
    if (this.auth.isAnonymous()) {
      this.auth.signOutAnonymous();
    } else {
      this.auth.signOut();
    }
    this.updateUserDisplay();
  }

  updateUserDisplay() {
    const userInfoEl = document.getElementById('user-info');
    const userNameEl = document.getElementById('user-name');
    
    if (this.auth.isSignedIn() || this.auth.isAnonymous()) {
      const user = this.auth.getUser();
      userNameEl.textContent = user.isAnonymous ? `🎭 ${user.name}` : user.name;
      userInfoEl.classList.remove('hidden');
    } else {
      userInfoEl.classList.add('hidden');
    }
  }

  setupP2PEvents() {
    this.p2p.on('connected', () => {
      console.log('P2P connected');
    });

    this.p2p.on('ready', () => {
      // Send player info
      this.p2p.sendPlayerInfo({
        playerId: this.stateMachine.localPlayerId,
        name: this.auth.getUser().name
      });
      
      // Start game if host
      if (this.p2p.isHost) {
        this.startGame();
      }
    });

    this.p2p.on('player', (data) => {
      const opponentId = this.stateMachine.localPlayerId === 1 ? 2 : 1;
      this.stateMachine.setPlayer(opponentId, {
        id: data.playerId,
        name: data.name
      });
      
      // Start game if joining player
      if (!this.p2p.isHost) {
        this.startGame();
      }
    });

    this.p2p.on('move', (data) => {
      this.receiveMove(data);
    });

    this.p2p.on('sync', (data) => {
      this.syncState(data);
    });

    this.p2p.on('rematch', () => {
      this.handleRematchRequest();
    });

    this.p2p.on('disconnected', () => {
      alert('Opponent disconnected');
      this.returnToMenu();
    });
  }

  async startOnlineGame() {
    this.stateMachine.setMode(GameMode.ONLINE);
    
    // Require sign in for online mode
    if (!this.auth.isSignedIn()) {
      this.auth.signIn();
      
      this.auth.on('signIn', () => {
        this.updateUserDisplay();
        this.connectToServer(false);
      });
      return;
    }
    
    await this.connectToServer(false);
  }

  async connectToServer(isAnonymous = false) {
    this.wsClient = new WebSocketClient(this.config.serverUrl);
    this.setupWebSocketEvents();
    
    try {
      if (isAnonymous) {
        const anonData = this.auth.getAnonymousAuthData();
        await this.wsClient.connectAnonymous(anonData);
      } else {
        await this.wsClient.connect(this.auth.getToken());
      }
    } catch (error) {
      console.error('Failed to connect to server:', error);
      alert('Failed to connect to server. Please try again.');
    }
  }

  setupWebSocketEvents() {
    this.wsClient.on('authenticated', (data) => {
      console.log('Authenticated:', data);
      // Start matchmaking
      this.wsClient.findMatch();
      this.stateMachine.setState(GameState.WAITING);
    });

    this.wsClient.on('gameStart', (data) => {
      this.stateMachine.gameId = data.gameId;
      this.stateMachine.localPlayerId = data.playerNumber;
      
      this.stateMachine.setPlayer(1, data.player1);
      this.stateMachine.setPlayer(2, data.player2);
      
      this.startGame();
    });

    this.wsClient.on('moveResult', (data) => {
      if (data.success) {
        this.applyMove(data.move, data.playerNum, data.captures);
      } else {
        console.error('Move rejected:', data.error);
        // Revert local state if needed
      }
    });

    this.wsClient.on('opponentMove', (data) => {
      this.receiveMove(data);
    });

    this.wsClient.on('gameOver', (data) => {
      this.endGame(data);
    });

    this.wsClient.on('eloUpdate', (data) => {
      console.log('ELO updated:', data);
    });

    this.wsClient.on('error', (error) => {
      console.error('Server error:', error);
    });

    this.wsClient.on('disconnected', () => {
      alert('Disconnected from server');
    });
  }

  startGame() {
    this.stateMachine.setState(GameState.PLAYING);
    this.stateMachine.setCurrentPlayer(1);
    
    // Hide menu
    document.getElementById('game-menu').classList.add('hidden');
    document.getElementById('share-link-container').classList.add('hidden');
    
    // Show player cards
    this.updatePlayerCards();
    
    // Reset board
    this.boardLogic.reset();
    this.renderer.reset();
  }

  handleMouseMove(event) {
    if (this.stateMachine.state !== GameState.PLAYING) return;
    if (!this.stateMachine.isLocalPlayerTurn()) return;
    
    this.renderer.getMousePosition(event);
    const dot = this.renderer.getDotAtMouse();
    const playerNum = this.stateMachine.currentPlayer;
    
    // Clear previous hover state
    if (this.renderer.hoverDot && this.renderer.hoverDot !== dot) {
      const prevData = this.renderer.hoverDot.userData;
      this.renderer.setDotHoverTarget(prevData.gridX, prevData.gridY, false);
      this.renderer.clearPreviews();
    }
    
    if (dot && this.renderer.isDotMeshClickable(dot)) {
      const { gridX, gridY } = dot.userData;
      
      // Set hover animation target
      this.renderer.setDotHoverTarget(gridX, gridY, true, playerNum);
      
      // Preview territory capture
      const previewDots = this.boardLogic.previewCapture(gridX, gridY, playerNum);
      if (previewDots.length > 0) {
        this.renderer.showCapturePreview(previewDots, playerNum);
      }
      
      this.renderer.hoverDot = dot;
    } else {
      if (this.renderer.hoverDot) {
        const prevData = this.renderer.hoverDot.userData;
        this.renderer.setDotHoverTarget(prevData.gridX, prevData.gridY, false);
      }
      this.renderer.hoverDot = null;
      this.renderer.clearPreviews();
    }
  }

  handleClick(event) {
    if (this.stateMachine.state !== GameState.PLAYING) return;
    if (!this.stateMachine.isLocalPlayerTurn()) return;
    
    this.renderer.getMousePosition(event);
    const dot = this.renderer.getDotAtMouse();
    
    if (!dot || !this.renderer.isDotMeshClickable(dot)) {
      return;
    }
    
    const { gridX, gridY } = dot.userData;
    this.makeMove(gridX, gridY);
  }

  makeMove(x, y) {
    const playerNum = this.stateMachine.currentPlayer;
    
    // Occupy the dot
    const result = this.boardLogic.occupyDot(x, y, playerNum);
    
    if (!result.success) {
      console.error('Invalid move');
      return;
    }
    
    // Clear previews
    this.renderer.clearPreviews();
    
    // Apply visual changes
    this.applyMove({ x, y }, playerNum, result.capturedDots);
    
    // Send move to opponent/server
    if (this.stateMachine.mode === GameMode.DEMO && this.p2p) {
      this.p2p.sendMove({ x, y, playerNum });
    } else if (this.stateMachine.mode === GameMode.ONLINE && this.wsClient) {
      this.wsClient.submitMove(x, y, 0, 0); // Modified for new format
    }
    
    // Handle scoring
    // Score = 1 for the occupied dot + number of captured dots
    const points = 1 + result.capturedDots.length;
    this.stateMachine.addScore(playerNum, points);
    
    if (result.capturedDots.length > 0) {
      this.showCaptureNotification();
    }
    
    // Switch turns (in this version, capturing doesn't give extra turn)
    this.stateMachine.switchTurn();
    
    // Check game over
    if (this.boardLogic.isGameOver()) {
      this.endGame();
    }
  }

  applyMove(move, playerNum, capturedDots = []) {
    // Mark the dot as owned
    this.renderer.setDotOwner(move.x, move.y, playerNum);
    
    // Mark captured dots
    if (capturedDots.length > 0) {
      this.renderer.setCapturedDots(capturedDots, playerNum);
    }
  }

  receiveMove(data) {
    const { x, y, playerNum } = data;
    
    // Apply move to board logic
    const result = this.boardLogic.occupyDot(x, y, playerNum);
    
    if (result.success) {
      // Apply visual changes
      this.applyMove({ x, y }, playerNum, result.capturedDots);
      
      // Handle scoring
      const points = 1 + result.capturedDots.length;
      this.stateMachine.addScore(playerNum, points);
      
      // Switch turns
      this.stateMachine.switchTurn();
      
      // Check game over
      if (this.boardLogic.isGameOver()) {
        this.endGame();
      }
    }
  }

  syncState(data) {
    // Full state sync from opponent
    this.boardLogic.deserialize(data.board);
    this.stateMachine.players = data.players;
    this.stateMachine.currentPlayer = data.currentPlayer;
    
    // Rebuild visuals
    this.rebuildVisuals();
  }

  rebuildVisuals() {
    this.renderer.reset();
    
    // Rebuild dot states
    for (const [, dot] of this.boardLogic.dots) {
      if (dot.owner) {
        this.renderer.setDotOwner(dot.x, dot.y, dot.owner);
      }
      if (dot.captured) {
        this.renderer.setCapturedDots([{ x: dot.x, y: dot.y }], dot.capturedBy);
      }
    }
  }

  showCaptureNotification() {
    const notification = document.getElementById('capture-notification');
    notification.classList.remove('hidden');
    
    setTimeout(() => {
      notification.classList.add('hidden');
    }, 1000);
  }

  endGame(data = null) {
    this.stateMachine.setState(GameState.GAME_OVER);
    
    const winner = this.stateMachine.getWinner();
    const p1Score = this.stateMachine.players[1].score;
    const p2Score = this.stateMachine.players[2].score;
    
    let winnerText;
    if (winner === null) {
      winnerText = "It's a draw!";
    } else {
      const winnerName = this.stateMachine.players[winner].name;
      winnerText = `${winnerName} wins!`;
    }
    
    document.getElementById('winner-text').textContent = winnerText;
    document.getElementById('final-scores').textContent = 
      `${this.stateMachine.players[1].name}: ${p1Score} | ${this.stateMachine.players[2].name}: ${p2Score}`;
    
    document.getElementById('game-over').classList.remove('hidden');
  }

  requestRematch() {
    if (this.stateMachine.mode === GameMode.DEMO && this.p2p) {
      this.p2p.sendRematch();
      this.resetGame();
    } else if (this.stateMachine.mode === GameMode.ONLINE && this.wsClient) {
      this.wsClient.requestRematch();
    }
  }

  handleRematchRequest() {
    // Auto-accept for demo mode
    this.resetGame();
  }

  resetGame() {
    document.getElementById('game-over').classList.add('hidden');
    
    this.boardLogic.reset();
    this.renderer.reset();
    this.stateMachine.reset();
    this.stateMachine.setCurrentPlayer(1);
    this.stateMachine.setState(GameState.PLAYING);
    
    this.updatePlayerCards();
  }

  returnToMenu() {
    // Cleanup
    if (this.p2p) {
      this.p2p.close();
      this.p2p = null;
    }
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    
    // Reset state
    this.boardLogic.reset();
    this.renderer.reset();
    this.stateMachine.isLocalMode = false;
    this.stateMachine.setState(GameState.MENU);
    
    // Show menu
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('game-menu').classList.remove('hidden');
  }

  updateUIForState(state) {
    switch (state) {
      case GameState.MENU:
        document.getElementById('game-menu').classList.remove('hidden');
        document.getElementById('game-over').classList.add('hidden');
        break;
      case GameState.WAITING:
        // Show waiting indicator
        break;
      case GameState.PLAYING:
        document.getElementById('game-menu').classList.add('hidden');
        break;
      case GameState.GAME_OVER:
        document.getElementById('game-over').classList.remove('hidden');
        break;
    }
  }

  updatePlayerCards() {
    const p1Card = document.getElementById('player1-card');
    const p2Card = document.getElementById('player2-card');
    
    p1Card.classList.add('player1');
    p2Card.classList.add('player2');
    
    p1Card.querySelector('.player-name').textContent = this.stateMachine.players[1].name;
    p2Card.querySelector('.player-name').textContent = this.stateMachine.players[2].name;
    
    this.updateTurnIndicator(this.stateMachine.currentPlayer);
  }

  updateTurnIndicator(playerNum) {
    const p1Card = document.getElementById('player1-card');
    const p2Card = document.getElementById('player2-card');
    const indicator = document.getElementById('turn-indicator');
    
    if (playerNum === 1) {
      p1Card.classList.add('active');
      p2Card.classList.remove('active');
    } else {
      p2Card.classList.add('active');
      p1Card.classList.remove('active');
    }
    
    const isLocal = this.stateMachine.isLocalPlayerTurn();
    indicator.textContent = isLocal ? 'Your Turn' : 'Opponent\'s Turn';
  }

  updateScoreDisplay(playerNum, score) {
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector('.player-score').textContent = score;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render();
  }
}
