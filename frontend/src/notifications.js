/**
 * Notification System
 * Displays temporary pop-up notifications with timestamps
 */

export class NotificationManager {
  constructor() {
    this.container = document.getElementById('notification-container');
    this.notifications = [];
  }

  /**
   * Show a notification
   * @param {string} message - The notification message
   * @param {string} type - Type: 'info', 'success', 'error'
   * @param {number} duration - Duration in milliseconds (default 5000)
   */
  show(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const time = new Date().toLocaleTimeString();
    
    notification.innerHTML = `
      <div class="notification-header">
        <span class="notification-title">${this.getTitle(type)}</span>
        <span class="notification-time">${time}</span>
      </div>
      <div class="notification-message">${message}</div>
    `;
    
    this.container.appendChild(notification);
    this.notifications.push(notification);
    
    // Auto-dismiss after duration
    setTimeout(() => {
      this.dismiss(notification);
    }, duration);
    
    // Limit to 5 notifications
    if (this.notifications.length > 5) {
      this.dismiss(this.notifications[0]);
    }
  }

  /**
   * Get title based on notification type
   */
  getTitle(type) {
    switch (type) {
      case 'success':
        return '✓ Success';
      case 'error':
        return '✗ Error';
      case 'info':
      default:
        return 'ℹ Info';
    }
  }

  /**
   * Dismiss a notification
   */
  dismiss(notification) {
    notification.classList.add('fadeOut');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      const index = this.notifications.indexOf(notification);
      if (index > -1) {
        this.notifications.splice(index, 1);
      }
    }, 300);
  }

  /**
   * Clear all notifications
   */
  clearAll() {
    this.notifications.forEach(notification => {
      this.dismiss(notification);
    });
  }
}

export const notificationManager = new NotificationManager();
