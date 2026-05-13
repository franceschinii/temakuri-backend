import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Profile (e2e)', () => {
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

  describe('GET /api/v1/profile', () => {
    it('retorna profile próprio autenticado (sem passwordHash)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body.username).toBe('alice');
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .expect(401);
    });
  });

  describe('PATCH /api/v1/profile', () => {
    it('atualiza avatarIndex', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ avatarIndex: 2 })
        .expect(200);
      expect(res.body.avatarIndex).toBe(2);
    });

    it('rejeita avatarIndex fora do range (12) com 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ avatarIndex: 12 })
        .expect(400);
    });

    it('atualiza username válido', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ username: 'newalice' })
        .expect(200);
      expect(res.body.username).toBe('newalice');
    });

    it('rejeita username com 2 caracteres', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .send({ username: 'ab' })
        .expect(400);
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .send({ avatarIndex: 2 })
        .expect(401);
    });
  });

  describe('GET /api/v1/profile/check-username', () => {
    it('retorna available=true para nome livre', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile/check-username')
        .query({ username: 'free-name' })
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body.available).toBe(true);
    });

    it('username existente retorna 404 (NotFoundException)', async () => {
      // Controller throws NotFoundException when username is taken
      await request(app.getHttpServer())
        .get('/api/v1/profile/check-username')
        .query({ username: 'bob' })
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/profile/leaderboard', () => {
    it('retorna array público sem auth', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile/leaderboard')
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/v1/profile/leaderboard/me', () => {
    it('retorna rank null para usuário sem pds positivo', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile/leaderboard/me')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body).toHaveProperty('rank');
      // New users have pds <= 0, so rank should be null
      expect(res.body.rank).toBeNull();
    });

    it('sem auth retorna 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/profile/leaderboard/me')
        .expect(401);
    });
  });

  describe('GET /api/v1/profile/:userId', () => {
    it('retorna profile público sem auth', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/profile/${auth.ids.alice}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: auth.ids.alice,
        username: 'alice',
      });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('retorna 404 para userId inexistente', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/profile/nonexistent-id')
        .expect(404);
    });
  });
});
