/**
 * P2P Networking using WebRTC
 * Handles peer-to-peer connection for demo mode
 */

export class P2PNetwork {
  constructor(serverUrl = null) {
    this.peer = null;
    this.connection = null;
    this.isHost = false;
    this.gameId = null;
    this.listeners = new Map();
    this.serverUrl = serverUrl || `${window.location.protocol}//${window.location.host}/api`;
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
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
   * Generate a unique game ID
   */
  generateGameId() {
    // No longer used - server generates IDs
    return null;
  }

  /**
   * Create a new game as host
   */
  async createGame() {
    this.isHost = true;
    
    try {
      this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
      this.setupPeerEvents();
      
      // Create data channel for game communication
      this.dataChannel = this.peer.createDataChannel('game', {
        ordered: true
      });
      this.setupDataChannelEvents();
      
      // Create offer
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      
      // Wait for ICE gathering
      await this.waitForIceGathering();
      
      // Store offer on server and get short game ID
      const offerData = JSON.stringify(this.peer.localDescription);
      const response = await fetch(`${this.serverUrl}/p2p/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: offerData })
      });
      
      if (!response.ok) {
        throw new Error('Failed to store offer on server');
      }
      
      const { gameId } = await response.json();
      this.gameId = gameId;
      
      // Return short link with just the game ID
      return {
        gameId: gameId,
        link: `${window.location.origin}${window.location.pathname}?join=${gameId}`
      };
    } catch (error) {
      console.error('Failed to create game:', error);
      throw error;
    }
  }

  /**
   * Join an existing game
   */
  async joinGame(gameId) {
    this.isHost = false;
    this.gameId = gameId;
    
    try {
      // Fetch offer from server
      const response = await fetch(`${this.serverUrl}/p2p/offer/${gameId}`);
      if (!response.ok) {
        throw new Error('Game not found');
      }
      
      const { offer } = await response.json();
      
      this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
      this.setupPeerEvents();
      
      // Handle incoming data channel
      this.peer.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannelEvents();
      };
      
      // Set remote description (the offer)
      const offerDesc = JSON.parse(offer);
      await this.peer.setRemoteDescription(new RTCSessionDescription(offerDesc));
      
      // Create answer
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      
      // Wait for ICE gathering
      await this.waitForIceGathering();
      
      // Send answer to server
      const answerData = JSON.stringify(this.peer.localDescription);
      const answerResponse = await fetch(`${this.serverUrl}/p2p/answer/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answerData })
      });
      
      if (!answerResponse.ok) {
        throw new Error('Failed to send answer');
      }
      
      return true;
    } catch (error) {
      console.error('Failed to join game:', error);
      throw error;
    }
  }

  /**
   * Complete the connection as host (receive answer)
   */
  async completeConnection() {
    try {
      // Poll for answer from server
      const maxAttempts = 60; // 60 seconds
      for (let i = 0; i < maxAttempts; i++) {
        const response = await fetch(`${this.serverUrl}/p2p/answer/${this.gameId}`);
        
        if (response.ok) {
          const { answer } = await response.json();
          const answerDesc = JSON.parse(answer);
          await this.peer.setRemoteDescription(new RTCSessionDescription(answerDesc));
          return true;
        }
        
        // Wait 1 second before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      throw new Error('Timeout waiting for answer');
    } catch (error) {
      console.error('Failed to complete connection:', error);
      throw error;
    }
  }

  /**
   * Wait for ICE gathering to complete
   */
  waitForIceGathering() {
    return new Promise((resolve) => {
      if (this.peer.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      
      const checkState = () => {
        if (this.peer.iceGatheringState === 'complete') {
          this.peer.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      
      this.peer.addEventListener('icegatheringstatechange', checkState);
      
      // Timeout after 5 seconds
      setTimeout(resolve, 5000);
    });
  }

  setupPeerEvents() {
    this.peer.onconnectionstatechange = () => {
      console.log('Connection state:', this.peer.connectionState);
      
      switch (this.peer.connectionState) {
        case 'connected':
          this.emit('connected');
          break;
        case 'disconnected':
        case 'failed':
          this.emit('disconnected');
          break;
      }
    };

    this.peer.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peer.iceConnectionState);
    };
  }

  setupDataChannelEvents() {
    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      this.emit('ready');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
      this.emit('disconnected');
    };

    this.dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };
  }

  handleMessage(message) {
    switch (message.type) {
      case 'move':
        this.emit('move', message.data);
        break;
      case 'sync':
        this.emit('sync', message.data);
        break;
      case 'chat':
        this.emit('chat', message.data);
        break;
      case 'rematch':
        this.emit('rematch', message.data);
        break;
      case 'player':
        this.emit('player', message.data);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  /**
   * Send a move to the peer
   */
  sendMove(moveData) {
    this.send({ type: 'move', data: moveData });
  }

  /**
   * Send sync data
   */
  sendSync(syncData) {
    this.send({ type: 'sync', data: syncData });
  }

  /**
   * Send player info
   */
  sendPlayerInfo(playerData) {
    this.send({ type: 'player', data: playerData });
  }

  /**
   * Request rematch
   */
  sendRematch() {
    this.send({ type: 'rematch', data: {} });
  }

  /**
   * Generic send function
   */
  send(message) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    } else {
      console.warn('Data channel not ready');
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.dataChannel && this.dataChannel.readyState === 'open';
  }

  /**
   * Close the connection
   */
  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peer) {
      this.peer.close();
    }
    this.peer = null;
    this.dataChannel = null;
    this.gameId = null;
  }
}

/**
 * Simple signaling helper using URL parameters
 * In production, use a proper signaling server
 */
export class URLSignaling {
  static encodeOffer(offer) {
    return btoa(JSON.stringify(offer));
  }

  static decodeOffer(encoded) {
    return JSON.parse(atob(encoded));
  }

  static getJoinParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      gameId: params.get('join'),
      offer: params.get('offer')
    };
  }

  static clearParams() {
    window.history.replaceState({}, '', window.location.pathname);
  }
}
