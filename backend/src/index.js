/**
 * Backend Server Entry Point
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';

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

// Initialize services
const authService = new AuthService(GOOGLE_CLIENT_ID);
const eloService = new EloService();
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
app.use('/api', createRouter(authService, gameManager, eloService, asyncGameManager));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

export { app, server, wss };
