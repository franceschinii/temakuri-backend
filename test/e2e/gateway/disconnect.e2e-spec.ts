import { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

/**
 * Connects a raw WebSocket and returns the close code.
 * The server closes the socket with code 4001 when auth fails.
 */
function connectAndGetCloseCode(url: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const sep = url.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${url}${sep}token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('connectAndGetCloseCode: timed out waiting for close'));
    }, 5000);
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

jest.setTimeout(30000);

describe('Gateway — Disconnect/Reconnect (e2e)', () => {
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

  it('reconexão: novo socket recebe state via game:request_state', async () => {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);

    const first = new TestWsClient({ defaultTimeoutMs: 10000 });
    await first.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(first, room.code);
    await first.waitFor('lobby:room_updated', 3000);
    setReadyWs(first, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(first, room.code);
    await first.waitFor('game:turn_started', 5000);
    first.close();

    await new Promise((r) => setTimeout(r, 200));

    const second = new TestWsClient({ defaultTimeoutMs: 5000 });
    await second.connect(wsUrl, auth.tokens.alice);
    // game:request_state registers the socket in roomSockets internally
    second.send('game:request_state', { roomCode: room.code });
    // Payload shape: { state: ClientGameState }
    const stateEvent = await second.waitFor<any>('game:state_sync', 5000);
    expect(stateEvent).toBeDefined();
    const hand = stateEvent.state?.myHand ?? stateEvent.myHand;
    expect(Array.isArray(hand)).toBe(true);
    second.close();
  });

  it('conexão sem token é recusada com código 4001', async () => {
    const closeCode = await connectAndGetCloseCode(wsUrl, '');
    expect(closeCode).toBe(4001);
  });

  it('conexão com token inválido é recusada com código 4001', async () => {
    const closeCode = await connectAndGetCloseCode(wsUrl, 'not-a-valid-jwt');
    expect(closeCode).toBe(4001);
  });
});
