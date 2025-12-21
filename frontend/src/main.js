/**
 * Dots & Boxes - Neon Edition
 * Main entry point
 */

import { GameController } from './gameController.js';

// Configuration - can be overridden by window.GAME_CONFIG from config.js
const config = {
  gridSize: 10, // Default grid size (can be changed via UI)
  googleClientId: window.GAME_CONFIG?.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || null,
  serverUrl: window.GAME_CONFIG?.serverUrl || import.meta.env.VITE_SERVER_URL || null
};

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.game = new GameController(config);
  
  // Log configuration status (helpful for debugging)
  if (config.googleClientId) {
    console.log('Google Authentication: Enabled');
  } else {
    console.log('Google Authentication: Disabled (no client ID configured)');
  }
});
