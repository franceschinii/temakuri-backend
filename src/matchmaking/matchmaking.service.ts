import { Injectable } from '@nestjs/common';

export interface QueueEntry {
  userId: string;
  username: string;
  pds: number;
  type: 'RANKED' | 'QUICK';
  joinedAt: number;
  avatarIndex: number;
  level: number;
}

const PDS_RANGE = 200;
const RELAX_AFTER_MS = 60_000;

@Injectable()
export class MatchmakingService {
  private queues = new Map<'RANKED' | 'QUICK', QueueEntry[]>([
    ['RANKED', []],
    ['QUICK', []],
  ]);

  // Tracks rooms awaiting confirmation so we don't double-fire
  private pendingRooms = new Set<string>();

  markRoomPending(roomCode: string) { this.pendingRooms.add(roomCode); }
  clearRoomPending(roomCode: string) { this.pendingRooms.delete(roomCode); }

  joinQueue(entry: QueueEntry): void {
    const queue = this.queues.get(entry.type)!;
    const idx = queue.findIndex(e => e.userId === entry.userId);
    if (idx !== -1) queue.splice(idx, 1);
    queue.push(entry);
  }

  leaveQueue(userId: string): void {
    for (const queue of this.queues.values()) {
      const idx = queue.findIndex(e => e.userId === userId);
      if (idx !== -1) { queue.splice(idx, 1); break; }
    }
  }

  // Returns up to 4 players to seed a room. With < 4, bots fill later.
  tryMatch(type: 'RANKED' | 'QUICK'): QueueEntry[] | null {
    const queue = this.queues.get(type)!;
    if (queue.length === 0) return null;

    if (type === 'QUICK') {
      // With 4+ grab all 4; otherwise take what we have (bots will fill)
      const take = Math.min(queue.length, 4);
      return queue.splice(0, take);
    }

    // RANKED: prefer PDS proximity, relax after 60s
    const now = Date.now();
    const anyRelaxed = queue.some(e => now - e.joinedAt >= RELAX_AFTER_MS);

    if (queue.length >= 4) {
      if (anyRelaxed) return queue.splice(0, 4);

      for (let i = 0; i <= queue.length - 4; i++) {
        const anchor = queue[i].pds;
        const group = queue.filter(e => Math.abs(e.pds - anchor) <= PDS_RANGE);
        if (group.length >= 4) {
          const matched = group.slice(0, 4);
          for (const entry of matched) {
            const idx = queue.indexOf(entry);
            if (idx !== -1) queue.splice(idx, 1);
          }
          return matched;
        }
      }
      return null;
    }

    // < 4 players: only fire when the oldest has been waiting >= RELAX_AFTER_MS
    if (anyRelaxed) {
      return queue.splice(0, queue.length);
    }

    return null;
  }

  getQueuePosition(userId: string, type: 'RANKED' | 'QUICK'): number {
    const queue = this.queues.get(type)!;
    const idx = queue.findIndex(e => e.userId === userId);
    return idx === -1 ? 0 : idx + 1;
  }

  getQueueSize(type: 'RANKED' | 'QUICK'): number {
    return this.queues.get(type)!.length;
  }
}
