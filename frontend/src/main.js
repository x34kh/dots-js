/**
 * Dots & Boxes - Neon Edition
 * Main entry point
 */

import { GameController } from './gameController.js';

// Configuration
const config = {
  gridSize: 10, // Default grid size (can be changed via UI)
  googleClientId: null, // Set your Google Client ID here
  serverUrl: null // Set your WebSocket server URL here
};

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.game = new GameController(config);
});
