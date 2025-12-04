/**
 * Authentication Service
 * Handles Google OAuth token verification and anonymous user authentication
 */

import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

export class AuthService {
  constructor(clientId) {
    this.clientId = clientId;
    this.client = clientId ? new OAuth2Client(clientId) : null;
    this.users = new Map(); // userId -> user data
    // Secret key for signing anonymous tokens - should be from environment in production
    this.anonymousSecret = process.env.ANONYMOUS_SECRET || 'dots-js-anonymous-secret-key-2024';
  }

  /**
   * Verify Google ID token
   */
  async verifyToken(token) {
    if (!this.client) {
      // No client ID configured - allow for development
      return this.createDevUser(token);
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience: this.clientId
      });
      
      const payload = ticket.getPayload();
      
      const user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        verified: payload.email_verified
      };

      // Store/update user
      this.users.set(user.id, user);

      return { success: true, user };
    } catch (error) {
      console.error('Token verification failed:', error);
      return { success: false, error: 'Invalid token' };
    }
  }

  /**
   * Create a development user for testing
   */
  createDevUser(token) {
    // Parse token if it's a JWT
    try {
      const base64 = token.split('.')[1];
      if (base64) {
        const payload = JSON.parse(atob(base64));
        const user = {
          id: payload.sub || `dev-${Date.now()}`,
          email: payload.email || 'dev@example.com',
          name: payload.name || 'Developer',
          picture: payload.picture || null,
          verified: true,
          isDev: true
        };
        this.users.set(user.id, user);
        return { success: true, user };
      }
    } catch {
      // Not a valid JWT - create placeholder user
    }

    // Create placeholder user
    const user = {
      id: `dev-${Date.now()}`,
      email: 'dev@example.com',
      name: 'Developer',
      picture: null,
      verified: true,
      isDev: true
    };
    this.users.set(user.id, user);
    return { success: true, user };
  }

  /**
   * Get user by ID
   */
  getUser(userId) {
    return this.users.get(userId);
  }

  /**
   * Update user profile
   */
  updateUser(userId, updates) {
    const user = this.users.get(userId);
    if (user) {
      Object.assign(user, updates);
      return { success: true, user };
    }
    return { success: false, error: 'User not found' };
  }

  /**
   * Generate a secure signature for anonymous user tokens
   * Uses HMAC-SHA256 to create tamper-proof tokens
   */
  generateAnonymousSignature(anonymousId, username) {
    const data = `${anonymousId}:${username}`;
    return crypto
      .createHmac('sha256', this.anonymousSecret)
      .update(data)
      .digest('hex');
  }

  /**
   * Verify anonymous user token signature
   */
  verifyAnonymousToken(anonymousId, username, signature) {
    const expectedSignature = this.generateAnonymousSignature(anonymousId, username);
    // Use timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Create anonymous user credentials
   * Returns an object with id, username, and signature that can be stored in cookies
   */
  createAnonymousUser() {
    const anonymousId = `anon-${crypto.randomBytes(16).toString('hex')}`;
    const username = this.generateRandomUsername();
    const signature = this.generateAnonymousSignature(anonymousId, username);

    const user = {
      id: anonymousId,
      name: username,
      email: null,
      picture: null,
      isAnonymous: true
    };

    this.users.set(anonymousId, user);

    return {
      anonymousId,
      username,
      signature,
      user
    };
  }

  /**
   * Generate a fun random username
   */
  generateRandomUsername() {
    const adjectives = [
      'Swift', 'Clever', 'Mighty', 'Brave', 'Lucky', 'Cosmic', 'Neon',
      'Electric', 'Crystal', 'Shadow', 'Golden', 'Silver', 'Blazing',
      'Frozen', 'Thunder', 'Storm', 'Phantom', 'Mystic', 'Cyber', 'Pixel'
    ];
    const nouns = [
      'Fox', 'Wolf', 'Eagle', 'Tiger', 'Dragon', 'Phoenix', 'Falcon',
      'Panther', 'Hawk', 'Lion', 'Bear', 'Shark', 'Viper', 'Cobra',
      'Raven', 'Knight', 'Warrior', 'Ninja', 'Wizard', 'Ranger'
    ];
    const numbers = Math.floor(Math.random() * 1000);

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adjective}${noun}${numbers}`;
  }

  /**
   * Get the secret for client-side signature generation
   * In production, this should be a separate client secret
   */
  getAnonymousSecret() {
    return this.anonymousSecret;
  }
}
