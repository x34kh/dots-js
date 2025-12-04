/**
 * API Routes
 */

import { Router } from 'express';

export function createRouter(authService, gameManager, eloService) {
  const router = Router();

  // Authentication routes
  router.post('/auth/verify', async (req, res) => {
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
  router.post('/auth/anonymous', (req, res) => {
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
  router.post('/auth/anonymous/verify', (req, res) => {
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
