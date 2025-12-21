/**
 * Basic tests for StateMachine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine, GameState, GameMode } from './stateMachine.js';

describe('StateMachine', () => {
  let stateMachine;

  beforeEach(() => {
    stateMachine = new StateMachine();
  });

  it('should initialize with default state', () => {
    expect(stateMachine.state).toBe(GameState.MENU);
    expect(stateMachine.currentPlayer).toBe(1);
    expect(stateMachine.localPlayerId).toBe(null);
  });

  it('should change state', () => {
    stateMachine.setState(GameState.PLAYING);
    expect(stateMachine.state).toBe(GameState.PLAYING);
  });

  it('should set and get player data', () => {
    stateMachine.setPlayer(1, { id: 'test123', name: 'Test Player' });
    const player = stateMachine.getPlayer(1);
    expect(player.id).toBe('test123');
    expect(player.name).toBe('Test Player');
  });

  it('should switch turns', () => {
    stateMachine.setCurrentPlayer(1);
    stateMachine.switchTurn();
    expect(stateMachine.currentPlayer).toBe(2);
    stateMachine.switchTurn();
    expect(stateMachine.currentPlayer).toBe(1);
  });

  it('should detect local player turn', () => {
    stateMachine.localPlayerId = 1;
    stateMachine.setCurrentPlayer(1);
    expect(stateMachine.isLocalPlayerTurn()).toBe(true);
    
    stateMachine.setCurrentPlayer(2);
    expect(stateMachine.isLocalPlayerTurn()).toBe(false);
  });

  it('should add scores', () => {
    stateMachine.addScore(1, 5);
    stateMachine.addScore(2, 3);
    expect(stateMachine.players[1].score).toBe(5);
    expect(stateMachine.players[2].score).toBe(3);
  });

  it('should determine winner', () => {
    stateMachine.addScore(1, 10);
    stateMachine.addScore(2, 5);
    expect(stateMachine.getWinner()).toBe(1);
    
    stateMachine.addScore(2, 10);
    expect(stateMachine.getWinner()).toBe(2); // 10 vs 15
    
    stateMachine.reset();
    stateMachine.addScore(1, 5);
    stateMachine.addScore(2, 5);
    expect(stateMachine.getWinner()).toBe(null); // Draw at 5-5
  });

  it('should reset scores', () => {
    stateMachine.addScore(1, 10);
    stateMachine.addScore(2, 5);
    stateMachine.reset();
    expect(stateMachine.players[1].score).toBe(0);
    expect(stateMachine.players[2].score).toBe(0);
    expect(stateMachine.currentPlayer).toBe(1);
  });
});
