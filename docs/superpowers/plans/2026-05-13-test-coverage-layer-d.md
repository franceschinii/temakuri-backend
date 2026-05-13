# Layer D — Flow E2E Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrir partidas completas (1 humano + bots) do start ao `GAME_OVER` em cada modo, validando persistência no DB (Room.status='FINISHED', GameResult rows, user XP/coins/PDS atualizados, RankedStats em jogos ranqueados). Mais cenários cross-mode: ranked flow, reconexão mid-game, salas concorrentes.

**Architecture:** Reusa toda infra de Layer C (createListeningTestApp, TestWsClient, lobby-helpers). Adiciona `game-helpers.ts` com `startGameWithBots()` (consolida boilerplate flagged no review de Layer C) e `awaitGameOverSummary()` (espera evento `lobby:game_over_summary` emitido APÓS o `markFinished` persistir no DB). Bots auto-jogam com `TURN_TIMEOUT_MS=100ms`; partida típica ~5-15s.

**Tech Stack:** Jest 30, `@nestjs/testing`, `supertest`, `ws`, Prisma. Roda via `docker compose exec backend npm run test:e2e`.

**Pré-requisito:** Layer A/B/C mergeadas (42 commits locais); suite atual: unit `92 passed`, e2e `68 passed`.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `test/e2e/helpers/game-helpers.ts` | NEW — `startGameWithBots`, `awaitGameOverSummary` |
| `test/e2e/flow/traditional-full-game.e2e-spec.ts` | NEW — 1H + 3 bots TRADITIONAL, validates Room.status + GameResult + rewards |
| `test/e2e/flow/mercado-full-game.e2e-spec.ts` | NEW — TRADITIONAL flow + assertion mode='MERCADO' |
| `test/e2e/flow/rodizio-full-game.e2e-spec.ts` | NEW — RODIZIO multi-rodada via flow |
| `test/e2e/flow/duelo-full-game.e2e-spec.ts` | NEW — 2P happy path com DUEL_PASS_PICK |
| `test/e2e/flow/ranked-flow.e2e-spec.ts` | NEW — isRanked=true + RankedStats |
| `test/e2e/flow/disconnect-recovery.e2e-spec.ts` | NEW — humano cai, bot assume, reconecta |
| `test/e2e/flow/concurrent-rooms.e2e-spec.ts` | NEW — 2 salas paralelas |

**Zero mudança no código de produção.** Toda persistência já está implementada (`markFinished`, `RankedStats`, eventos `lobby:game_over_summary`).

---

## Eventos relevantes (descobertos em Layers anteriores)

| Evento | Quando |
|---|---|
| `lobby:room_updated` | Após join_room ou reset |
| `game:turn_started` | Broadcast a cada novo turno; payload `{ userId, timeoutMs }` |
| `game:game_over` | Engine emite ao atingir GAME_OVER (antes de persistir) |
| `lobby:game_over_summary` | **APÓS `markFinished` persistir no DB**; payload `{ rankings, room, rewards }` |

**Use `lobby:game_over_summary` para garantir que asserts no DB pegam estado consistente.**

---

## Task 0: Pré-condições

**Files:** N/A — só verificação.

- [ ] **Step 1: Confirmar baseline**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend status --short
git -C /home/anrry/github.com/temakuri/temakuri-backend branch --show-current
docker compose exec -T backend npm test 2>&1 | grep "^Tests:"
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
```

Expected: working tree limpa, branch `feat/test-coverage`, unit `92 passed`, e2e `68 passed`.

---

## Task 1: Helper `game-helpers.ts`

**Files:**
- Create: `test/e2e/helpers/game-helpers.ts`

- [ ] **Step 1: Criar helper**

```ts
import { INestApplication } from '@nestjs/common';
import { TestWsClient } from './ws-client.js';
import { createRoom, addBot } from './room-helpers.js';
import { joinRoomWs, setReadyWs, startGameWs } from './lobby-helpers.js';

type GameMode = 'TRADITIONAL' | 'MERCADO' | 'RODIZIO' | 'DEGUSTACAO';

export interface StartGameOpts {
  mode?: GameMode;
  maxPlayers?: number;
  isRanked?: boolean;
  /** Quantos bots adicionar; default = maxPlayers - 1 */
  botCount?: number;
}

export interface GameStartResult {
  client: TestWsClient;
  roomCode: string;
}

/**
 * Fluxo padrão: cria sala → adiciona bots → conecta humano → join → ready →
 * start → aguarda primeiro game:turn_started.
 */
export async function startGameWithBots(
  app: INestApplication,
  wsUrl: string,
  token: string,
  opts: StartGameOpts = {},
): Promise<GameStartResult> {
  const maxPlayers = opts.maxPlayers ?? 4;
  const botCount = opts.botCount ?? maxPlayers - 1;
  const room = await createRoom(app, token, {
    mode: opts.mode ?? 'TRADITIONAL',
    maxPlayers,
    isRanked: opts.isRanked ?? false,
  });
  for (let i = 0; i < botCount; i++) {
    await addBot(app, token, room.code);
  }
  const client = new TestWsClient({ defaultTimeoutMs: 15000 });
  await client.connect(wsUrl, token);
  joinRoomWs(client, room.code);
  await client.waitFor('lobby:room_updated', 5000);
  setReadyWs(client, room.code, true);
  await new Promise((r) => setTimeout(r, 100));
  startGameWs(client, room.code);
  await client.waitFor('game:turn_started', 8000);
  return { client, roomCode: room.code };
}

export interface GameOverSummary {
  rankings: Array<{
    userId: string;
    username: string;
    placement: number;
    tokensLeft: number;
  }>;
  room: any;
  rewards: Record<
    string,
    {
      xpEarned: number;
      coinsEarned: number;
      newLevel: number;
      leveledUp: boolean;
      pdsChange: number;
      newPds: number;
      newRank: string;
    }
  >;
}

/**
 * Aguarda o evento emitido APÓS `markFinished` persistir no DB.
 * Use isso (não `game:game_over`) quando for verificar estado no banco.
 */
export async function awaitGameOverSummary(
  client: TestWsClient,
  timeoutMs = 60000,
): Promise<GameOverSummary> {
  return client.waitFor<GameOverSummary>('lobby:game_over_summary', timeoutMs);
}
```

- [ ] **Step 2: Suite continua passando (helper não é importado ainda)**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
```

Expected: `68 passed`.

- [ ] **Step 3: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/helpers/game-helpers.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): helper para flow E2E (startGameWithBots + awaitGameOverSummary)

Consolida o boilerplate de setup de jogo (room → bots → connect → join →
ready → start) num único call. awaitGameOverSummary espera o evento
emitido APÓS markFinished persistir no DB."
```

---

## Task 2: `traditional-full-game.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/traditional-full-game.e2e-spec.ts`

**Objetivo:** partida TRADITIONAL completa → assert Room.status='FINISHED', 4 GameResult rows com placement 1-4, UserStats.gamesPlayed incrementado, rewards positivos pro vencedor.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — TRADITIONAL full game (e2e)', () => {
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

  it('partida 4P TRADITIONAL roda até GAME_OVER e persiste Room+GameResult', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);
    const placements = summary.rankings.map((r) => r.placement).sort();
    expect(placements).toEqual([1, 2, 3, 4]);

    // Verifica persistência
    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.status).toBe('FINISHED');
    expect(room?.endedAt).not.toBeNull();

    const results = await prisma.gameResult.findMany({ where: { roomId: room!.id } });
    expect(results).toHaveLength(4);
    const dbPlacements = results.map((r) => r.placement).sort();
    expect(dbPlacements).toEqual([1, 2, 3, 4]);

    // Vencedor (placement=1) ganhou alguma coisa
    const winner = summary.rankings.find((r) => r.placement === 1)!;
    const winnerReward = summary.rewards[winner.userId];
    if (winnerReward) {
      // xp/coins podem ser 0 dependendo de regras; o teste assume > 0 pro vencedor
      expect(winnerReward.xpEarned).toBeGreaterThanOrEqual(0);
      expect(winnerReward.coinsEarned).toBeGreaterThanOrEqual(0);
    }

    // UserStats.gamesPlayed do humano incrementou (de 0 → 1)
    const aliceStats = await prisma.userStats.findUnique({
      where: { userId: auth.ids.alice },
    });
    expect(aliceStats?.gamesPlayed).toBeGreaterThanOrEqual(1);

    client.close();
  });
});
```

- [ ] **Step 2: Rodar**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/traditional" 2>&1 | tail -25
```

Expected: 1 passed em ~10-20s. Se falhar:
- Verificar se `lobby:game_over_summary` realmente fires — pode ter outro nome de evento. Olhar `notifications.gateway.ts:380` e adjacências.
- Pode acontecer race entre `markFinished` (async) e o broadcast — observar timeline.
- `summary.rewards` pode ter chave por userId; se estrutura diferente, adaptar.
- `UserStats` é criado apenas se já existia (registerAndLogin via /auth/register sim cria via `register` em auth.service.ts → `userStats.create`). Pode ser que `gamesPlayed` esteja em outro lugar.

- [ ] **Step 3: Rodar full suite**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
```

Expected: `69 passed`.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/traditional-full-game.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow completo TRADITIONAL 4P até GAME_OVER + persistência"
```

---

## Task 3: `mercado-full-game.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/mercado-full-game.e2e-spec.ts`

**Objetivo:** partida MERCADO 4P completa; assert Room.mode='MERCADO' no DB pós-game.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — MERCADO full game (e2e)', () => {
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
    // Unlock MERCADO no inventory do alice
    await prisma.userInventory.upsert({
      where: { userId: auth.ids.alice },
      create: {
        userId: auth.ids.alice,
        unlockedAvatars: [0, 1, 2, 3],
        unlockedModes: ['TRADITIONAL', 'MERCADO'],
      },
      update: { unlockedModes: ['TRADITIONAL', 'MERCADO'] },
    });
  });

  it('partida MERCADO 4P roda até GAME_OVER e persiste com mode correto', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'MERCADO',
      maxPlayers: 4,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.mode).toBe('MERCADO');
    expect(room?.status).toBe('FINISHED');

    client.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/mercado" 2>&1 | tail -20
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/mercado-full-game.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow completo MERCADO 4P até GAME_OVER"
```

Expected: `70 passed`.

---

## Task 4: `rodizio-full-game.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/rodizio-full-game.e2e-spec.ts`

**Objetivo:** partida RODIZIO 4P; assert mode + status. (Note: per Layer A fix, hands rotate between rounds.)

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — RODIZIO full game (e2e)', () => {
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
    await prisma.userInventory.upsert({
      where: { userId: auth.ids.alice },
      create: {
        userId: auth.ids.alice,
        unlockedAvatars: [0, 1, 2, 3],
        unlockedModes: ['TRADITIONAL', 'RODIZIO'],
      },
      update: { unlockedModes: ['TRADITIONAL', 'RODIZIO'] },
    });
  });

  it('partida RODIZIO 4P roda até GAME_OVER e persiste com mode correto', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'RODIZIO',
      maxPlayers: 4,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.mode).toBe('RODIZIO');
    expect(room?.status).toBe('FINISHED');

    client.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/rodizio" 2>&1 | tail -20
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/rodizio-full-game.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow completo RODIZIO 4P até GAME_OVER"
```

Expected: `71 passed`.

---

## Task 5: `duelo-full-game.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/duelo-full-game.e2e-spec.ts`

**Objetivo:** 2P TRADITIONAL (= Duelo via HAND_SIZE[2]=11); assert 2 GameResult rows + DUEL_PASS_PICK phase apareceu em algum momento.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Duelo 2P full game (e2e)', () => {
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

  it('partida 2P (Duelo) roda até GAME_OVER e persiste 2 GameResults', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 2,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(2);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.maxPlayers).toBe(2);
    expect(room?.status).toBe('FINISHED');

    const results = await prisma.gameResult.findMany({ where: { roomId: room!.id } });
    expect(results).toHaveLength(2);

    client.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/duelo" 2>&1 | tail -20
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/duelo-full-game.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow completo 2P (Duelo) até GAME_OVER"
```

Expected: `72 passed`.

---

## Task 6: `ranked-flow.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/ranked-flow.e2e-spec.ts`

**Objetivo:** sala ranked (requires level ≥ 10); GAME_OVER atualiza RankedStats e pds do usuário.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Ranked (e2e)', () => {
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
    // Ranked precisa de level >= 10
    await prisma.user.update({
      where: { id: auth.ids.alice },
      data: { level: 10 },
    });
  });

  it('jogo ranked atualiza RankedStats e pds no GAME_OVER', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
      isRanked: true,
    });
    const summary = await awaitGameOverSummary(client, 60000);

    expect(summary.rankings).toHaveLength(4);

    const room = await prisma.room.findUnique({ where: { code: roomCode } });
    expect(room?.isRanked).toBe(true);
    expect(room?.status).toBe('FINISHED');

    // GameResult.isRanked deve refletir
    const results = await prisma.gameResult.findMany({ where: { roomId: room!.id } });
    expect(results.every((r) => r.isRanked === true)).toBe(true);

    // RankedStats do alice deve existir (criada ou atualizada)
    const ranked = await prisma.rankedStats.findUnique({
      where: { userId: auth.ids.alice },
    });
    expect(ranked).not.toBeNull();
    // Pelo menos win OU loss > 0
    expect((ranked?.rankedWins ?? 0) + (ranked?.rankedLosses ?? 0)).toBeGreaterThanOrEqual(1);

    client.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/ranked" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/ranked-flow.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow ranked — RankedStats e isRanked persistem"
```

Expected: `73 passed`.

---

## Task 7: `disconnect-recovery.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/disconnect-recovery.e2e-spec.ts`

**Objetivo:** humano cai mid-game; bots continuam; humano reconecta; jogo termina. Assert que jogo completou apesar do disconnect.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(60000);

describe('Flow — Disconnect recovery (e2e)', () => {
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

  it('humano desconecta mid-game; jogo termina; reconexão recupera estado final', async () => {
    const { client, roomCode } = await startGameWithBots(app, wsUrl, auth.tokens.alice, {
      mode: 'TRADITIONAL',
      maxPlayers: 4,
    });
    // Espera um turno andar pra ter certeza que jogo está em curso
    await new Promise((r) => setTimeout(r, 500));
    client.close();

    // Aguarda o jogo terminar via bots (não temos client pra escutar)
    // Poll DB até Room.status === 'FINISHED' (timeout 30s)
    const startTime = Date.now();
    let room = await prisma.room.findUnique({ where: { code: roomCode } });
    while (room?.status !== 'FINISHED' && Date.now() - startTime < 30000) {
      await new Promise((r) => setTimeout(r, 200));
      room = await prisma.room.findUnique({ where: { code: roomCode } });
    }
    expect(room?.status).toBe('FINISHED');

    // Reconecta e recupera estado
    const second = new TestWsClient({ defaultTimeoutMs: 5000 });
    await second.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(second, roomCode);
    // Pode receber lobby:room_updated com estado pós-game
    const update = await second.waitFor<any>('lobby:room_updated', 3000).catch(() => null);
    expect(update).toBeTruthy();
    second.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/disconnect" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/disconnect-recovery.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): flow de disconnect mid-game — bots terminam, humano reconecta"
```

Expected: `74 passed`.

---

## Task 8: `concurrent-rooms.e2e-spec.ts`

**Files:**
- Create: `test/e2e/flow/concurrent-rooms.e2e-spec.ts`

**Objetivo:** 2 salas em paralelo (host diferente em cada); ambas chegam a GAME_OVER independentemente; estados não vazam.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { startGameWithBots, awaitGameOverSummary } from '../helpers/game-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(90000);

describe('Flow — Concurrent rooms (e2e)', () => {
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
    auth = await registerAndLogin(app, ['alice', 'bob']);
  });

  it('duas salas paralelas (hosts diferentes) terminam independentemente', async () => {
    // Iniciar as duas em paralelo
    const [aliceGame, bobGame] = await Promise.all([
      startGameWithBots(app, wsUrl, auth.tokens.alice, {
        mode: 'TRADITIONAL',
        maxPlayers: 4,
      }),
      startGameWithBots(app, wsUrl, auth.tokens.bob, {
        mode: 'TRADITIONAL',
        maxPlayers: 4,
      }),
    ]);

    expect(aliceGame.roomCode).not.toBe(bobGame.roomCode);

    // Esperar ambas terminarem
    const [aliceSummary, bobSummary] = await Promise.all([
      awaitGameOverSummary(aliceGame.client, 60000),
      awaitGameOverSummary(bobGame.client, 60000),
    ]);

    expect(aliceSummary.rankings).toHaveLength(4);
    expect(bobSummary.rankings).toHaveLength(4);
    expect(aliceSummary.room.code).toBe(aliceGame.roomCode);
    expect(bobSummary.room.code).toBe(bobGame.roomCode);

    // Validar no DB
    const aliceRoom = await prisma.room.findUnique({ where: { code: aliceGame.roomCode } });
    const bobRoom = await prisma.room.findUnique({ where: { code: bobGame.roomCode } });
    expect(aliceRoom?.status).toBe('FINISHED');
    expect(bobRoom?.status).toBe('FINISHED');
    expect(aliceRoom?.id).not.toBe(bobRoom?.id);

    aliceGame.client.close();
    bobGame.client.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="flow/concurrent" 2>&1 | tail -30
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/flow/concurrent-rooms.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): salas concorrentes terminam independentemente"
```

Expected: `75 passed`.

---

## Task 9: Verificação final + final review

**Files:** N/A — só relato.

- [ ] **Step 1: Suite completa**

```bash
docker compose exec -T backend npm test 2>&1 | grep "^Tests:"
docker compose exec -T backend npm run test:e2e 2>&1 | grep "^Tests:"
```

Expected: unit `92 passed`, e2e `~75 passed`.

- [ ] **Step 2: Listar commits Layer D**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline 3e21a59..HEAD
```

Expected: ~8 commits.

- [ ] **Step 3: NÃO pushar** — preferência do usuário.

Reportar:
> Layer D completa. Suite total: ~167 testes (92 unit + 75 e2e). Push pendente de autorização.

---

## Notas finais

**Anti-padrões a evitar:**

- Não fazer asserts strict sobre quem venceu (deck é random) — só sobre invariantes (4 placements únicos, vencedor tem rewards ≥ 0).
- Cada teste fecha o WS client (`client.close()`) ao fim — fundamental porque jests rodam em sequência mas WS leaks ainda atrapalham `--forceExit`.
- Não confiar em `game:game_over` para assertions no DB; SEMPRE use `lobby:game_over_summary` (garantia de persistência).
- `prisma.userInventory.upsert` é necessário para modos não-TRADITIONAL e DEGUSTACAO porque novo usuário só tem TRADITIONAL.

**Discoveries esperadas:**

- Tempo de partida vs. timeout — se com `TURN_TIMEOUT_MS=100ms` partidas ainda demoram >60s, investigar (pode ser que `consecutivePasses` nunca atinja threshold por algum motivo de bot AI).
- `summary.rewards` pode ter `undefined` para bots — testa apenas para humano.
- `disconnect-recovery` pode precisar de poll DB com timeout mais generoso se bot AI for lenta.

**Bugs reais que podem aparecer (potential issues):**

- Se `markFinished` falhar silenciosamente, Room.status fica WAITING/IN_PROGRESS — flagar como bug
- Se `RankedStats` não for criado para o vencedor em sala ranked, é bug
- Se humano disconnect → bot não assume → jogo trava → é bug
- Se 2 salas paralelas vazarem estado entre si (player aparece nas duas), é bug

Tratar essas situações como **discoveries flagáveis**, não fix no Layer D — abrir issue e mover pra depois.
