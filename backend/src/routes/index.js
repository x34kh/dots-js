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

export function createRouter(authService, gameManager, eloService, asyncGameManager) {
  const router = Router();

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
    
    // Count connected players would need WebSocket tracking
    // For now, estimate from queue + active games
    const playersInQueue = queueStats.rankedQueue + queueStats.unrankedQueue;
    const playersPlaying = queueStats.activeGames * 2; // 2 players per game
    
    res.json({
      playersOnline: playersInQueue + playersPlaying,
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
