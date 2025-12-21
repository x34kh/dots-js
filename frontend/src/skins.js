/**
 * Skins System
 * Manages visual themes for dots and captured territories
 */

import * as THREE from 'three';

/**
 * Skin definitions
 * Each skin defines colors and patterns for players
 */
export const SKINS = {
  // Default plain colors skin
  default: {
    id: 'default',
    name: 'Classic Neon',
    description: 'Default neon colors',
    price: 0, // Free
    player1: {
      dotColor: 0x00ffff,      // Cyan
      captureColor: 0x00ffff,
      pattern: null            // No pattern, solid fill
    },
    player2: {
      dotColor: 0xff00ff,      // Magenta
      captureColor: 0xff00ff,
      pattern: null
    }
  },
  
  // Bricks skin
  bricks: {
    id: 'bricks',
    name: 'Bricks',
    description: 'Brick-like pattern for captured territory',
    price: 100, // Example price
    player1: {
      dotColor: 0xff6600,      // Orange
      captureColor: 0xff6600,
      pattern: 'bricks'
    },
    player2: {
      dotColor: 0x3366ff,      // Blue
      captureColor: 0x3366ff,
      pattern: 'bricks'
    }
  }
};

/**
 * Pattern generators for captured territory fills
 */
export class PatternGenerator {
  
  /**
   * Create a brick pattern texture
   */
  static createBrickPattern(color, width = 128, height = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Background color (slightly darker)
    const baseColor = new THREE.Color(color);
    const darkerColor = baseColor.clone().multiplyScalar(0.7);
    const lighterColor = baseColor.clone().multiplyScalar(1.2);
    
    // Fill background
    ctx.fillStyle = `#${baseColor.getHexString()}`;
    ctx.fillRect(0, 0, width, height);
    
    // Brick dimensions
    const brickWidth = 32;
    const brickHeight = 16;
    const mortarWidth = 2;
    
    // Mortar color (darker)
    ctx.strokeStyle = `#${darkerColor.getHexString()}`;
    ctx.lineWidth = mortarWidth;
    
    // Draw horizontal lines
    for (let y = 0; y <= height; y += brickHeight) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Draw vertical lines (offset every other row)
    for (let row = 0; row <= height / brickHeight; row++) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let x = offset; x <= width; x += brickWidth) {
        const y = row * brickHeight;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + brickHeight);
        ctx.stroke();
      }
    }
    
    // Add subtle shading to bricks
    ctx.fillStyle = `rgba(255, 255, 255, 0.1)`;
    for (let row = 0; row < height / brickHeight; row++) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let x = offset; x < width; x += brickWidth) {
        const y = row * brickHeight;
        // Top edge highlight
        ctx.fillRect(x + mortarWidth, y + mortarWidth, brickWidth - mortarWidth * 2, 2);
      }
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    
    return texture;
  }
  
  /**
   * Get pattern texture for a skin
   */
  static getPatternTexture(patternName, color) {
    switch (patternName) {
      case 'bricks':
        return this.createBrickPattern(color);
      default:
        return null;
    }
  }
}

/**
 * Skin Manager
 * Handles skin selection, persistence, and ownership
 */
export class SkinManager {
  constructor() {
    this.currentSkin = 'default'; // Local player's skin
    this.ownedSkins = ['default']; // Default skin is always owned
    this.patternTextures = new Map();
    this.playerSkins = { 1: 'default', 2: 'default' }; // Per-player skins
    
    this.loadFromStorage();
  }
  
  /**
   * Load skin preferences from localStorage
   */
  loadFromStorage() {
    try {
      const saved = localStorage.getItem('dots_skin');
      if (saved) {
        const data = JSON.parse(saved);
        this.currentSkin = data.currentSkin || 'default';
        this.ownedSkins = data.ownedSkins || ['default'];
      }
    } catch (error) {
      console.warn('Failed to load skin preferences:', error);
    }
  }
  
  /**
   * Save skin preferences to localStorage
   */
  saveToStorage() {
    try {
      localStorage.setItem('dots_skin', JSON.stringify({
        currentSkin: this.currentSkin,
        ownedSkins: this.ownedSkins
      }));
    } catch (error) {
      console.warn('Failed to save skin preferences:', error);
    }
  }
  
  /**
   * Get the current skin definition
   */
  getCurrentSkin() {
    return SKINS[this.currentSkin] || SKINS.default;
  }
  
  /**
   * Get skin by ID
   */
  getSkin(skinId) {
    return SKINS[skinId] || null;
  }
  
  /**
   * Get all available skins
   */
  getAllSkins() {
    return Object.values(SKINS);
  }
  
  /**
   * Check if a skin is owned
   */
  isSkinOwned(skinId) {
    return this.ownedSkins.includes(skinId);
  }
  
  /**
   * Purchase a skin (for future account integration)
   */
  purchaseSkin(skinId) {
    if (!SKINS[skinId]) {
      return { success: false, error: 'Skin not found' };
    }
    if (this.isSkinOwned(skinId)) {
      return { success: false, error: 'Skin already owned' };
    }
    
    // In a real implementation, this would involve a server call
    this.ownedSkins.push(skinId);
    this.saveToStorage();
    
    return { success: true };
  }
  
  /**
   * Select a skin (must be owned)
   */
  selectSkin(skinId) {
    if (!SKINS[skinId]) {
      return { success: false, error: 'Skin not found' };
    }
    if (!this.isSkinOwned(skinId)) {
      return { success: false, error: 'Skin not owned' };
    }
    
    this.currentSkin = skinId;
    this.saveToStorage();
    
    return { success: true };
  }
  
  /**
   * Get player colors for the current skin
   */
  getPlayerColors() {
    const skin1 = this.getSkin(this.playerSkins[1]) || SKINS.default;
    const skin2 = this.getSkin(this.playerSkins[2]) || SKINS.default;
    return {
      1: new THREE.Color(skin1.player1.dotColor),
      2: new THREE.Color(skin2.player2.dotColor)
    };
  }
  
  /**
   * Get capture colors for the current skin
   */
  getCaptureColors() {
    const skin1 = this.getSkin(this.playerSkins[1]) || SKINS.default;
    const skin2 = this.getSkin(this.playerSkins[2]) || SKINS.default;
    return {
      1: new THREE.Color(skin1.player1.captureColor),
      2: new THREE.Color(skin2.player2.captureColor)
    };
  }
  
  /**
   * Get or create pattern texture for a player
   */
  getPatternTexture(playerNum) {
    const skinId = this.playerSkins[playerNum] || 'default';
    const skin = this.getSkin(skinId) || SKINS.default;
    const playerConfig = playerNum === 1 ? skin.player1 : skin.player2;
    
    if (!playerConfig.pattern) {
      return null;
    }
    
    const cacheKey = `${skinId}_${playerNum}`;
    
    if (!this.patternTextures.has(cacheKey)) {
      const texture = PatternGenerator.getPatternTexture(
        playerConfig.pattern,
        playerConfig.captureColor
      );
      if (texture) {
        this.patternTextures.set(cacheKey, texture);
      }
    }
    
    return this.patternTextures.get(cacheKey) || null;
  }
  
  /**
   * Set skin for a specific player
   */
  setPlayerSkin(playerNum, skinId) {
    if (SKINS[skinId]) {
      this.playerSkins[playerNum] = skinId;
    }
  }
  
  /**
   * Get skin for a specific player
   */
  getPlayerSkin(playerNum) {
    return this.playerSkins[playerNum] || 'default';
  }
  
  /**
   * Get skin info for a player (for scoreboard display)
   */
  getPlayerSkinInfo(playerNum) {
    const skinId = this.playerSkins[playerNum] || 'default';
    const skin = this.getSkin(skinId) || SKINS.default;
    const playerConfig = playerNum === 1 ? skin.player1 : skin.player2;
    return {
      skinId,
      skinName: skin.name,
      color: playerConfig.dotColor
    };
  }
  
  /**
   * Clear cached textures (call when switching skins)
   */
  clearTextureCache() {
    for (const texture of this.patternTextures.values()) {
      texture.dispose();
    }
    this.patternTextures.clear();
  }
}

// Export a singleton instance
export const skinManager = new SkinManager();
