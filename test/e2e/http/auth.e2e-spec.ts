import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: 'temakuser',
          email: 'temakuser@example.com',
          password: 'secret123',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        user: {
          username: 'temakuser',
          email: 'temakuser@example.com',
        },
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('rejects duplicated email with 400', async () => {
      const payload = {
        username: 'firstuser',
        email: 'dup@example.com',
        password: 'secret123',
      };
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...payload, username: 'seconduser' })
        .expect(400);
    });

    it('rejects invalid payload with 400 (validation)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'ab', email: 'not-an-email', password: '123' })
        .expect(400);
    });
  });
});
