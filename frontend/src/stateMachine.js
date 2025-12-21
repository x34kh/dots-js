/**
 * Game State Machine
 * Manages the overall game state and transitions
 */

export const GameState = {
  MENU: 'menu',
  WAITING: 'waiting',
  PLAYING: 'playing',
  GAME_OVER: 'gameOver'
};

export const GameMode = {
  DEMO: 'demo',
  ONLINE: 'online',
  LOCAL: 'local',
  ASYNC: 'async'
};

export class StateMachine {
  constructor() {
    this.state = GameState.MENU;
    this.mode = null;
    this.isLocalMode = false;
    this.players = {
      1: { id: null, name: 'Player 1', score: 0, color: 0x00ffff },
      2: { id: null, name: 'Player 2', score: 0, color: 0xff00ff }
    };
    this.currentPlayer = 1;
    this.localPlayerId = null;
    this.gameId = null;
    this.listeners = new Map();
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

  setState(newState) {
    const oldState = this.state;
    console.log(`[StateMachine] setState: ${oldState} -> ${newState}`);
    this.state = newState;
    this.emit('stateChange', { oldState, newState });
  }

  setMode(mode) {
    this.mode = mode;
    this.emit('modeChange', mode);
  }

  setPlayer(playerNum, playerData) {
    this.players[playerNum] = { ...this.players[playerNum], ...playerData };
    this.emit('playerUpdate', { playerNum, player: this.players[playerNum] });
  }

  getPlayer(playerNum) {
    return this.players[playerNum];
  }

  setCurrentPlayer(playerNum) {
    this.currentPlayer = playerNum;
    this.emit('turnChange', playerNum);
  }

  addScore(playerNum, points) {
    this.players[playerNum].score += points;
    this.emit('scoreChange', { playerNum, score: this.players[playerNum].score });
  }

  isLocalPlayerTurn() {
    // In local mode, always allow the current player to make moves
    if (this.isLocalMode) {
      return true;
    }
    return this.localPlayerId === this.currentPlayer;
  }

  switchTurn() {
    this.setCurrentPlayer(this.currentPlayer === 1 ? 2 : 1);
    // In local mode, update localPlayerId to current player
    if (this.isLocalMode) {
      this.localPlayerId = this.currentPlayer;
    }
  }

  reset() {
    this.players[1].score = 0;
    this.players[2].score = 0;
    this.currentPlayer = 1;
    this.emit('reset');
  }

  getWinner() {
    if (this.players[1].score > this.players[2].score) return 1;
    if (this.players[2].score > this.players[1].score) return 2;
    return null; // Draw
  }
}
