import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Shop (e2e)', () => {
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
    auth = await registerAndLogin(app, ['alice']);
  });

  describe('GET /api/v1/shop/catalog', () => {
    it('retorna catálogo com avatars, modes e coins (autenticado)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/shop/catalog')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body).toHaveProperty('avatars');
      expect(res.body).toHaveProperty('modes');
      expect(res.body).toHaveProperty('coins');
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/shop/catalog')
        .expect(401);
    });
  });

  describe('GET /api/v1/shop/inventory', () => {
    it('retorna inventory inicial (avatars 0-3, mode TRADITIONAL)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/shop/inventory')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body.unlockedAvatars).toEqual(expect.arrayContaining([0, 1, 2, 3]));
      expect(res.body.unlockedModes).toEqual(['TRADITIONAL']);
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/shop/inventory')
        .expect(401);
    });
  });

  describe('POST /api/v1/shop/avatar/:index', () => {
    it('compra avatar 4 com coins suficientes', async () => {
      await prisma.user.update({
        where: { id: auth.ids.alice },
        data: { coins: 100 },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/4')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(201);
      expect(res.body).toMatchObject({
        success: true,
        avatarIndex: 4,
        coinsSpent: expect.any(Number),
      });
    });

    it('rejeita compra com coins insuficientes (403)', async () => {
      // User has 0 coins; avatar 7 costs 30
      await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/7')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(403);
    });

    it('rejeita avatar já owned (400)', async () => {
      // Avatar 0 já está unlocked por default (avatars 0-3 são free/default)
      await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/0')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(400);
    });

    it('rejeita avatar inválido (999) com 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/999')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(400);
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/4')
        .expect(401);
    });
  });

  describe('POST /api/v1/shop/mode/:mode', () => {
    it('compra modo MERCADO com coins suficientes', async () => {
      await prisma.user.update({
        where: { id: auth.ids.alice },
        data: { coins: 100 },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/shop/mode/MERCADO')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('MERCADO');
    });

    it('rejeita compra de modo com coins insuficientes (403)', async () => {
      // User has 0 coins; DEGUSTACAO costs 50
      await request(app.getHttpServer())
        .post('/api/v1/shop/mode/DEGUSTACAO')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(403);
    });

    it('rejeita compra de modo já owned (TRADITIONAL) com 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/mode/TRADITIONAL')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(400);
    });

    it('rejeita modo inválido com 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/mode/INVALID')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(400);
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/mode/MERCADO')
        .expect(401);
    });
  });
});
