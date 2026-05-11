/**
 * Backend Server Entry Point
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';

import { GameManager } from './game/gameManager.js';
import { AuthService } from './auth/authService.js';
import { EloService } from './elo/eloService.js';
import { AsyncGameManager } from './game/asyncGameManager.js';
import { WebSocketHandler } from './websocket/wsHandler.js';
import { createRouter } from './routes/index.js';
import { logger, getClientIp } from './logging/logger.js';

// Load environment variables
config();

const PORT = process.env.PORT || 8080;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const REDIS_URL = process.env.REDIS_URL;

async function createRedisClient() {
  if (!REDIS_URL) {
    logger.warn({ action: 'redis_unconfigured' }, 'REDIS_URL is not configured, running with in-memory persistence only');
    return null;
  }

  try {
    const client = createClient({ url: REDIS_URL });
    client.on('error', (err) => {
      logger.error({ action: 'redis_error', error: err.message || String(err) }, 'Redis client error');
    });
    await client.connect();
    logger.info({ action: 'redis_connected', redisUrl: REDIS_URL }, 'Connected to Redis');
    return client;
  } catch (error) {
    logger.error({ action: 'redis_connect_failed', error: error.message || String(error) }, 'Failed to connect to Redis, continuing without persistence');
    return null;
  }
}

async function bootstrap() {
  const redisClient = await createRedisClient();

  // Initialize services
  const authService = new AuthService(GOOGLE_CLIENT_ID, redisClient);
  const eloService = new EloService(redisClient);
  await Promise.all([authService.init(), eloService.init()]);
  const gameManager = new GameManager(eloService);
  const asyncGameManager = new AsyncGameManager(eloService);

  // Create Express app
  const app = express();
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.headers['x-request-id'] || randomUUID();
    const clientIp = getClientIp(req);

    req.requestId = String(requestId);
    res.setHeader('x-request-id', String(requestId));

    const requestLogger = logger.child({
      requestId: String(requestId),
      clientIp,
      method: req.method,
      path: req.originalUrl || req.url
    });

    req.logger = requestLogger;

    res.on('finish', () => {
      requestLogger.info({
        action: 'http_request',
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: req.headers['user-agent'] || null,
        userId: req.query?.userId || req.body?.userId || req.headers['x-user-id'] || null
      }, 'HTTP request completed');
    });

    next();
  });

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json());

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsHandler = new WebSocketHandler(wss, authService, gameManager, asyncGameManager, logger);

  // Setup REST routes
  app.use('/api', createRouter(authService, gameManager, eloService, asyncGameManager, wsHandler));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Start server
  server.listen(PORT, () => {
    logger.info({ action: 'server_started', port: PORT, wsPath: '/ws' }, 'Server started');
  });

  const shutdown = async () => {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (error) {
        logger.error({ action: 'redis_quit_failed', error: error.message || String(error) }, 'Error closing Redis client');
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, wss };
}

const runtime = await bootstrap();

export const { app, server, wss } = runtime;
