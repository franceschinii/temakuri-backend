import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Admin (e2e smoke)', () => {
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
    auth = await registerAndLogin(app, ['alice', 'admin']);
  });

  async function promoteToAdmin(name: string): Promise<string> {
    // AdminGuard lê isAdmin do banco via JwtStrategy.validate(), não do JWT claim.
    // Basta atualizar o DB; o token existente já funciona.
    await prisma.user.update({
      where: { id: auth.ids[name] },
      data: { isAdmin: true },
    });
    return auth.tokens[name];
  }

  it('GET /admin/users sem auth retorna 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .expect(401);
  });

  it('GET /admin/users como usuário comum retorna 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${auth.tokens.alice}`)
      .expect(403);
  });

  it('GET /admin/users como admin retorna 200', async () => {
    const adminToken = await promoteToAdmin('admin');
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('GET /admin/rooms como admin retorna 200', async () => {
    const adminToken = await promoteToAdmin('admin');
    await request(app.getHttpServer())
      .get('/api/v1/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
