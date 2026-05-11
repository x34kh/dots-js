/**
 * Player Profile Screen
 * Displays player stats, recent matches, and last online timestamp
 * Accessible from Recent Matches and Current Games
 */

export class PlayerProfile {
  constructor(authState, serverUrl) {
    this.authState = authState;
    this.serverUrl = serverUrl;
    this.profileData = null;
    this.isVisible = false;
    this.previousScreen = null;
    this.containerId = 'player-profile-modal';
  }

  /**
   * Show player profile for a specific user
   */
  async show(userId, previousScreen = 'lobby') {
    this.previousScreen = previousScreen;
    
    try {
      // Fetch player profile from backend
      const apiUrl = this.getApiUrl();
      const response = await fetch(`${apiUrl}/api/profile/${userId}`);
      
      if (!response.ok) {
        console.error('Failed to fetch player profile:', response.status);
        return;
      }
      
      this.profileData = await response.json();
      this.isVisible = true;
      
      // Render the profile modal
      this.render();
      
      // Attach event listeners
      this.attachEventListeners();
    } catch (error) {
      console.error('Failed to load player profile:', error);
    }
  }

  /**
   * Hide the player profile modal
   */
  hide() {
    this.isVisible = false;
    const modal = document.getElementById(this.containerId);
    if (modal) {
      modal.remove();
    }
  }

  /**
   * Render the profile modal
   */
  render() {
    if (!this.profileData) return;

    const lastOnline = this.formatLastOnline(this.profileData.lastOnline);
    const winRate = this.profileData.winRate || 'N/A';
    const recentMatches = this.renderRecentMatches();

    const html = `
      <div id="${this.containerId}" class="player-profile-modal">
        <div class="profile-modal-overlay"></div>
        <div class="profile-modal-content">
          <div class="profile-header">
            <h2>${this.profileData.nickname || 'Player'}</h2>
            <button class="btn-close-profile" aria-label="Close">×</button>
          </div>

          <div class="profile-stats">
            <div class="stat-group">
              <div class="stat-item">
                <span class="stat-label">ELO Rating</span>
                <span class="stat-value">${this.profileData.rating || 1200}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Games Played</span>
                <span class="stat-value">${this.profileData.gamesPlayed || 0}</span>
              </div>
            </div>
            
            <div class="stat-group">
              <div class="stat-item">
                <span class="stat-label">Wins</span>
                <span class="stat-value">${this.profileData.wins || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Win Rate</span>
                <span class="stat-value">${winRate}</span>
              </div>
            </div>

            <div class="stat-group">
              <div class="stat-item">
                <span class="stat-label">Losses</span>
                <span class="stat-value">${this.profileData.losses || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Draws</span>
                <span class="stat-value">${this.profileData.draws || 0}</span>
              </div>
            </div>

            <div class="stat-group full-width">
              <div class="stat-item">
                <span class="stat-label">Last Online</span>
                <span class="stat-value">${lastOnline}</span>
              </div>
            </div>
          </div>

          <div class="profile-matches">
            <h3>Recent Matches</h3>
            <div class="matches-list">
              ${recentMatches}
            </div>
          </div>

          <div class="profile-actions">
            <button class="btn-primary btn-play-opponent" data-opponent-id="${this.profileData.userId}">
              Challenge Player
            </button>
            <button class="btn-secondary btn-close-profile">
              Back
            </button>
          </div>
        </div>
      </div>
    `;

    // Remove any existing profile modal
    const existing = document.getElementById(this.containerId);
    if (existing) {
      existing.remove();
    }

    // Append to body
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
  }

  /**
   * Render recent matches for the profile
   */
  renderRecentMatches() {
    if (!this.profileData.recentMatches || this.profileData.recentMatches.length === 0) {
      return '<p class="no-matches">No matches yet</p>';
    }

    return this.profileData.recentMatches.map(match => {
      const resultClass = match.result === 'win' ? 'match-win' : 
                         match.result === 'loss' ? 'match-loss' : 'match-draw';
      const date = new Date(match.completedAt).toLocaleDateString();
      const opponentDisplay = match.opponentNickname || match.opponentName || 'Unknown';

      return `
        <div class="match-entry ${resultClass}">
          <span class="match-result">${match.result.toUpperCase()}</span>
          <span class="match-opponent">${opponentDisplay}</span>
          <span class="match-score">${match.myScore}:${match.opponentScore}</span>
          <span class="match-date">${date}</span>
        </div>
      `;
    }).join('');
  }

  /**
   * Format last online timestamp
   */
  formatLastOnline(timestamp) {
    if (!timestamp) return 'Unknown';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
  }

  /**
   * Attach event listeners to the modal
   */
  attachEventListeners() {
    const modal = document.getElementById(this.containerId);
    if (!modal) return;

    // Close button
    const closeBtn = modal.querySelector('.btn-close-profile');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click to close
    const overlay = modal.querySelector('.profile-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => this.hide());
    }

    // Challenge button
    const challengeBtn = modal.querySelector('.btn-play-opponent');
    if (challengeBtn) {
      challengeBtn.addEventListener('click', () => {
        const opponentId = challengeBtn.dataset.opponentId;
        this.hide();
        // TODO: Implement challenge/matchmaking logic
        console.log('Challenge player:', opponentId);
      });
    }
  }

  /**
   * Get API URL
   */
  getApiUrl() {
    // Use serverUrl if provided
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
    // Fallback to location-based URL
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    return `https://${hostname}`;
  }
}
