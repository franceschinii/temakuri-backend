import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Ranked (e2e)', () => {
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
    await prisma.user.update({
      where: { id: auth.ids.alice },
      data: { level: 10 },
    });
  });

  it('jogo ranked atualiza RankedStats e pds no GAME_OVER', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
      isRanked: true,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.isRanked).toBe(true);
    expect(room?.status).toBe('FINISHED');

    const results = await prisma.gameResult.findMany({ where: { roomId: room!.id } });
    // Apenas humano persistido; isRanked deve ser true no row do alice
    const aliceResult = results.find((r) => r.userId === auth.ids.alice);
    expect(aliceResult?.isRanked).toBe(true);

    const ranked = await prisma.rankedStats.findUnique({
      where: { userId: auth.ids.alice },
    });
    expect(ranked).not.toBeNull();
    expect((ranked?.rankedWins ?? 0) + (ranked?.rankedLosses ?? 0)).toBeGreaterThanOrEqual(1);

    client.close();
  });
});
