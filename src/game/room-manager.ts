import { Injectable } from '@nestjs/common';
import { GameEngine } from './engine/GameEngine.js';
import { GameMode } from '../types/game.types.js';

@Injectable()
export class RoomManager {
  private engines = new Map<string, GameEngine>();

  create(roomCode: string, mode: GameMode, handBias = 0, initialTokens = 2): GameEngine {
    const engine = new GameEngine(roomCode, mode, handBias, initialTokens);
    this.engines.set(roomCode, engine);
    return engine;
  }

  get(roomCode: string): GameEngine | undefined {
    return this.engines.get(roomCode);
  }

  destroy(roomCode: string) {
    this.engines.delete(roomCode);
  }

  has(roomCode: string): boolean {
    return this.engines.has(roomCode);
  }
}
