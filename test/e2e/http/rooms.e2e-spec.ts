import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import {
  createRoom,
  addBot,
  removeBot,
  resetRoom,
  listRooms,
  getRoom,
} from '../helpers/room-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Rooms (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthBundle;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    auth = await registerAndLogin(app, ['alice', 'bob']);
  });

  describe('POST /api/v1/rooms', () => {
    it('cria sala pública TRADITIONAL com defaults', async () => {
      const room = await createRoom(app, auth.tokens.alice, {});
      expect(room).toMatchObject({
        code: expect.any(String),
        mode: 'TRADITIONAL',
        status: 'WAITING',
        maxPlayers: 4,
        isPrivate: false,
      });
    });

    it('rejeita maxPlayers inválido (7) com 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ mode: 'TRADITIONAL', maxPlayers: 7 })
        .expect(400);
    });

    it('rejeita mode inválido com 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ mode: 'INVALID', maxPlayers: 4 })
        .expect(400);
    });

    it('rejeita criação sem auth com 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .send({ mode: 'TRADITIONAL', maxPlayers: 4 })
        .expect(401);
    });

    it('rejeita modo não-TRADITIONAL não desbloqueado com 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ mode: 'DEGUSTACAO', maxPlayers: 2, isPrivate: true })
        .expect(403);
    });
  });

  describe('GET /api/v1/rooms', () => {
    it('lista salas públicas WAITING', async () => {
      const r1 = await createRoom(app, auth.tokens.alice, { isPrivate: false });
      await createRoom(app, auth.tokens.bob, { isPrivate: true });
      const res = await listRooms(app);
      expect(res.status).toBe(200);
      const codes = res.body.map((r: { code: string }) => r.code);
      expect(codes).toContain(r1.code);
      const privateCodes = res.body.filter((r: { isPrivate: boolean }) => r.isPrivate);
      expect(privateCodes).toHaveLength(0);
    });

    it('filtra por mode quando query ?mode= passado', async () => {
      const r1 = await createRoom(app, auth.tokens.alice, { mode: 'TRADITIONAL', isPrivate: false });
      await createRoom(app, auth.tokens.bob, { mode: 'TRADITIONAL', maxPlayers: 2, isPrivate: false });
      const res = await listRooms(app, { mode: 'TRADITIONAL' });
      expect(res.status).toBe(200);
      const codes = res.body.map((r: { code: string }) => r.code);
      expect(codes).toContain(r1.code);
      expect(res.body.every((r: { mode: string }) => r.mode === 'TRADITIONAL')).toBe(true);
    });
  });

  describe('GET /api/v1/rooms/:code', () => {
    it('retorna sala existente sem autenticação', async () => {
      const r = await createRoom(app, auth.tokens.alice, {});
      const res = await getRoom(app, r.code);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(r.code);
    });

    it('retorna 404 para código inexistente', async () => {
      const res = await getRoom(app, 'INEXIS');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/rooms/:code/bots', () => {
    it('host adiciona bot com sucesso', async () => {
      const r = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const res = await addBot(app, auth.tokens.alice, r.code);
      expect(res.status).toBe(201);
      const bots = res.body.players.filter((p: { isBot: boolean }) => p.isBot);
      expect(bots.length).toBeGreaterThan(0);
    });

    it('não-host recebe 403', async () => {
      const r = await createRoom(app, auth.tokens.alice, {});
      const res = await addBot(app, auth.tokens.bob, r.code);
      expect(res.status).toBe(403);
    });

    it('sala cheia rejeita com 400', async () => {
      // host already occupies 1 seat; maxPlayers=2 → only 1 bot slot
      const r = await createRoom(app, auth.tokens.alice, { maxPlayers: 2 });
      await addBot(app, auth.tokens.alice, r.code);
      const res = await addBot(app, auth.tokens.alice, r.code);
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/rooms/:code/bots/:botId', () => {
    it('host remove bot com sucesso', async () => {
      const r = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const added = (await addBot(app, auth.tokens.alice, r.code)).body;
      const bot = added.players.find((p: { isBot: boolean }) => p.isBot)!;
      const res = await removeBot(app, auth.tokens.alice, r.code, bot.userId);
      expect(res.status).toBe(200);
      const remainingBots = res.body.players.filter(
        (p: { isBot: boolean; userId: string }) =>
          p.isBot && p.userId === bot.userId,
      );
      expect(remainingBots).toHaveLength(0);
    });

    it('não-host recebe 403', async () => {
      const r = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const added = (await addBot(app, auth.tokens.alice, r.code)).body;
      const bot = added.players.find((p: { isBot: boolean }) => p.isBot)!;
      const res = await removeBot(app, auth.tokens.bob, r.code, bot.userId);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/rooms/:code/reset', () => {
    it('host reseta sala (status volta a WAITING)', async () => {
      const r = await createRoom(app, auth.tokens.alice, {});
      const res = await resetRoom(app, auth.tokens.alice, r.code);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('WAITING');
    });

    it('não-host recebe 403', async () => {
      const r = await createRoom(app, auth.tokens.alice, {});
      const res = await resetRoom(app, auth.tokens.bob, r.code);
      expect(res.status).toBe(403);
    });
  });
});
