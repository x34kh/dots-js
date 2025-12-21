/**
 * Favicon Status Indicator
 * Changes favicon color to indicate connection status
 */

export class FaviconStatus {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.ctx = this.canvas.getContext('2d');
    this.link = document.querySelector("link[rel*='icon']") || this.createFaviconLink();
  }

  createFaviconLink() {
    const link = document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    document.head.appendChild(link);
    return link;
  }

  /**
   * Set favicon color
   * @param {string} color - 'green' for connected, 'red' for disconnected, 'orange' for reconnecting
   */
  setStatus(status) {
    const colors = {
      connected: '#00ff66',
      disconnected: '#ff3333',
      reconnecting: '#ffaa00'
    };

    const color = colors[status] || colors.disconnected;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, 32, 32);
    
    // Draw circle
    this.ctx.beginPath();
    this.ctx.arc(16, 16, 14, 0, 2 * Math.PI);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    
    // Add inner glow effect
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    // Update favicon
    this.link.href = this.canvas.toDataURL('image/png');
  }

  setConnected() {
    this.setStatus('connected');
  }

  setDisconnected() {
    this.setStatus('disconnected');
  }

  setReconnecting() {
    this.setStatus('reconnecting');
  }
}

// Create global instance
export const faviconStatus = new FaviconStatus();
