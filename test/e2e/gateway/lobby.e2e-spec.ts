import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import {
  joinRoomWs,
  setReadyWs,
  startGameWs,
  leaveRoomWs,
  resetRoomWs,
} from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Gateway — Lobby (e2e)', () => {
  let app: INestApplication;
  let wsUrl: string;
  let prisma: PrismaService;
  let auth: AuthBundle;

  beforeAll(async () => {
    const result = await createListeningTestApp();
    app = result.app;
    wsUrl = result.wsUrl;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    auth = await registerAndLogin(app, ['alice', 'bob']);
  });

  describe('lobby:join_room', () => {
    it('cliente recebe lobby:room_updated ao entrar na sala', async () => {
      const room = await createRoom(app, auth.tokens.alice, {});
      const client = new TestWsClient();
      await client.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(client, room.code);
      const state = await client.waitFor('lobby:room_updated', 3000);
      expect(state).toBeDefined();
      expect(state.room).toBeDefined();
      client.close();
    });

    it('sala inexistente: cliente recebe lobby:error', async () => {
      const client = new TestWsClient();
      await client.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(client, 'INEXIS');
      const err = await client.waitFor('lobby:error', 3000);
      expect(err).toBeDefined();
      expect(err.code).toBe('ROOM_NOT_FOUND');
      client.close();
    });
  });

  describe('lobby:set_ready', () => {
    it('player ready=true → outros clientes recebem lobby:player_ready', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      const bob = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(alice, room.code);
      await alice.waitFor('lobby:room_updated', 3000);
      joinRoomWs(bob, room.code);
      await bob.waitFor('lobby:room_updated', 3000);
      alice.clearEvents();
      bob.clearEvents();
      setReadyWs(alice, room.code, true);
      const readyEvt = await bob.waitFor<any>('lobby:player_ready', 3000);
      expect(readyEvt.userId).toBe(auth.ids.alice);
      expect(readyEvt.ready).toBe(true);
      alice.close();
      bob.close();
    });
  });

  describe('lobby:start_game', () => {
    it('host inicia com todos ready → recebe game:turn_started após o início', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      await addBot(app, auth.tokens.alice, room.code);
      await addBot(app, auth.tokens.alice, room.code);
      await addBot(app, auth.tokens.alice, room.code);
      const alice = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(alice, room.code);
      await alice.waitFor('lobby:room_updated', 3000);
      setReadyWs(alice, room.code, true);
      await new Promise((r) => setTimeout(r, 100));
      startGameWs(alice, room.code);
      // game:turn_started is broadcast to room after startRound()
      const turnEvt = await alice.waitFor<any>('game:turn_started', 5000);
      expect(turnEvt).toBeDefined();
      expect(turnEvt.userId).toBeDefined();
      alice.close();
    });

    it('não-host tentando start recebe lobby:error', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const bob = new TestWsClient();
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(bob, room.code);
      await bob.waitFor('lobby:room_updated', 3000);
      startGameWs(bob, room.code);
      const err = await bob.waitFor<any>('lobby:error', 3000);
      expect(err).toBeDefined();
      expect(err.code).toBe('NOT_HOST');
      bob.close();
    });
  });

  describe('lobby:leave_room', () => {
    it('cliente sai → host recebe lobby:player_left com userId do sainte', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      const bob = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(alice, room.code);
      await alice.waitFor('lobby:room_updated', 3000);
      joinRoomWs(bob, room.code);
      await bob.waitFor('lobby:room_updated', 3000);
      alice.clearEvents();
      leaveRoomWs(bob, room.code);
      const leftEvt = await alice.waitFor<any>('lobby:player_left', 3000);
      expect(leftEvt.userId).toBe(auth.ids.bob);
      alice.close();
      bob.close();
    });
  });

  describe('lobby:reset_room', () => {
    it('reset não dispara lobby:error para o host', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(alice, room.code);
      await alice.waitFor('lobby:room_updated', 3000);
      alice.clearEvents();
      resetRoomWs(alice, room.code);
      await new Promise((r) => setTimeout(r, 500));
      // Reset deve broadcastar lobby:room_updated sem gerar lobby:error
      expect(alice.events.get('lobby:error') ?? []).toHaveLength(0);
      const updated = await alice.waitFor<any>('lobby:room_updated', 3000);
      expect(updated.room).toBeDefined();
      alice.close();
    });
  });
});
