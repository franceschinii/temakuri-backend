import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — MERCADO full game (e2e)', () => {
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
    // Unlock MERCADO no inventory do alice
    await prisma.userInventory.upsert({
      where: { userId: auth.ids.alice },
      create: {
        userId: auth.ids.alice,
        unlockedAvatars: [0, 1, 2, 3],
        unlockedModes: ['TRADITIONAL', 'MERCADO'],
      },
      update: { unlockedModes: ['TRADITIONAL', 'MERCADO'] },
    });
  });

  it('partida MERCADO 4P roda até GAME_OVER e persiste com mode correto', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'MERCADO',
      maxPlayers: 4,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.mode).toBe('MERCADO');
    expect(room?.status).toBe('FINISHED');

    client.close();
  });
});
