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

import { GameManager } from './game/gameManager.js';
import { AuthService } from './auth/authService.js';
import { EloService } from './elo/eloService.js';
import { AsyncGameManager } from './game/asyncGameManager.js';
import { WebSocketHandler } from './websocket/wsHandler.js';
import { createRouter } from './routes/index.js';

// Load environment variables
config();

const PORT = process.env.PORT || 8080;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const REDIS_URL = process.env.REDIS_URL;

async function createRedisClient() {
  if (!REDIS_URL) {
    console.warn('REDIS_URL is not configured, running with in-memory persistence only');
    return null;
  }

  try {
    const client = createClient({ url: REDIS_URL });
    client.on('error', (err) => {
      console.error('Redis client error:', err.message || err);
    });
    await client.connect();
    console.log(`Connected to Redis at ${REDIS_URL}`);
    return client;
  } catch (error) {
    console.error('Failed to connect to Redis, continuing without persistence:', error.message || error);
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
  const wsHandler = new WebSocketHandler(wss, authService, gameManager, asyncGameManager);

  // Setup REST routes
  app.use('/api', createRouter(authService, gameManager, eloService, asyncGameManager, wsHandler));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Start server
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  });

  const shutdown = async () => {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (error) {
        console.error('Error closing Redis client:', error.message || error);
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, wss };
}

const runtime = await bootstrap();

export const { app, server, wss } = runtime;
