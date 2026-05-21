import { Injectable } from '@nestjs/common';

/**
 * Abstracao do estado de "pronto" das salas. Implementacao atual em memoria
 * (InMemoryReadyStateStore); pluggable para Redis no futuro sem mudar
 * chamadores. Toda a logica de lobby/start usa essa interface, nunca o
 * Map cru.
 */
export abstract class ReadyStateStore {
  abstract setReady(roomCode: string, userId: string, ready: boolean): Promise<void>;
  abstract isReady(roomCode: string, userId: string): Promise<boolean>;
  abstract snapshot(roomCode: string): Promise<string[]>;
  abstract clear(roomCode: string): Promise<void>;
  abstract removeUser(roomCode: string, userId: string): Promise<void>;
}

@Injectable()
export class InMemoryReadyStateStore extends ReadyStateStore {
  private readonly map = new Map<string, Set<string>>();

  async setReady(roomCode: string, userId: string, ready: boolean): Promise<void> {
    let set = this.map.get(roomCode);
    if (!set) {
      set = new Set();
      this.map.set(roomCode, set);
    }
    if (ready) set.add(userId);
    else set.delete(userId);
  }

  async isReady(roomCode: string, userId: string): Promise<boolean> {
    return this.map.get(roomCode)?.has(userId) ?? false;
  }

  async snapshot(roomCode: string): Promise<string[]> {
    return Array.from(this.map.get(roomCode) ?? []);
  }

  async clear(roomCode: string): Promise<void> {
    this.map.delete(roomCode);
  }

  async removeUser(roomCode: string, userId: string): Promise<void> {
    this.map.get(roomCode)?.delete(userId);
  }
}
