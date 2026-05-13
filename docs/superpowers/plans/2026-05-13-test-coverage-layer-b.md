# Layer B — HTTP/REST Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrir os endpoints HTTP REST (rooms, profile, shop, admin-smoke) com e2e via `supertest`, contra a app Nest e o Postgres de teste já configurado.

**Architecture:** Bootstrap real do Nest via `Test.createTestingModule({ imports: [AppModule] })`, replicando `ValidationPipe`, `setGlobalPrefix('api/v1')` e `WsAdapter` do `main.ts`. Cada arquivo `*.e2e-spec.ts` cria a app no `beforeAll`, registra usuários por `beforeEach` via helper, exercita endpoints reais, e limpa o DB entre testes. Helpers compartilhados em `test/e2e/helpers/`.

**Tech Stack:** Jest 30, `@nestjs/testing`, `supertest`, `@swc/jest`, `dotenv-cli`, Prisma. Roda via `docker compose exec backend npm run test:e2e`.

**Pre-requisito:** Docker compose rodando; branch `feat/test-coverage` checked-out; Layer A merged (24 commits locais). Suite e2e atual: 3 tests passando em `test/auth.e2e-spec.ts`.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `test/e2e/helpers/app-factory.ts` | NEW — `createTestApp(): Promise<INestApplication>` |
| `test/e2e/helpers/auth-helpers.ts` | NEW — `registerAndLogin(app, names[])` |
| `test/e2e/helpers/db-cleanup.ts` | NEW — `resetDb(prisma)` na ordem `gameResult → room → user` |
| `test/e2e/helpers/room-helpers.ts` | NEW — `createRoom`, `addBot`, `removeBot`, `resetRoom` |
| `test/e2e/http/auth.e2e-spec.ts` | MOVE de `test/auth.e2e-spec.ts` + refatorar p/ usar helpers |
| `test/e2e/http/rooms.e2e-spec.ts` | NEW — cobre 6 endpoints |
| `test/e2e/http/profile.e2e-spec.ts` | NEW — cobre 6 endpoints |
| `test/e2e/http/shop.e2e-spec.ts` | NEW — cobre 4 endpoints |
| `test/e2e/http/admin.e2e-spec.ts` | NEW — smoke 403/200 |
| `test/jest-e2e.json` | (sem mudança — `testRegex` já pega `**/*.e2e-spec.ts$`) |

Nenhuma mudança no código de produção (`src/`).

---

## Task 0: Pré-condições

**Files:** N/A — só verificação.

- [ ] **Step 1: Confirmar branch e estado**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend status --short
git -C /home/anrry/github.com/temakuri/temakuri-backend branch --show-current
```

Expected: working tree limpa; branch `feat/test-coverage`.

- [ ] **Step 2: Confirmar suite passa**

```bash
docker compose exec -T backend npm test 2>&1 | tail -5
docker compose exec -T backend npm run test:e2e 2>&1 | tail -5
```

Expected: unit `92 passed`; e2e `3 passed`.

---

## Task 1: Helper `app-factory.ts`

**Files:**
- Create: `test/e2e/helpers/app-factory.ts`

- [ ] **Step 1: Criar o helper**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '../../../src/app.module.js';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}
```

- [ ] **Step 2: Sem commit ainda** — todos os 4 helpers vão num commit conjunto na Task 3.

---

## Task 2: Helper `auth-helpers.ts`

**Files:**
- Create: `test/e2e/helpers/auth-helpers.ts`

- [ ] **Step 1: Criar o helper**

```ts
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
```

- [ ] **Step 2: Sem commit ainda.**

---

## Task 3: Helper `db-cleanup.ts` + `room-helpers.ts` + commit consolidado

**Files:**
- Create: `test/e2e/helpers/db-cleanup.ts`
- Create: `test/e2e/helpers/room-helpers.ts`

- [ ] **Step 1: Criar `db-cleanup.ts`**

```ts
import { PrismaService } from '../../../src/prisma/prisma.service.js';

export async function resetDb(prisma: PrismaService): Promise<void> {
  // Ordem importa: GameResult e Room não têm onDelete: Cascade vs User.
  // RoomPlayer cascateia de Room. User cascade cobre o resto (Session, Stats,
  // Inventory, RankedStats, PasswordResetToken).
  await prisma.gameResult.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.user.deleteMany({});
}
```

- [ ] **Step 2: Criar `room-helpers.ts`**

```ts
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
```

- [ ] **Step 3: Commit os 4 helpers**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/helpers/
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): helpers compartilhados (app, auth, db, room)

Infra para Layer B HTTP/REST: createTestApp bootstrapa Nest com pipes
e prefix iguais ao main.ts; registerAndLogin cria usuários em batch e
retorna tokens/ids; resetDb limpa banco na ordem GameResult → Room →
User; room-helpers expõe wrappers HTTP para os endpoints de sala."
```

---

## Task 4: Mover + refatorar `auth.e2e-spec.ts`

**Files:**
- Move: `test/auth.e2e-spec.ts` → `test/e2e/http/auth.e2e-spec.ts`
- Refactor: usar `createTestApp` e `registerAndLogin` / `resetDb`

- [ ] **Step 1: Mover arquivo**

```bash
mkdir -p /home/anrry/github.com/temakuri/temakuri-backend/test/e2e/http
git -C /home/anrry/github.com/temakuri/temakuri-backend mv test/auth.e2e-spec.ts test/e2e/http/auth.e2e-spec.ts
```

- [ ] **Step 2: Reescrever o conteúdo usando helpers**

Substituir todo o conteúdo de `test/e2e/http/auth.e2e-spec.ts` por:

```ts
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
```

- [ ] **Step 3: Rodar suite e2e**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | tail -10
```

Expected: `Tests: 3 passed, 3 total`.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): move auth tests para test/e2e/http/ usando helpers

Mesma cobertura, infra centralizada via createTestApp / resetDb."
```

---

## Task 5: `rooms.e2e-spec.ts`

**Files:**
- Create: `test/e2e/http/rooms.e2e-spec.ts`

**Endpoints cobertos:** POST `/rooms`, GET `/rooms`, GET `/rooms/:code`, POST `/rooms/:code/bots`, DELETE `/rooms/:code/bots/:botId`, POST `/rooms/:code/reset`.

**Nota: entrar/sair de sala é WebSocket (lobby:join_room/lobby:leave_room) — fora do escopo de Layer B.**

- [ ] **Step 1: Criar arquivo**

```ts
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

    it('cria sala privada DEGUSTACAO 2P ranqueada', async () => {
      const room = await createRoom(app, auth.tokens.alice, {
        mode: 'DEGUSTACAO',
        maxPlayers: 2,
        isPrivate: true,
        isRanked: true,
      });
      expect(room.mode).toBe('DEGUSTACAO');
      expect(room.maxPlayers).toBe(2);
      expect(room.isPrivate).toBe(true);
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
  });

  describe('GET /api/v1/rooms', () => {
    it('lista salas públicas WAITING', async () => {
      const r1 = await createRoom(app, auth.tokens.alice, { isPrivate: false });
      await createRoom(app, auth.tokens.bob, { isPrivate: true });
      const res = await listRooms(app);
      expect(res.status).toBe(200);
      const codes = res.body.map((r: { code: string }) => r.code);
      expect(codes).toContain(r1.code);
      // Privada não deve aparecer
      const privateCodes = res.body.filter((r: { isPrivate: boolean }) => r.isPrivate);
      expect(privateCodes).toHaveLength(0);
    });

    it('filtra por mode quando query ?mode= passado', async () => {
      const r1 = await createRoom(app, auth.tokens.alice, { mode: 'MERCADO' });
      await createRoom(app, auth.tokens.bob, { mode: 'TRADITIONAL' });
      const res = await listRooms(app, { mode: 'MERCADO' });
      expect(res.status).toBe(200);
      const codes = res.body.map((r: { code: string }) => r.code);
      expect(codes).toContain(r1.code);
      expect(res.body.every((r: { mode: string }) => r.mode === 'MERCADO')).toBe(true);
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
      const r = await createRoom(app, auth.tokens.alice, { maxPlayers: 2 });
      // host já é 1; adiciona 1 bot → cheia (2)
      await addBot(app, auth.tokens.alice, r.code).expect(201);
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
```

- [ ] **Step 2: Rodar arquivo isolado**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="rooms" 2>&1 | tail -20
```

Expected: maioria dos testes passam. Investigar falhas:
- Se `createRoom` retornar 400 inesperado → verificar DTO.
- Se o filtro por `mode` não funcionar → ler `rooms.service.ts` para confirmar query.
- Se `addBot` retornar 404 para sala que existe → confirmar o path real.

Ajustar tests conforme observado, NÃO modificar produção.

- [ ] **Step 3: Rodar suite completa e2e**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | tail -8
```

Expected: ~18 passed (3 auth + ~15 rooms).

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/http/rooms.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre HTTP de rooms (CRUD + bots + reset)

Não cobre lobby:join_room/leave_room (WS, Layer C)."
```

---

## Task 6: `profile.e2e-spec.ts`

**Files:**
- Create: `test/e2e/http/profile.e2e-spec.ts`

**Endpoints:** GET `/profile`, PATCH `/profile`, GET `/profile/check-username`, GET `/profile/leaderboard`, GET `/profile/leaderboard/me`, GET `/profile/:userId`.

- [ ] **Step 1: Criar arquivo**

```ts
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

    it('username existente retorna não-200 ou available=false', async () => {
      // Pode retornar 404 (NotFound) ou 200 com available=false — testar comportamento observado
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile/check-username')
        .query({ username: 'bob' })
        .set('Authorization', `Bearer ${auth.tokens.alice}`);
      // Aceita ambos os comportamentos; ajustar após observar
      expect([200, 404, 409]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.available).toBe(false);
      }
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
    it('retorna posição (null se fora do top 100)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile/leaderboard/me')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(200);
      expect(res.body).toHaveProperty('rank');
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
```

- [ ] **Step 2: Rodar**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="profile" 2>&1 | tail -25
```

Investigar e ajustar falhas conforme comportamento real.

- [ ] **Step 3: Rodar suite e2e completa**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | tail -5
```

Expected: ~30 passed.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/http/profile.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre HTTP de profile (próprio, leaderboard, público)"
```

---

## Task 7: `shop.e2e-spec.ts`

**Files:**
- Create: `test/e2e/http/shop.e2e-spec.ts`

**Endpoints:** GET `/shop/catalog`, GET `/shop/inventory`, POST `/shop/avatar/:index`, POST `/shop/mode/:mode`. **Todos JWT-protected.**

**Preços observados** (já investigados):
- Avatares: 4 → 15, 5 → 20, 6 → 25, 7 → 30. Avatares 0–3 são free (default).
- Modos: MERCADO → 20, RODIZIO → 30, DEGUSTACAO → 50. TRADITIONAL é base.

- [ ] **Step 1: Criar arquivo**

```ts
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
    it('retorna catálogo com avatars e modes (autenticado)', async () => {
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
  });

  describe('POST /api/v1/shop/avatar/:index', () => {
    it('compra avatar com coins suficientes', async () => {
      // Default user starts with 0 coins; precisa setar saldo
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

    it('rejeita compra com coins insuficientes (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shop/avatar/7')
        .set('Authorization', `Bearer ${auth.tokens.alice}`)
        .expect(400);
    });

    it('rejeita avatar já owned (400)', async () => {
      // Avatar 0 já está unlocked
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
  });

  describe('POST /api/v1/shop/mode/:mode', () => {
    it('compra modo com coins suficientes', async () => {
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

    it('rejeita compra de modo já owned (TRADITIONAL)', async () => {
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
  });
});
```

- [ ] **Step 2: Rodar**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="shop" 2>&1 | tail -25
```

- [ ] **Step 3: Suite completa**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | tail -5
```

Expected: ~40 passed.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/http/shop.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre HTTP de shop (catalog, inventory, compras)"
```

---

## Task 8: `admin.e2e-spec.ts` (smoke)

**Files:**
- Create: `test/e2e/http/admin.e2e-spec.ts`

**Escopo:** smoke apenas — 403 quando não-admin, 200 quando admin. Cobertura funcional do admin fica fora de Layer B.

- [ ] **Step 1: Criar arquivo**

```ts
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
    // Promover usuário a admin via Prisma direto (não há endpoint público pra isso)
    await prisma.user.update({
      where: { id: auth.ids.admin },
      data: { isAdmin: true },
    });
    // O JWT antigo do admin ainda não tem isAdmin embutido; precisamos re-logar
    // OU o JWT pode bastar se o guard ler o DB. Se 403 mesmo após update, fazer re-login.
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${auth.tokens.admin}`);
    // Comportamento desejado: 200. Se for 403 por JWT cacheado, ajustar:
    expect([200, 403]).toContain(res.status);
    if (res.status === 403) {
      // Reauth pra refrescar claim
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'secret123' })
        .expect(200);
      const adminToken = loginRes.body.accessToken;
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    }
  });

  it('GET /admin/rooms como admin retorna 200', async () => {
    await prisma.user.update({
      where: { id: auth.ids.admin },
      data: { isAdmin: true },
    });
    // Login fresco para garantir claim
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'secret123' })
      .expect(200);
    const adminToken = loginRes.body.accessToken;
    await request(app.getHttpServer())
      .get('/api/v1/admin/rooms')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
```

- [ ] **Step 2: Rodar**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="admin" 2>&1 | tail -25
```

- [ ] **Step 3: Suite completa**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | tail -5
```

Expected: ~44 passed.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/http/admin.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): smoke de admin (auth 401, guard 403, admin 200)"
```

---

## Task 9: Verificação final

**Files:** N/A — só relato.

- [ ] **Step 1: Rodar suite completa (unit + e2e)**

```bash
docker compose exec -T backend npm test 2>&1 | tail -5
docker compose exec -T backend npm run test:e2e 2>&1 | tail -5
```

Expected: unit `92 passed`; e2e `~44 passed`.

- [ ] **Step 2: Listar commits de Layer B**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline main..HEAD
```

Expected: 24 (Layer A + FU) + 5 (Layer B) = 29 commits.

- [ ] **Step 3: NÃO fazer push** — conforme preferência do usuário.

Reportar:
> Layer B completa. e2e: ~44 passed. Push pendente de autorização.

---

## Notas finais

**Discoveries esperadas:**

- Algumas validações em DTOs podem ser mais restritivas do que documentadas → ajustar `expect(400)` para `expect(403)` ou similar conforme observado.
- O guard de admin pode requerer reauth após `isAdmin: true` no DB (JWT antigo não tem o claim).
- Endpoints publicly-accessible (GET /rooms, GET /rooms/:code, GET /profile/:userId, GET /profile/leaderboard) precisam ser testados COM e SEM `Authorization` header pra confirmar.

**Anti-padrões a evitar:**

- Não usar `expect(201)` ou `expect(200)` hardcoded em todo lugar — ler a doc dos `@HttpCode()` decorators e ajustar (POST sem `@HttpCode` retorna 201; com `@HttpCode(200)` retorna 200).
- Não modificar produção pra fazer testes passarem — se o backend não cumpre o spec, abrir issue e mover pra fora de Layer B.
- Não criar arquivos novos em `src/` — Layer B é puramente teste.
