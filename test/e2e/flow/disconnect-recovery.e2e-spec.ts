import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots } from '../helpers/game-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Disconnect recovery (e2e)', () => {
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

  it('humano desconecta mid-game; jogo termina via bots; reconexão recebe lobby update', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
    });
    // Espera um turno andar pra ter certeza que jogo está em curso
    await new Promise((r) => setTimeout(r, 500));
    client.close();

    // Poll DB até Room.status === 'FINISHED' (timeout 30s)
    const startTime = Date.now();
    let room = await prisma.room.findUnique({ where: { code: roomCode } });
    while (room?.status !== 'FINISHED' && Date.now() - startTime < 30000) {
      await new Promise((r) => setTimeout(r, 200));
      room = await prisma.room.findUnique({ where: { code: roomCode } });
    }
    expect(room?.status).toBe('FINISHED');

    // Reconecta com novo socket
    const second = new TestWsClient({ defaultTimeoutMs: 5000 });
    await second.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(second, roomCode);
    // Recebe lobby:room_updated com estado pós-game
    const update = await second.waitFor<any>('lobby:room_updated', 3000).catch(() => null);
    expect(update).toBeTruthy();
    second.close();
  });
});
