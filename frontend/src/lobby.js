/**
 * Lobby UI
 * Displays player profile, ELO, match history, and queue controls
 */

export class LobbyUI {
  constructor(websocket, authState) {
    this.websocket = websocket;
    this.authState = authState;
    this.profileData = null;
    this.queueStats = null;
    this.inQueue = false;
    this.currentQueueType = null;
  }

  async show() {
    // Load profile data
    await this.loadProfile();
    
    // Render lobby UI
    this.render();
    
    // Listen for queue stats updates
    this.websocket.on('queue_stats', (data) => {
      this.queueStats = data;
      this.updateQueueStats();
    });
    
    // Request initial queue stats
    this.requestQueueStats();
  }

  async loadProfile() {
    const userId = this.authState.userId;
    const apiUrl = window.GAME_CONFIG?.backendUrl || 
                   import.meta.env.VITE_BACKEND_URL || 
                   'http://localhost:3001';
    
    try {
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

  requestQueueStats() {
    // Stats will be broadcasted by server, but we can also poll
    const apiUrl = window.GAME_CONFIG?.backendUrl || 
                   import.meta.env.VITE_BACKEND_URL || 
                   'http://localhost:3001';
    
    fetch(`${apiUrl}/api/stats/online`)
      .then(res => res.json())
      .then(data => {
        this.queueStats = data;
        this.updateQueueStats();
      })
      .catch(err => console.error('Failed to load queue stats:', err));
  }

  render() {
    const app = document.getElementById('app');
    
    app.innerHTML = `
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
                <div class="stat-value">${(this.profileData?.winRate || 0).toFixed(1)}%</div>
                <div class="stat-label">Win Rate</div>
              </div>
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
  }

  joinQueue(isRanked) {
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
    // Cleanup if needed
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
    `;
    
    document.head.appendChild(style);
  }
}
