/**
 * P2P Offer/Answer Storage
 * Stores WebRTC connection data for peer-to-peer games
 */

class P2PStore {
  constructor() {
    // In-memory storage (use Redis in production)
    this.offers = new Map();
    
    // Clean up old offers after 1 hour
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [gameId, data] of this.offers.entries()) {
        if (now - data.timestamp > 3600000) { // 1 hour
          this.offers.delete(gameId);
        }
      }
    }, 300000); // Run every 5 minutes
  }

  /**
   * Generate a short game ID
   */
  generateGameId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // Ensure uniqueness
    if (this.offers.has(id)) {
      return this.generateGameId();
    }
    
    return id;
  }

  /**
   * Store an offer
   */
  storeOffer(gameId, offer) {
    this.offers.set(gameId, {
      offer,
      timestamp: Date.now()
    });
  }

  /**
   * Retrieve an offer
   */
  getOffer(gameId) {
    const data = this.offers.get(gameId);
    return data ? data.offer : null;
  }

  /**
   * Store an answer
   */
  storeAnswer(gameId, answer) {
    const data = this.offers.get(gameId);
    if (data) {
      data.answer = answer;
    }
  }

  /**
   * Retrieve an answer
   */
  getAnswer(gameId) {
    const data = this.offers.get(gameId);
    return data && data.answer ? data.answer : null;
  }

  /**
   * Delete game data
   */
  delete(gameId) {
    this.offers.delete(gameId);
  }

  cleanup() {
    clearInterval(this.cleanupInterval);
  }
}

module.exports = new P2PStore();
