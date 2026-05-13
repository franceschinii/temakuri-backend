import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game TRADITIONAL (e2e)', () => {
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
    auth = await registerAndLogin(app, ['alice']);
  });

  /**
   * Creates a TRADITIONAL room with 3 bots, connects alice, joins,
   * marks ready, starts and waits until game:turn_started arrives.
   * Returns alice's WsClient and the roomCode.
   */
  async function setupGameWithBots(): Promise<{ alice: TestWsClient; roomCode: string }> {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4, mode: 'TRADITIONAL' });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);

    const alice = new TestWsClient({ defaultTimeoutMs: 8000 });
    await alice.connect(wsUrl, auth.tokens.alice);

    joinRoomWs(alice, room.code);
    await alice.waitFor('lobby:room_updated', 3000);

    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));

    startGameWs(alice, room.code);
    // game:turn_started is broadcast to the room after engine.startRound()
    await alice.waitFor('game:turn_started', 5000);

    return { alice, roomCode: room.code };
  }

  describe('game:request_state', () => {
    it('retorna game:state_sync privado com myHand populada', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      alice.clearEvents();

      alice.send('game:request_state', { roomCode });

      // The gateway sends { event: 'game:state_sync', data: { state: { myHand, ... } } }
      // ws-client stores data = { state: {...} }, so the predicate receives { state }
      const payload = await alice.waitForState<{ state: { myHand: unknown[] } }>(
        (s) => Array.isArray((s as any).state?.myHand) && (s as any).state.myHand.length > 0,
        5000,
      );
      expect((payload as any).state.myHand.length).toBeGreaterThan(0);
      alice.close();
    });
  });

  describe('game:play_cards', () => {
    it('índices fora do range recebem game:error privado', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      alice.clearEvents();

      alice.send('game:play_cards', { roomCode, cardIndices: [999] });

      const err = await alice.waitFor<{ code: string; message: string }>('game:error', 3000);
      expect(err).toBeDefined();
      expect(err.code).toBe('INVALID_PLAY');
      alice.close();
    });
  });

  describe('game:send_reaction', () => {
    it('envia reação sem disparar game:error privado', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      alice.clearEvents();

      // game:send_reaction broadcasts game:reaction to all sockets *except* the sender,
      // so alice (the only human) will NOT receive it back. We just assert no error.
      alice.send('game:send_reaction', { roomCode, emoji: '🍣' });
      await new Promise((r) => setTimeout(r, 400));

      expect(alice.events.get('game:error') ?? []).toHaveLength(0);
      alice.close();
    });
  });

  describe('game:send_message', () => {
    it('envia mensagem sem disparar game:error privado', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      alice.clearEvents();

      // game:send_message broadcasts game:message to all sockets *except* the sender,
      // so alice (the only human) will NOT receive it back. We just assert no error.
      alice.send('game:send_message', { roomCode, text: 'oi pessoal' });
      await new Promise((r) => setTimeout(r, 400));

      expect(alice.events.get('game:error') ?? []).toHaveLength(0);
      alice.close();
    });
  });
});
