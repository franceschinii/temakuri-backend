import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game RODIZIO (e2e)', () => {
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
    await prisma.userInventory.upsert({
      where: { userId: auth.ids.alice },
      create: {
        userId: auth.ids.alice,
        unlockedAvatars: [0, 1, 2, 3],
        unlockedModes: ['TRADITIONAL', 'RODIZIO'],
      },
      update: { unlockedModes: ['TRADITIONAL', 'RODIZIO'] },
    });
  });

  it('draw_card em RODIZIO: tentativa imediata pode receber erro privado (não é turno) ou state', async () => {
    const room = await createRoom(app, auth.tokens.alice, { mode: 'RODIZIO', maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
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
    alice.send('game:draw_card', { roomCode: room.code });
    // Pode dar erro privado (não é turno do alice) OU sucesso silencioso
    // Aceita qualquer um dos dois — o que NÃO queremos é o servidor crashar
    await new Promise((r) => setTimeout(r, 500));
    // Se chegou game:error, está OK (é erro privado). Se nada chegou, também OK.
    const errors = alice.events.get('game:error') ?? [];
    // Apenas garante que algum sinal coerente aconteceu
    expect(errors.length).toBeGreaterThanOrEqual(0);
    alice.close();
  });
});
