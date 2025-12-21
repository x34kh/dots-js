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
import { skinManager, SKINS } from './skins.js';

export class GameController {
  constructor(config = {}) {
    this.config = {
      gridSize: config.gridSize || 10, // Default to 10x10
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
    this.selectedGridSize = 10; // Default grid size
    this.pendingGameMode = null; // Store the selected game mode before grid size selection

    this.init();
  }

  async init() {
    // Initialize renderer
    this.renderer = new GameRenderer(this.canvas, this.boardLogic);

    // Setup event listeners
    this.setupUIEvents();
    this.setupInputEvents();
    this.setupStateMachineEvents();
    this.setupGridSizeSelector();
    this.setupSkinSelector();

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
    // Menu buttons - now show grid size selector first
    document.getElementById('btn-local-mode').addEventListener('click', () => {
      this.showGridSizeSelector('local');
    });

    document.getElementById('btn-demo-mode').addEventListener('click', () => {
      this.showGridSizeSelector('demo');
    });

    document.getElementById('btn-online-mode').addEventListener('click', () => {
      this.showGridSizeSelector('online');
    });

    document.getElementById('btn-anonymous-mode').addEventListener('click', () => {
      this.showGridSizeSelector('anonymous');
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

    // Forfeit button
    document.getElementById('btn-forfeit').addEventListener('click', () => {
      this.forfeitGame();
    });

    // Skins button
    document.getElementById('btn-skins').addEventListener('click', () => {
      this.showSkinSelector();
    });
  }

  setupGridSizeSelector() {
    // Grid size button selection
    const gridSizeBtns = document.querySelectorAll('.grid-size-btn');
    gridSizeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        // Update selection
        gridSizeBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedGridSize = parseInt(btn.dataset.size, 10);
      });
    });

    // Start game button
    document.getElementById('btn-start-game').addEventListener('click', () => {
      this.confirmGridSizeAndStartGame();
    });

    // Back button
    document.getElementById('btn-back-to-menu').addEventListener('click', () => {
      this.hideGridSizeSelector();
    });
  }

  setupSkinSelector() {
    // Close button
    document.getElementById('btn-close-skins').addEventListener('click', () => {
      this.hideSkinSelector();
    });

    // Populate skin list
    this.populateSkinList();
  }

  showSkinSelector() {
    document.getElementById('game-menu').classList.add('hidden');
    document.getElementById('skin-selector').classList.remove('hidden');
    this.populateSkinList();
  }

  hideSkinSelector() {
    document.getElementById('skin-selector').classList.add('hidden');
    document.getElementById('game-menu').classList.remove('hidden');
  }

  populateSkinList() {
    const skinList = document.getElementById('skin-list');
    skinList.innerHTML = '';

    const skins = skinManager.getAllSkins();
    const currentSkinId = skinManager.currentSkin;

    for (const skin of skins) {
      const isOwned = skinManager.isSkinOwned(skin.id);
      const isSelected = skin.id === currentSkinId;

      const skinItem = document.createElement('div');
      skinItem.className = `skin-item${isSelected ? ' selected' : ''}${!isOwned ? ' locked' : ''}`;
      skinItem.dataset.skinId = skin.id;

      // Get colors from skin
      const color1 = skin.player1.dotColor.toString(16).padStart(6, '0');
      const color2 = skin.player2.dotColor.toString(16).padStart(6, '0');

      skinItem.innerHTML = `
        <div class="skin-preview">
          <div class="skin-preview-dot" style="background-color: #${color1}"></div>
          <div class="skin-preview-dot" style="background-color: #${color2}"></div>
        </div>
        <div class="skin-info">
          <div class="skin-name">${skin.name}</div>
          <div class="skin-description">${skin.description}</div>
        </div>
        <div class="skin-status ${isOwned ? 'owned' : 'price'}">
          ${isOwned ? (isSelected ? '✓ Active' : 'Owned') : `${skin.price} coins`}
        </div>
      `;

      skinItem.addEventListener('click', () => {
        this.handleSkinClick(skin.id);
      });

      skinList.appendChild(skinItem);
    }
  }

  handleSkinClick(skinId) {
    if (skinManager.isSkinOwned(skinId)) {
      // Select the skin
      skinManager.selectSkin(skinId);
      skinManager.clearTextureCache();
      
      // Update renderer colors
      if (this.renderer) {
        this.renderer.updateSkinColors();
      }
      
      // Refresh the list
      this.populateSkinList();
    } else {
      // Try to purchase (in a real app, this would involve server/payment)
      const result = skinManager.purchaseSkin(skinId);
      if (result.success) {
        // Auto-select after purchase
        skinManager.selectSkin(skinId);
        skinManager.clearTextureCache();
        
        if (this.renderer) {
          this.renderer.updateSkinColors();
        }
        
        this.populateSkinList();
      } else {
        alert(`Cannot purchase skin: ${result.error}`);
      }
    }
  }

  showGridSizeSelector(mode) {
    this.pendingGameMode = mode;
    document.getElementById('game-menu').classList.add('hidden');
    document.getElementById('grid-size-selector').classList.remove('hidden');
  }

  hideGridSizeSelector() {
    this.pendingGameMode = null;
    document.getElementById('grid-size-selector').classList.add('hidden');
    document.getElementById('game-menu').classList.remove('hidden');
  }

  confirmGridSizeAndStartGame() {
    // Update the grid size configuration
    this.config.gridSize = this.selectedGridSize;
    
    // Reinitialize board logic and renderer with new grid size
    this.boardLogic = new BoardLogic(this.selectedGridSize);
    this.reinitializeRenderer();
    
    // Hide the grid size selector
    document.getElementById('grid-size-selector').classList.add('hidden');
    
    // Start the appropriate game mode
    switch (this.pendingGameMode) {
      case 'local':
        this.startLocalGame();
        break;
      case 'demo':
        this.startDemoGame();
        break;
      case 'online':
        this.startOnlineGame();
        break;
      case 'anonymous':
        this.startAnonymousGame();
        break;
    }
    
    this.pendingGameMode = null;
  }

  reinitializeRenderer() {
    // Clear the old scene and create a new renderer
    if (this.renderer) {
      // Dispose of old resources if needed
      this.renderer.reset();
    }
    this.renderer = new GameRenderer(this.canvas, this.boardLogic);
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
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('join');
    
    if (gameId) {
      // Clear the URL parameters
      window.history.replaceState({}, '', window.location.pathname);
      // Join the game
      this.joinDemoGame(gameId);
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
      
      console.log('Game created with ID:', gameId);
      console.log('Share link:', link);
      console.log('Link length:', link.length);
      
      // Update browser URL to the shareable link
      window.history.pushState({}, '', link);
      
      // Show share link in input field as well
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
      console.log('Waiting for opponent to join...');
      
      // Start polling for answer
      this.p2p.completeConnection().catch(error => {
        console.error('Failed to complete connection:', error);
        alert('Timed out waiting for opponent');
        this.returnToMenu();
      });
      
    } catch (error) {
      console.error('Failed to create demo game:', error);
      alert('Failed to create game. Error: ' + error.message);
    }
  }

  async joinDemoGame(gameId) {
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
      await this.p2p.joinGame(gameId);
      
      // Set local player as player 2
      this.stateMachine.localPlayerId = 2;
      this.stateMachine.setPlayer(2, {
        id: this.auth.getUser().id,
        name: this.auth.getUser().name
      });
      
    } catch (error) {
      console.error('Failed to join demo game:', error);
      alert('Failed to join game. The link may be invalid or expired.');
    }
  }
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
      console.log('P2P ready');
      // Send player info
      this.p2p.sendPlayerInfo({
        playerId: this.stateMachine.localPlayerId,
        name: this.auth.getUser().name
      });
      
      // Don't start game yet - wait for player info exchange
    });

    this.p2p.on('player', (data) => {
      const opponentId = this.stateMachine.localPlayerId === 1 ? 2 : 1;
      this.stateMachine.setPlayer(opponentId, {
        id: data.playerId,
        name: data.name
      });
      
      // Both players connected - start the game
      this.startGame();
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
    
    // Show forfeit button
    document.getElementById('btn-forfeit').classList.remove('hidden');
    
    // Reset board and scores
    this.boardLogic.reset();
    this.renderer.reset();
    this.stateMachine.reset();
    
    // Show player cards (after reset so scores are updated)
    this.updatePlayerCards();
  }

  forfeitGame() {
    if (this.stateMachine.state !== GameState.PLAYING) return;
    
    // Confirm forfeit
    if (!confirm('Are you sure you want to forfeit? Your opponent will win.')) {
      return;
    }
    
    // Determine winner (the other player)
    const currentPlayerId = this.stateMachine.localPlayerId;
    const winnerId = currentPlayerId === 1 ? 2 : 1;
    
    // Set the winner based on forfeit
    this.stateMachine.players[winnerId].score = 999; // Ensure they win
    
    // Notify server/opponent if in online/p2p mode
    if (this.stateMachine.mode === GameMode.DEMO && this.p2p) {
      // P2P resign
      this.p2p.send({ type: 'forfeit', player: currentPlayerId });
    } else if (this.stateMachine.mode === GameMode.ONLINE && this.wsClient) {
      // Server resign
      this.wsClient.resign();
    }
    
    // End the game
    this.endGame({ forfeit: true, forfeiter: currentPlayerId });
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
      this.wsClient.submitMove(x, y); // Send dot coordinates for new game format
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
    
    // Hide forfeit button
    document.getElementById('btn-forfeit').classList.add('hidden');
    
    const winner = this.stateMachine.getWinner();
    const p1Score = this.stateMachine.players[1].score;
    const p2Score = this.stateMachine.players[2].score;
    
    let winnerText;
    if (data && data.forfeit) {
      const forfeiterName = this.stateMachine.players[data.forfeiter].name;
      const winnerId = data.forfeiter === 1 ? 2 : 1;
      const winnerName = this.stateMachine.players[winnerId].name;
      winnerText = `${winnerName} wins! (${forfeiterName} forfeited)`;
    } else if (winner === null) {
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
    if (this.stateMachine.mode === GameMode.LOCAL) {
      // Local mode can rematch immediately
      this.resetGame();
    } else if (this.stateMachine.mode === GameMode.DEMO && this.p2p) {
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
    
    // Show forfeit button
    document.getElementById('btn-forfeit').classList.remove('hidden');
    
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
    
    // Hide forfeit button
    document.getElementById('btn-forfeit').classList.add('hidden');
    
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
    
    // Also update score displays to ensure they reflect current state
    this.updateScoreDisplay(1, this.stateMachine.players[1].score);
    this.updateScoreDisplay(2, this.stateMachine.players[2].score);
    
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
