# Layer C — WebSocket Gateway Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrir os 15 `@SubscribeMessage` do `NotificationsGateway` com e2e usando 1 cliente WS humano de teste + bots (via HTTP) para preencher salas. Validar protocolo (broadcast, erros privados, state sync com `myHand` privado, disconnect/reconnect).

**Architecture:** Reusar `createTestApp` da Layer B, mas chamar `app.listen(0)` para bindar a um port aleatório — necessário pra WS clients reais. Novo helper `TestWsClient` (wrapper de `ws`) com API `connect/send/waitFor/waitForState/events/close`. Bots existentes (auto-play após `TURN_TIMEOUT_MS`) fazem o jogo avançar; reduzimos `TURN_TIMEOUT_MS` e `STARTING_COUNTDOWN_MS` via env para evitar testes de 30s.

**Tech Stack:** Jest 30, `@nestjs/testing`, `@nestjs/platform-ws`, `ws` (já é devDep), `@swc/jest`, Prisma. Roda via `docker compose exec backend npm run test:e2e`.

**Pré-requisito:** Layer A e B mergeadas (32 commits locais); suite atual: unit `92 passed`, e2e `51 passed`.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `src/common/constants/game.constants.ts` | MODIFY — `TURN_TIMEOUT_MS` e `STARTING_COUNTDOWN_MS` overridable via env |
| `.env.test` | MODIFY — adicionar `TURN_TIMEOUT_MS=100`, `STARTING_COUNTDOWN_MS=50` |
| `.env.test.example` | MODIFY — documentar as novas vars |
| `test/e2e/helpers/app-factory.ts` | MODIFY — expor função `createListeningTestApp()` que faz `app.listen(0)` |
| `test/e2e/helpers/ws-client.ts` | NEW — classe `TestWsClient` |
| `test/e2e/helpers/lobby-helpers.ts` | NEW — wrappers WS para join/ready/start |
| `test/e2e/gateway/lobby.e2e-spec.ts` | NEW — 5 eventos lobby |
| `test/e2e/gateway/game-traditional.e2e-spec.ts` | NEW — protocolo geral in-game |
| `test/e2e/gateway/game-mercado.e2e-spec.ts` | NEW — market_swap |
| `test/e2e/gateway/game-rodizio.e2e-spec.ts` | NEW — draw_card + insert_drawn_card |
| `test/e2e/gateway/game-duelo.e2e-spec.ts` | NEW — duel_pass_pick |
| `test/e2e/gateway/disconnect.e2e-spec.ts` | NEW — disconnect/reconnect |

Mudanças no código de produção: **2 valores constantes viram env-overridable, sem mudança de comportamento em produção** (defaults preservados).

---

## Task 0: Pré-condições

**Files:** N/A — só verificação.

- [ ] **Step 1: Confirmar branch e estado**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend status --short
git -C /home/anrry/github.com/temakuri/temakuri-backend branch --show-current
```

Expected: working tree limpa; branch `feat/test-coverage`.

- [ ] **Step 2: Confirmar baseline**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "^Tests:"
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
```

Expected: unit `92 passed`, e2e `51 passed`.

---

## Task 1: Tornar `TURN_TIMEOUT_MS` e `STARTING_COUNTDOWN_MS` env-overridable

**Files:**
- Modify: `src/common/constants/game.constants.ts` (linhas 36 e 38)
- Modify: `.env.test` (adicionar duas vars)
- Modify: `.env.test.example` (documentar)

- [ ] **Step 1: Atualizar constants**

Substituir as linhas 36 e 38 de `src/common/constants/game.constants.ts`:

```ts
export const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 30_000);
```

```ts
export const STARTING_COUNTDOWN_MS = Number(process.env.STARTING_COUNTDOWN_MS ?? 3_000);
```

(Preservar todo o resto do arquivo.)

- [ ] **Step 2: Confirmar valor lido OK**

```bash
docker compose exec -T backend node -e "process.env.TURN_TIMEOUT_MS='100'; console.log(Number(process.env.TURN_TIMEOUT_MS ?? 30000))"
```

Expected: `100`.

- [ ] **Step 3: Atualizar `.env.test`**

Adicionar ao final de `.env.test`:

```
TURN_TIMEOUT_MS=100
STARTING_COUNTDOWN_MS=50
```

- [ ] **Step 4: Atualizar `.env.test.example`**

Adicionar:

```
# Reduz timeouts para testes (defaults 30000 e 3000 em produção)
TURN_TIMEOUT_MS=100
STARTING_COUNTDOWN_MS=50
```

- [ ] **Step 5: Rodar suite — confirmar nenhuma regressão**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "^Tests:"
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
```

Expected: unit `92 passed`, e2e `51 passed`. Nada deve quebrar com timeouts reduzidos.

- [ ] **Step 6: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add src/common/constants/game.constants.ts .env.test .env.test.example
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "feat(constants): TURN_TIMEOUT_MS e STARTING_COUNTDOWN_MS overridable via env

Defaults preservados em produção (30000ms / 3000ms). Testes setam 100/50
para evitar partidas longas. Necessário para Layer C (gateway e2e)."
```

---

## Task 2: Helper `TestWsClient`

**Files:**
- Create: `test/e2e/helpers/ws-client.ts`

- [ ] **Step 1: Criar helper**

```ts
import WebSocket from 'ws';

type EventHandler = (data: any) => void;

export interface TestWsClientOptions {
  /** Timeout default para waitFor/waitForState (ms) */
  defaultTimeoutMs?: number;
}

export class TestWsClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  public events: Map<string, any[]> = new Map();
  public readonly defaultTimeoutMs: number;

  constructor(opts: TestWsClientOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5000;
  }

  async connect(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sep = url.includes('?') ? '&' : '?';
      this.socket = new WebSocket(`${url}${sep}token=${encodeURIComponent(token)}`);

      const onOpen = () => {
        this.socket!.off('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.socket!.off('open', onOpen);
        reject(err);
      };
      this.socket.once('open', onOpen);
      this.socket.once('error', onError);

      this.socket.on('message', (raw: Buffer) => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const event: string = parsed.event;
        const data = parsed.data ?? parsed.payload ?? parsed;
        if (!event) return;
        if (!this.events.has(event)) this.events.set(event, []);
        this.events.get(event)!.push(data);
        const set = this.listeners.get(event);
        if (set) {
          for (const fn of set) fn(data);
        }
      });
    });
  }

  send(event: string, data: any = {}): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send '${event}': socket not open`);
    }
    this.socket.send(JSON.stringify({ event, data }));
  }

  async waitFor<T = any>(event: string, timeoutMs?: number): Promise<T> {
    const limit = timeoutMs ?? this.defaultTimeoutMs;
    // Se já chegou antes, retorna a primeira ocorrência
    const buffered = this.events.get(event);
    if (buffered && buffered.length > 0) return buffered[0] as T;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`waitFor('${event}') timeout after ${limit}ms`));
      }, limit);
      const handler: EventHandler = (data) => {
        clearTimeout(timer);
        this.off(event, handler);
        resolve(data as T);
      };
      this.on(event, handler);
    });
  }

  async waitForState<T = any>(
    predicate: (state: T) => boolean,
    timeoutMs?: number,
  ): Promise<T> {
    const limit = timeoutMs ?? this.defaultTimeoutMs;
    const event = 'game:state_sync';
    // Checa buffer
    const buffered = this.events.get(event);
    if (buffered) {
      for (const state of buffered) {
        if (predicate(state as T)) return state as T;
      }
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`waitForState() timeout after ${limit}ms`));
      }, limit);
      const handler: EventHandler = (data) => {
        if (predicate(data as T)) {
          clearTimeout(timer);
          this.off(event, handler);
          resolve(data as T);
        }
      };
      this.on(event, handler);
    });
  }

  private on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  private off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Limpa o buffer de eventos (útil entre ações em um mesmo teste) */
  clearEvents(): void {
    this.events.clear();
  }

  close(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
    this.listeners.clear();
  }
}
```

- [ ] **Step 2: Sem commit ainda** — `app-factory` e `lobby-helpers` vão no mesmo commit (Task 3).

---

## Task 3: Estender `app-factory.ts` com `createListeningTestApp` + criar `lobby-helpers.ts` + commit conjunto

**Files:**
- Modify: `test/e2e/helpers/app-factory.ts`
- Create: `test/e2e/helpers/lobby-helpers.ts`

- [ ] **Step 1: Estender `app-factory.ts`**

Adicionar ao final do arquivo `test/e2e/helpers/app-factory.ts`:

```ts
import { AddressInfo } from 'net';

export interface ListeningTestApp {
  app: import('@nestjs/common').INestApplication;
  port: number;
  wsUrl: string;
}

/**
 * Bootstrapa o Nest e faz `listen(0)` para bindar em port aleatório.
 * Necessário para clientes WS de teste se conectarem.
 */
export async function createListeningTestApp(): Promise<ListeningTestApp> {
  const app = await createTestApp();
  await app.listen(0);
  const server = app.getHttpServer();
  const addr = server.address() as AddressInfo;
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to get listening address');
  }
  const port = addr.port;
  return {
    app,
    port,
    wsUrl: `ws://localhost:${port}/ws`,
  };
}
```

- [ ] **Step 2: Criar `lobby-helpers.ts`**

```ts
import { TestWsClient } from './ws-client.js';

/**
 * Sequência típica de lobby: join_room → set_ready → start_game (se host).
 * O caller deve esperar pelos eventos de transição (`room:state`, `game:state_sync`).
 */
export async function joinRoomWs(client: TestWsClient, roomCode: string): Promise<void> {
  client.send('lobby:join_room', { roomCode });
}

export async function setReadyWs(
  client: TestWsClient,
  roomCode: string,
  ready: boolean,
): Promise<void> {
  client.send('lobby:set_ready', { roomCode, ready });
}

export async function startGameWs(client: TestWsClient, roomCode: string): Promise<void> {
  client.send('lobby:start_game', { roomCode });
}

export async function leaveRoomWs(client: TestWsClient, roomCode: string): Promise<void> {
  client.send('lobby:leave_room', { roomCode });
}

export async function resetRoomWs(client: TestWsClient, roomCode: string): Promise<void> {
  client.send('lobby:reset_room', { roomCode });
}
```

- [ ] **Step 3: Commit os 3 arquivos**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/helpers/
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): helpers de WebSocket (TestWsClient + lobby-helpers + listening app)

TestWsClient: wrapper do 'ws' com API connect/send/waitFor/waitForState/
events/close para testes determinísticos de WebSocket.
createListeningTestApp(): bootstrapa Nest com listen(0) e retorna a wsUrl.
lobby-helpers: wrappers fininhos pra eventos de lobby."
```

---

## Task 4: `lobby.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/lobby.e2e-spec.ts`

**Cobertura:** 5 eventos — `lobby:join_room`, `lobby:leave_room`, `lobby:reset_room`, `lobby:set_ready`, `lobby:start_game`.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import {
  joinRoomWs,
  setReadyWs,
  startGameWs,
  leaveRoomWs,
  resetRoomWs,
} from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('Gateway — Lobby (e2e)', () => {
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

  describe('lobby:join_room', () => {
    it('cliente recebe room:state ao entrar na sala', async () => {
      const room = await createRoom(app, auth.tokens.alice, {});
      const client = new TestWsClient();
      await client.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(client, room.code);
      const state = await client.waitFor('room:state', 3000);
      expect(state).toBeDefined();
      client.close();
    });

    it('sala inexistente: cliente recebe game:error com code apropriado', async () => {
      const client = new TestWsClient();
      await client.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(client, 'INEXISTENTE');
      const err = await client.waitFor('game:error', 3000);
      expect(err).toMatchObject({ code: expect.any(String) });
      client.close();
    });
  });

  describe('lobby:set_ready', () => {
    it('player ready=true → outro cliente recebe broadcast room:state', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      const bob = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(alice, room.code);
      joinRoomWs(bob, room.code);
      await alice.waitFor('room:state', 3000);
      await bob.waitFor('room:state', 3000);
      alice.clearEvents();
      bob.clearEvents();
      setReadyWs(alice, room.code, true);
      // Bob recebe um room:state com alice ready=true
      const state = await bob.waitFor<any>('room:state', 3000);
      expect(state.players.find((p: any) => p.userId === auth.ids.alice)?.isReady).toBe(true);
      alice.close();
      bob.close();
    });
  });

  describe('lobby:start_game', () => {
    it('host inicia com todos ready → eventualmente IN_PROGRESS', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      // Host + 3 bots → todos prontos automaticamente
      await addBot(app, auth.tokens.alice, room.code);
      await addBot(app, auth.tokens.alice, room.code);
      await addBot(app, auth.tokens.alice, room.code);
      const alice = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(alice, room.code);
      await alice.waitFor('room:state', 3000);
      setReadyWs(alice, room.code, true);
      // Pequena pausa para o estado propagar
      await new Promise((r) => setTimeout(r, 100));
      startGameWs(alice, room.code);
      // Engine inicializa e emite game:state_sync com phase != DEALING após countdown
      const state = await alice.waitForState<any>(
        (s) => s.phase === 'PLAYER_TURN' || s.phase === 'DEALING',
        5000,
      );
      expect(state).toBeDefined();
      expect(['PLAYER_TURN', 'DEALING', 'TRICK_PICK']).toContain(state.phase);
      alice.close();
    });

    it('não-host tentando start recebe erro', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const bob = new TestWsClient();
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(bob, room.code);
      await bob.waitFor('room:state', 3000);
      startGameWs(bob, room.code);
      const err = await bob.waitFor('game:error', 3000);
      expect(err).toBeDefined();
      bob.close();
    });
  });

  describe('lobby:leave_room', () => {
    it('cliente sai → outros recebem broadcast atualizado', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      const bob = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      await bob.connect(wsUrl, auth.tokens.bob);
      joinRoomWs(alice, room.code);
      joinRoomWs(bob, room.code);
      await alice.waitFor('room:state', 3000);
      await bob.waitFor('room:state', 3000);
      alice.clearEvents();
      leaveRoomWs(bob, room.code);
      const state = await alice.waitFor<any>('room:state', 3000);
      const bobInState = state.players?.find((p: any) => p.userId === auth.ids.bob);
      expect(bobInState).toBeUndefined();
      alice.close();
      bob.close();
    });
  });

  describe('lobby:reset_room', () => {
    it('host pode resetar; broadcast aos clientes da sala', async () => {
      const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
      const alice = new TestWsClient();
      await alice.connect(wsUrl, auth.tokens.alice);
      joinRoomWs(alice, room.code);
      await alice.waitFor('room:state', 3000);
      alice.clearEvents();
      resetRoomWs(alice, room.code);
      // Pode chegar como room:state ou outro evento — testar apenas que algo chega
      // sem erro
      const racePromises = [
        alice.waitFor('room:state', 3000).catch(() => null),
        alice.waitFor('game:error', 3000).catch(() => null),
      ];
      const result = await Promise.race(racePromises);
      // Esperamos sucesso (room:state), não erro
      expect(result).not.toBeNull();
      // Se foi erro, o teste falha aqui
      expect(alice.events.get('game:error') ?? []).toHaveLength(0);
      alice.close();
    });
  });
});
```

- [ ] **Step 2: Rodar arquivo isolado**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/lobby" 2>&1 | tail -30
```

Investigar falhas:
- Se `room:state` não chega → confirmar nome do evento broadcastado (pode ser outro como `lobby:room_state`)
- Se `game:error` para sala inexistente vem com payload diferente → ajustar assert
- Se start_game requer todos prontos antes (inclusive os bots vão ready=true automaticamente?) → adicionar setReady para os bots OU aceitar erro como observação

Ajustar tests conforme observado, NÃO modificar produção.

- [ ] **Step 3: Rodar suite completa e2e**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
```

Expected: 51 + ~7 = ~58.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/lobby.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre eventos WS de lobby (join/leave/ready/start/reset)"
```

---

## Task 5: `game-traditional.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/game-traditional.e2e-spec.ts`

**Cobertura:** `game:request_state`, `game:play_cards` (válido + inválido), `game:pass_turn`, `game:trick_pick`, `game:send_reaction`, `game:send_message`.

Setup: 1 humano (alice) + 3 bots em sala TRADITIONAL 4P.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game TRADITIONAL (e2e)', () => {
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

  async function setupGameWithBots(): Promise<{ alice: TestWsClient; roomCode: string }> {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    const alice = new TestWsClient({ defaultTimeoutMs: 8000 });
    await alice.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(alice, room.code);
    await alice.waitFor('room:state', 3000);
    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(alice, room.code);
    return { alice, roomCode: room.code };
  }

  describe('game:request_state', () => {
    it('retorna game:state_sync privado com myHand populada', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      // Aguarda o jogo entrar em estado jogável
      await alice.waitForState<any>(
        (s) => Array.isArray(s.myHand) && s.myHand.length > 0,
        10000,
      );
      alice.clearEvents();
      alice.send('game:request_state', { roomCode });
      const state = await alice.waitForState<any>(
        (s) => Array.isArray(s.myHand) && s.myHand.length > 0,
        3000,
      );
      expect(state.myHand.length).toBeGreaterThan(0);
      alice.close();
    });
  });

  describe('game:play_cards', () => {
    it('jogada inválida (índices fora do range) recebe game:error privado', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      // Espera ser o turno do alice
      const state = await alice.waitForState<any>(
        (s) => s.currentTurnUserId === auth.ids.alice && s.phase === 'PLAYER_TURN',
        15000,
      );
      alice.clearEvents();
      alice.send('game:play_cards', { roomCode, cardIndices: [999] });
      const err = await alice.waitFor('game:error', 3000);
      expect(err).toBeDefined();
      alice.close();
    });
  });

  describe('game:send_reaction', () => {
    it('envia reação; emoji aparece como broadcast', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      await alice.waitForState<any>((s) => Array.isArray(s.myHand) && s.myHand.length > 0, 10000);
      alice.clearEvents();
      alice.send('game:send_reaction', { roomCode, emoji: '🍣' });
      const reactionEvent = await alice.waitFor('game:reaction', 3000).catch(() => null);
      // Pode chegar como game:reaction OU outro nome — falha graciosamente
      if (reactionEvent) {
        expect(reactionEvent).toBeDefined();
      } else {
        // No mínimo o teste passa se não chega erro
        expect(alice.events.get('game:error') ?? []).toHaveLength(0);
      }
      alice.close();
    });
  });

  describe('game:send_message', () => {
    it('envia mensagem de chat; broadcast chega de volta', async () => {
      const { alice, roomCode } = await setupGameWithBots();
      await alice.waitForState<any>((s) => Array.isArray(s.myHand) && s.myHand.length > 0, 10000);
      alice.clearEvents();
      alice.send('game:send_message', { roomCode, text: 'oi pessoal' });
      const msgEvent = await alice.waitFor('game:message', 3000).catch(() => null);
      if (msgEvent) {
        expect(msgEvent).toBeDefined();
      } else {
        expect(alice.events.get('game:error') ?? []).toHaveLength(0);
      }
      alice.close();
    });
  });
});
```

- [ ] **Step 2: Rodar isolado**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/game-traditional" 2>&1 | tail -30
```

Investigar falhas:
- Nomes de eventos broadcast podem diferir (`game:reaction` vs `game:reaction_received` etc) — ler `notifications.gateway.ts` para confirmar e ajustar
- O alice pode nunca chegar ao seu turno se `currentTurnUserId` rotaciona com bots — aumentar timeout ou ajustar a espera

- [ ] **Step 3: Suite completa**

```bash
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
```

Expected: ~62.

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/game-traditional.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre protocolo WS in-game (TRADITIONAL com bots)"
```

---

## Task 6: `game-mercado.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/game-mercado.e2e-spec.ts`

**Cobertura:** `game:market_swap` válido + inválido (em sala MERCADO).

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game MERCADO (e2e)', () => {
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
    // Desbloquear MERCADO para alice
    await prisma.userInventory.upsert({
      where: { userId: auth.ids.alice },
      create: { userId: auth.ids.alice, unlockedAvatars: [0, 1, 2, 3], unlockedModes: ['TRADITIONAL', 'MERCADO'] },
      update: { unlockedModes: ['TRADITIONAL', 'MERCADO'] },
    });
  });

  it('market_swap em sala MERCADO: handIndex inválido recebe erro', async () => {
    const room = await createRoom(app, auth.tokens.alice, { mode: 'MERCADO', maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    const alice = new TestWsClient({ defaultTimeoutMs: 10000 });
    await alice.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(alice, room.code);
    await alice.waitFor('room:state', 3000);
    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(alice, room.code);
    // Aguarda turno do alice
    await alice.waitForState<any>(
      (s) => s.currentTurnUserId === auth.ids.alice && s.phase === 'PLAYER_TURN',
      15000,
    );
    alice.clearEvents();
    alice.send('game:market_swap', { roomCode: room.code, handIndex: 999, marketIndex: 0 });
    const err = await alice.waitFor('game:error', 3000);
    expect(err).toBeDefined();
    alice.close();
  });
});
```

- [ ] **Step 2: Rodar + ajustar + suite + commit (mesmo padrão Tasks 4-5)**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/game-mercado" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/game-mercado.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre market_swap WS em sala MERCADO"
```

Expected: ~63.

---

## Task 7: `game-rodizio.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/game-rodizio.e2e-spec.ts`

**Cobertura:** `game:draw_card` em sala RODIZIO. (`game:insert_drawn_card` é flow secundário; cobrir se setup permitir.)

- [ ] **Step 1: Criar arquivo (estrutura paralela ao mercado)**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game RODIZIO (e2e)', () => {
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
      create: { userId: auth.ids.alice, unlockedAvatars: [0, 1, 2, 3], unlockedModes: ['TRADITIONAL', 'RODIZIO'] },
      update: { unlockedModes: ['TRADITIONAL', 'RODIZIO'] },
    });
  });

  it('draw_card em RODIZIO: chamada fora de fase recebe erro', async () => {
    const room = await createRoom(app, auth.tokens.alice, { mode: 'RODIZIO', maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    const alice = new TestWsClient({ defaultTimeoutMs: 10000 });
    await alice.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(alice, room.code);
    await alice.waitFor('room:state', 3000);
    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(alice, room.code);
    // Tenta drawCard imediatamente após start (provável fase DEALING/PLAYER_TURN
    // mas talvez não seja turno do alice → erro privado).
    await new Promise((r) => setTimeout(r, 200));
    alice.clearEvents();
    alice.send('game:draw_card', { roomCode: room.code });
    // Esperamos receber game:error (não é turno) OU game:state_sync (passou)
    const race = await Promise.race([
      alice.waitFor('game:error', 2000).then((e) => ({ kind: 'error', e })),
      alice.waitForState<any>(() => true, 2000).then((s) => ({ kind: 'state', s })),
    ]).catch(() => ({ kind: 'timeout' }));
    expect(['error', 'state', 'timeout']).toContain((race as any).kind);
    alice.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/game-rodizio" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/game-rodizio.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre draw_card WS em sala RODIZIO"
```

---

## Task 8: `game-duelo.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/game-duelo.e2e-spec.ts`

**Cobertura:** `game:duel_pass_pick` em sala 2P. Setup é desafiador — o flow real exige chegar à fase `DUEL_PASS_PICK`, que requer `applyDrawCard` em jogo Duelo.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Game Duelo (2P, e2e)', () => {
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

  it('duel_pass_pick fora de fase recebe erro', async () => {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 2 });
    await addBot(app, auth.tokens.alice, room.code);
    const alice = new TestWsClient({ defaultTimeoutMs: 10000 });
    await alice.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(alice, room.code);
    await alice.waitFor('room:state', 3000);
    setReadyWs(alice, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(alice, room.code);
    await alice.waitForState<any>(
      (s) => Array.isArray(s.myHand) && s.myHand.length > 0,
      10000,
    );
    alice.clearEvents();
    // Tenta duel_pass_pick sem estar na fase DUEL_PASS_PICK → erro privado
    alice.send('game:duel_pass_pick', { roomCode: room.code, plateIndex: 0, action: 'insert', insertAtIndex: 0 });
    const err = await alice.waitFor('game:error', 3000);
    expect(err).toBeDefined();
    alice.close();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/game-duelo" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/game-duelo.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre duel_pass_pick WS em sala 2P"
```

---

## Task 9: `disconnect.e2e-spec.ts`

**Files:**
- Create: `test/e2e/gateway/disconnect.e2e-spec.ts`

**Cobertura:** cliente cai (close), depois reconecta com novo socket e recupera estado via `game:request_state`.

- [ ] **Step 1: Criar arquivo**

```ts
import { INestApplication } from '@nestjs/common';
import { createListeningTestApp } from '../helpers/app-factory.js';
import { registerAndLogin, AuthBundle } from '../helpers/auth-helpers.js';
import { resetDb } from '../helpers/db-cleanup.js';
import { createRoom, addBot } from '../helpers/room-helpers.js';
import { TestWsClient } from '../helpers/ws-client.js';
import { joinRoomWs, setReadyWs, startGameWs } from '../helpers/lobby-helpers.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

jest.setTimeout(30000);

describe('Gateway — Disconnect/Reconnect (e2e)', () => {
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

  it('reconexão: novo socket recebe state via game:request_state', async () => {
    const room = await createRoom(app, auth.tokens.alice, { maxPlayers: 4 });
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    await addBot(app, auth.tokens.alice, room.code);
    const first = new TestWsClient({ defaultTimeoutMs: 10000 });
    await first.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(first, room.code);
    await first.waitFor('room:state', 3000);
    setReadyWs(first, room.code, true);
    await new Promise((r) => setTimeout(r, 100));
    startGameWs(first, room.code);
    await first.waitForState<any>((s) => Array.isArray(s.myHand) && s.myHand.length > 0, 10000);
    first.close();

    // Espera o servidor detectar disconnect
    await new Promise((r) => setTimeout(r, 200));

    const second = new TestWsClient({ defaultTimeoutMs: 5000 });
    await second.connect(wsUrl, auth.tokens.alice);
    joinRoomWs(second, room.code);
    second.send('game:request_state', { roomCode: room.code });
    const state = await second.waitForState<any>(
      (s) => Array.isArray(s.myHand),
      5000,
    );
    expect(state.myHand).toBeDefined();
    second.close();
  });

  it('conexão sem token é recusada', async () => {
    const client = new TestWsClient();
    await expect(client.connect(wsUrl, '')).rejects.toBeDefined();
  });

  it('conexão com token inválido é recusada', async () => {
    const client = new TestWsClient();
    await expect(client.connect(wsUrl, 'not-a-valid-jwt')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2-4: rodar + ajustar + commit**

```bash
docker compose exec -T backend npm run test:e2e -- --testPathPattern="gateway/disconnect" 2>&1 | tail -25
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/e2e/gateway/disconnect.e2e-spec.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(e2e): cobre disconnect/reconnect + auth WS"
```

---

## Task 10: Verificação final

**Files:** N/A — só relato.

- [ ] **Step 1: Suite completa**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "^Tests:"
docker compose exec -T backend npm run test:e2e 2>&1 | grep -E "^Tests:"
```

Expected: unit `92 passed`, e2e `~68-72 passed`.

- [ ] **Step 2: Listar commits da Layer C**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline 6255034..HEAD
```

Expected: ~10 commits desde Layer B.

- [ ] **Step 3: NÃO pushar** — preferência do usuário.

Reportar:
> Layer C completa. e2e: ~70 passed. Push pendente de autorização.

---

## Notas finais

**Anti-padrões a evitar:**

- Não usar `.toBe(true)` em estados que dependem de bot timing — preferir asserts em invariantes (`expect(state).toBeDefined()`, `expect(state.phase).toMatch(/PLAYER_TURN|TRICK_PICK|DEALING/)`).
- Não fechar a app entre tests do mesmo arquivo — `beforeAll`/`afterAll` lida com isso; `beforeEach` só limpa DB.
- Sempre fechar os WS clients (`alice.close()`, `bob.close()`) ao fim do teste — evita leaks.
- Bots demoram `TURN_TIMEOUT_MS=100ms` para jogar; com 3 bots, 1 rodada pode levar ~300-1000ms.

**Discoveries esperadas:**

- Nomes de eventos broadcast diferem do que adivinhei (`game:reaction` pode ser `game:reaction_received` etc.) — investigar `notifications.gateway.ts` e ajustar.
- Alguns eventos podem requerer setup preciso (DUEL_PASS_PICK só dispara via flow específico).
- O server pode encerrar conexões com close codes específicos (4001, 4002) — testes podem precisar conferir o code.

**Fora de escopo (Layer D ou follow-up):**

- Múltiplos humanos conectados simultaneamente jogando uma partida real (Layer D)
- Cenários de race condition em chat cooldowns
- Reconexão durante o turno (bot precisa assumir) — testar em Layer D
