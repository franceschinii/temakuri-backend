import { INestApplication } from '@nestjs/common';
import request from 'supertest';

type GameMode = 'TRADITIONAL' | 'MERCADO' | 'RODIZIO' | 'DEGUSTACAO';

export interface CreateRoomOpts {
  mode?: GameMode;
  maxPlayers?: number;
  isPrivate?: boolean;
  isRanked?: boolean;
  handBias?: number;
  initialTokens?: number;
}

export async function createRoom(
  app: INestApplication,
  token: string,
  opts: CreateRoomOpts = {},
) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send({
      mode: opts.mode ?? 'TRADITIONAL',
      maxPlayers: opts.maxPlayers ?? 4,
      isPrivate: opts.isPrivate ?? false,
      isRanked: opts.isRanked ?? false,
      handBias: opts.handBias ?? 0,
      initialTokens: opts.initialTokens ?? 2,
    });
  if (res.status !== 201) {
    throw new Error(`createRoom failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function addBot(app: INestApplication, token: string, code: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/rooms/${code}/bots`)
    .set('Authorization', `Bearer ${token}`)
    .send();
}

export async function removeBot(
  app: INestApplication,
  token: string,
  code: string,
  botId: string,
) {
  return request(app.getHttpServer())
    .delete(`/api/v1/rooms/${code}/bots/${botId}`)
    .set('Authorization', `Bearer ${token}`)
    .send();
}

export async function resetRoom(app: INestApplication, token: string, code: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/rooms/${code}/reset`)
    .set('Authorization', `Bearer ${token}`)
    .send();
}

export async function listRooms(app: INestApplication, query: Record<string, string> = {}) {
  let req = request(app.getHttpServer()).get('/api/v1/rooms');
  for (const [k, v] of Object.entries(query)) req = req.query({ [k]: v });
  return req;
}

export async function getRoom(app: INestApplication, code: string) {
  return request(app.getHttpServer()).get(`/api/v1/rooms/${code}`);
}
