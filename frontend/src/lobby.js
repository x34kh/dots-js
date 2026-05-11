/**
 * Lobby UI
 * Displays player profile, ELO, match history, and queue controls
 */

import { GameReplay } from './gameReplay.js';
import { PlayerProfile } from './playerProfile.js';

export class LobbyUI {
  constructor(websocket, authState, serverUrl, onResumeGame) {
    this.websocket = websocket;
    this.authState = authState;
    this.serverUrl = serverUrl;
    this.onResumeGame = onResumeGame;
    this.profileData = null;
    this.queueStats = null;
    this.currentGames = [];
    this.adminData = null;
    this.inQueue = false;
    this.currentQueueType = null;
    this.replay = new GameReplay(serverUrl);
    this.playerProfile = new PlayerProfile(authState, serverUrl);
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

    // Load admin dashboard data when applicable
    if (this.authState?.isAdmin) {
      await this.loadAdminLobbyData();
    }
    
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
      if (this.authState?.isAdmin) {
        this.loadAdminLobbyData();
      }
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

  async loadAdminLobbyData() {
    if (!this.authState?.isAdmin || !this.authState?.userId) {
      this.adminData = null;
      return;
    }

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/admin/lobby?userId=${encodeURIComponent(this.authState.userId)}`);
      if (response.ok) {
        this.adminData = await response.json();
        this.updateAdminPanel();
      }
    } catch (error) {
      console.error('Failed to load admin lobby data:', error);
    }
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

          ${this.authState?.isAdmin ? this.renderAdminPanel() : ''}
          
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

  renderAdminPanel() {
    const counts = this.adminData?.counts || {
      onlinePlayers: 0,
      queuedPlayers: 0,
      activeGames: 0,
      finishedGames: 0
    };

    return `
      <div class="admin-section">
        <h3>Admin Tools</h3>
        
        <!-- Player Search -->
        <div class="admin-search-box">
          <input type="text" id="admin-player-search" class="admin-search-input" 
                 placeholder="Search players by name, nickname, or email..." />
          <div id="admin-search-results" class="admin-search-results hidden"></div>
        </div>
        
        <h3>Admin Overview</h3>
        <div class="admin-stats-grid">
          <button class="admin-stat-btn" data-admin-view="onlinePlayers">
            <span class="admin-stat-value">${counts.onlinePlayers}</span>
            <span class="admin-stat-label">Online Players</span>
          </button>
          <button class="admin-stat-btn" data-admin-view="queuedPlayers">
            <span class="admin-stat-value">${counts.queuedPlayers}</span>
            <span class="admin-stat-label">Players In Queues</span>
          </button>
          <button class="admin-stat-btn" data-admin-view="activeGames">
            <span class="admin-stat-value">${counts.activeGames}</span>
            <span class="admin-stat-label">Active Games</span>
          </button>
          <button class="admin-stat-btn" data-admin-view="finishedGames">
            <span class="admin-stat-value">${counts.finishedGames}</span>
            <span class="admin-stat-label">Finished Games</span>
          </button>
        </div>
        <div id="admin-detail-panel" class="admin-detail-panel"></div>
      </div>
    `;
  }

  updateAdminPanel() {
    if (!this.authState?.isAdmin) return;

    const panel = document.getElementById('admin-detail-panel');
    if (!panel) return;

    panel.innerHTML = '<div class="admin-detail-hint">Click a number above to view details.</div>';
  }

  renderAdminList(viewType) {
    if (!this.adminData) {
      return '<div class="admin-empty">No admin data loaded</div>';
    }

    if (viewType === 'onlinePlayers') {
      const players = this.adminData.onlinePlayers || [];
      if (players.length === 0) return '<div class="admin-empty">No online players</div>';
      return players.map((p) => `
        <div class="admin-item">
          <div><strong>${p.nickname || p.name || 'Unknown'}</strong></div>
          <div class="admin-meta">${p.email || 'anonymous'}${p.isAdmin ? ' | admin' : ''}</div>
        </div>
      `).join('');
    }

    if (viewType === 'queuedPlayers') {
      const ranked = this.adminData.queueDetails?.ranked || [];
      const unranked = this.adminData.queueDetails?.unranked || [];
      const rows = [
        ...ranked.map((p) => ({ ...p, queue: 'Ranked' })),
        ...unranked.map((p) => ({ ...p, queue: 'Unranked' }))
      ];
      if (rows.length === 0) return '<div class="admin-empty">No players in queue</div>';
      return rows.map((p) => `
        <div class="admin-item">
          <div><strong>${p.nickname || p.name || p.userId}</strong></div>
          <div class="admin-meta">${p.queue} queue</div>
        </div>
      `).join('');
    }

    if (viewType === 'activeGames') {
      const games = this.adminData.activeGames || [];
      if (games.length === 0) return '<div class="admin-empty">No active games</div>';
      return games.map((g) => `
        <div class="admin-item admin-game-item">
          <div><strong>${g.player1Name}</strong> vs <strong>${g.player2Name}</strong></div>
          <div class="admin-meta">Score ${g.scores?.[1] || 0} - ${g.scores?.[2] || 0} | Moves: ${g.moveCount || 0}</div>
          <button class="btn btn-secondary btn-admin-watch" data-admin-game-id="${g.id}">Watch</button>
        </div>
      `).join('');
    }

    if (viewType === 'finishedGames') {
      const games = this.adminData.finishedGames || [];
      if (games.length === 0) return '<div class="admin-empty">No finished games</div>';
      return games.slice(0, 100).map((g) => `
        <div class="admin-item">
          <div><strong>${g.player1Name || 'Player 1'}</strong> vs <strong>${g.player2Name || 'Player 2'}</strong></div>
          <div class="admin-meta">${g.player1Score || 0} - ${g.player2Score || 0}</div>
        </div>
      `).join('');
    }

    return '<div class="admin-empty">Unknown view</div>';
  }

  async watchActiveGame(gameId) {
    if (!this.authState?.isAdmin || !this.authState?.userId) return;

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/admin/active-games/${encodeURIComponent(gameId)}?userId=${encodeURIComponent(this.authState.userId)}`);
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to load active game');
        return;
      }

      const gameState = await response.json();
      if (this.onResumeGame) {
        this.onResumeGame(gameId, gameState, { spectator: true, adminView: true });
      }
    } catch (error) {
      console.error('Failed to watch active game:', error);
      alert('Failed to watch active game');
    }
  }

  /**
   * Search for players (admin function)
   */
  async searchAdminPlayers(query) {
    if (!this.authState?.isAdmin || !this.authState?.userId) return;

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/admin/search-players?q=${encodeURIComponent(query)}&userId=${encodeURIComponent(this.authState.userId)}`);
      if (!response.ok) {
        console.error('Search failed');
        return;
      }

      const data = await response.json();
      this.displayAdminSearchResults(data.results || []);
    } catch (error) {
      console.error('Failed to search players:', error);
    }
  }

  /**
   * Display search results and attach event listeners
   */
  displayAdminSearchResults(results) {
    const resultsDiv = document.getElementById('admin-search-results');
    if (!resultsDiv) return;

    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="admin-search-empty">No players found</div>';
      resultsDiv.classList.remove('hidden');
      return;
    }

    const html = results.map(player => `
      <div class="admin-search-result-item" data-player-id="${player.userId}">
        <div class="admin-search-result-name">
          <strong>${player.nickname || player.name || 'Unknown'}</strong>
          ${player.isOnline ? '<span class="status-badge status-online">Online</span>' : '<span class="status-badge status-offline">Offline</span>'}
          ${player.isAdmin ? '<span class="status-badge status-admin">Admin</span>' : ''}
        </div>
        <div class="admin-search-result-meta">
          ${player.email || 'no email'}
        </div>
        <button class="btn btn-secondary btn-view-player-games" data-player-id="${player.userId}">
          View Games
        </button>
      </div>
    `).join('');

    resultsDiv.innerHTML = html;
    resultsDiv.classList.remove('hidden');

    // Attach event listeners for view games buttons
    resultsDiv.querySelectorAll('.btn-view-player-games').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const playerId = e.currentTarget.dataset.playerId;
        this.viewAdminPlayerGames(playerId);
      });
    });
  }

  /**
   * View all games for a specific player (admin function)
   */
  async viewAdminPlayerGames(userId) {
    if (!this.authState?.isAdmin || !this.authState?.userId) return;

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/admin/player-games/${encodeURIComponent(userId)}?userId=${encodeURIComponent(this.authState.userId)}`);
      if (!response.ok) {
        alert('Failed to load player games');
        return;
      }

      const playerData = await response.json();
      this.displayAdminPlayerGames(playerData);
    } catch (error) {
      console.error('Failed to view player games:', error);
      alert('Failed to view player games');
    }
  }

  /**
   * Display player's games in the admin detail panel
   */
  displayAdminPlayerGames(playerData) {
    const panel = document.getElementById('admin-detail-panel');
    if (!panel) return;

    const games = playerData.games || [];
    const stats = `<div class="admin-player-stats">
      <h4>${playerData.userId}</h4>
      <div class="admin-player-stats-grid">
        <div>Total Games: <strong>${playerData.totalGames}</strong></div>
        <div>Active: <strong>${playerData.activeGames}</strong></div>
        <div>Completed: <strong>${playerData.completedGames}</strong></div>
      </div>
    </div>`;

    if (games.length === 0) {
      panel.innerHTML = stats + '<div class="admin-empty">No games found for this player</div>';
      return;
    }

    const gamesList = games.map(game => {
      const status = game.status === 'active' ? 'Active' : 'Completed';
      const turn = game.isMyTurn ? '🔵 Your Turn' : '⚪ Their Turn';
      const score = `${game.myScore || 0} - ${game.opponentScore || 0}`;
      const moves = game.moveCount || 0;
      const gridSize = game.gridSize || 10;

      return `
        <div class="admin-player-game-item">
          <div class="game-header">
            <span class="game-status">${status}</span>
            <span class="game-opponent"><strong>vs ${game.opponent1Name}</strong></span>
          </div>
          <div class="game-info">
            <span>Score: ${score}</span>
            <span>Grid: ${gridSize}×${gridSize}</span>
            <span>Moves: ${moves}</span>
            ${game.status === 'active' ? `<span>${turn}</span>` : ''}
          </div>
          <button class="btn btn-secondary btn-admin-observe" data-game-id="${game.id}">
            ${game.status === 'active' ? 'Observe' : 'Review'}
          </button>
        </div>
      `;
    }).join('');

    panel.innerHTML = stats + '<div class="admin-player-games-list">' + gamesList + '</div>';

    // Attach observe button listeners
    panel.querySelectorAll('.btn-admin-observe').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const gameId = e.currentTarget.dataset.gameId;
        this.observeAdminGame(gameId);
      });
    });
  }

  /**
   * Observe/spectate a game (admin function)
   */
  async observeAdminGame(gameId) {
    if (!this.authState?.isAdmin || !this.authState?.userId) return;

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/admin/observe/${encodeURIComponent(gameId)}?userId=${encodeURIComponent(this.authState.userId)}`);
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to load game');
        return;
      }

      const gameState = await response.json();
      if (this.onResumeGame) {
        this.onResumeGame(gameId, gameState, { spectator: true, adminView: true, observeMode: true });
      }
    } catch (error) {
      console.error('Failed to observe game:', error);
      alert('Failed to observe game');
    }
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
      const replayBtn = match.gameId
        ? `<button class="btn-replay-match" data-game-id="${match.gameId}">▶ Replay</button>`
        : '';
      
      // Use nickname if available (privacy first), fall back to name
      const opponentDisplay = match.opponentNickname || match.opponentName || 'Unknown';
      
      return `
        <div class="match-item ${resultClass}" data-opponent-id="${match.opponentId}">
          <div class="match-result">${resultText}</div>
          <div class="match-details">
            <div class="match-opponent clickable">vs ${opponentDisplay}</div>
            <div class="match-score">${match.myScore} - ${match.opponentScore}</div>
          </div>
          <div class="match-meta">
            ${rankedBadge}
            <span class="match-date">${date}</span>
            ${replayBtn}
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
      
      // Use nickname if available (privacy first), fall back to name
      const opponentDisplay = game.opponentNickname || game.opponentName || 'Unknown';
      
      return `
        <div class="current-game-item ${turnClass}" data-game-id="${game.id}" data-opponent-id="${game.opponentId}">
          <div class="game-status">
            <span class="game-turn-status">${turnText}</span>
            ${rankedBadge}
          </div>
          <div class="game-opponent">
            <strong class="clickable">${opponentDisplay}</strong>
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

    // Attach opponent click listeners for current games
    this.attachOpponentClickListeners('.current-game-item');
  }

  attachOpponentClickListeners(selector) {
    const items = document.querySelectorAll(selector);
    items.forEach(item => {
      const opponentLink = item.querySelector('.clickable');
      if (opponentLink) {
        if (opponentLink.dataset.profileBound === '1') return;
        const opponentId = item.dataset.opponentId;
        opponentLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (opponentId) {
            this.playerProfile.show(opponentId, 'lobby');
          }
        });
        opponentLink.dataset.profileBound = '1';
      }
    });

    // Attach to match history items
    const matchItems = document.querySelectorAll('.match-item');
    matchItems.forEach(item => {
      const opponentLink = item.querySelector('.match-opponent');
      if (opponentLink) {
        if (opponentLink.dataset.profileBound === '1') return;
        const opponentId = item.dataset.opponentId;
        opponentLink.style.cursor = 'pointer';
        opponentLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (opponentId) {
            this.playerProfile.show(opponentId, 'lobby');
          }
        });
        opponentLink.dataset.profileBound = '1';
      }
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

    // Attach opponent click listeners (recent matches)
    this.attachOpponentClickListeners('.match-item');

    // Attach replay button listeners
    document.querySelectorAll('.btn-replay-match').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const gameId = e.target.dataset.gameId;
        this.replay.show(gameId, 1000);
      });
    });

    // Admin detail views
    document.querySelectorAll('.admin-stat-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const viewType = e.currentTarget.dataset.adminView;
        const panel = document.getElementById('admin-detail-panel');
        if (!panel) return;
        panel.innerHTML = this.renderAdminList(viewType);

        panel.querySelectorAll('.btn-admin-watch').forEach((watchBtn) => {
          watchBtn.addEventListener('click', (watchEvent) => {
            const gameId = watchEvent.currentTarget.dataset.adminGameId;
            this.watchActiveGame(gameId);
          });
        });
      });
    });

    // Admin player search
    const searchInput = document.getElementById('admin-player-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
          document.getElementById('admin-search-results').classList.add('hidden');
          return;
        }

        searchTimeout = setTimeout(() => {
          this.searchAdminPlayers(query);
        }, 300);
      });
    }
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
      
      .profile-section, .queue-section, .match-history-section, .current-games-section, .admin-section {
        background: rgba(0, 0, 0, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        padding: 20px;
        display: flex;
        flex-direction: column;
      }

      .admin-stats-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 12px;
      }

      .admin-stat-btn {
        background: rgba(22, 61, 90, 0.45);
        border: 1px solid rgba(133, 194, 255, 0.5);
        color: #ffffff;
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
      }

      .admin-stat-btn:hover {
        background: rgba(29, 90, 133, 0.6);
      }

      .admin-stat-value {
        font-size: 1.4em;
        font-weight: 700;
      }

      .admin-stat-label {
        font-size: 0.85em;
        opacity: 0.9;
      }

      .admin-detail-panel {
        max-height: 260px;
        overflow-y: auto;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .admin-detail-hint, .admin-empty {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.92em;
      }

      .admin-item {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        padding: 10px;
      }

      .admin-meta {
        font-size: 0.82em;
        color: rgba(255, 255, 255, 0.74);
      }

      .admin-game-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .btn-admin-watch {
        width: fit-content;
        padding: 6px 12px;
      }
      
      .current-games-section {
        max-height: 600px; /* Constrain the entire section */
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
        height: 350px; /* Fixed height instead of max-height */
        overflow-y: auto; /* auto instead of scroll */
        overflow-x: hidden;
        padding-right: 10px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        scrollbar-width: auto;
        scrollbar-color: rgba(255, 255, 255, 0.4) rgba(0, 0, 0, 0.2);
      }
      
      .match-history-list::-webkit-scrollbar {
        width: 12px;
      }
      
      .match-history-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 6px;
      }
      
      .match-history-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.4);
        border-radius: 6px;
        border: 2px solid rgba(0, 0, 0, 0.3);
      }
      
      .match-history-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.6);
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
        height: 400px; /* Fixed height instead of max-height */
        overflow-y: auto; /* auto instead of scroll */
        overflow-x: hidden;
        padding-right: 10px;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        scrollbar-width: auto;
        scrollbar-color: rgba(255, 255, 255, 0.4) rgba(0, 0, 0, 0.2);
      }
      
      .current-games-list::-webkit-scrollbar {
        width: 12px;
      }
      
      .current-games-list::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 6px;
      }
      
      .current-games-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.4);
        border-radius: 6px;
        border: 2px solid rgba(0, 0, 0, 0.3);
      }
      
      .current-games-list::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.6);
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
      
      #lobby-container .btn,
      .lobby-container .btn {
        padding: 12px 24px !important;
        border: none !important;
        border-radius: 5px !important;
        font-size: 1em !important;
        cursor: pointer !important;
        transition: all 0.2s !important;
      }
      
      #lobby-container .btn-primary,
      .lobby-container .btn-primary {
        background: #2196F3 !important;
        color: white !important;
      }
      
      #lobby-container .btn-primary:hover,
      .lobby-container .btn-primary:hover {
        background: #1976D2 !important;
      }
      
      #lobby-container .btn-secondary,
      .lobby-container .btn-secondary {
        background: rgba(255, 255, 255, 0.2) !important;
        color: white !important;
      }
      
      #lobby-container .btn-secondary:hover,
      .lobby-container .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.3) !important;
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

      .btn-replay-match {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.8);
        border-radius: 4px;
        padding: 3px 10px;
        font-size: 0.8em;
        cursor: pointer;
        margin-top: 4px;
        display: block;
        transition: background 0.15s;
      }
      .btn-replay-match:hover {
        background: rgba(255, 255, 255, 0.18);
        color: white;
      }

      /* Admin Search Styles */
      .admin-search-box {
        position: relative;
        margin-bottom: 15px;
      }

      .admin-search-input {
        width: 100%;
        padding: 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(133, 194, 255, 0.5);
        border-radius: 6px;
        color: white;
        font-size: 1em;
      }

      .admin-search-input::placeholder {
        color: rgba(255, 255, 255, 0.5);
      }

      .admin-search-input:focus {
        outline: none;
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(133, 194, 255, 0.8);
        box-shadow: 0 0 10px rgba(133, 194, 255, 0.3);
      }

      .admin-search-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.9);
        border: 1px solid rgba(133, 194, 255, 0.5);
        border-top: none;
        border-radius: 0 0 6px 6px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
        margin-top: -1px;
      }

      .admin-search-results.hidden {
        display: none;
      }

      .admin-search-empty {
        padding: 15px;
        text-align: center;
        color: rgba(255, 255, 255, 0.6);
      }

      .admin-search-result-item {
        padding: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        cursor: pointer;
        transition: background 0.2s;
      }

      .admin-search-result-item:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .admin-search-result-item:last-child {
        border-bottom: none;
      }

      .admin-search-result-name {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .admin-search-result-name strong {
        flex: 1;
      }

      .status-badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.75em;
        font-weight: bold;
      }

      .status-online {
        background: #4CAF50;
        color: white;
      }

      .status-offline {
        background: #999;
        color: white;
      }

      .status-admin {
        background: #FF9800;
        color: white;
      }

      .admin-search-result-meta {
        font-size: 0.85em;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 8px;
      }

      .btn-view-player-games {
        width: 100%;
        padding: 6px 12px;
        font-size: 0.9em;
      }

      /* Admin Player Games Styles */
      .admin-player-stats {
        background: rgba(255, 255, 255, 0.08);
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 15px;
      }

      .admin-player-stats h4 {
        margin: 0 0 10px 0;
        color: rgba(133, 194, 255, 1);
      }

      .admin-player-stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        font-size: 0.9em;
      }

      .admin-player-games-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .admin-player-game-item {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        padding: 12px;
      }

      .game-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        gap: 10px;
      }

      .game-status {
        display: inline-block;
        padding: 4px 8px;
        background: rgba(133, 194, 255, 0.3);
        border-radius: 3px;
        font-size: 0.8em;
        font-weight: bold;
      }

      .game-opponent {
        flex: 1;
        font-weight: bold;
      }

      .game-info {
        display: flex;
        gap: 15px;
        font-size: 0.85em;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .btn-admin-observe {
        width: 100%;
        padding: 8px;
        font-size: 0.9em;
      }
    `;
    
    document.head.appendChild(style);
  }
}