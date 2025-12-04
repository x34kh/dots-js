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

    document.getElementById('btn-copy-link').addEventListener('click', () => {
      const linkInput = document.getElementById('share-link');
      linkInput.select();
      document.execCommand('copy');
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
    
    // Clear previous hover
    if (this.renderer.hoverDot && this.renderer.hoverDot !== dot) {
      if (this.renderer.hoverDot !== this.renderer.selectedDot) {
        this.renderer.unhighlightDot(this.renderer.hoverDot);
      }
      this.renderer.clearPreviews();
    }
    
    if (dot && dot !== this.renderer.selectedDot) {
      const playerNum = this.stateMachine.currentPlayer;
      
      // If we have a selected dot, show preview line and territory
      if (this.renderer.selectedDot) {
        const sel = this.renderer.selectedDot.userData;
        const hov = dot.userData;
        
        if (this.boardLogic.isValidLine(sel.gridX, sel.gridY, hov.gridX, hov.gridY)) {
          this.renderer.highlightDot(dot, this.renderer.playerColors[playerNum].getHex());
          this.renderer.createPreviewLine(sel.gridX, sel.gridY, hov.gridX, hov.gridY, playerNum);
          
          // Preview territory capture
          const previewTerritories = this.boardLogic.previewCapture(
            sel.gridX, sel.gridY, hov.gridX, hov.gridY
          );
          previewTerritories.forEach(t => {
            this.renderer.createPreviewTerritory(t.points);
          });
        }
      } else {
        // Just highlight the hovered dot
        this.renderer.highlightDot(dot, this.renderer.playerColors[playerNum].getHex());
      }
      
      this.renderer.hoverDot = dot;
    } else if (!dot) {
      this.renderer.hoverDot = null;
    }
  }

  handleClick(event) {
    if (this.stateMachine.state !== GameState.PLAYING) return;
    if (!this.stateMachine.isLocalPlayerTurn()) return;
    
    this.renderer.getMousePosition(event);
    const dot = this.renderer.getDotAtMouse();
    
    if (!dot) {
      this.cancelSelection();
      return;
    }
    
    const playerNum = this.stateMachine.currentPlayer;
    
    if (!this.renderer.selectedDot) {
      // Select first dot
      this.renderer.selectDot(dot, playerNum);
    } else if (dot === this.renderer.selectedDot) {
      // Deselect
      this.cancelSelection();
    } else {
      // Try to place line
      const sel = this.renderer.selectedDot.userData;
      const target = dot.userData;
      
      if (this.boardLogic.isValidLine(sel.gridX, sel.gridY, target.gridX, target.gridY)) {
        this.makeMove(sel.gridX, sel.gridY, target.gridX, target.gridY);
      } else {
        // Invalid line - select new dot instead
        this.renderer.deselectDot();
        this.renderer.selectDot(dot, playerNum);
      }
    }
  }

  cancelSelection() {
    this.renderer.deselectDot();
    this.renderer.clearPreviews();
  }

  makeMove(x1, y1, x2, y2) {
    const playerNum = this.stateMachine.currentPlayer;
    
    // Place the line locally
    const result = this.boardLogic.placeLine(x1, y1, x2, y2, playerNum);
    
    if (!result.success) {
      console.error('Invalid move');
      return;
    }
    
    // Clear selection and previews
    this.cancelSelection();
    
    // Apply visual changes
    this.applyMove({ x1, y1, x2, y2 }, playerNum, result.capturedTerritories);
    
    // Send move to opponent/server
    if (this.stateMachine.mode === GameMode.DEMO && this.p2p) {
      this.p2p.sendMove({ x1, y1, x2, y2, playerNum });
    } else if (this.stateMachine.mode === GameMode.ONLINE && this.wsClient) {
      this.wsClient.submitMove(x1, y1, x2, y2);
    }
    
    // Handle turn/captures
    if (result.capturedTerritories.length > 0) {
      // Player captured territory - they continue
      const points = result.capturedTerritories.reduce((sum, t) => sum + t.area, 0);
      this.stateMachine.addScore(playerNum, points);
      this.showCaptureNotification();
    } else {
      // No capture - switch turns
      this.stateMachine.switchTurn();
    }
    
    // Check game over
    if (this.boardLogic.isGameOver()) {
      this.endGame();
    }
  }

  applyMove(move, playerNum, captures = []) {
    // Add line to renderer
    const lineKey = this.boardLogic.getLineKey(move.x1, move.y1, move.x2, move.y2);
    const lineMesh = this.renderer.createLine(move.x1, move.y1, move.x2, move.y2, playerNum);
    this.renderer.lineMeshes.set(lineKey, lineMesh);
    
    // Add territories
    captures.forEach(territory => {
      const territoryKey = territory.points.map(p => `${p.x},${p.y}`).join('|');
      const territoryMesh = this.renderer.createTerritory(territory.points, playerNum);
      this.renderer.territoryMeshes.set(territoryKey, territoryMesh);
    });
  }

  receiveMove(data) {
    const { x1, y1, x2, y2, playerNum } = data;
    
    // Apply move to board logic
    const result = this.boardLogic.placeLine(x1, y1, x2, y2, playerNum);
    
    if (result.success) {
      // Apply visual changes
      this.applyMove({ x1, y1, x2, y2 }, playerNum, result.capturedTerritories);
      
      // Handle scoring and turns
      if (result.capturedTerritories.length > 0) {
        const points = result.capturedTerritories.reduce((sum, t) => sum + t.area, 0);
        this.stateMachine.addScore(playerNum, points);
      } else {
        this.stateMachine.switchTurn();
      }
      
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
    
    // Rebuild lines
    this.boardLogic.lines.forEach((playerNum, key) => {
      const [p1, p2] = key.split('-');
      const [x1, y1] = p1.split(',').map(Number);
      const [x2, y2] = p2.split(',').map(Number);
      
      const lineMesh = this.renderer.createLine(x1, y1, x2, y2, playerNum, false);
      this.renderer.lineMeshes.set(key, lineMesh);
    });
    
    // Rebuild territories
    this.boardLogic.territories.forEach((data, key) => {
      const territoryMesh = this.renderer.createTerritory(data.points, data.player, false);
      this.renderer.territoryMeshes.set(key, territoryMesh);
    });
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
