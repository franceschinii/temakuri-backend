import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
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
    // Poll a cada 5s para disparar jogadores solo que aguardaram tempo suficiente
    this.soloCheckInterval = setInterval(() => {
      for (const type of ['QUICK', 'RANKED'] as const) {
        const matched = this.matchmaking.tryMatch(type);
        if (matched) {
          this.createMatch(matched, type).catch(() => {
            this.matchmaking.rollbackMatch(matched);
          });
        }
      }
    }, 5_000);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;
    this.matchmaking.leaveQueue(client.userId);
  }

  // Listener exposto para NotificationsGateway sinalizar que um match foi cancelado
  // (ex: jogador desconectou durante a janela de confirmacao). Devolve a fila os players
  // que ainda querem jogar.
  onMatchCancelled(players: QueueEntry[]) {
    this.matchmaking.confirmMatch(players);
  }

  @OnEvent('matchmaking.requeue')
  handleRequeue(payload: { players: QueueEntry[] }) {
    // Recoloca jogadores sobreviventes de um match ranqueado cancelado na fila.
    // Atualiza joinedAt para start fresh do timer de relaxamento.
    const now = Date.now();
    for (const p of payload.players) {
      // Confirma para liberar do reserved set antes de reinserir
      this.matchmaking.confirmMatch([p]);
      this.matchmaking.joinQueue({ ...p, joinedAt: now });
    }
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
      try {
        await this.createMatch(matched, type);
      } catch {
        this.matchmaking.rollbackMatch(matched);
      }
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
      // Confirma match: libera reserva sem reinserir na fila
      this.matchmaking.confirmMatch(players);
      this.events.emit('matchmaking.found', { roomCode: room.code, players, createdByUserId: host.userId });
    } catch (e) {
      // Re-throw para que o caller faca rollback (devolve a fila)
      throw e;
    }
  }

  private send(client: AuthenticatedSocket, event: string, payload: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data: payload }));
    }
  }
}
