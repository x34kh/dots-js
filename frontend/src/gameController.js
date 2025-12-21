/**
 * Main Game Controller
 * Orchestrates all game components
 */

import { StateMachine, GameState, GameMode } from './stateMachine.js';
import { BoardLogic } from './boardLogic.js';
import { GameRenderer } from './renderer.js';
import { P2PNetwork } from './p2p.js';
import { WebSocketClient } from './websocket.js';
import { GoogleAuth } from './auth.js';
import { skinManager } from './skins.js';
import { notificationManager } from './notifications.js';
import { LobbyUI } from './lobby.js';
import { faviconStatus } from './faviconStatus.js';

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
    this.lobby = null;
    this.selectedGridSize = 10; // Default grid size
    this.pendingGameMode = null; // Store the selected game mode before grid size selection
    this.gameStarted = false; // Flag to prevent multiple startGame() calls
    this.autoShowLobbyOnLoad = false; // Flag to show lobby after initial auth
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.pendingMove = null; // Store pending move for touch confirm

    this.init();
  }

  async init() {
    // Initialize renderer
    this.renderer = new GameRenderer(this.canvas, this.boardLogic);

    // Initialize favicon status (start as disconnected)
    faviconStatus.setDisconnected();

    // Setup event listeners
    this.setupUIEvents();
    this.setupInputEvents();
    this.setupStateMachineEvents();
    this.setupGridSizeSelector();
    this.setupSkinSelector();

    // Initialize auth (optional)
    try {
      await this.auth.init();
      
      // Set up auth event handlers for auto-login/lobby
      this.auth.on('signIn', async (data) => {
        console.log('User signed in:', data.user.name);
        this.updateUserDisplay();
        
        // If this is the initial load and we have Google auth, show lobby
        if (this.autoShowLobbyOnLoad || this.config.googleClientId) {
          this.autoShowLobbyOnLoad = false;
          await this.autoStartOnlineMode();
        }
      });
      
      // If Google auth is available, trigger One Tap
      if (this.config.googleClientId) {
        // Check if already signed in from session
        if (this.auth.isSignedIn()) {
          console.log('Already signed in, showing lobby');
          await this.autoStartOnlineMode();
        } else {
          // Show Google One Tap on page load
          console.log('Triggering Google One Tap on page load');
          this.autoShowLobbyOnLoad = true;
          setTimeout(() => {
            this.auth.signIn();
          }, 500); // Small delay to ensure DOM is ready
        }
      }
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

    // Back to Lobby button
    document.getElementById('btn-back-to-lobby').addEventListener('click', () => {
      this.returnToLobby();
    });

    // Skins button
    document.getElementById('btn-skins').addEventListener('click', () => {
      this.showSkinSelector();
    });

    // Confirm move button (for touch devices)
    const confirmBtn = document.getElementById('btn-confirm-move');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.confirmPendingMove();
      });
    }
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
      
      // Update local player's skin
      const localPlayerId = this.stateMachine.localPlayerId || 1;
      skinManager.setPlayerSkin(localPlayerId, skinId);
      
      // If in P2P mode, send skin update to opponent
      if (this.p2p && this.p2p.isConnected && this.stateMachine.mode === GameMode.DEMO) {
        const playerInfo = this.stateMachine.getPlayer(localPlayerId);
        if (playerInfo) {
          playerInfo.skin = skinId;
          this.p2p.sendPlayerInfo({
            playerId: playerInfo.id,
            name: playerInfo.name,
            skin: skinId,
            playerNum: localPlayerId
          });
        }
      }
      
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
        
        // Update local player's skin
        const localPlayerId = this.stateMachine.localPlayerId || 1;
        skinManager.setPlayerSkin(localPlayerId, skinId);
        
        // If in P2P mode, send skin update to opponent
        if (this.p2p && this.p2p.isConnected && this.stateMachine.mode === GameMode.DEMO) {
          const playerInfo = this.stateMachine.getPlayer(localPlayerId);
          if (playerInfo) {
            playerInfo.skin = skinId;
            this.p2p.sendPlayerInfo({
              playerId: playerInfo.id,
              name: playerInfo.name,
              skin: skinId,
              playerNum: localPlayerId
            });
          }
        }
        
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
      if (this.isTouchDevice) {
        e.preventDefault();
        const touch = e.touches[0];
        this.handleTouchStart({ clientX: touch.clientX, clientY: touch.clientY });
      } else {
        e.preventDefault();
        const touch = e.touches[0];
        this.handleClick({ clientX: touch.clientX, clientY: touch.clientY });
      }
    });
  }

  setupStateMachineEvents() {
    this.stateMachine.on('stateChange', ({ newState }) => {
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
      
      // Hide all menu elements immediately
      document.getElementById('game-menu').classList.add('hidden');
      document.getElementById('grid-size-selector').classList.add('hidden');
      document.getElementById('skin-selector').classList.add('hidden');
      
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
    notificationManager.show('Initializing P2P game...', 'info');
    this.stateMachine.setMode(GameMode.DEMO);
    
    // Create guest user if not signed in
    if (!this.auth.isSignedIn()) {
      notificationManager.show('Creating guest user...', 'info');
      this.auth.createGuestUser();
    }
    
    // Set local player as player 1 FIRST
    notificationManager.show('Setting up Player 1...', 'info');
    this.stateMachine.localPlayerId = 1;
    this.stateMachine.setPlayer(1, {
      id: this.auth.getUser().id,
      name: this.auth.getUser().name,
      skin: skinManager.currentSkin
    });
    skinManager.setPlayerSkin(1, skinManager.currentSkin);
    
    // Initialize P2P
    notificationManager.show('Initializing P2P connection...', 'info');
    this.p2p = new P2PNetwork();
    this.setupP2PEvents();
    
    try {
      // Create game and get link
      notificationManager.show('Creating WebRTC offer...', 'info');
      const { gameId, link } = await this.p2p.createGame();
      this.stateMachine.gameId = gameId;
      
      console.log('Game created with ID:', gameId);
      console.log('Share link:', link);
      console.log('Link length:', link.length);
      
      notificationManager.show(`Game created! ID: ${gameId}`, 'success');
      
      // Update browser URL to the shareable link
      window.history.pushState({}, '', link);
      
      // Show share link in input field as well
      document.getElementById('share-link').value = link;
      document.getElementById('share-link-container').classList.remove('hidden');
      
      // Wait for opponent
      this.stateMachine.setState(GameState.WAITING);
      notificationManager.show('Waiting for opponent to join...', 'info', 10000);
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
    notificationManager.show(`Joining game ${gameId}...`, 'info');
    this.stateMachine.setMode(GameMode.DEMO);
    
    // Create guest user if not signed in
    if (!this.auth.isSignedIn()) {
      notificationManager.show('Creating guest user...', 'info');
      this.auth.createGuestUser();
    }
    
    // Set local player as player 2 FIRST
    notificationManager.show('Setting up Player 2...', 'info');
    this.stateMachine.localPlayerId = 2;
    this.stateMachine.setPlayer(2, {
      id: this.auth.getUser().id,
      name: this.auth.getUser().name,
      skin: skinManager.currentSkin
    });
    skinManager.setPlayerSkin(2, skinManager.currentSkin);
    
    // Initialize P2P
    notificationManager.show('Initializing P2P connection...', 'info');
    this.p2p = new P2PNetwork();
    this.setupP2PEvents();
    
    try {
      // Join the game
      notificationManager.show('Fetching game offer...', 'info');
      await this.p2p.joinGame(gameId);
      notificationManager.show('Joined successfully! Connecting...', 'success');
      
    } catch (error) {
      console.error('Failed to join demo game:', error);
      alert('Failed to join game. The link may be invalid or expired.');
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
      notificationManager.show('P2P connection established', 'success');
    });

    this.p2p.on('ready', () => {
      console.log('P2P ready');
      notificationManager.show('Connection ready, syncing player info...', 'info');
      // Send player info with skin
      const playerNum = this.stateMachine.localPlayerId;
      const playerInfo = this.stateMachine.getPlayer(playerNum);
      
      // Make sure player info exists before sending
      if (playerInfo) {
        this.p2p.sendPlayerInfo({
          playerId: playerInfo.id,
          name: playerInfo.name,
          skin: playerInfo.skin || skinManager.currentSkin,
          playerNum: playerNum
        });
        notificationManager.show('Player info sent', 'success');
      } else {
        console.warn('Player info not set yet when P2P ready fired');
        notificationManager.show('Warning: Player info not ready', 'error');
      }
      
      // Don't start game yet - wait for player info exchange
    });

    this.p2p.on('player', (data) => {
      console.log('[P2P] player event received:', data);
      console.log('[P2P] Current localPlayerId:', this.stateMachine.localPlayerId);
      notificationManager.show(`Received opponent info: ${data.name}`, 'success');
      const opponentId = this.stateMachine.localPlayerId === 1 ? 2 : 1;
      console.log('[P2P] Setting opponent ID:', opponentId);
      this.stateMachine.setPlayer(opponentId, {
        id: data.playerId,
        name: data.name,
        skin: data.skin || 'default'
      });
      
      // Set opponent's skin
      if (data.skin) {
        skinManager.setPlayerSkin(opponentId, data.skin);
        this.renderer.updateSkinColors();
      }
      
      // Both players connected - start the game
      console.log('[P2P] Calling startGame()...');
      notificationManager.show('Both players ready! Starting game...', 'success');
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
      notificationManager.show('Opponent disconnected', 'error');
      this.returnToMenu();
    });
  }

  async startOnlineGame() {
    this.stateMachine.setMode(GameMode.ONLINE);
    
    // Require sign in for online mode
    if (!this.auth.isSignedIn()) {
      this.autoShowLobbyOnLoad = true;
      this.auth.signIn();
      return;
    }
    
    // Connect to server and show lobby
    await this.connectToServer(false);
    await this.showLobby();
  }
  
  async autoStartOnlineMode() {
    // Called when user is already signed in (on page load)
    this.stateMachine.setMode(GameMode.ONLINE);
    await this.connectToServer(false);
    await this.showLobby();
  }

  async showLobby() {
    // Create lobby container if it doesn't exist
    let lobbyContainer = document.getElementById('lobby-container');
    if (!lobbyContainer) {
      lobbyContainer = document.createElement('div');
      lobbyContainer.id = 'lobby-container';
      document.body.appendChild(lobbyContainer);
    }
    
    if (!this.lobby) {
      // Ensure we have the user ID - it's 'sub' in JWT tokens
      const userId = this.auth.user?.sub || this.auth.user?.id || this.auth.getAnonymousAuthData()?.anonymousId;
      console.log('Creating lobby with user ID:', userId, 'Full user:', this.auth.user);
      
      this.lobby = new LobbyUI(this.wsClient, {
        userId: userId,
        name: this.auth.user?.name || this.auth.getAnonymousAuthData()?.username,
        picture: this.auth.user?.picture || null
      }, this.config.serverUrl, (gameId, gameState) => this.resumeSavedGame(gameId, gameState));
    }
    
    // Hide menu and game container
    const menuElement = document.getElementById('game-menu');
    const gameContainer = document.getElementById('game-container');
    
    if (menuElement) menuElement.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'none';
    
    // Show lobby container
    lobbyContainer.style.display = 'block';
    
    await this.lobby.show();
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
      // Don't auto-start matchmaking, let lobby control it
    });

    this.wsClient.on('gameStart', (data) => {
      // Hide lobby, show game
      if (this.lobby) {
        this.lobby.hide();
      }
      
      document.getElementById('game-container').style.display = 'block';
      
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
      faviconStatus.setDisconnected();
    });

    this.wsClient.on('reconnecting', () => {
      faviconStatus.setReconnecting();
    });

    this.wsClient.on('connected', () => {
      faviconStatus.setConnected();
    });
    
    this.wsClient.on('messagesFlushed', (data) => {
      if (data.count > 0) {
        notificationManager.show(`Reconnected - ${data.count} move${data.count > 1 ? 's' : ''} synchronized`, 'success');
      }
    });
  }

  startGame() {
    notificationManager.show('Starting game...', 'info');
    console.log('startGame() called');
    console.log('gameStarted flag:', this.gameStarted);
    
    // Prevent multiple calls to startGame()
    if (this.gameStarted) {
      console.log('Game already started, ignoring duplicate call');
      return;
    }
    this.gameStarted = true;
    
    console.log('Current state:', this.stateMachine.state);
    console.log('Mode:', this.stateMachine.mode);
    console.log('Players:', this.stateMachine.players);
    console.log('localPlayerId BEFORE:', this.stateMachine.localPlayerId);
    console.log('currentPlayer BEFORE:', this.stateMachine.currentPlayer);
    
    this.stateMachine.setState(GameState.PLAYING);
    this.stateMachine.setCurrentPlayer(1);
    
    console.log('Hiding menu...');
    // Hide menu
    document.getElementById('game-menu').classList.add('hidden');
    document.getElementById('share-link-container').classList.add('hidden');
    
    console.log('Showing forfeit button...');
    // Show forfeit button
    document.getElementById('btn-forfeit').classList.remove('hidden');
    
    // Hide back to lobby button for real-time games
    document.getElementById('btn-back-to-lobby').classList.add('hidden');
    
    console.log('Resetting board and renderer...');
    // Reset board and scores
    this.boardLogic.reset();
    this.renderer.reset();
    this.stateMachine.reset();
    
    // Update renderer colors to match current skin selections
    this.renderer.updateSkinColors();
    
    console.log('localPlayerId AFTER reset:', this.stateMachine.localPlayerId);
    console.log('currentPlayer AFTER reset:', this.stateMachine.currentPlayer);
    
    console.log('Updating player cards...');
    // Show player cards (after reset so scores are updated)
    this.updatePlayerCards();
    
    notificationManager.show('Game started!', 'success');
    console.log('startGame() completed');
    console.log('Final localPlayerId:', this.stateMachine.localPlayerId);
    console.log('Final currentPlayer:', this.stateMachine.currentPlayer);
  }

  async resumeSavedGame(gameId, gameState) {
    console.log('Resuming saved game:', gameId, gameState);
    
    // Prevent multiple calls
    if (this.gameStarted) {
      console.log('Game already started, ignoring resume');
      return;
    }
    this.gameStarted = true;
    
    // Hide lobby, show game
    if (this.lobby) {
      this.lobby.hide();
    }
    
    // Show game elements
    const gameContainer = document.getElementById('game-container');
    const gameMenu = document.getElementById('game-menu');
    const shareLink = document.getElementById('share-link-container');
    const forfeitBtn = document.getElementById('btn-forfeit');
    const backToLobbyBtn = document.getElementById('btn-back-to-lobby');
    
    gameContainer.style.display = 'block';
    gameMenu.classList.add('hidden');
    shareLink.classList.add('hidden');
    forfeitBtn.classList.remove('hidden');
    
    // Set up game state
    this.stateMachine.setState(GameState.PLAYING);
    this.stateMachine.mode = GameMode.ASYNC; // Use async mode for continued games
    this.stateMachine.gameId = gameId;
    
    // Determine which player we are
    const userId = this.auth.user?.sub || this.auth.user?.id;
    this.stateMachine.localPlayerId = (gameState.player1Id === userId) ? 1 : 2;
    
    console.log('User ID:', userId);
    console.log('Player1 ID:', gameState.player1Id, 'Player2 ID:', gameState.player2Id);
    console.log('LocalPlayerId:', this.stateMachine.localPlayerId);
    console.log('Current Player:', gameState.currentPlayer);
    
    // Set player info
    this.stateMachine.setPlayer(1, { 
      id: gameState.player1Id, 
      name: gameState.player1Name || 'Player 1',
      score: 0
    });
    this.stateMachine.setPlayer(2, { 
      id: gameState.player2Id, 
      name: gameState.player2Name || 'Player 2',
      score: 0
    });
    
    // Restore board state
    this.boardLogic.reset();
    this.renderer.reset();
    
    let player1Score = 0;
    let player2Score = 0;
    
    // Replay all moves to restore the board
    console.log('Replaying', gameState.moves.length, 'moves');
    for (const move of gameState.moves) {
      const result = this.boardLogic.placeDot(move.x, move.y, move.player);
      if (result.valid) {
        this.renderer.addDot(move.x, move.y, move.player);
        
        if (result.captures && result.captures.length > 0) {
          for (const capture of result.captures) {
            this.renderer.addSquare(capture.x, capture.y, move.player);
            if (move.player === 1) player1Score++;
            else player2Score++;
          }
        }
      }
    }
    
    // Update scores
    this.stateMachine.players[1].score = player1Score;
    this.stateMachine.players[2].score = player2Score;
    
    // Set current player
    this.stateMachine.setCurrentPlayer(gameState.currentPlayer);
    
    // Update UI
    this.renderer.updateSkinColors();
    this.updatePlayerCards();
    
    // Show Back to Lobby button for async games
    backToLobbyBtn.classList.remove('hidden');
    
    notificationManager.show('Game resumed!', 'success');
    console.log('Game resumed successfully. Current player:', gameState.currentPlayer, 'Local player:', this.stateMachine.localPlayerId);
  }

  returnToLobby() {
    // Return to lobby without forfeiting the game
    // Only works for async games
    if (this.stateMachine.mode !== GameMode.ASYNC) {
      console.log('Can only return to lobby from async games');
      return;
    }
    
    console.log('Returning to lobby, game will be preserved');
    
    // Reset game started flag
    this.gameStarted = false;
    
    // Hide game UI
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('btn-forfeit').classList.add('hidden');
    document.getElementById('btn-back-to-lobby').classList.add('hidden');
    
    // Show lobby
    if (this.lobby) {
      this.lobby.show();
    }
    
    notificationManager.show('Game saved - you can continue later from Current Games', 'success');
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

  handleTouchStart(event) {
    if (this.stateMachine.state !== GameState.PLAYING) return;
    if (!this.stateMachine.isLocalPlayerTurn()) return;
    
    this.renderer.getMousePosition(event);
    const dot = this.renderer.getDotAtMouse();
    const playerNum = this.stateMachine.currentPlayer;
    
    if (dot && this.renderer.isDotMeshClickable(dot)) {
      const { gridX, gridY } = dot.userData;
      
      // Clear previous preview
      this.renderer.clearPreviews();
      if (this.renderer.hoverDot) {
        const prevData = this.renderer.hoverDot.userData;
        this.renderer.setDotHoverTarget(prevData.gridX, prevData.gridY, false);
      }
      
      // Show hover effect like mouse (magnify dot)
      this.renderer.setDotHoverTarget(gridX, gridY, true, playerNum);
      
      // Preview territory capture
      const previewDots = this.boardLogic.previewCapture(gridX, gridY, playerNum);
      if (previewDots.length > 0) {
        this.renderer.showCapturePreview(previewDots, playerNum);
      }
      
      this.renderer.hoverDot = dot;
      
      // Store pending move and enable confirm button
      this.pendingMove = { gridX, gridY, playerNum };
      const confirmBtn = document.getElementById('btn-confirm-move');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
      }
    }
  }

  confirmPendingMove() {
    if (!this.pendingMove) return;
    
    const { gridX, gridY, playerNum } = this.pendingMove;
    
    // Execute the move
    this.makeMove(gridX, gridY, playerNum);
    
    // Clear pending move and disable button
    this.pendingMove = null;
    this.renderer.clearPreviews();
    if (this.renderer.hoverDot) {
      const prevData = this.renderer.hoverDot.userData;
      this.renderer.setDotHoverTarget(prevData.gridX, prevData.gridY, false);
      this.renderer.hoverDot = null;
    }
    
    const confirmBtn = document.getElementById('btn-confirm-move');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.4';
    }
  }

  handleClick(event) {
    console.log('Click detected!');
    console.log('State:', this.stateMachine.state);
    console.log('GameState.PLAYING:', GameState.PLAYING);
    console.log('localPlayerId:', this.stateMachine.localPlayerId);
    console.log('currentPlayer:', this.stateMachine.currentPlayer);
    console.log('isLocalPlayerTurn:', this.stateMachine.isLocalPlayerTurn());
    
    if (this.stateMachine.state !== GameState.PLAYING) {
      console.log('Not in PLAYING state, ignoring click');
      return;
    }
    if (!this.stateMachine.isLocalPlayerTurn()) {
      console.log('Not local player turn, ignoring click');
      return;
    }
    
    this.renderer.getMousePosition(event);
    const dot = this.renderer.getDotAtMouse();
    
    if (!dot || !this.renderer.isDotMeshClickable(dot)) {
      console.log('No clickable dot at mouse position');
      return;
    }
    
    const { gridX, gridY } = dot.userData;
    console.log('Making move at:', gridX, gridY);
    this.makeMove(gridX, gridY);
  }

  async makeMove(x, y) {
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
      // Check if WebSocket is connected
      if (!this.wsClient.isConnected()) {
        notificationManager.show('Connection lost - move will be sent when reconnected', 'info');
      }
      this.wsClient.submitMove(x, y); // Send dot coordinates for new game format
    } else if (this.stateMachine.mode === GameMode.ASYNC) {
      // Send move to async API
      await this.submitAsyncMove(x, y);
    }
    
    // Handle scoring
    // First deduct points from players who lost territory
    if (result.lostByPlayers) {
      for (const [lostPlayerNum, lostDotCount] of result.lostByPlayers) {
        this.stateMachine.addScore(lostPlayerNum, -lostDotCount);
      }
    }
    
    // Then award points to capturing player
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
  
  async submitAsyncMove(x, y) {
    const apiUrl = this.config.serverUrl || window.location.origin;
    const userId = this.auth.user?.sub || this.auth.user?.id;
    const gameId = this.stateMachine.gameId;
    
    try {
      const response = await fetch(`${apiUrl}/api/async/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, x, y })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to submit async move:', error);
        notificationManager.show('Failed to submit move', 'error');
      } else {
        console.log('Async move submitted successfully');
      }
    } catch (error) {
      console.error('Error submitting async move:', error);
      notificationManager.show('Error submitting move', 'error');
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
      // First deduct points from players who lost territory
      if (result.lostByPlayers) {
        for (const [lostPlayerNum, lostDotCount] of result.lostByPlayers) {
          this.stateMachine.addScore(lostPlayerNum, -lostDotCount);
        }
      }
      
      // Then award points to capturing player
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
    this.gameStarted = false; // Reset the flag
    this.stateMachine.setState(GameState.MENU);
    
    // Hide forfeit button
    document.getElementById('btn-forfeit').classList.add('hidden');
    
    // Show menu
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('game-menu').classList.remove('hidden');
  }

  updateUIForState(state) {
    const confirmBtn = document.getElementById('btn-confirm-move');
    const forfeitBtn = document.getElementById('btn-forfeit');
    
    switch (state) {
      case GameState.MENU:
        document.getElementById('game-menu').classList.remove('hidden');
        document.getElementById('game-over').classList.add('hidden');
        if (confirmBtn) confirmBtn.classList.add('hidden');
        if (forfeitBtn) forfeitBtn.classList.add('hidden');
        break;
      case GameState.WAITING:
        // Show waiting indicator
        if (confirmBtn) confirmBtn.classList.add('hidden');
        break;
      case GameState.PLAYING:
        document.getElementById('game-menu').classList.add('hidden');
        if (forfeitBtn) forfeitBtn.classList.remove('hidden');
        // Show confirm button only on touch devices
        if (confirmBtn && this.isTouchDevice) {
          confirmBtn.classList.remove('hidden');
          confirmBtn.disabled = true;
        }
        break;
      case GameState.GAME_OVER:
        document.getElementById('game-over').classList.remove('hidden');
        if (confirmBtn) confirmBtn.classList.add('hidden');
        if (forfeitBtn) forfeitBtn.classList.add('hidden');
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
    
    // Update player card colors based on their skins
    const p1SkinInfo = skinManager.getPlayerSkinInfo(1);
    const p2SkinInfo = skinManager.getPlayerSkinInfo(2);
    
    p1Card.style.setProperty('--player-color', `#${p1SkinInfo.color.toString(16).padStart(6, '0')}`);
    p2Card.style.setProperty('--player-color', `#${p2SkinInfo.color.toString(16).padStart(6, '0')}`);
    
    // Also update score displays to ensure they reflect current state
    this.updateScoreDisplay(1, this.stateMachine.players[1].score);
    this.updateScoreDisplay(2, this.stateMachine.players[2].score);
    
    this.updateTurnIndicator(this.stateMachine.currentPlayer);
  }

  updateTurnIndicator(playerNum) {
    const p1Card = document.getElementById('player1-card');
    const p2Card = document.getElementById('player2-card');
    const indicator = document.getElementById('turn-indicator');
    const confirmBtn = document.getElementById('btn-confirm-move');
    
    if (playerNum === 1) {
      p1Card.classList.add('active');
      p2Card.classList.remove('active');
    } else {
      p2Card.classList.add('active');
      p1Card.classList.remove('active');
    }
    
    const isLocal = this.stateMachine.isLocalPlayerTurn();
    indicator.textContent = isLocal ? 'Your Turn' : 'Opponent\'s Turn';
    
    // Clear pending move when turn changes
    if (!isLocal && this.pendingMove) {
      this.pendingMove = null;
      this.renderer.clearPreviews();
      if (this.renderer.hoverDot) {
        const prevData = this.renderer.hoverDot.userData;
        this.renderer.setDotHoverTarget(prevData.gridX, prevData.gridY, false);
        this.renderer.hoverDot = null;
      }
      if (confirmBtn) {
        confirmBtn.disabled = true;
      }
    }
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
