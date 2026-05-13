import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface AuthBundle {
  tokens: Record<string, string>;
  ids: Record<string, string>;
}

export async function registerAndLogin(
  app: INestApplication,
  names: string[],
): Promise<AuthBundle> {
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  for (const name of names) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: name,
        email: `${name}@example.com`,
        password: 'secret123',
      })
      .expect(201);
    tokens[name] = res.body.accessToken;
    ids[name] = res.body.user.id;
  }

  return { tokens, ids };
}
