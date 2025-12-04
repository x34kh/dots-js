/**
 * Authentication Module
 * Handles Google OAuth and Anonymous authentication
 */

export class GoogleAuth {
  constructor(clientId, serverUrl = null) {
    this.clientId = clientId;
    this.serverUrl = serverUrl || this.getDefaultServerUrl();
    this.user = null;
    this.token = null;
    this.anonymousCredentials = null;
    this.listeners = new Map();
    this.initialized = false;
  }

  getDefaultServerUrl() {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.hostname === 'localhost' ? ':8080' : '';
    return `${protocol}//${host}${port}`;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  /**
   * Initialize Google Sign-In
   */
  async init() {
    if (this.initialized) return;
    
    // Skip if no client ID provided
    if (!this.clientId) {
      console.warn('Google Client ID not provided');
      return;
    }

    return new Promise((resolve, reject) => {
      // Load the Google Identity Services library
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      
      script.onload = () => {
        this.setupGoogleSignIn();
        this.initialized = true;
        resolve();
      };
      
      script.onerror = () => {
        reject(new Error('Failed to load Google Sign-In'));
      };
      
      document.head.appendChild(script);
    });
  }

  setupGoogleSignIn() {
    /* global google */
    google.accounts.id.initialize({
      client_id: this.clientId,
      callback: (response) => this.handleCredentialResponse(response),
      auto_select: false
    });

    // Check for existing session
    this.checkExistingSession();
  }

  /**
   * Handle the credential response from Google
   */
  handleCredentialResponse(response) {
    if (response.credential) {
      this.token = response.credential;
      this.user = this.parseJwt(response.credential);
      
      // Store in session storage
      sessionStorage.setItem('google_token', this.token);
      
      this.emit('signIn', {
        user: this.user,
        token: this.token
      });
    }
  }

  /**
   * Parse JWT token to extract user info
   */
  parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      
      const payload = JSON.parse(jsonPayload);
      
      return {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
        exp: payload.exp
      };
    } catch (error) {
      console.error('Failed to parse JWT:', error);
      return null;
    }
  }

  /**
   * Check for existing session
   */
  checkExistingSession() {
    const storedToken = sessionStorage.getItem('google_token');
    if (storedToken) {
      const user = this.parseJwt(storedToken);
      if (user && user.exp * 1000 > Date.now()) {
        this.token = storedToken;
        this.user = user;
        this.emit('signIn', { user, token: storedToken });
      } else {
        sessionStorage.removeItem('google_token');
      }
    }
  }

  /**
   * Prompt user to sign in
   */
  signIn() {
    if (!this.initialized) {
      console.warn('Google Sign-In not initialized');
      return;
    }

    /* global google */
    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        // Show manual sign-in button if prompt is not displayed
        google.accounts.id.renderButton(
          document.getElementById('btn-google-login'),
          { theme: 'outline', size: 'large', width: '100%' }
        );
        document.getElementById('btn-google-login').classList.remove('hidden');
      }
    });
  }

  /**
   * Sign out
   */
  signOut() {
    this.user = null;
    this.token = null;
    sessionStorage.removeItem('google_token');
    
    if (this.initialized) {
      /* global google */
      google.accounts.id.disableAutoSelect();
    }
    
    this.emit('signOut');
  }

  /**
   * Check if user is signed in
   */
  isSignedIn() {
    return this.user !== null && this.token !== null;
  }

  /**
   * Get current user
   */
  getUser() {
    return this.user;
  }

  /**
   * Get current token
   */
  getToken() {
    return this.token;
  }

  /**
   * Create a guest user for demo mode
   */
  createGuestUser() {
    const guestId = 'guest-' + Math.random().toString(36).slice(2, 11);
    this.user = {
      id: guestId,
      name: 'Guest ' + guestId.slice(-4).toUpperCase(),
      email: null,
      picture: null,
      isGuest: true
    };
    this.token = null;
    
    return this.user;
  }

  // ==================== Anonymous Authentication ====================

  /**
   * Check if anonymous credentials exist in cookies
   */
  hasAnonymousCredentials() {
    return this.getCookie('anon_id') && 
           this.getCookie('anon_name') && 
           this.getCookie('anon_sig');
  }

  /**
   * Get anonymous credentials from cookies
   */
  getAnonymousCredentials() {
    return {
      anonymousId: this.getCookie('anon_id'),
      username: this.getCookie('anon_name'),
      signature: this.getCookie('anon_sig')
    };
  }

  /**
   * Create or retrieve anonymous user
   * Uses server-side generation for secure signatures
   */
  async createAnonymousUser() {
    // Check for existing anonymous credentials
    if (this.hasAnonymousCredentials()) {
      const credentials = this.getAnonymousCredentials();
      
      // Verify credentials with server
      try {
        const response = await fetch(`${this.serverUrl}/api/auth/anonymous/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials)
        });

        if (response.ok) {
          const data = await response.json();
          this.user = data.user;
          this.anonymousCredentials = credentials;
          this.emit('signIn', { user: this.user, isAnonymous: true });
          return this.user;
        }
      } catch (error) {
        console.warn('Failed to verify anonymous credentials:', error);
      }
      
      // Clear invalid credentials
      this.clearAnonymousCookies();
    }

    // Create new anonymous user via server
    try {
      const response = await fetch(`${this.serverUrl}/api/auth/anonymous`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Include cookies in request
      });

      if (!response.ok) {
        throw new Error('Failed to create anonymous user');
      }

      const credentials = await response.json();
      
      // Store credentials in cookies with secure settings
      this.setSecureCookie('anon_id', credentials.anonymousId, 30);
      this.setSecureCookie('anon_name', credentials.username, 30);
      this.setSecureCookie('anon_sig', credentials.signature, 30);

      this.user = {
        id: credentials.anonymousId,
        name: credentials.username,
        email: null,
        picture: null,
        isAnonymous: true
      };
      this.anonymousCredentials = credentials;

      this.emit('signIn', { user: this.user, isAnonymous: true });
      return this.user;
    } catch (error) {
      console.error('Failed to create anonymous user:', error);
      // Fallback to local guest user for demo mode
      return this.createGuestUser();
    }
  }

  /**
   * Get anonymous credentials for WebSocket authentication
   */
  getAnonymousAuthData() {
    if (!this.anonymousCredentials) {
      this.anonymousCredentials = this.getAnonymousCredentials();
    }
    return this.anonymousCredentials;
  }

  /**
   * Check if current user is anonymous
   */
  isAnonymous() {
    return this.user && this.user.isAnonymous === true;
  }

  // ==================== Cookie Utilities ====================

  /**
   * Set a secure cookie
   */
  setSecureCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    
    let cookieString = `${name}=${encodeURIComponent(value)}`;
    cookieString += `; expires=${expires.toUTCString()}`;
    cookieString += '; path=/';
    cookieString += '; SameSite=Strict';
    
    // Add Secure flag in production (HTTPS)
    if (window.location.protocol === 'https:') {
      cookieString += '; Secure';
    }
    
    document.cookie = cookieString;
  }

  /**
   * Get a cookie value
   */
  getCookie(name) {
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length));
      }
    }
    return null;
  }

  /**
   * Clear anonymous cookies
   */
  clearAnonymousCookies() {
    this.deleteCookie('anon_id');
    this.deleteCookie('anon_name');
    this.deleteCookie('anon_sig');
    this.anonymousCredentials = null;
  }

  /**
   * Delete a cookie
   */
  deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
  }

  /**
   * Sign out anonymous user
   */
  signOutAnonymous() {
    this.clearAnonymousCookies();
    this.user = null;
    this.emit('signOut');
  }
}
