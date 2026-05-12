import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MatchmakingService, QueueEntry } from './matchmaking.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  username?: string;
  isAlive: boolean;
}

@WebSocketGateway({ path: '/ws' })
export class MatchmakingGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private soloCheckInterval: NodeJS.Timeout;

  constructor(
    private matchmaking: MatchmakingService,
    private rooms: RoomsService,
    private events: EventEmitter2,
    private prisma: PrismaService,
  ) {
    // Poll every 5s to fire solo players who have waited long enough
    this.soloCheckInterval = setInterval(() => {
      for (const type of ['QUICK', 'RANKED'] as const) {
        const matched = this.matchmaking.tryMatch(type);
        if (matched) {
          this.createMatch(matched, type).catch(() => {
            for (const p of matched) this.matchmaking.joinQueue(p);
          });
        }
      }
    }, 5_000);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;
    this.matchmaking.leaveQueue(client.userId);
  }

  @SubscribeMessage('matchmaking:join')
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { type: 'RANKED' | 'QUICK'; avatarIndex?: number; level?: number; pds?: number },
  ) {
    if (!client.userId || !client.username) return;

    const type: 'RANKED' | 'QUICK' = data.type === 'RANKED' ? 'RANKED' : 'QUICK';

    if (type === 'RANKED') {
      const user = await this.prisma.user.findUnique({
        where: { id: client.userId },
        select: { level: true, rankedSuspendedUntil: true },
      });
      if (!user || (user.level ?? 1) < 10) {
        this.send(client, 'matchmaking:error', { message: 'Nível 10 necessário para ranked' });
        return;
      }
      if (user.rankedSuspendedUntil && user.rankedSuspendedUntil > new Date()) {
        this.send(client, 'matchmaking:error', { message: 'Você está suspenso do ranked' });
        return;
      }
    }

    const entry: QueueEntry = {
      userId: client.userId,
      username: client.username,
      pds: data.pds ?? 0,
      type,
      joinedAt: Date.now(),
      avatarIndex: data.avatarIndex ?? 0,
      level: data.level ?? 1,
    };

    this.matchmaking.joinQueue(entry);

    const position = this.matchmaking.getQueuePosition(client.userId, type);
    const queueSize = this.matchmaking.getQueueSize(type);
    this.send(client, 'matchmaking:queued', { type, position, queueSize });

    // Attempt to form a match
    const matched = this.matchmaking.tryMatch(type);
    if (matched) {
      await this.createMatch(matched, type);
    }
  }

  @SubscribeMessage('matchmaking:leave')
  handleLeave(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.userId) return;
    this.matchmaking.leaveQueue(client.userId);
    this.send(client, 'matchmaking:left', {});
  }

  private async createMatch(players: QueueEntry[], type: 'RANKED' | 'QUICK') {
    const host = players[0];
    try {
      const room = await this.rooms.createMatchmakingRoom(host.userId, {
        mode: 'TRADITIONAL',
        maxPlayers: 4,
        isPrivate: false,
        isRanked: type === 'RANKED',
        initialTokens: 2,
        handBias: 0,
      });
      this.events.emit('matchmaking.found', { roomCode: room.code, players, createdByUserId: host.userId });
    } catch (e) {
      // Put players back in queue on failure
      for (const p of players) this.matchmaking.joinQueue(p);
    }
  }

  private send(client: AuthenticatedSocket, event: string, payload: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data: payload }));
    }
  }
}
