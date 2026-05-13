import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoomManager } from '../game/room-manager.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EngineEvent } from '../game/engine/GameEngine.js';
import { WS_HEARTBEAT_INTERVAL, STARTING_COUNTDOWN_MS } from '../common/constants/game.constants.js';
import type { QueueEntry } from '../matchmaking/matchmaking.service.js';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  username?: string;
  roomCode?: string;
  isAlive: boolean;
}

@WebSocketGateway({ path: '/ws' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<AuthenticatedSocket>>();

  /** Numero de usuarios unicos online no momento (com ao menos 1 socket aberto). */
  getOnlineCount(): number {
    return this.userSockets.size;
  }
  private roomSockets = new Map<string, Set<AuthenticatedSocket>>();
  private roomBots = new Map<string, Set<string>>(); // roomCode → Set<botUserId>
  private turnTimers = new Map<string, NodeJS.Timeout>(); // roomCode → timer
  private heartbeatInterval: NodeJS.Timeout;
  private roomReadyMap = new Map<string, Set<string>>(); // roomCode → Set<userId prontos>
  private matchmakingRooms = new Set<string>(); // roomCodes criados via matchmaking
  private chatCooldowns = new Map<string, number>(); // userId → timestamp último envio
  private reactionCooldowns = new Map<string, number>(); // userId → timestamp última reação
  // Matchmaking em formacao: roomCode → { players, timeout, isRanked }
  // Permite cancelar a sala se um jogador desconecta durante a janela de confirmacao.
  private pendingMatches = new Map<string, { players: QueueEntry[]; isRanked: boolean; confirmTimer: NodeJS.Timeout | null }>();

  // Throttle do presence:count para nao spammar broadcasts em rajadas de
  // connect/disconnect. Emite no maximo 1 vez por segundo.
  private presenceThrottle: NodeJS.Timeout | null = null;
  private lastPresenceSentCount = -1;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private roomManager: RoomManager,
    private roomsService: RoomsService,
    private events: EventEmitter2,
    private prisma: PrismaService,
  ) {}

  afterInit() {
    this.heartbeatInterval = setInterval(() => {
      this.server.clients.forEach((ws: AuthenticatedSocket) => {
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
      });
    }, WS_HEARTBEAT_INTERVAL);

    // Limpa salas que ficaram IN_PROGRESS apos restart do servidor.
    // Engine vive em memoria; sem ele, partida e irrecuperavel.
    this.roomsService.markOrphanInProgressAsFinished().catch(() => {});
  }

  async handleConnection(client: AuthenticatedSocket, req: any) {
    client.isAlive = true;
    client.on('pong', () => { client.isAlive = true; });

    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      client.close(4001, 'Missing token');
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_SECRET') });
      const userId: string = payload.sub;

      const userStillExists = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!userStillExists) {
        client.close(4001, 'Stale token');
        return;
      }

      client.userId = userId;
      client.username = payload.username;

      const isFirstSocketForUser = !this.userSockets.has(userId);
      if (isFirstSocketForUser) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client);

      // Envia valor atual direto pra esse cliente; broadcast geral se foi
      // novo usuario online (nao apenas reconexao adicional do mesmo user).
      this.sendToClient(client, 'presence:count', { online: this.userSockets.size });
      if (isFirstSocketForUser) {
        this.schedulePresenceBroadcast();
      }
    } catch {
      client.close(4001, 'Invalid token');
    }
  }

  /**
   * Agenda broadcast de presence:count. Throttle de 1s pra evitar storm
   * em refresh em massa ou reconexoes simultaneas.
   */
  private schedulePresenceBroadcast() {
    if (this.presenceThrottle) return;
    this.presenceThrottle = setTimeout(() => {
      this.presenceThrottle = null;
      const count = this.userSockets.size;
      if (count === this.lastPresenceSentCount) return;
      this.lastPresenceSentCount = count;
      this.broadcastAll('presence:count', { online: count });
    }, 1000);
  }

  private broadcastAll(event: string, payload: any) {
    const msg = JSON.stringify({ event, data: payload });
    this.server.clients.forEach((ws: AuthenticatedSocket) => {
      if (ws.userId && ws.readyState === ws.OPEN) ws.send(msg);
    });
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;

    const userSet = this.userSockets.get(client.userId);
    if (userSet) {
      userSet.delete(client);
      if (userSet.size === 0) {
        this.userSockets.delete(client.userId);
        // Only remove from matchmaking queue when the user has no remaining sockets
        this.events.emit('matchmaking.user_disconnected', { userId: client.userId });
        // Decrementa o contador global agora que o user saiu de fato.
        this.schedulePresenceBroadcast();
      }
    }

    if (client.roomCode) {
      const roomSet = this.roomSockets.get(client.roomCode);
      if (roomSet) {
        roomSet.delete(client);
        if (roomSet.size === 0) this.roomSockets.delete(client.roomCode);
      }

      const engine = this.roomManager.get(client.roomCode);
      if (engine) {
        // Game in progress: mark disconnected, allow reconnect + apply ranked abandonment penalty
        const events = engine.setPlayerConnected(client.userId, false);
        this.dispatchEvents(client.roomCode, events);
        this.applyRankedAbandonmentIfNeeded(client.userId, client.roomCode).catch(() => {});
      } else {
        // Room in WAITING: remove guest immediately (they only exist while connected)
        const disconnectedRoomCode = client.roomCode;
        const disconnectedUserId = client.userId;
        this.roomsService.leaveRoomIfGuest(disconnectedUserId, disconnectedRoomCode).then(async removed => {
          // After guest removal (or registered user disconnect), check if room should close
          const room = await this.roomsService.findByCode(disconnectedRoomCode!).catch(() => null);
          if (!room || room.status !== 'WAITING') {
            if (this.matchmakingRooms.has(disconnectedRoomCode!)) {
              this.matchmakingRooms.delete(disconnectedRoomCode!);
            }
            return;
          }

          // Count humans still connected (has at least one active socket)
          const humanPlayers = room.players.filter((p: any) => !p.isBot);
          const connectedHumans = humanPlayers.filter((p: any) => {
            const sockets = this.userSockets.get(p.userId);
            return sockets && sockets.size > 0;
          });

          if (connectedHumans.length === 0) {
            // No humans left — close the room
            this.clearTurnTimer(disconnectedRoomCode!);
            await this.roomsService.leaveRoom(room.hostId, disconnectedRoomCode!).catch(() => {});
            this.roomReadyMap.delete(disconnectedRoomCode!);
            this.matchmakingRooms.delete(disconnectedRoomCode!);
            this.roomSockets.delete(disconnectedRoomCode!);
            return;
          }

          if (removed) {
            this.roomsService.findByCode(disconnectedRoomCode!).then(updated => {
              this.broadcastToRoom(disconnectedRoomCode!, 'lobby:room_updated', { room: updated });
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    } else {
      // Guest with no active room (closed tab before joining a room) — free username
      this.roomsService.deleteGuestIfOrphan(client.userId).catch(() => {});
    }
  }

  @SubscribeMessage('lobby:join_room')
  async handleJoinRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; password?: string }) {
    if (!client.userId) throw new WsException('Unauthorized');

    // Bloquear se o userId já está em outra sala com qualquer outro socket
    const existingSockets = this.userSockets.get(client.userId);
    if (existingSockets) {
      for (const sock of existingSockets) {
        if (sock !== client && sock.roomCode && sock.roomCode !== data.roomCode) {
          this.sendToClient(client, 'lobby:error', {
            code: 'ALREADY_IN_ROOM',
            message: 'Você já está em outra sala nesta conta. Saia antes de entrar em uma nova.',
          });
          return;
        }
      }
    }

    try {
      const room = await this.roomsService.joinRoom(client.userId, data.roomCode, data.password);
      client.roomCode = data.roomCode;

      if (!this.roomSockets.has(data.roomCode)) {
        this.roomSockets.set(data.roomCode, new Set());
      }
      this.roomSockets.get(data.roomCode)!.add(client);

      this.broadcastToRoom(data.roomCode, 'lobby:room_updated', { room });

      // Envia snapshot do readyMap para que o cliente que acabou de entrar
      // (ou abriu nova aba) sincronize quem ja esta pronto
      const readySnapshot = Array.from(this.roomReadyMap.get(data.roomCode) ?? []);
      this.sendToClient(client, 'lobby:ready_snapshot', { ready: readySnapshot });
    } catch (e: any) {
      const msg = e?.message ?? '';
      let code = 'ROOM_NOT_FOUND';
      if (msg === 'Senha incorreta' || e?.status === 403) code = 'WRONG_PASSWORD';
      else if (msg.includes('Sala cheia')) code = 'ROOM_FULL';
      else if (msg.includes('em andamento')) code = 'ROOM_IN_PROGRESS';
      this.sendToClient(client, 'lobby:error', { code, message: msg });
    }
  }

  @SubscribeMessage('lobby:reset_room')
  async handleResetRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    const room = await this.roomsService.findByCode(data.roomCode).catch(() => null);
    if (!room || room.hostId !== client.userId) return;

    // Destruir engine se existir
    this.roomManager.destroy(data.roomCode);

    // Limpar timer de turno
    const timer = this.turnTimers.get(data.roomCode);
    if (timer) { clearTimeout(timer); this.turnTimers.delete(data.roomCode); }

    // Limpar estado de ready e bots
    this.roomReadyMap.delete(data.roomCode);
    this.roomBots.delete(data.roomCode);

    const updatedRoom = await this.roomsService.resetRoom(data.roomCode, client.userId);
    // Notifica clientes em /game/:code para voltarem ao lobby
    this.broadcastToRoom(data.roomCode, 'lobby:room_reset', { roomCode: data.roomCode });
    this.broadcastToRoom(data.roomCode, 'lobby:room_updated', { room: updatedRoom });
  }

  /**
   * Jogador recusou o match no dialog de matchmaking.
   * Cancela imediatamente o match em formacao e devolve os demais a fila.
   */
  @SubscribeMessage('matchmaking:decline')
  async handleMatchmakingDecline(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;
    const pending = this.pendingMatches.get(data.roomCode);
    if (!pending) return;

    // Verifica se o user esta neste match
    const isInMatch = pending.players.some(p => p.userId === client.userId);
    if (!isInMatch) return;

    if (pending.confirmTimer) clearTimeout(pending.confirmTimer);
    this.pendingMatches.delete(data.roomCode);
    this.matchmakingRooms.delete(data.roomCode);
    this.roomReadyMap.delete(data.roomCode);

    // Notifica todos no match
    for (const player of pending.players) {
      this.sendToUser(player.userId, 'matchmaking:cancelled', {
        reason: player.userId === client.userId
          ? 'Você recusou o match.'
          : 'Um jogador recusou. Voltando para a fila.',
      });
    }
    this.roomSockets.delete(data.roomCode);
    this.roomsService.leaveRoom(pending.players[0]?.userId ?? '', data.roomCode).catch(() => {});

    // Devolve os que NAO recusaram a fila
    const survivors = pending.players.filter(p => p.userId !== client.userId);
    if (survivors.length > 0) {
      this.events.emit('matchmaking.requeue', { players: survivors });
    }
  }

  @SubscribeMessage('lobby:leave_room')
  async handleLeaveRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    this.clearTurnTimer(data.roomCode);

    await this.roomsService.leaveRoom(client.userId, data.roomCode);
    client.roomCode = undefined;

    const roomSet = this.roomSockets.get(data.roomCode);
    if (roomSet) roomSet.delete(client);

    this.broadcastToRoom(data.roomCode, 'lobby:player_left', { userId: client.userId });

    // Se a sala foi deletada do DB (caso unico humano saiu de partida com bots,
    // ou sala vazia), limpa o engine in-memory tambem. Sem isso o engine ficaria
    // zumbi: sala some do lobby mas qualquer requisicao com o codigo ainda
    // retornaria estado de partida.
    const stillExists = await this.roomsService.findByCode(data.roomCode).catch(() => null);
    if (!stillExists) {
      this.roomManager.destroy(data.roomCode);
      this.roomBots.delete(data.roomCode);
      this.roomReadyMap.delete(data.roomCode);
      this.roomSockets.delete(data.roomCode);
    }

    // Fecha sala de matchmaking se não restarem jogadores humanos em WAITING
    if (this.matchmakingRooms.has(data.roomCode)) {
      const room = await this.roomsService.findByCode(data.roomCode).catch(() => null);
      if (!room || room.status !== 'WAITING') {
        this.matchmakingRooms.delete(data.roomCode);
      } else {
        const humanPlayers = room.players.filter((p: any) => !p.isBot);
        if (humanPlayers.length === 0) {
          await this.roomsService.leaveRoom(room.hostId, data.roomCode).catch(() => {});
          this.roomReadyMap.delete(data.roomCode);
          this.matchmakingRooms.delete(data.roomCode);
          this.roomSockets.delete(data.roomCode);
        }
      }
    }
  }

  @SubscribeMessage('lobby:set_ready')
  async handleSetReady(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; ready: boolean }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (engine) {
      engine.setReady(client.userId, data.ready);
    }

    if (!this.roomReadyMap.has(data.roomCode)) this.roomReadyMap.set(data.roomCode, new Set());
    if (data.ready) {
      this.roomReadyMap.get(data.roomCode)!.add(client.userId);
    } else {
      this.roomReadyMap.get(data.roomCode)!.delete(client.userId);
    }

    this.broadcastToRoom(data.roomCode, 'lobby:player_ready', { userId: client.userId, ready: data.ready });

    // Tambem broadcast o array de confirmados para o frontend sincronizar UI
    const readySnapshot = Array.from(this.roomReadyMap.get(data.roomCode) ?? []);
    this.broadcastToRoom(data.roomCode, 'lobby:ready_snapshot', {
      ready: readySnapshot,
    });

    // Auto-start para salas de matchmaking quando todos os humanos confirmam
    if (this.matchmakingRooms.has(data.roomCode)) {
      const room = await this.roomsService.findByCode(data.roomCode).catch(() => null);
      if (room && room.status === 'WAITING') {
        const humanPlayers = room.players.filter((p: any) => !p.isBot);
        const readySet = this.roomReadyMap.get(data.roomCode) ?? new Set<string>();
        const allReady = humanPlayers.length >= 1 && humanPlayers.every((p: any) => readySet.has(p.userId));
        if (allReady) {
          // Delega para completeMatchmakingMatch que respeita pending state (ranked check, etc.)
          this.completeMatchmakingMatch(data.roomCode);
        }
      }
    }
  }

  @SubscribeMessage('lobby:start_game')
  async handleStartGame(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    const room = await this.roomsService.findByCode(data.roomCode);
    if (room.hostId !== client.userId) {
      return this.sendToClient(client, 'lobby:error', { code: 'NOT_HOST', message: 'Only the host can start' });
    }
    if (room.players.length < 2) {
      return this.sendToClient(client, 'lobby:error', { code: 'NOT_ENOUGH_PLAYERS', message: 'Need at least 2 players' });
    }

    const humanPlayers = room.players.filter(p => !p.isBot);
    const readySet = this.roomReadyMap.get(data.roomCode) ?? new Set<string>();
    const notReady = humanPlayers.filter(p => !readySet.has(p.userId));
    if (notReady.length > 0) {
      return this.sendToClient(client, 'lobby:error', {
        code: 'NOT_ALL_READY',
        message: 'Nem todos os jogadores estão prontos',
      });
    }

    this.broadcastToRoom(data.roomCode, 'lobby:game_starting', { countdown: STARTING_COUNTDOWN_MS });

    setTimeout(async () => {
      this.roomReadyMap.delete(data.roomCode);

      // Re-le a sala apos countdown — jogadores podem ter saido durante esses 3s
      const freshRoom = await this.roomsService.findByCode(data.roomCode).catch(() => null);
      if (!freshRoom || freshRoom.status !== 'WAITING' || freshRoom.players.length < 2) {
        return;
      }
      const activePlayers = freshRoom.players;
      if (activePlayers.length < 2) return;

      const engine = this.roomManager.create(data.roomCode, freshRoom.mode as any, freshRoom.handBias ?? 0, freshRoom.initialTokens ?? 2);
      activePlayers.forEach((p: any) => engine.addPlayer(p.userId, p.username, p.avatarIndex, p.seat, { isBot: p.isBot, isGuest: p.isGuest, isAdmin: p.isAdmin, level: p.level, pds: p.pds, sessionWins: p.sessionWins }));

      const bots = new Set<string>(activePlayers.filter((p: any) => p.isBot).map((p: any) => p.userId));
      this.roomBots.set(data.roomCode, bots);

      await this.roomsService.markStarted(data.roomCode);

      const events = engine.startRound();
      this.dispatchEvents(data.roomCode, events);
      this.scheduleBotMoveIfNeeded(data.roomCode, engine);

      // Garante que mesmo se o GameBoard ainda nao montou o listener no
      // cliente, um segundo state_sync chega depois da navegacao e popula
      // a UI. Resolve o caso de "tela vazia ao iniciar" sem precisar de F5.
      const humanUserIds = activePlayers.filter((p: any) => !p.isBot).map((p: any) => p.userId);
      setTimeout(() => {
        const enginePtr = this.roomManager.get(data.roomCode);
        if (!enginePtr) return;
        for (const userId of humanUserIds) {
          const state = enginePtr.getClientStateFor(userId);
          this.sendToUser(userId, 'game:state_sync', { state, spectatorCount: 0, isSpectator: false });
        }
      }, 250);
    }, STARTING_COUNTDOWN_MS);
  }

  @SubscribeMessage('game:request_state')
  handleRequestState(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    client.roomCode = data.roomCode;
    if (!this.roomSockets.has(data.roomCode)) this.roomSockets.set(data.roomCode, new Set());
    this.roomSockets.get(data.roomCode)!.add(client);

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) {
      // Engine nao existe — sala morta (restart do servidor, ja finalizada, etc).
      // Cliente nao deve ficar esperando state_sync indefinidamente.
      this.sendToClient(client, 'game:room_closed', {
        roomCode: data.roomCode,
        reason: 'A partida foi encerrada ou nao esta mais disponivel.',
      });
      return;
    }

    // Usuario nao faz parte da partida — feature de espectador removida.
    if (!engine.hasPlayer(client.userId)) {
      this.sendToClient(client, 'game:error', {
        code: 'NOT_IN_GAME',
        message: 'Você não faz parte desta partida.',
      });
      return;
    }

    const events = engine.setPlayerConnected(client.userId, true);
    this.dispatchEvents(data.roomCode, events);

    const state = engine.getClientStateFor(client.userId);
    this.sendToClient(client, 'game:state_sync', { state, spectatorCount: 0, isSpectator: false });
  }

  @SubscribeMessage('game:play_cards')
  handlePlayCards(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; cardIndices: number[]; plateIndices?: number[] }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyPlayCards(client.userId, data.cardIndices, data.plateIndices);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PLAY', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);

    if (engine.isGameOver()) {
      const gameOverPayload = result.events.find(e => e.type === 'game:game_over')?.payload;
      const rankings = gameOverPayload?.['rankings'] as any[];
      const gameStats = gameOverPayload?.['stats'] as { saborTriggers: number; tricksWon: Record<string, number> } | undefined;
      if (rankings) {
        this.clearTurnTimer(data.roomCode);
        this.roomsService.markFinished(data.roomCode, rankings.map(r => ({
          userId: r.userId,
          placement: r.placement,
          tokensLeft: r.tokensLeft,
        })), gameStats).then(async (rewards) => {
          const updatedRoom = await this.roomsService.findByCode(data.roomCode).catch(() => null);
          if (updatedRoom) {
            this.broadcastToRoom(data.roomCode, 'lobby:game_over_summary', { rankings, room: updatedRoom, rewards });
          }
        }).catch(() => {});
        setTimeout(() => {
          this.roomManager.destroy(data.roomCode);
          this.roomSockets.delete(data.roomCode);
          this.roomBots.delete(data.roomCode);
        }, 300_000);
      }
    }
  }

  @SubscribeMessage('game:pass_turn')
  handlePassTurn(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; insertAtIndex: number }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return;

    const result = engine.applyPassTurn(client.userId, data.insertAtIndex ?? 0);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PICK', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:draw_card')
  handleDrawCard(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyDrawCard(client.userId);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PICK', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:insert_drawn_card')
  handleInsertDrawnCard(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; insertAtIndex: number; action?: 'insert' | 'discard' }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyInsertDrawn(client.userId, data.insertAtIndex ?? 0, data.action ?? 'insert');
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PICK', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:duel_pass_pick')
  handleDuelPassPick(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; plateIndex: number; action: 'insert' | 'discard'; insertAtIndex?: number }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyDuelPassPick(client.userId, data.plateIndex, data.action, data.insertAtIndex ?? 0);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PICK', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:trick_pick')
  handleTrickPick(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; action: 'take' | 'discard'; insertAtIndex?: number }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyTrickPick(client.userId, data.action, data.insertAtIndex ?? 0);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PLAY', message: result.reason });
    }
    this.clearTurnTimer(data.roomCode);

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:market_swap')
  handleMarketSwap(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; handIndex: number; marketIndex: number }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return;

    const result = engine.applyMarketSwap(client.userId, data.handIndex, data.marketIndex);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PLAY', message: result.reason });
    }

    this.dispatchEvents(data.roomCode, result.events);
  }

  @SubscribeMessage('game:send_reaction')
  handleReaction(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; emoji: string }) {
    if (!client.userId) return;
    const now = Date.now();
    const lastReaction = this.reactionCooldowns.get(client.userId) ?? 0;
    if (now - lastReaction < 3000) return;
    this.reactionCooldowns.set(client.userId, now);
    this.broadcastToRoomExcept(data.roomCode, client, 'game:reaction', { userId: client.userId, emoji: data.emoji });
  }

  @SubscribeMessage('lobby:chat_send')
  handleLobbyChatSend(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; text: string }) {
    const userId = client.userId;
    const username = client.username;
    if (!userId || !username) return;
    const now = Date.now();
    const lastMsg = this.chatCooldowns.get(userId) ?? 0;
    if (now - lastMsg < 1500) return;
    this.chatCooldowns.set(userId, now);
    const text = (data.text ?? '').trim().slice(0, 200);
    if (!text) return;
    this.broadcastToRoom(data.roomCode, 'lobby:chat_message', { userId, username, text, ts: now });
  }

  @SubscribeMessage('game:send_message')
  handleMessage(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; text: string }) {
    const userId = client.userId;
    const username = client.username;
    if (!userId || !username) return;
    const now = Date.now();
    const lastMsg = this.chatCooldowns.get(userId) ?? 0;
    if (now - lastMsg < 2000) return;
    this.chatCooldowns.set(userId, now);
    const text = (data.text ?? '').trim().slice(0, 120);
    if (!text) return;
    this.broadcastToRoomExcept(data.roomCode, client, 'game:message', { userId, username, text });
  }

  private scheduleBotMoveIfNeeded(roomCode: string, engine: import('../game/engine/GameEngine.js').GameEngine) {
    if (engine.isGameOver()) return;
    const bots = this.roomBots.get(roomCode);
    if (!bots?.size) return;

    const currentUserId = engine.currentTurnUserId();
    if (!bots.has(currentUserId)) return;

    setTimeout(() => {
      const currentEngine = this.roomManager.get(roomCode);
      if (!currentEngine || currentEngine.isGameOver()) return;
      if (currentEngine.currentTurnUserId() !== currentUserId) return;

      let result: ReturnType<typeof currentEngine.applyPlayCards>;

      try {
        if (currentEngine.getPhase() === 'TRICK_PICK') {
          result = currentEngine.applyTrickPick(currentUserId, 'discard');
        } else if (currentEngine.getPhase() === 'DUEL_PASS_PICK') {
          result = currentEngine.applyDuelPassPick(currentUserId, 0, 'discard');
        } else if (currentEngine.getPhase() === 'PASS_PICK') {
          // Timer already drew a card for the bot — just insert it
          const state = currentEngine.getClientStateFor(currentUserId);
          const insertAt = Math.floor(Math.random() * (state.myHand.length + 1));
          result = currentEngine.applyInsertDrawn(currentUserId, insertAt);
        } else {
          const move = currentEngine.computeBotMove(currentUserId);
          if (move.action === 'play') {
            result = currentEngine.applyPlayCards(currentUserId, move.cardIndices);
          } else {
            result = currentEngine.applyPassTurn(currentUserId, move.insertAtIndex);
          }
        }
      } catch (err) {
        // Engine pode lançar (assert integridade em test) — não deixa
        // derrubar o processo. Loga, força resync no cliente, e tenta
        // de novo no próximo tick.
        console.error(`[bot scheduler] engine threw for room ${roomCode}:`, err);
        try {
          this.broadcastToRoom(roomCode, 'game:state_sync', {
            state: currentEngine.getClientStateFor(currentUserId),
          });
        } catch {}
        return;
      }

      if (result.success) {
        this.dispatchEvents(roomCode, result.events);
        if (currentEngine.isGameOver()) {
          const gameOverPayload = result.events.find(e => e.type === 'game:game_over')?.payload;
          const rankings = gameOverPayload?.['rankings'] as any[];
          const gameStats = gameOverPayload?.['stats'] as { saborTriggers: number; tricksWon: Record<string, number> } | undefined;
          if (rankings) {
            this.clearTurnTimer(roomCode);
            this.roomsService.markFinished(roomCode, rankings.map(r => ({
              userId: r.userId,
              placement: r.placement,
              tokensLeft: r.tokensLeft,
            })), gameStats).then(async (rewards) => {
              const updatedRoom = await this.roomsService.findByCode(roomCode).catch(() => null);
              if (updatedRoom) {
                this.broadcastToRoom(roomCode, 'lobby:game_over_summary', { rankings, room: updatedRoom, rewards });
              }
            }).catch(() => {});
            setTimeout(() => {
              this.roomManager.destroy(roomCode);
              this.roomSockets.delete(roomCode);
              this.roomBots.delete(roomCode);
            }, 300_000);
          }
        } else {
          this.scheduleBotMoveIfNeeded(roomCode, currentEngine);
        }
      }
    }, 900); // bot age rapido; frontend que segura turn_started para visualizar
  }

  private async applyRankedAbandonmentIfNeeded(userId: string, roomCode: string) {
    const engine = this.roomManager.get(roomCode);
    if (engine?.isGameOver()) return; // game already finished, no penalty
    const room = await this.roomsService.findByCode(roomCode).catch(() => null);
    if (!room?.isRanked) return;
    const user = await this.roomsService.getUserForAbandonment(userId);
    if (!user || user.isBot || user.isGuest) return;
    await this.roomsService.applyRankedAbandonment(userId);
  }

  @OnEvent('matchmaking.found')
  async handleMatchmakingFound(payload: { roomCode: string; players: QueueEntry[]; createdByUserId: string; isRanked?: boolean }) {
    const { roomCode, players } = payload;

    if (!this.roomReadyMap.has(roomCode)) {
      this.roomReadyMap.set(roomCode, new Set());
    }

    this.matchmakingRooms.add(roomCode);

    // Detecta se a sala criada e ranqueada (verificacao definitiva via DB)
    const roomRecord = await this.roomsService.findByCode(roomCode).catch(() => null);
    const isRanked = roomRecord?.isRanked === true;

    // QUICK: 20s para aceitar (modelo LoL). RANKED: mantem 120s para nao penalizar.
    const CONFIRM_TIMEOUT_MS = isRanked ? 120_000 : 20_000;

    for (const player of players) {
      try {
        await this.roomsService.joinRoom(player.userId, roomCode);

        const userSocketSet = this.userSockets.get(player.userId);
        if (userSocketSet) {
          for (const sock of userSocketSet) {
            if (!this.roomSockets.has(roomCode)) this.roomSockets.set(roomCode, new Set());
            this.roomSockets.get(roomCode)!.add(sock);
            sock.roomCode = roomCode;
          }
        }
      } catch {
        // Player may have disconnected between match formation and join — skip
      }
    }

    const matchPayload = {
      roomCode,
      isRanked,
      players: players.map(p => ({
        userId: p.userId,
        username: p.username,
        avatarIndex: p.avatarIndex,
        level: p.level,
        pds: p.pds,
      })),
    };

    for (const player of players) {
      this.sendToUser(player.userId, 'matchmaking:match_found', matchPayload);
    }

    // Registra pendingMatch para permitir cancelamento em handleMatchmakingUserDisconnected
    const confirmTimer = setTimeout(() => this.completeMatchmakingMatch(roomCode), CONFIRM_TIMEOUT_MS);
    this.pendingMatches.set(roomCode, { players, isRanked, confirmTimer });
  }

  /**
   * Finaliza o match: preenche com bots (se permitido) e inicia a partida.
   * Chamado quando todos confirmam OU quando o CONFIRM_TIMEOUT expira.
   */
  private async completeMatchmakingMatch(roomCode: string) {
    const pending = this.pendingMatches.get(roomCode);
    if (!pending) return;
    this.pendingMatches.delete(roomCode);
    if (pending.confirmTimer) clearTimeout(pending.confirmTimer);

    const room = await this.roomsService.findByCode(roomCode).catch(() => null);
    if (!room || room.status !== 'WAITING') {
      this.matchmakingRooms.delete(roomCode);
      return;
    }

    const humanPlayers = room.players.filter((p: any) => !p.isBot);
    if (humanPlayers.length < 1) {
      this.matchmakingRooms.delete(roomCode);
      return;
    }

    // Ranqueada exige todos os 4 humanos. Se nao chegou: cancela sala e devolve confirmados a fila.
    if (pending.isRanked && humanPlayers.length < 4) {
      this.cancelRankedMatch(roomCode, pending.players, humanPlayers.map((p: any) => p.userId));
      return;
    }

    // QUICK: exige minimo 2 humanos CONFIRMADOS (ready=true). Quem nao confirmou e removido.
    if (!pending.isRanked) {
      const readySet = this.roomReadyMap.get(roomCode) ?? new Set<string>();
      const confirmedHumans = humanPlayers.filter((p: any) => readySet.has(p.userId));

      if (confirmedHumans.length < 2) {
        // Menos de 2 confirmados — cancela match. Confirmados voltam a fila.
        const confirmedIds = confirmedHumans.map((p: any) => p.userId);
        const survivors = pending.players.filter(p => confirmedIds.includes(p.userId));
        this.matchmakingRooms.delete(roomCode);
        this.roomReadyMap.delete(roomCode);
        // Notifica todos que estavam no match
        for (const player of pending.players) {
          this.sendToUser(player.userId, 'matchmaking:cancelled', {
            reason: confirmedIds.includes(player.userId)
              ? 'Poucos jogadores confirmaram. Voltando para a fila.'
              : 'Match cancelado.',
          });
        }
        this.roomSockets.delete(roomCode);
        this.roomsService.leaveRoom(pending.players[0]?.userId ?? '', roomCode).catch(() => {});
        if (survivors.length > 0) {
          this.events.emit('matchmaking.requeue', { players: survivors });
        }
        return;
      }

      // 2+ confirmaram: remove humanos nao-confirmados da sala (eles perdem o slot)
      const notConfirmed = humanPlayers.filter((p: any) => !readySet.has(p.userId));
      for (const p of notConfirmed) {
        await this.roomsService.leaveRoom(p.userId, roomCode).catch(() => {});
        this.sendToUser(p.userId, 'matchmaking:cancelled', { reason: 'Você não confirmou a tempo.' });
      }
    }

    this.broadcastToRoom(roomCode, 'lobby:game_starting', { countdown: STARTING_COUNTDOWN_MS });

    setTimeout(async () => {
      let freshRoom = await this.roomsService.findByCode(roomCode).catch(() => null);
      if (!freshRoom || freshRoom.status !== 'WAITING') {
        this.matchmakingRooms.delete(roomCode);
        return;
      }

      // QUICK pode preencher com bots; RANKED nao (bloqueado no fillWithBots)
      await this.roomsService.fillWithBots(roomCode);
      freshRoom = await this.roomsService.findByCode(roomCode).catch(() => null);
      if (!freshRoom || freshRoom.status !== 'WAITING') {
        this.matchmakingRooms.delete(roomCode);
        return;
      }

      this.roomReadyMap.delete(roomCode);
      this.matchmakingRooms.delete(roomCode);

      const engine = this.roomManager.create(roomCode, freshRoom.mode as any, freshRoom.handBias ?? 0, freshRoom.initialTokens ?? 2);
      freshRoom.players.forEach((p: any) => engine.addPlayer(p.userId, p.username, p.avatarIndex, p.seat, { isBot: p.isBot, isGuest: p.isGuest, isAdmin: p.isAdmin, level: p.level, pds: p.pds, sessionWins: p.sessionWins }));

      const bots = new Set<string>(freshRoom.players.filter((p: any) => p.isBot).map((p: any) => p.userId));
      this.roomBots.set(roomCode, bots);

      await this.roomsService.markStarted(roomCode);

      const events = engine.startRound();
      this.dispatchEvents(roomCode, events);
      this.scheduleBotMoveIfNeeded(roomCode, engine);
    }, STARTING_COUNTDOWN_MS);
  }

  /**
   * Cancela um match ranqueado em formacao: encerra a sala, notifica os jogadores
   * e devolve `survivors` (humanos ainda conectados) para a fila ranked.
   */
  private cancelRankedMatch(roomCode: string, originalPlayers: QueueEntry[], survivorUserIds: string[]) {
    this.matchmakingRooms.delete(roomCode);
    this.roomReadyMap.delete(roomCode);
    this.clearTurnTimer(roomCode);

    // Notifica jogadores sobreviventes que o match foi cancelado e que voltam a fila
    const survivorSet = new Set(survivorUserIds);
    for (const player of originalPlayers) {
      if (survivorSet.has(player.userId)) {
        this.sendToUser(player.userId, 'matchmaking:cancelled', {
          reason: 'Um jogador saiu antes de confirmar. Voltando para a fila ranqueada.',
        });
      }
    }

    // Limpa sockets registrados na sala
    this.roomSockets.delete(roomCode);

    // Tenta apagar a sala do DB
    this.roomsService.leaveRoom(originalPlayers[0]?.userId ?? '', roomCode).catch(() => {});

    // Devolve sobreviventes a fila ranked
    const survivors = originalPlayers.filter(p => survivorSet.has(p.userId));
    if (survivors.length > 0) {
      this.events.emit('matchmaking.requeue', { players: survivors });
    }
  }

  @OnEvent('matchmaking.user_disconnected')
  handleMatchmakingUserDisconnected(payload: { userId: string }) {
    // Procura matches pendentes que incluem esse user e cancela se necessario
    for (const [roomCode, pending] of this.pendingMatches.entries()) {
      const isInMatch = pending.players.some(p => p.userId === payload.userId);
      if (!isInMatch) continue;

      // Verifica se o user tem outros sockets ativos — pode estar em outra aba
      const otherSockets = this.userSockets.get(payload.userId);
      if (otherSockets && otherSockets.size > 0) continue;

      // Em ranked: cancela imediatamente
      if (pending.isRanked) {
        if (pending.confirmTimer) clearTimeout(pending.confirmTimer);
        this.pendingMatches.delete(roomCode);
        const survivors = pending.players
          .filter(p => p.userId !== payload.userId)
          .filter(p => {
            const s = this.userSockets.get(p.userId);
            return s && s.size > 0;
          })
          .map(p => p.userId);
        this.cancelRankedMatch(roomCode, pending.players, survivors);
      }
      // Em QUICK: deixa o timeout cuidar (bots preenchem)
    }
  }

  @OnEvent('rooms.lobby.changed')
  broadcastLobbyRoomChanged({ roomCode, room }: { roomCode: string; room: unknown }) {
    this.broadcastToRoom(roomCode, 'lobby:room_updated', { room });
  }

  @OnEvent('rooms.public.changed')
  broadcastPublicRoomsChanged() {
    const msg = JSON.stringify({ event: 'lobby:public_rooms_changed', data: {} });
    this.server.clients.forEach((ws: AuthenticatedSocket) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  /**
   * Admin removeu um jogador da sala. Notifica o cliente alvo, encerra a
   * conexao para que o GameBoard receba o close e redirecione, e limpa o
   * engine in-memory se a sala ainda existir.
   */
  @OnEvent('admin.kicked')
  handleAdminKicked({ roomCode, userId }: { roomCode: string; userId: string }) {
    this.clearTurnTimer(roomCode);
    // Notifica todos da sala que esse player saiu (atualizar UI)
    this.broadcastToRoom(roomCode, 'lobby:player_left', { userId, reason: 'kicked' });
    // Acha o socket do usuario kickado, manda evento direcionado e fecha
    const sockets = this.roomSockets.get(roomCode);
    if (sockets) {
      sockets.forEach((client) => {
        if (client.userId === userId) {
          this.sendToClient(client, 'admin:kicked', { roomCode, message: 'Você foi removido da sala pelo admin.' });
          // Pequeno delay pra mensagem chegar antes de fechar a conexao
          setTimeout(() => {
            try { client.close(1000, 'kicked-by-admin'); } catch { /* noop */ }
          }, 200);
          sockets.delete(client);
        }
      });
    }
  }

  private dispatchEvents(roomCode: string, events: EngineEvent[]) {
    for (const event of events) {
      if (event.targetUserId) {
        this.sendToUser(event.targetUserId, event.type, event.payload);
      } else {
        this.broadcastToRoom(roomCode, event.type, event.payload);
      }

      // Arm turn timer whenever a new turn starts or a pick dialog is offered
      if (event.type === 'game:turn_started') {
        const { userId, timeoutMs } = event.payload as { userId: string; timeoutMs: number };
        this.armTurnTimer(roomCode, userId, timeoutMs);

        // Reemite a mao autoritativa do jogador da vez. Garante que mesmo se
        // o cliente perdeu algum your_hand anterior, ao virar a vez dele a
        // mao reflete o estado real do engine — sem janela de mao stale.
        const engineForHand = this.roomManager.get(roomCode);
        if (engineForHand) {
          const handState = engineForHand.getClientStateFor(userId);
          this.sendToUser(userId, 'game:your_hand', { hand: handState.myHand });
        }
      } else if (
        event.type === 'game:trick_pick_offer' ||
        event.type === 'game:duel_pass_offer' ||
        event.type === 'game:card_drawn'
      ) {
        // Pick dialogs/draw nao tem turn_started — arma timer para AFK nao travar o jogo
        const userId = event.targetUserId!;
        this.armTurnTimer(roomCode, userId, 30_000);

        // Heartbeat em TRICK_PICK: 10s apos abrir o dialog, faz broadcast ao
        // restante da sala com a fase atual. Garante resync mesmo se algum
        // cliente tiver perdido o cards_played com nextPhase=TRICK_PICK.
        if (event.type === 'game:trick_pick_offer') {
          const phaseRoomCode = roomCode;
          const phaseUserId = userId;
          setTimeout(() => {
            const eng = this.roomManager.get(phaseRoomCode);
            if (!eng) return;
            if (eng.getPhase() !== 'TRICK_PICK') return;
            if (eng.currentTurnUserId() !== phaseUserId) return;
            this.broadcastToRoom(phaseRoomCode, 'game:phase_heartbeat', {
              phase: 'TRICK_PICK',
              currentTurnUserId: phaseUserId,
            });
          }, 10_000);
        }
      }
    }
  }

  private armTurnTimer(roomCode: string, userId: string, timeoutMs: number) {
    // Cancel any previous timer for this room
    const prev = this.turnTimers.get(roomCode);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      this.turnTimers.delete(roomCode);
      const engine = this.roomManager.get(roomCode);
      if (!engine || engine.isGameOver()) return;
      if (engine.currentTurnUserId() !== userId) return; // turn already advanced

      // Auto-pass: handle TRICK_PICK, PASS_PICK, DUEL_PASS_PICK e turno normal
      let result: ReturnType<typeof engine.applyDrawCard>;
      if (engine.getPhase() === 'TRICK_PICK') {
        result = engine.applyTrickPick(userId, 'discard');
      } else if (engine.getPhase() === 'DUEL_PASS_PICK') {
        result = engine.applyDuelPassPick(userId, 0, 'discard');
      } else if (engine.getPhase() === 'PASS_PICK') {
        const state = engine.getClientStateFor(userId);
        const insertAt = Math.floor(Math.random() * (state.myHand.length + 1));
        result = engine.applyInsertDrawn(userId, insertAt);
      } else {
        result = engine.applyDrawCard(userId);
        if (result.success && engine.getPhase() === 'PASS_PICK') {
          const state = engine.getClientStateFor(userId);
          const insertAt = Math.floor(Math.random() * (state.myHand.length + 1));
          result = engine.applyInsertDrawn(userId, insertAt);
        } else if (!result.success) {
          result = engine.applyPassTurn(userId, 0);
        }
      }

      if (result.success) {
        this.dispatchEvents(roomCode, result.events);
        this.scheduleBotMoveIfNeeded(roomCode, engine);
        if (engine.isGameOver()) {
          const gameOverPayload = result.events.find(e => e.type === 'game:game_over')?.payload;
          const rankings = gameOverPayload?.['rankings'] as any[];
          const gameStats = gameOverPayload?.['stats'] as { saborTriggers: number; tricksWon: Record<string, number> } | undefined;
          if (rankings) {
            this.roomsService.markFinished(roomCode, rankings.map(r => ({ userId: r.userId, placement: r.placement, tokensLeft: r.tokensLeft })), gameStats).then(async (rewards) => {
              const updatedRoom = await this.roomsService.findByCode(roomCode).catch(() => null);
              if (updatedRoom) {
                this.broadcastToRoom(roomCode, 'lobby:game_over_summary', { rankings, room: updatedRoom, rewards });
              }
            }).catch(() => {});
            setTimeout(() => {
              this.roomManager.destroy(roomCode);
              this.roomSockets.delete(roomCode);
              this.roomBots.delete(roomCode);
            }, 300_000);
          }
        }
      }
    }, timeoutMs + 500); // small grace buffer

    this.turnTimers.set(roomCode, timer);
  }

  private clearTurnTimer(roomCode: string) {
    const t = this.turnTimers.get(roomCode);
    if (t) { clearTimeout(t); this.turnTimers.delete(roomCode); }
  }

  private broadcastToRoomExcept(roomCode: string, excludeClient: AuthenticatedSocket, event: string, payload: unknown) {
    const sockets = this.roomSockets.get(roomCode);
    if (!sockets) return;
    const msg = JSON.stringify({ event, data: payload });
    sockets.forEach(ws => {
      if (ws !== excludeClient && ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  private broadcastToRoom(roomCode: string, event: string, payload: unknown) {
    const sockets = this.roomSockets.get(roomCode);
    if (!sockets) return;
    const msg = JSON.stringify({ event, data: payload });
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  private sendToUser(userId: string, event: string, payload: unknown) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    const msg = JSON.stringify({ event, data: payload });
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  private sendToClient(client: AuthenticatedSocket, event: string, payload: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data: payload }));
    }
  }
}
