/**
 * API Routes
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import p2pStore from '../p2p/p2pStore.js';

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limiter for anonymous user creation
const anonCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 anonymous user creations per hour
  message: { error: 'Too many anonymous accounts created, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

export function createRouter(authService, gameManager, eloService, asyncGameManager, wsHandler) {
  const router = Router();

  function getRequestUserId(req) {
    return req.query.userId || req.body?.userId || req.headers['x-user-id'];
  }

  function requireAdmin(req, res) {
    const userId = getRequestUserId(req);
    if (!userId) {
      req.logger?.warn({ action: 'admin_access_denied', reason: 'missing_user_id' }, 'Admin access denied');
      res.status(401).json({ error: 'userId is required' });
      return null;
    }

    const user = authService.getUser(String(userId));
    if (!authService.isAdmin(user)) {
      req.logger?.warn({ action: 'admin_access_denied', reason: 'not_admin', userId: String(userId), email: user?.email || null }, 'Admin access denied');
      res.status(403).json({ error: 'Admin access required' });
      return null;
    }

    req.logger?.info({ action: 'admin_access_granted', userId: String(userId), email: user?.email || null }, 'Admin access granted');

    return user;
  }

  // Authentication routes
  router.post('/auth/verify', authLimiter, async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const result = await authService.verifyToken(token);
    
    if (result.success) {
      res.json({ user: result.user });
    } else {
      res.status(401).json({ error: result.error });
    }
  });

  // Anonymous user creation
  router.post('/auth/anonymous', anonCreateLimiter, (req, res) => {
    const credentials = authService.createAnonymousUser();
    
    // Set secure HTTP-only cookie with the credentials
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    res.cookie('anon_id', credentials.anonymousId, cookieOptions);
    res.cookie('anon_name', credentials.username, cookieOptions);
    res.cookie('anon_sig', credentials.signature, cookieOptions);

    res.json({
      anonymousId: credentials.anonymousId,
      username: credentials.username,
      signature: credentials.signature
    });
  });

  // Verify anonymous credentials
  router.post('/auth/anonymous/verify', authLimiter, (req, res) => {
    const { anonymousId, username, signature } = req.body;

    if (!anonymousId || !username || !signature) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const isValid = authService.verifyAnonymousToken(anonymousId, username, signature);

    if (isValid) {
      res.json({ 
        valid: true,
        user: {
          id: anonymousId,
          name: username,
          isAnonymous: true
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid anonymous credentials' });
    }
  });

  // Game routes
  router.get('/games/:gameId', (req, res) => {
    const game = gameManager.getGameInfo(req.params.gameId);
    
    if (game) {
      res.json(game);
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  });

  // ELO/Stats routes
  router.get('/stats/:userId', (req, res) => {
    const stats = eloService.getPlayerStats(req.params.userId);
    res.json(stats);
  });

  // Profile endpoint - combined stats and recent matches
  router.get('/profile/:userId', (req, res) => {
    const stats = eloService.getPlayerStats(req.params.userId);
    const matches = eloService.getMatchHistory(req.params.userId, 10);
    const user = authService.getUser(req.params.userId);
    
    // If user doesn't exist or doesn't have a nickname, generate one
    let nickname = user?.nickname;
    if (!nickname) {
      nickname = authService.generateUniqueNickname();
      // Store it if user exists
      if (user) {
        user.nickname = nickname;
      }
    }
    
    res.json({
      ...stats,
      nickname: nickname,
      lastOnline: user?.lastOnline || null,
      recentMatches: matches
    });
  });

  // Update nickname endpoint
  router.post('/profile/:userId/nickname', authLimiter, (req, res) => {
    const { nickname } = req.body;
    const userId = req.params.userId;
    
    if (!nickname) {
      return res.status(400).json({ error: 'Nickname required' });
    }
    
    const result = authService.updateNickname(userId, nickname);
    
    if (result.success) {
      res.json({ nickname: result.user.nickname });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  // Online stats - player counts
  router.get('/stats/online', (req, res) => {
    const queueStats = gameManager.getQueueStats();
    const playersInQueue = queueStats.rankedQueue + queueStats.unrankedQueue;
    const playersPlaying = queueStats.activeGames * 2; // 2 players per game
    const playersOnline = wsHandler ? wsHandler.clients.size : playersInQueue + playersPlaying;
    
    res.json({
      playersOnline,
      playersInQueue,
      playersPlaying,
      rankedQueue: queueStats.rankedQueue,
      unrankedQueue: queueStats.unrankedQueue,
      activeGames: queueStats.activeGames
    });
  });

  router.get('/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = eloService.getLeaderboard(limit);
    res.json(leaderboard);
  });

  router.get('/matches/:userId', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const matches = eloService.getMatchHistory(req.params.userId, limit);
    res.json(matches);
  });

  // Replay endpoint - returns moves for a completed game
  router.get('/replay/:gameId', (req, res) => {
    const match = eloService.matches.find(m => String(m.gameId) === String(req.params.gameId));
    if (!match) return res.status(404).json({ error: 'Replay not found' });
    res.json({
      gameId: match.gameId,
      gridSize: match.gridSize || 10,
      player1Id: match.player1Id,
      player1Name: match.player1Name,
      player2Id: match.player2Id,
      player2Name: match.player2Name,
      player1Score: match.player1Score,
      player2Score: match.player2Score,
      winnerId: match.winnerId,
      moves: match.moves || []
    });
  });

  // Admin lobby overview
  router.get('/admin/lobby', (req, res) => {
    const adminUser = requireAdmin(req, res);
    if (!adminUser) return;

    const onlinePlayers = [];
    if (wsHandler?.clients) {
      for (const client of wsHandler.clients.values()) {
        if (!client?.user) continue;
        onlinePlayers.push({
          userId: client.userId,
          name: client.user.name,
          nickname: client.user.nickname || null,
          email: client.user.email || null,
          isAnonymous: client.user.isAnonymous === true,
          isAdmin: client.user.isAdmin === true
        });
      }
    }

    const queueDetails = {
      ranked: gameManager.rankedQueue.map((entry) => ({
        userId: entry.playerId,
        name: entry.playerData?.name || 'Unknown',
        nickname: entry.playerData?.nickname || null,
        joinedAt: entry.joinedAt
      })),
      unranked: gameManager.unrankedQueue.map((entry) => ({
        userId: entry.playerId,
        name: entry.playerData?.name || 'Unknown',
        nickname: entry.playerData?.nickname || null,
        joinedAt: entry.joinedAt
      }))
    };

    const activeGames = Array.from(asyncGameManager.games.values())
      .filter((game) => game.status === 'active')
      .map((game) => ({
        id: game.id,
        player1Id: game.player1Id,
        player1Name: game.player1Nickname || game.player1Name || game.player1Id,
        player2Id: game.player2Id,
        player2Name: game.player2Nickname || game.player2Name || game.player2Id,
        currentPlayer: game.currentPlayer,
        scores: game.scores,
        moveCount: game.moves?.length || 0,
        isRanked: game.isRanked,
        createdAt: game.createdAt,
        lastMoveAt: game.lastMoveAt,
        turnDeadline: game.turnDeadline
      }))
      .sort((a, b) => (b.lastMoveAt || 0) - (a.lastMoveAt || 0));

    const finishedGames = [...eloService.matches]
      .slice(-200)
      .reverse()
      .map((match) => ({
        gameId: match.gameId,
        player1Name: match.player1Nickname || match.player1Name,
        player2Name: match.player2Nickname || match.player2Name,
        player1Score: match.player1Score,
        player2Score: match.player2Score,
        winnerId: match.winnerId,
        isRanked: match.isRanked,
        completedAt: match.completedAt
      }));

    res.json({
      admin: {
        userId: adminUser.id,
        email: adminUser.email,
        name: adminUser.name
      },
      counts: {
        onlinePlayers: onlinePlayers.length,
        rankedQueue: queueDetails.ranked.length,
        unrankedQueue: queueDetails.unranked.length,
        queuedPlayers: queueDetails.ranked.length + queueDetails.unranked.length,
        activeGames: activeGames.length,
        finishedGames: finishedGames.length
      },
      onlinePlayers,
      queueDetails,
      activeGames,
      finishedGames
    });
  });

  router.get('/admin/active-games/:gameId', (req, res) => {
    const adminUser = requireAdmin(req, res);
    if (!adminUser) return;

    const game = asyncGameManager.games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Active game not found' });
    }

    if (game.status !== 'active') {
      return res.status(400).json({ error: 'Game is not active' });
    }

    // Admin spectator view of actual game state (read-only on frontend).
    res.json({
      ...game,
      adminView: true
    });
  });

  // Admin: Search for players by name, nickname, or email
  router.get('/admin/search-players', (req, res) => {
    const adminUser = requireAdmin(req, res);
    if (!adminUser) return;

    const query = (req.query.q || '').toLowerCase().trim();
    if (query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const results = [];
    const maxResults = 20;

    // Search in online players
    if (wsHandler?.clients) {
      for (const client of wsHandler.clients.values()) {
        if (!client?.user) continue;
        
        const name = (client.user.name || '').toLowerCase();
        const nickname = (client.user.nickname || '').toLowerCase();
        const email = (client.user.email || '').toLowerCase();
        
        if (name.includes(query) || nickname.includes(query) || email.includes(query)) {
          results.push({
            userId: client.userId,
            name: client.user.name,
            nickname: client.user.nickname,
            email: client.user.email,
            isOnline: true,
            isAnonymous: client.user.isAnonymous === true,
            isAdmin: client.user.isAdmin === true
          });
          
          if (results.length >= maxResults) break;
        }
      }
    }

    // Also search in auth service (offline players)
    if (results.length < maxResults) {
      const allUsers = authService.getAllUsers?.() || [];
      for (const user of allUsers) {
        if (results.some(r => r.userId === user.id)) continue; // Skip already added
        
        const name = (user.name || '').toLowerCase();
        const nickname = (user.nickname || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        
        if (name.includes(query) || nickname.includes(query) || email.includes(query)) {
          results.push({
            userId: user.id,
            name: user.name,
            nickname: user.nickname,
            email: user.email,
            isOnline: false,
            isAnonymous: user.isAnonymous === true,
            isAdmin: user.isAdmin === true
          });
          
          if (results.length >= maxResults) break;
        }
      }
    }

    res.json({ results });
  });

  // Admin: Get all games for a specific player (active and pending async games)
  router.get('/admin/player-games/:userId', (req, res) => {
    const adminUser = requireAdmin(req, res);
    if (!adminUser) return;

    const userId = req.params.userId;
    
    // Get async games (turn-based)
    const asyncGames = asyncGameManager.getPlayerGames(userId).map(game => ({
      ...game,
      gameType: 'async',
      opponent1Id: game.opponentId,
      // Use opponentNickname if available (privacy first), fall back to opponentName
      opponent1Name: game.opponentNickname || game.opponentName,
      opponent2Id: undefined,
      opponent2Name: undefined,
      myScore: game.myScore,
      opponentScore: game.opponentScore,
      isMyTurn: game.isMyTurn
    }));

    // Get real-time games (if we had an active games manager, it would go here)
    // For now, we only have async games

    const allGames = [
      ...asyncGames
    ].sort((a, b) => (b.lastMoveAt || 0) - (a.lastMoveAt || 0));

    res.json({
      userId,
      games: allGames,
      totalGames: allGames.length,
      activeGames: allGames.filter(g => g.status === 'active').length,
      completedGames: allGames.filter(g => g.status === 'completed').length
    });
  });

  // Admin: Observe/spectate a player's game (supports both async and real-time)
  router.get('/admin/observe/:gameId', (req, res) => {
    const adminUser = requireAdmin(req, res);
    if (!adminUser) return;

    // Try to find in async games first
    const asyncGame = asyncGameManager.games.get(req.params.gameId);
    if (asyncGame) {
      return res.json({
        ...asyncGame,
        adminView: true,
        gameType: 'async'
      });
    }

    // Could extend to support real-time games here
    return res.status(404).json({ error: 'Game not found' });
  });

  // Async/Turn-based game routes
  router.post('/async/games', (req, res) => {
    const { player1Id, player2Id, gridSize, isRanked } = req.body;
    
    if (!player1Id || !player2Id) {
      return res.status(400).json({ error: 'Both player IDs required' });
    }

    try {
      const game = asyncGameManager.createGame(
        player1Id, 
        player2Id, 
        gridSize || 10, 
        isRanked || false
      );
      res.json(game);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/async/games/player/:userId', (req, res) => {
    const games = asyncGameManager.getPlayerGames(req.params.userId);
    res.json(games);
  });

  router.get('/async/games/:gameId', (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' });
    }

    try {
      const game = asyncGameManager.getGameState(req.params.gameId, userId);
      if (game) {
        console.log(`Fetching game state for ${req.params.gameId}:`, {
          moveCount: game.moves?.length || 0,
          currentPlayer: game.currentPlayer,
          player1Id: game.player1Id,
          player2Id: game.player2Id
        });
        res.json(game);
      } else {
        res.status(404).json({ error: 'Game not found' });
      }
    } catch (error) {
      console.error('Error fetching game state:', error);
      res.status(403).json({ error: error.message });
    }
  });

  router.post('/async/games/:gameId/move', (req, res) => {
    const { userId, x, y } = req.body;
    
    if (userId === undefined || x === undefined || y === undefined) {
      return res.status(400).json({ error: 'userId, x, and y required' });
    }

    try {
      const result = asyncGameManager.makeMove(req.params.gameId, userId, x, y);
      
      // Broadcast move to other player if both are online (in game room)
      if (wsHandler) {
        wsHandler.broadcastAsyncMove(req.params.gameId, userId, x, y, result.capturedDots);
      }
      
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/async/games/:gameId/info', (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' });
    }

    const info = asyncGameManager.getGameInfo(req.params.gameId, userId);
    if (info) {
      res.json(info);
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  });

  // P2P routes for WebRTC signaling
  router.post('/p2p/offer', (req, res) => {
    try {
      const { offer } = req.body;
      if (!offer) {
        return res.status(400).json({ error: 'Offer is required' });
      }
      
      const gameId = p2pStore.generateGameId();
      p2pStore.storeOffer(gameId, offer);
      
      res.json({ gameId });
    } catch (error) {
      console.error('Failed to store offer:', error);
      res.status(500).json({ error: 'Failed to store offer' });
    }
  });

  router.get('/p2p/offer/:gameId', (req, res) => {
    try {
      const { gameId } = req.params;
      const offer = p2pStore.getOffer(gameId);
      
      if (!offer) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      res.json({ offer });
    } catch (error) {
      console.error('Failed to retrieve offer:', error);
      res.status(500).json({ error: 'Failed to retrieve offer' });
    }
  });

  router.post('/p2p/answer/:gameId', (req, res) => {
    try {
      const { gameId } = req.params;
      const { answer } = req.body;
      
      if (!answer) {
        return res.status(400).json({ error: 'Answer is required' });
      }
      
      const offer = p2pStore.getOffer(gameId);
      if (!offer) {
        return res.status(404).json({ error: 'Game not found' });
      }
      
      p2pStore.storeAnswer(gameId, answer);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to store answer:', error);
      res.status(500).json({ error: 'Failed to store answer' });
    }
  });

  router.get('/p2p/answer/:gameId', (req, res) => {
    try {
      const { gameId } = req.params;
      const answer = p2pStore.getAnswer(gameId);
      
      if (!answer) {
        return res.status(404).json({ error: 'Answer not found yet' });
      }
      
      res.json({ answer });
    } catch (error) {
      console.error('Failed to retrieve answer:', error);
      res.status(500).json({ error: 'Failed to retrieve answer' });
    }
  });

  // Health check
  router.get('/health', (req, res) => {
    const queueStats = gameManager.getQueueStats();
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      games: queueStats.activeGames,
      rankedQueue: queueStats.rankedQueue,
      unrankedQueue: queueStats.unrankedQueue
    });
  });

  return router;
}
