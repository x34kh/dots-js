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

export function createRouter(authService, gameManager, eloService) {
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
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      games: gameManager.games.size,
      queue: gameManager.matchmakingQueue.length
    });
  });

  return router;
}
