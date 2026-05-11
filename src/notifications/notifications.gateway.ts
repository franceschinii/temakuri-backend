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
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoomManager } from '../game/room-manager.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { EngineEvent } from '../game/engine/GameEngine.js';
import { WS_HEARTBEAT_INTERVAL, STARTING_COUNTDOWN_MS } from '../common/constants/game.constants.js';

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
  private roomSockets = new Map<string, Set<AuthenticatedSocket>>();
  private roomBots = new Map<string, Set<string>>(); // roomCode → Set<botUserId>
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private roomManager: RoomManager,
    private roomsService: RoomsService,
  ) {}

  afterInit() {
    this.heartbeatInterval = setInterval(() => {
      this.server.clients.forEach((ws: AuthenticatedSocket) => {
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
      });
    }, WS_HEARTBEAT_INTERVAL);
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
      client.userId = payload.sub;
      client.username = payload.username;

      if (!this.userSockets.has(client.userId)) {
        this.userSockets.set(client.userId, new Set());
      }
      this.userSockets.get(client.userId)!.add(client);
    } catch {
      client.close(4001, 'Invalid token');
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;

    const userSet = this.userSockets.get(client.userId);
    if (userSet) {
      userSet.delete(client);
      if (userSet.size === 0) this.userSockets.delete(client.userId);
    }

    if (client.roomCode) {
      const roomSet = this.roomSockets.get(client.roomCode);
      if (roomSet) {
        roomSet.delete(client);
        if (roomSet.size === 0) this.roomSockets.delete(client.roomCode);
      }

      const engine = this.roomManager.get(client.roomCode);
      if (engine) {
        const events = engine.setPlayerConnected(client.userId, false);
        this.dispatchEvents(client.roomCode, events);
      }
    }
  }

  @SubscribeMessage('lobby:join_room')
  async handleJoinRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) throw new WsException('Unauthorized');

    try {
      const room = await this.roomsService.joinRoom(client.userId, data.roomCode);
      client.roomCode = data.roomCode;

      if (!this.roomSockets.has(data.roomCode)) {
        this.roomSockets.set(data.roomCode, new Set());
      }
      this.roomSockets.get(data.roomCode)!.add(client);

      this.broadcastToRoom(data.roomCode, 'lobby:room_updated', { room });
    } catch (e: any) {
      this.sendToClient(client, 'lobby:error', { code: 'ROOM_NOT_FOUND', message: e.message });
    }
  }

  @SubscribeMessage('lobby:leave_room')
  async handleLeaveRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    await this.roomsService.leaveRoom(client.userId, data.roomCode);
    client.roomCode = undefined;

    const roomSet = this.roomSockets.get(data.roomCode);
    if (roomSet) roomSet.delete(client);

    this.broadcastToRoom(data.roomCode, 'lobby:player_left', { userId: client.userId });
  }

  @SubscribeMessage('lobby:set_ready')
  handleSetReady(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; ready: boolean }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (engine) {
      engine.setReady(client.userId, data.ready);
    }

    this.broadcastToRoom(data.roomCode, 'lobby:player_ready', { userId: client.userId, ready: data.ready });
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

    this.broadcastToRoom(data.roomCode, 'lobby:game_starting', { countdown: STARTING_COUNTDOWN_MS });

    setTimeout(async () => {
      const engine = this.roomManager.create(data.roomCode, room.mode as any);
      room.players.forEach(p => engine.addPlayer(p.userId, p.username, p.avatarIndex, p.seat));

      const bots = new Set(room.players.filter(p => p.isBot).map(p => p.userId));
      this.roomBots.set(data.roomCode, bots);

      await this.roomsService.markStarted(data.roomCode);

      const events = engine.startRound();
      this.dispatchEvents(data.roomCode, events);
      this.scheduleBotMoveIfNeeded(data.roomCode, engine);
    }, STARTING_COUNTDOWN_MS);
  }

  @SubscribeMessage('game:request_state')
  handleRequestState(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string }) {
    if (!client.userId) return;

    client.roomCode = data.roomCode;
    if (!this.roomSockets.has(data.roomCode)) this.roomSockets.set(data.roomCode, new Set());
    this.roomSockets.get(data.roomCode)!.add(client);

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return;

    const events = engine.setPlayerConnected(client.userId, true);
    this.dispatchEvents(data.roomCode, events);

    const state = engine.getClientStateFor(client.userId);
    this.sendToClient(client, 'game:state_sync', { state });
  }

  @SubscribeMessage('game:play_cards')
  handlePlayCards(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; cardIndices: number[] }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyPlayCards(client.userId, data.cardIndices);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PLAY', message: result.reason });
    }

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);

    if (engine.isGameOver()) {
      const rankings = result.events.find(e => e.type === 'game:game_over')?.payload?.['rankings'] as any[];
      if (rankings) {
        this.roomsService.markFinished(data.roomCode, rankings.map(r => ({
          userId: r.userId,
          placement: r.placement,
          tokensLeft: r.tokensLeft,
        })));
        setTimeout(() => this.roomManager.destroy(data.roomCode), 60_000);
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

    this.dispatchEvents(data.roomCode, result.events);
    this.scheduleBotMoveIfNeeded(data.roomCode, engine);
  }

  @SubscribeMessage('game:insert_drawn_card')
  handleInsertDrawnCard(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { roomCode: string; insertAtIndex: number }) {
    if (!client.userId) return;

    const engine = this.roomManager.get(data.roomCode);
    if (!engine) return this.sendToClient(client, 'game:error', { code: 'ROOM_NOT_FOUND', message: 'Game not found' });

    const result = engine.applyInsertDrawn(client.userId, data.insertAtIndex ?? 0);
    if (!result.success) {
      return this.sendToClient(client, 'game:error', { code: 'INVALID_PICK', message: result.reason });
    }

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
    this.broadcastToRoom(data.roomCode, 'game:reaction', { userId: client.userId, emoji: data.emoji });
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

      const move = currentEngine.computeBotMove(currentUserId);
      let result: ReturnType<typeof currentEngine.applyPlayCards>;

      if (move.action === 'play') {
        result = currentEngine.applyPlayCards(currentUserId, move.cardIndices);
      } else {
        result = currentEngine.applyPassTurn(currentUserId, move.insertAtIndex);
      }

      if (result.success) {
        this.dispatchEvents(roomCode, result.events);
        if (currentEngine.isGameOver()) {
          const rankings = result.events.find(e => e.type === 'game:game_over')?.payload?.['rankings'] as any[];
          if (rankings) {
            this.roomsService.markFinished(roomCode, rankings.map(r => ({
              userId: r.userId,
              placement: r.placement,
              tokensLeft: r.tokensLeft,
            })));
            setTimeout(() => this.roomManager.destroy(roomCode), 60_000);
          }
        } else {
          this.scheduleBotMoveIfNeeded(roomCode, currentEngine);
        }
      }
    }, 900);
  }

  @OnEvent('rooms.public.changed')
  broadcastPublicRoomsChanged() {
    const msg = JSON.stringify({ event: 'lobby:public_rooms_changed', data: {} });
    this.server.clients.forEach((ws: AuthenticatedSocket) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }

  private dispatchEvents(roomCode: string, events: EngineEvent[]) {
    for (const event of events) {
      if (event.targetUserId) {
        this.sendToUser(event.targetUserId, event.type, event.payload);
      } else {
        this.broadcastToRoom(roomCode, event.type, event.payload);
      }
    }
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
