import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(90000);

describe('Flow — Concurrent rooms (e2e)', () => {
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

  it('duas salas paralelas (hosts diferentes) terminam independentemente', async () => {
    const [aliceGame, bobGame] = await Promise.all([
      startGameWithBots(app, wsUrl, auth.tokens.alice, {
        mode: 'TRADITIONAL',
        maxPlayers: 4,
      }),
      startGameWithBots(app, wsUrl, auth.tokens.bob, {
        mode: 'TRADITIONAL',
        maxPlayers: 4,
      }),
    ]);

    expect(aliceGame.roomCode).not.toBe(bobGame.roomCode);

    const [aliceSummary, bobSummary] = await Promise.all([
      awaitGameOverSummary(aliceGame.client, 60000),
      awaitGameOverSummary(bobGame.client, 60000),
    ]);

    expect(aliceSummary.rankings).toHaveLength(4);
    expect(bobSummary.rankings).toHaveLength(4);

    const aliceRoom = await prisma.room.findUnique({ where: { code: aliceGame.roomCode } });
    const bobRoom = await prisma.room.findUnique({ where: { code: bobGame.roomCode } });
    expect(aliceRoom?.status).toBe('FINISHED');
    expect(bobRoom?.status).toBe('FINISHED');
    expect(aliceRoom?.id).not.toBe(bobRoom?.id);

    aliceGame.client.close();
    bobGame.client.close();
  });
});
