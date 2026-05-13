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
const PDS_RANGE_RELAXED = 600; // janela maior depois de RELAX_AFTER_MS
const QUICK_SOLO_WAIT_MS = 30_000;

@Injectable()
export class MatchmakingService {
  private queues = new Map<'RANKED' | 'QUICK', QueueEntry[]>([
    ['RANKED', []],
    ['QUICK', []],
  ]);

  // Mutex simples por tipo de fila. tryMatch faz splice e reinserir em falha — sem isso, duas
  // chamadas concorrentes (handleJoin + soloCheckInterval) podem criar duas salas com mesmo player.
  private matchLocks = new Map<'RANKED' | 'QUICK', boolean>([
    ['RANKED', false],
    ['QUICK', false],
  ]);

  // Reserva de userIds em match formation: depois do splice mas antes de createMatch confirmar,
  // o usuario nao pode reentrar na fila. Limpa em confirmMatch ou releaseReserved.
  private reservedUserIds = new Set<string>();

  joinQueue(entry: QueueEntry): void {
    // Bloqueia reentrada se ja esta reservado por outro match em formacao
    if (this.reservedUserIds.has(entry.userId)) return;
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
    this.reservedUserIds.delete(userId);
  }

  // Acquire lock; returns false se outra chamada esta processando esse tipo
  private acquireLock(type: 'RANKED' | 'QUICK'): boolean {
    if (this.matchLocks.get(type)) return false;
    this.matchLocks.set(type, true);
    return true;
  }

  private releaseLock(type: 'RANKED' | 'QUICK'): void {
    this.matchLocks.set(type, false);
  }

  // Marca os players como reservados em match em formacao
  private reserve(entries: QueueEntry[]): void {
    for (const e of entries) this.reservedUserIds.add(e.userId);
  }

  // Confirma o match (apos createMatch ter sucesso) — libera reserva
  confirmMatch(entries: QueueEntry[]): void {
    for (const e of entries) this.reservedUserIds.delete(e.userId);
  }

  // Reverte match em caso de erro — devolve a fila e libera reserva
  rollbackMatch(entries: QueueEntry[]): void {
    for (const e of entries) {
      this.reservedUserIds.delete(e.userId);
      const queue = this.queues.get(e.type)!;
      if (!queue.find(q => q.userId === e.userId)) {
        queue.push(e);
      }
    }
  }

  /**
   * Retorna ate 4 jogadores para semear uma sala. Com < 4, bots preenchem depois (apenas QUICK).
   * Usa lock para evitar criar duas salas com overlapping players.
   * O caller deve invocar confirmMatch() apos createMatch ter sucesso, ou rollbackMatch() em erro.
   */
  tryMatch(type: 'RANKED' | 'QUICK'): QueueEntry[] | null {
    if (!this.acquireLock(type)) return null;
    try {
      const queue = this.queues.get(type)!;
      if (queue.length === 0) return null;

      if (type === 'QUICK') {
        if (queue.length >= 2) {
          const matched = queue.splice(0, Math.min(queue.length, 4));
          this.reserve(matched);
          return matched;
        }
        const now = Date.now();
        if (queue[0] && now - queue[0].joinedAt >= QUICK_SOLO_WAIT_MS) {
          const matched = queue.splice(0, 1);
          this.reserve(matched);
          return matched;
        }
        return null;
      }

      // RANKED: prefer PDS proximity, relax individualmente por jogador depois de 60s
      const now = Date.now();

      if (queue.length >= 4) {
        // Tenta achar grupo dentro da janela apertada
        for (let i = 0; i <= queue.length - 4; i++) {
          const anchor = queue[i].pds;
          const group = queue.filter(e => Math.abs(e.pds - anchor) <= PDS_RANGE);
          if (group.length >= 4) {
            const matched = group.slice(0, 4);
            for (const entry of matched) {
              const idx = queue.indexOf(entry);
              if (idx !== -1) queue.splice(idx, 1);
            }
            this.reserve(matched);
            return matched;
          }
        }

        // Janela relaxada: usa apenas jogadores que esperaram >= 60s como ancora
        for (let i = 0; i <= queue.length - 4; i++) {
          if (now - queue[i].joinedAt < RELAX_AFTER_MS) continue;
          const anchor = queue[i].pds;
          const group = queue.filter(e => Math.abs(e.pds - anchor) <= PDS_RANGE_RELAXED);
          if (group.length >= 4) {
            const matched = group.slice(0, 4);
            for (const entry of matched) {
              const idx = queue.indexOf(entry);
              if (idx !== -1) queue.splice(idx, 1);
            }
            this.reserve(matched);
            return matched;
          }
        }
        return null;
      }

      // < 4 players: ranked nao dispara com bots, espera completar 4 ou desistir
      return null;
    } finally {
      this.releaseLock(type);
    }
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
