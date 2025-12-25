/**
 * Lobby UI
 * Displays player profile, ELO, match history, and queue controls
 */

export class LobbyUI {
  constructor(websocket, authState, serverUrl, onResumeGame) {
    this.websocket = websocket;
    this.authState = authState;
    this.serverUrl = serverUrl;
    this.onResumeGame = onResumeGame; // Callback to resume a game
    this.profileData = null;
    this.queueStats = null;
    this.currentGames = []; // Active async games
    this.inQueue = false;
    this.currentQueueType = null;
  }
  
  getApiUrl() {
    // If we have a configured serverUrl, use it
    if (this.serverUrl) {
      // If serverUrl is ws:// or wss://, convert to http:// or https://
      if (this.serverUrl.startsWith('ws://')) {
        return this.serverUrl.replace('ws://', 'http://').replace(/\/ws$/, '');
      } else if (this.serverUrl.startsWith('wss://')) {
        return this.serverUrl.replace('wss://', 'https://').replace(/\/ws$/, '');
      } else if (this.serverUrl.startsWith('http')) {
        return this.serverUrl.replace(/\/ws$/, '');
      }
    }
    
    // Try window.GAME_CONFIG or env vars
    if (window.GAME_CONFIG?.backendUrl) {
      return window.GAME_CONFIG.backendUrl;
    }
    
    if (import.meta.env.VITE_BACKEND_URL) {
      return import.meta.env.VITE_BACKEND_URL;
    }
    
    // Derive from current location (same as WebSocket does)
    const protocol = window.location.protocol; // http: or https:
    const host = window.location.hostname;
    const port = window.location.hostname === 'localhost' ? ':3001' : '';
    const url = `${protocol}//${host}${port}`;
    
    console.log('Derived API URL from location:', url);
    return url;
  }

  async show() {
    // Load profile data
    await this.loadProfile();
    
    // Load current games
    await this.loadCurrentGames();
    
    // Render lobby UI
    this.render();
    
    // Listen for queue stats updates
    this.websocket.on('queue_stats', (data) => {
      this.queueStats = data;
      this.updateQueueStats();
    });
    
    // Request initial queue stats
    this.requestQueueStats();
    
    // Poll for current games updates every 30 seconds
    this.gamesInterval = setInterval(() => {
      this.loadCurrentGames();
    }, 30000);
    
    // Setup nickname editing
    this.setupNicknameEditor();
  }

  setupNicknameEditor() {
    const editBtn = document.getElementById('edit-nickname-btn');
    const saveBtn = document.getElementById('save-nickname-btn');
    const cancelBtn = document.getElementById('cancel-nickname-btn');
    const editor = document.getElementById('nickname-editor');
    const display = document.getElementById('current-nickname');
    const input = document.getElementById('nickname-input');
    
    if (!editBtn || !saveBtn || !cancelBtn || !editor || !display || !input) return;
    
    editBtn.addEventListener('click', () => {
      input.value = display.textContent;
      editor.classList.remove('hidden');
      editBtn.classList.add('hidden');
      input.focus();
    });
    
    cancelBtn.addEventListener('click', () => {
      editor.classList.add('hidden');
      editBtn.classList.remove('hidden');
    });
    
    saveBtn.addEventListener('click', async () => {
      const newNickname = input.value.trim();
      if (!newNickname) return;
      
      const apiUrl = this.getApiUrl();
      try {
        const response = await fetch(`${apiUrl}/api/profile/${this.authState.userId}/nickname`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: newNickname })
        });
        
        if (response.ok) {
          const data = await response.json();
          display.textContent = data.nickname;
          editor.classList.add('hidden');
          editBtn.classList.remove('hidden');
          // Update cached profile data
          if (this.profileData) {
            this.profileData.nickname = data.nickname;
          }
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to update nickname');
        }
      } catch (error) {
        console.error('Failed to update nickname:', error);
        alert('Failed to update nickname');
      }
    });
  }

  async loadProfile() {
    const userId = this.authState.userId;
    
    if (!userId || userId === 'null' || userId === 'undefined') {
      console.warn('Invalid user ID:', userId, 'Auth state:', this.authState);
      this.profileData = {
        rating: 1500,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        recentMatches: []
      };
      return;
    }
    
    const apiUrl = this.getApiUrl();
    
    try {
      console.log('Loading profile for user:', userId, 'from:', apiUrl);
      const response = await fetch(`${apiUrl}/api/profile/${userId}`);
      if (response.ok) {
        this.profileData = await response.json();
      } else {
        console.warn('Failed to load profile, using defaults');
        this.profileData = {
          rating: 1500,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          winRate: 0,
          recentMatches: []
        };
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
      this.profileData = {
        rating: 1500,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        recentMatches: []
      };
    }
  }

  async loadCurrentGames() {
    const userId = this.authState.userId;
    
    if (!userId || userId === 'null' || userId === 'undefined') {
      this.currentGames = [];
      return;
    }
    
    const apiUrl = this.getApiUrl();
    
    try {
      const response = await fetch(`${apiUrl}/api/async/games/player/${userId}`);
      if (response.ok) {
        this.currentGames = await response.json();
        this.updateCurrentGamesDisplay();
      } else {
        this.currentGames = [];
      }
    } catch (error) {
      console.error('Failed to load current games:', error);
      this.currentGames = [];
    }
  }

  requestQueueStats() {
    // Stats will be broadcasted by server, but we can also poll
    const apiUrl = this.getApiUrl();
    
    fetch(`${apiUrl}/api/stats/online`)
      .then(res => res.json())
      .then(data => {
        this.queueStats = data;
        this.updateQueueStats();
      })
      .catch(err => console.error('Failed to load queue stats:', err));
  }

  render() {
    const container = document.getElementById('lobby-container');
    
    if (!container) {
      console.error('Lobby container not found!');
      return;
    }
    
    // Make lobby visible
    container.classList.remove('hidden');
    
    container.innerHTML = `
      <div class="lobby-container">
        <div class="lobby-header">
          <h1>Dots Game - Lobby</h1>
          <button id="logout-btn" class="btn btn-secondary">Logout</button>
        </div>
        
        <div class="lobby-content">
          <!-- Player Profile Section -->
          <div class="profile-section">
            <div class="profile-header">
              <img src="${this.authState.picture || 'https://via.placeholder.com/80'}" 
                   alt="Profile" class="profile-picture">
              <div class="profile-info">
                <h2>${this.authState.name}</h2>
                <div class="nickname-display">
                  <span class="nickname-label">Nickname:</span>
                  <span class="nickname-value" id="current-nickname">${this.profileData?.nickname || this.authState.name || 'Player'}</span>
                  <button id="edit-nickname-btn" class="btn-edit-nickname">✏️</button>
                </div>
                <div class="nickname-editor hidden" id="nickname-editor">
                  <input type="text" id="nickname-input" maxlength="20" placeholder="Enter nickname" />
                  <button id="save-nickname-btn" class="btn-save-nickname">Save</button>
                  <button id="cancel-nickname-btn" class="btn-cancel-nickname">Cancel</button>
                </div>
                <div class="elo-display">
                  <span class="elo-label">ELO Rating:</span>
                  <span class="elo-value">${this.profileData?.rating || 1500}</span>
                </div>
              </div>
            </div>
            
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-value">${this.profileData?.gamesPlayed || 0}</div>
                <div class="stat-label">Games Played</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${this.profileData?.wins || 0}</div>
                <div class="stat-label">Wins</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${this.profileData?.losses || 0}</div>
                <div class="stat-label">Losses</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${this.profileData?.draws || 0}</div>
                <div class="stat-label">Draws</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${this.profileData?.winRate || 'N/A'}</div>
                <div class="stat-label">Win Rate</div>
              </div>
            </div>
          </div>
          
          <!-- Current Games Section -->
          <div class="current-games-section">
            <h3>Current Games (${this.currentGames.length}/5)</h3>
            <div id="current-games-list" class="current-games-list">
              ${this.renderCurrentGames()}
            </div>
          </div>
          
          <!-- Queue Section -->
          <div class="queue-section">
            <h3>Find Match</h3>
            <div id="queue-controls">
              <button id="join-ranked-btn" class="btn btn-primary">Join Ranked Queue</button>
              <button id="join-unranked-btn" class="btn btn-primary">Join Unranked Queue</button>
            </div>
            <div id="queue-status" class="queue-status hidden">
              <div class="spinner"></div>
              <p id="queue-status-text">Waiting for opponent...</p>
              <button id="cancel-queue-btn" class="btn btn-secondary">Cancel</button>
            </div>
            
            <!-- Online Stats -->
            <div class="online-stats">
              <h4>Online</h4>
              <div class="online-stats-grid">
                <div class="online-stat">
                  <span class="online-value" id="players-online">-</span>
                  <span class="online-label">Players Online</span>
                </div>
                <div class="online-stat">
                  <span class="online-value" id="players-in-queue">-</span>
                  <span class="online-label">In Queue</span>
                </div>
                <div class="online-stat">
                  <span class="online-value" id="players-playing">-</span>
                  <span class="online-label">Playing</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Match History Section -->
          <div class="match-history-section">
            <h3>Recent Matches</h3>
            <div class="match-history-list">
              ${this.renderMatchHistory()}
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add styles
    this.addStyles();
    
    // Attach event listeners
    this.attachEventListeners();
  }

  renderMatchHistory() {
    if (!this.profileData?.recentMatches || this.profileData.recentMatches.length === 0) {
      return '<p class="no-matches">No matches played yet</p>';
    }
    
    return this.profileData.recentMatches.map(match => {
      const resultClass = match.result === 'win' ? 'match-win' : 
                         match.result === 'loss' ? 'match-loss' : 'match-draw';
      const resultText = match.result.toUpperCase();
      const date = new Date(match.completedAt).toLocaleDateString();
      const rankedBadge = match.isRanked ? '<span class="ranked-badge">Ranked</span>' : '';
      
      return `
        <div class="match-item ${resultClass}">
          <div class="match-result">${resultText}</div>
          <div class="match-details">
            <div class="match-opponent">vs ${match.opponentName}</div>
            <div class="match-score">${match.myScore} - ${match.opponentScore}</div>
          </div>
          <div class="match-meta">
            ${rankedBadge}
            <span class="match-date">${date}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderCurrentGames() {
    if (!this.currentGames || this.currentGames.length === 0) {
      return '<div class="no-games">No active games. Start a new turn-based match!</div>';
    }
    
    return this.currentGames.map(game => {
      const turnClass = game.isMyTurn ? 'your-turn' : 'opponent-turn';
      const turnText = game.isMyTurn ? 'Your Turn' : "Opponent's Turn";
      const timeRemaining = this.formatTimeRemaining(game.timeRemaining);
      const rankedBadge = game.isRanked ? '<span class="ranked-badge">Ranked</span>' : '';
      const gridInfo = `${game.gridSize}×${game.gridSize}`;
      
      return `
        <div class="current-game-item ${turnClass}" data-game-id="${game.id}">
          <div class="game-status">
            <span class="game-turn-status">${turnText}</span>
            ${rankedBadge}
          </div>
          <div class="game-opponent">
            <strong>${game.opponentName}</strong>
            <span class="opponent-elo">ELO: ${game.opponentRating}</span>
          </div>
          <div class="game-score">
            <span>You: ${game.myScore}</span>
            <span class="score-separator">-</span>
            <span>Opp: ${game.opponentScore}</span>
          </div>
          <div class="game-meta">
            <span class="grid-info">${gridInfo}</span>
            <span class="time-remaining">${timeRemaining}</span>
          </div>
          <button class="btn-continue-game" data-game-id="${game.id}">
            ${game.isMyTurn ? 'Play Now' : 'View Game'}
          </button>
        </div>
      `;
    }).join('');
  }

  formatTimeRemaining(ms) {
    if (ms <= 0) return 'Time expired!';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  updateCurrentGamesDisplay() {
    const gamesList = document.getElementById('current-games-list');
    if (gamesList) {
      gamesList.innerHTML = this.renderCurrentGames();
      // Re-attach event listeners for continue buttons
      this.attachGameContinueListeners();
    }
  }

  attachGameContinueListeners() {
    const continueButtons = document.querySelectorAll('.btn-continue-game');
    continueButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const gameId = e.target.dataset.gameId;
        this.continueGame(gameId);
      });
    });
  }

  async continueGame(gameId) {
    console.log('Continue game:', gameId);
    
    const apiUrl = this.getApiUrl();
    const userId = this.authState.userId;
    
    try {
      // Load full game state
      const response = await fetch(`${apiUrl}/api/async/games/${gameId}?userId=${userId}`);
      if (!response.ok) {
        console.error('Failed to load game:', await response.text());
        return;
      }
      
      const gameState = await response.json();
      console.log('Game state loaded:', gameState);
      
      // Call the callback to resume the game
      if (this.onResumeGame) {
        this.onResumeGame(gameId, gameState);
      } else {
        console.error('No onResumeGame callback provided');
      }
    } catch (error) {
      console.error('Error continuing game:', error);
    }
  }

  updateQueueStats() {
    if (!this.queueStats) return;
    
    document.getElementById('players-online').textContent = this.queueStats.playersOnline || 0;
    document.getElementById('players-in-queue').textContent = this.queueStats.playersInQueue || 0;
    document.getElementById('players-playing').textContent = this.queueStats.playersPlaying || 0;
  }

  attachEventListeners() {
    // Join ranked queue
    document.getElementById('join-ranked-btn')?.addEventListener('click', () => {
      this.joinQueue(true);
    });
    
    // Join unranked queue
    document.getElementById('join-unranked-btn')?.addEventListener('click', () => {
      this.joinQueue(false);
    });
    
    // Cancel queue
    document.getElementById('cancel-queue-btn')?.addEventListener('click', () => {
      this.cancelQueue();
    });
    
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      this.logout();
    });
    
    // Attach current game continue listeners
    this.attachGameContinueListeners();
  }

  joinQueue(isRanked) {
    // Check WebSocket connection
    if (!this.websocket || !this.websocket.isConnected()) {
      console.error('WebSocket not connected, cannot join queue');
      alert('Connection lost. Please refresh the page.');
      return;
    }
    
    this.inQueue = true;
    this.currentQueueType = isRanked ? 'ranked' : 'unranked';
    
    // Show queue status
    document.getElementById('queue-controls').classList.add('hidden');
    document.getElementById('queue-status').classList.remove('hidden');
    document.getElementById('queue-status-text').textContent = 
      `Searching for ${isRanked ? 'ranked' : 'unranked'} match...`;
    
    // Send find match message
    this.websocket.send({
      type: 'find_match',
      isRanked
    });
  }

  cancelQueue() {
    this.inQueue = false;
    this.currentQueueType = null;
    
    // Hide queue status
    document.getElementById('queue-controls').classList.remove('hidden');
    document.getElementById('queue-status').classList.add('hidden');
    
    // Send cancel message
    this.websocket.send({
      type: 'cancel_match'
    });
  }

  logout() {
    // Clear auth and reload
    sessionStorage.removeItem('google_token');
    localStorage.removeItem('google_token');
    localStorage.removeItem('anon_id');
    localStorage.removeItem('anon_name');
    localStorage.removeItem('anon_sig');
    window.location.reload();
  }

  hide() {
    // Hide lobby container
    const container = document.getElementById('lobby-container');
    if (container) {
      container.classList.add('hidden');
    }
    
    // Cleanup polling interval
    if (this.gamesInterval) {
      clearInterval(this.gamesInterval);
      this.gamesInterval = null;
    }
  }

  addStyles() {
    if (document.getElementById('lobby-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'lobby-styles';
    style.textContent = `
      .lobby-container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
        color: white;
      }
      
      .lobby-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
      }
      
      .lobby-header h1 {
        margin: 0;
        font-size: 2em;
      }
      
      .lobby-content {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
      
      .profile-section, .queue-section, .match-history-section {
        background: rgba(0, 0, 0, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        padding: 20px;
      }
      
      .match-history-section {
        grid-column: 1 / -1;
      }
      
      .profile-header {
        display: flex;
        gap: 20px;
        margin-bottom: 20px;
        align-items: center;
      }
      
      .profile-picture {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        border: 3px solid white;
      }
      
      .profile-info h2 {
        margin: 0 0 10px 0;
      }
      
      .elo-display {
        font-size: 1.2em;
      }
      
      .elo-value {
        font-weight: bold;
        color: #ffd700;
        margin-left: 5px;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 15px;
      }
      
      .stat-item {
        text-align: center;
      }
      
      .stat-value {
        font-size: 2em;
        font-weight: bold;
        color: #4CAF50;
      }
      
      .stat-label {
        font-size: 0.9em;
        color: rgba(255, 255, 255, 0.7);
      }
      
      .queue-section h3 {
        margin-top: 0;
      }
      
      #queue-controls {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }
      
      .queue-status {
        text-align: center;
        padding: 20px;
      }
      
      .queue-status.hidden {
        display: none;
      }
      
      .spinner {
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top: 3px solid white;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 0 auto 15px;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .online-stats {
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .online-stats h4 {
        margin-top: 0;
      }
      
      .online-stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
        text-align: center;
      }
      
      .online-value {
        display: block;
        font-size: 1.5em;
        font-weight: bold;
        color: #2196F3;
      }
      
      .online-label {
        display: block;
        font-size: 0.85em;
        color: rgba(255, 255, 255, 0.7);
      }
      
      .match-history-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 400px;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 10px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
      }
      
      .match-history-list::-webkit-scrollbar {
        width: 8px;
      }
      
      .match-history-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }
      
      .match-history-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }
      
      .match-history-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .match-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.05);
      }
      
      .match-win {
        border-left: 4px solid #4CAF50;
      }
      
      .match-loss {
        border-left: 4px solid #f44336;
      }
      
      .match-draw {
        border-left: 4px solid #FF9800;
      }
      
      .match-result {
        font-weight: bold;
        font-size: 1.1em;
        min-width: 60px;
      }
      
      .match-win .match-result {
        color: #4CAF50;
      }
      
      .match-loss .match-result {
        color: #f44336;
      }
      
      .match-draw .match-result {
        color: #FF9800;
      }
      
      .match-details {
        flex: 1;
      }
      
      .match-opponent {
        font-size: 1.1em;
      }
      
      .match-score {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.9em;
      }
      
      .match-meta {
        text-align: right;
      }
      
      .ranked-badge {
        background: #ffd700;
        color: #000;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 0.8em;
        font-weight: bold;
        margin-right: 5px;
      }
      
      .match-date {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.85em;
      }
      
      .no-matches {
        text-align: center;
        color: rgba(255, 255, 255, 0.5);
        padding: 40px;
      }
      
      /* Current Games Section */
      .current-games-section h3 {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .current-games-list {
        display: flex;
        flex-direction: column;
        gap: 15px;
        max-height: 500px;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 10px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
      }
      
      .current-games-list::-webkit-scrollbar {
        width: 8px;
      }
      
      .current-games-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }
      
      .current-games-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }
      
      .current-games-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .current-game-item {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 20px;
        border-left: 4px solid #2196F3;
        transition: all 0.2s;
      }
      
      .current-game-item:hover {
        background: rgba(255, 255, 255, 0.08);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      
      .current-game-item.your-turn {
        border-left-color: #4CAF50;
        animation: pulse-glow 2s ease-in-out infinite;
      }
      
      .current-game-item.opponent-turn {
        border-left-color: #FF9800;
      }
      
      @keyframes pulse-glow {
        0%, 100% { box-shadow: 0 0 10px rgba(76, 175, 80, 0.3); }
        50% { box-shadow: 0 0 20px rgba(76, 175, 80, 0.6); }
      }
      
      .game-status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .turn-indicator {
        font-weight: bold;
        font-size: 1.1em;
      }
      
      .your-turn .turn-indicator {
        color: #4CAF50;
      }
      
      .opponent-turn .turn-indicator {
        color: #FF9800;
      }
      
      .game-opponent {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .opponent-elo {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.9em;
      }
      
      .game-score {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 15px;
        margin: 15px 0;
        font-size: 1.2em;
        font-weight: bold;
      }
      
      .score-separator {
        color: rgba(255, 255, 255, 0.3);
      }
      
      .game-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.9em;
      }
      
      .time-remaining {
        font-weight: bold;
        color: #2196F3;
      }
      
      .your-turn .time-remaining {
        color: #4CAF50;
      }
      
      .btn-continue-game {
        width: 100%;
        padding: 12px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 5px;
        font-size: 1em;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .your-turn .btn-continue-game {
        background: #4CAF50;
      }
      
      .btn-continue-game:hover {
        transform: scale(1.02);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      
      .your-turn .btn-continue-game:hover {
        background: #45a049;
      }
      
      .no-games {
        text-align: center;
        color: rgba(255, 255, 255, 0.5);
        padding: 40px;
        font-style: italic;
      }
      
      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 5px;
        font-size: 1em;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .btn-primary {
        background: #2196F3;
        color: white;
      }
      
      .btn-primary:hover {
        background: #1976D2;
      }
      
      .btn-secondary {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }
      
      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .hidden {
        display: none !important;
      }
      
      @media (max-width: 768px) {
        .lobby-content {
          grid-template-columns: 1fr;
        }
        
        .stats-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      
      /* Portrait orientation scrolling fix */
      @media (orientation: portrait) {
        #lobby-container {
          height: 100vh;
          overflow-y: auto;
          overflow-x: hidden;
        }
        
        .lobby-container {
          padding-bottom: 50px;
        }
      }
    `;
    
    document.head.appendChild(style);
  }
}
