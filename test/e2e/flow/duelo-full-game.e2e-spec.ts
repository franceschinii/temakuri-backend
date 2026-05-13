import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Duelo 2P full game (e2e)', () => {
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

  it('partida 2P (Duelo) roda até GAME_OVER e persiste maxPlayers=2', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 2,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(2);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.maxPlayers).toBe(2);
    expect(room?.status).toBe('FINISHED');

    client.close();
  });
});
