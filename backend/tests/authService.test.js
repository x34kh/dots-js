/**
 * Authentication Service Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AuthService } from '../src/auth/authService.js';

describe('AuthService', () => {
  let authService;

  beforeEach(() => {
    authService = new AuthService(null); // No Google client ID for testing
  });

  describe('Anonymous Authentication', () => {
    describe('createAnonymousUser', () => {
      it('should create anonymous user with all required fields', () => {
        const credentials = authService.createAnonymousUser();
        
        assert.ok(credentials.anonymousId);
        assert.ok(credentials.username);
        assert.ok(credentials.signature);
        assert.ok(credentials.user);
      });

      it('should generate unique IDs for each user', () => {
        const cred1 = authService.createAnonymousUser();
        const cred2 = authService.createAnonymousUser();
        
        assert.notStrictEqual(cred1.anonymousId, cred2.anonymousId);
      });

      it('should generate anonymous IDs with correct prefix', () => {
        const credentials = authService.createAnonymousUser();
        
        assert.ok(credentials.anonymousId.startsWith('anon-'));
      });

      it('should store user in users map', () => {
        const credentials = authService.createAnonymousUser();
        
        const user = authService.getUser(credentials.anonymousId);
        assert.ok(user);
        assert.strictEqual(user.name, credentials.username);
      });
    });

    describe('generateRandomUsername', () => {
      it('should generate a username', () => {
        const username = authService.generateRandomUsername();
        
        assert.ok(username);
        assert.ok(username.length > 0);
      });

      it('should generate different usernames', () => {
        const usernames = new Set();
        for (let i = 0; i < 10; i++) {
          usernames.add(authService.generateRandomUsername());
        }
        
        // Should have multiple unique usernames (very unlikely all are the same)
        assert.ok(usernames.size > 1);
      });
    });

    describe('generateAnonymousSignature', () => {
      it('should generate a hex signature', () => {
        const sig = authService.generateAnonymousSignature('anon-123', 'TestUser');
        
        assert.ok(sig);
        assert.ok(/^[a-f0-9]+$/i.test(sig));
      });

      it('should generate consistent signatures for same input', () => {
        const sig1 = authService.generateAnonymousSignature('anon-123', 'TestUser');
        const sig2 = authService.generateAnonymousSignature('anon-123', 'TestUser');
        
        assert.strictEqual(sig1, sig2);
      });

      it('should generate different signatures for different inputs', () => {
        const sig1 = authService.generateAnonymousSignature('anon-123', 'TestUser');
        const sig2 = authService.generateAnonymousSignature('anon-456', 'TestUser');
        
        assert.notStrictEqual(sig1, sig2);
      });
    });

    describe('verifyAnonymousToken', () => {
      it('should verify valid token', () => {
        const credentials = authService.createAnonymousUser();
        
        const isValid = authService.verifyAnonymousToken(
          credentials.anonymousId,
          credentials.username,
          credentials.signature
        );
        
        assert.strictEqual(isValid, true);
      });

      it('should reject invalid signature', () => {
        const credentials = authService.createAnonymousUser();
        
        const isValid = authService.verifyAnonymousToken(
          credentials.anonymousId,
          credentials.username,
          'invalid-signature'
        );
        
        assert.strictEqual(isValid, false);
      });

      it('should reject tampered username', () => {
        const credentials = authService.createAnonymousUser();
        
        const isValid = authService.verifyAnonymousToken(
          credentials.anonymousId,
          'TamperedUsername',
          credentials.signature
        );
        
        assert.strictEqual(isValid, false);
      });

      it('should reject tampered anonymousId', () => {
        const credentials = authService.createAnonymousUser();
        
        const isValid = authService.verifyAnonymousToken(
          'tampered-id',
          credentials.username,
          credentials.signature
        );
        
        assert.strictEqual(isValid, false);
      });

      it('should prevent username spoofing', () => {
        // Create two users
        const user1 = authService.createAnonymousUser();
        const user2 = authService.createAnonymousUser();
        
        // Try to use user1's signature with user2's username
        const isValid = authService.verifyAnonymousToken(
          user1.anonymousId,
          user2.username, // Trying to spoof
          user1.signature
        );
        
        assert.strictEqual(isValid, false);
      });
    });
  });

  describe('Development User', () => {
    it('should create dev user when no Google client', () => {
      const result = authService.createDevUser('fake-token');
      
      assert.strictEqual(result.success, true);
      assert.ok(result.user);
      assert.ok(result.user.id.startsWith('dev-'));
    });
  });

  describe('User Management', () => {
    it('should get user by ID', () => {
      const credentials = authService.createAnonymousUser();
      
      const user = authService.getUser(credentials.anonymousId);
      
      assert.ok(user);
      assert.strictEqual(user.name, credentials.username);
    });

    it('should return undefined for unknown user', () => {
      const user = authService.getUser('unknown-id');
      
      assert.strictEqual(user, undefined);
    });

    it('should update user profile', () => {
      const credentials = authService.createAnonymousUser();
      
      const result = authService.updateUser(credentials.anonymousId, { 
        customField: 'value' 
      });
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.user.customField, 'value');
    });

    it('should fail to update unknown user', () => {
      const result = authService.updateUser('unknown-id', { 
        customField: 'value' 
      });
      
      assert.strictEqual(result.success, false);
    });
  });
});
