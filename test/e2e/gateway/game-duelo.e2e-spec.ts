import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game Duelo 2P (e2e)', () => {
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

  it('duel_pass_pick fora de fase recebe erro privado', async () => {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 2 });
    await addBot(app, auth.tokens.alice, room.code);
    const alice = new TestWsClient({ defaultTimeoutMs: 10000 });
    await alice.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(alice, room.code);
    await alice.waitFor('lobby:room_updated', 3000);
    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(alice, room.code);
    await alice.waitFor('game:turn_started', 5000);
    alice.clearEvents();
    // Tenta duel_pass_pick sem estar na fase DUEL_PASS_PICK → erro privado
    alice.send('game:duel_pass_pick', {
      roomCode: room.code,
      plateIndex: 0,
      action: 'insert',
      insertAtIndex: 0,
    });
    const err = await alice.waitFor('game:error', 3000);
    expect(err).toBeDefined();
    alice.close();
  });
});
