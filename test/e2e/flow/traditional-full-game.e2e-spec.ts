import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — TRADITIONAL full game (e2e)', () => {
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

  it('partida 4P TRADITIONAL roda até GAME_OVER e persiste Room+GameResult', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);
    const placements = summary.rankings.map((r) => r.placement).sort();
    expect(placements).toEqual([1, 2, 3, 4]);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.status).toBe('FINISHED');
    expect(room?.endedAt).not.toBeNull();

    // Only real (non-bot, non-guest) players have GameResult rows persisted.
    // This game has 1 real player (alice) + 3 bots, so only 1 row is expected.
    const results = await prisma.gameResult.findMany({ where: { roomId: room!.id } });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const aliceResult = results.find((r) => r.userId === auth.ids.alice);
    expect(aliceResult).toBeDefined();
    expect(aliceResult!.placement).toBeGreaterThanOrEqual(1);
    expect(aliceResult!.placement).toBeLessThanOrEqual(4);

    const winner = summary.rankings.find((r) => r.placement === 1)!;
    const winnerReward = summary.rewards[winner.userId];
    if (winnerReward) {
      expect(winnerReward.xpEarned).toBeGreaterThanOrEqual(0);
      expect(winnerReward.coinsEarned).toBeGreaterThanOrEqual(0);
    }

    const aliceStats = await prisma.userStats.findUnique({
      where: { userId: auth.ids.alice },
    });
    expect(aliceStats?.gamesPlayed).toBeGreaterThanOrEqual(1);

    client.close();
  });
});
