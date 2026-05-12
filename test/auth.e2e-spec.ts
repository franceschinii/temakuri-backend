import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({});
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
