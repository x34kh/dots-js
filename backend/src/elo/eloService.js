/**
 * ELO Rating Service
 * Calculates and updates player ratings
 */

export class EloService {
  constructor() {
    this.ratings = new Map(); // userId -> { rating, gamesPlayed, wins, losses, draws }
    this.matches = []; // Match history
    this.K_FACTOR = 32; // Default K-factor
    this.PROVISIONAL_GAMES = 10; // Games before rating stabilizes
    this.PROVISIONAL_K = 64; // Higher K for new players
  }

  /**
   * Get or create player rating
   */
  getRating(userId) {
    if (!this.ratings.has(userId)) {
      this.ratings.set(userId, {
        rating: 1500, // Default starting rating
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0
      });
    }
    return this.ratings.get(userId);
  }

  /**
   * Calculate expected score (probability of winning)
   */
  expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  /**
   * Get K-factor for a player
   */
  getKFactor(playerData) {
    if (playerData.gamesPlayed < this.PROVISIONAL_GAMES) {
      return this.PROVISIONAL_K;
    }
    return this.K_FACTOR;
  }

  /**
   * Calculate new rating
   */
  calculateNewRating(currentRating, expectedScore, actualScore, kFactor) {
    return Math.round(currentRating + kFactor * (actualScore - expectedScore));
  }

  /**
   * Update ratings after a match
   * result: 1 = player1 wins, 0 = player2 wins, 0.5 = draw
   */
  async updateRatings(player1Id, player2Id, result) {
    const player1 = this.getRating(player1Id);
    const player2 = this.getRating(player2Id);

    const expected1 = this.expectedScore(player1.rating, player2.rating);
    const expected2 = this.expectedScore(player2.rating, player1.rating);

    const k1 = this.getKFactor(player1);
    const k2 = this.getKFactor(player2);

    const oldRating1 = player1.rating;
    const oldRating2 = player2.rating;

    player1.rating = this.calculateNewRating(player1.rating, expected1, result, k1);
    player2.rating = this.calculateNewRating(player2.rating, expected2, 1 - result, k2);

    // Update stats
    player1.gamesPlayed++;
    player2.gamesPlayed++;

    if (result === 1) {
      player1.wins++;
      player2.losses++;
    } else if (result === 0) {
      player1.losses++;
      player2.wins++;
    } else {
      player1.draws++;
      player2.draws++;
    }

    return {
      player1: {
        oldRating: oldRating1,
        newRating: player1.rating,
        change: player1.rating - oldRating1
      },
      player2: {
        oldRating: oldRating2,
        newRating: player2.rating,
        change: player2.rating - oldRating2
      }
    };
  }

  /**
   * Record match in history
   */
  async recordMatch(matchData) {
    const match = {
      id: this.matches.length + 1,
      ...matchData,
      recordedAt: new Date()
    };
    this.matches.push(match);
    return match;
  }

  /**
   * Get player statistics
   */
  getPlayerStats(userId) {
    const rating = this.getRating(userId);
    return {
      userId,
      ...rating,
      winRate: rating.gamesPlayed > 0 
        ? (rating.wins / rating.gamesPlayed * 100).toFixed(1) + '%' 
        : 'N/A'
    };
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(limit = 10) {
    const players = Array.from(this.ratings.entries())
      .map(([userId, data]) => ({
        userId,
        ...data
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);

    return players;
  }

  /**
   * Get match history for a player
   */
  getMatchHistory(userId, limit = 20) {
    return this.matches
      .filter(m => m.player1Id === userId || m.player2Id === userId)
      .slice(-limit)
      .reverse();
  }
}
