# Temakuri — Cobertura de Testes (Backend)

**Data**: 2026-05-12
**Status**: Aprovado pelo usuário; pendente implementação
**Entrega**: commits locais por sessão → 1 PR único ao final

## Objetivo

Cobrir com testes automatizados toda a lógica de jogo e o flow do servidor de
ponta a ponta — do registro do usuário até o resultado de uma partida persistido
no banco — sem invadir o código de produção com mocks ou helpers de teste.

## Abordagem

Pirâmide clássica em 4 camadas, construídas de baixo pra cima. Cada camada
expõe defeitos diferentes; quando uma está estável, a próxima fica menor.

```
A. Engine (puro)       — funções e máquina de estado, sem DB nem rede
B. HTTP (REST)         — supertest contra a app Nest, banco real
C. Gateway (WS)        — 1 cliente WS humano + bots, gateway sob teste
D. Flow E2E            — partida completa até GAME_OVER, persistência verificada
```

## Estrutura de arquivos

```
temakuri-backend/
└── test/
    ├── engine.test.ts                              # Layer A — refatorado
    └── e2e/
        ├── http/                                   # Layer B
        │   ├── auth.e2e-spec.ts                    # já existe; mover pra cá
        │   ├── rooms.e2e-spec.ts
        │   ├── profile.e2e-spec.ts
        │   └── shop.e2e-spec.ts
        ├── gateway/                                # Layer C
        │   ├── lobby.e2e-spec.ts
        │   ├── game-traditional.e2e-spec.ts
        │   ├── game-mercado.e2e-spec.ts
        │   ├── game-rodizio.e2e-spec.ts
        │   └── game-duelo.e2e-spec.ts
        ├── flow/                                   # Layer D
        │   ├── traditional-full-game.e2e-spec.ts
        │   ├── mercado-full-game.e2e-spec.ts
        │   ├── rodizio-full-game.e2e-spec.ts
        │   ├── duelo-full-game.e2e-spec.ts
        │   ├── ranked-flow.e2e-spec.ts
        │   ├── disconnect-recovery.e2e-spec.ts
        │   └── concurrent-rooms.e2e-spec.ts
        └── helpers/
            ├── app-factory.ts
            ├── auth-helpers.ts
            ├── ws-client.ts
            ├── room-helpers.ts
            └── db-cleanup.ts
```

## Mudanças mínimas no código de produção

Apenas duas, ambas seguras:

1. `src/common/constants/game.constants.ts`: tornar `TURN_TIMEOUT_MS` e
   `STARTING_COUNTDOWN_MS` overridable via env. Defaults atuais (`30_000` e
   `3_000`) preservados em produção. `.env.test` seta `TURN_TIMEOUT_MS=100` e
   `STARTING_COUNTDOWN_MS=50`.

2. `src/game/engine/GameEngine.ts`: adicionar método `_setHandsForTest(map)`
   que substitui as mãos dos jogadores. Usado apenas pela Layer A em cenários
   determinísticos. Prefixo `_` sinaliza uso interno; sem guard de NODE_ENV
   (não é segurança, é convenção).

## Infra compartilhada

### Jest configs

- `jest.config.js` — Layer A (já existe). `testMatch: ['test/engine.test.ts']`.
- `test/jest-e2e.json` — Layers B/C/D (já existe).
  `testRegex: '.*\\.e2e-spec\\.ts$'`, transform `@swc/jest`, runInBand,
  forceExit, globalSetup que roda `prisma db push`.

### Banco de teste

- DB `temakuri_test` (já criado).
- Cada describe block: `beforeEach` faz `prisma.user.deleteMany({})`.
  Cascades cobrem sessions, room players, game results, password reset tokens,
  user stats, user inventory, ranked stats.
- Rooms e GameResults sem FK direto pra User: limpar separadamente em
  `db-cleanup.ts`.

### Helpers chave

**`app-factory.ts`** — `createTestApp(): Promise<INestApplication>`. Faz tudo
que `main.ts` faz (ValidationPipe, setGlobalPrefix, useWebSocketAdapter).
Compartilhado por todas as camadas B/C/D.

**`auth-helpers.ts`** — `registerAndLogin(app, ['alice', 'bob'])`. Faz POST
`/auth/register` pra cada nome e retorna `{ alice: jwt, bob: jwt, ids: { alice, bob } }`.

**`room-helpers.ts`** — wrappers HTTP: `createRoom(token, opts)`,
`addBot(token, code)`, `joinRoom(token, code)`. Retornam o body parseado.

**`ws-client.ts`** — classe `TestWsClient`:

```ts
class TestWsClient {
  userId: string;
  constructor(serverUrl: string);
  async connect(token: string): Promise<void>;
  async send(event: string, data: any): Promise<void>;
  async waitFor(event: string, timeoutMs?: number): Promise<any>;
  async waitForState(predicate: (state: ClientGameState) => boolean, timeoutMs?: number): Promise<ClientGameState>;
  events: Map<string, any[]>;
  close(): void;
}
```

`waitFor` resolve quando o evento chega ou rejeita após timeout. `waitForState`
agrega `game:state_sync` até o predicado passar.

## Layer A — Engine

**Estado atual**: 56 ✅ / 5 ❌ em `test/engine.test.ts`.

**Ações**:

1. Deletar 4 testes que referenciam `WIPE_RESOLUTION` e `playersWithEmptyHand`
   (dead code removido em `443f2af`).
2. Reescrever 1 teste (`round_ended é emitido quando jogador esvazia a mão`)
   pra refletir o comportamento atual.
3. Adicionar método `_setHandsForTest(map)` ao GameEngine.

**Gaps a cobrir**:

| Área | Casos novos |
|---|---|
| Modo DEGUSTACAO/Duelo (2P) | setup com 11 cartas + 2 Pratos do Dia; phase `DUEL_PASS_PICK`; ação `duel_pass_pick` (insert/discard); vitória |
| Modo MERCADO | swap inválido; market refill; market vazio no fim do baralho |
| Modo RODIZIO | rotação de seats entre rodadas; cobrir 3+ rodadas seguidas |
| Sabor | quebrar (categorias mistas com count suficiente); continuar (mesma categoria, count maior); Sabor que termina rodada |
| Tokens | jogador zera tokens → eliminação; último com tokens → vitória |
| GAME_OVER | shape final do state; `winner` populado; `ranking` ordenado |
| Edge — deck pequeno | rodada termina porque deck acabou (não porque alguém esvaziou mão) |
| Anti-fraude | índices fora do range; índices duplicados; jogada que não bate pilha; drawn card fora de hora |

**Meta**: 110+ casos passando em `engine.test.ts` ao final.

## Layer B — HTTP/REST

**Endpoints cobertos** (`auth` já feito em `auth.e2e-spec.ts`):

### rooms (`/api/v1/rooms`)

- POST `/rooms`: pública/privada, todos modos, payload inválido, maxPlayers inválido
- GET `/rooms`: lista públicas WAITING; não lista privadas; não lista IN_PROGRESS
- GET `/rooms/:code`: sucesso; 404 quando inexistente
- POST `/rooms/:code/join`: sucesso; cheia → 400; IN_PROGRESS → 400; FINISHED → 400; reentrar é idempotente
- POST `/rooms/:code/leave`: player sai; host sai (transfere host); último humano com bots → sala fecha
- POST `/rooms/:code/bots`: host adiciona; não-host → 403; cheia → 400
- DELETE `/rooms/:code/bots/:botId`: host remove; não-host → 403

### profile (`/api/v1/profile`)

- GET `/profile/me`: retorna user + stats + inventory
- PATCH `/profile/avatar`: dentro do inventory; fora → 400; sem auth → 401
- GET `/profile/:userId`: público; 404 quando inexistente

### shop (`/api/v1/shop`)

- GET `/shop/items`: lista
- POST `/shop/buy`: sucesso; coins insuficientes → 400; item já possuído → 400

### admin (`/api/v1/admin`) — smoke apenas

- 403 quando não-admin; 200 quando admin (sem testar funcionalidade ainda)

**Meta**: ~40 casos HTTP.

## Layer C — Gateway WebSocket

**Cenários por evento** (16 `@SubscribeMessage` no `notifications.gateway.ts`):

### Lobby

- `lobby:join_room`: conecta → `room:state`; sala inexistente → erro; broadcast
- `lobby:leave_room`: sai; broadcast; host sai → novo host
- `lobby:reset_room`: host reseta FINISHED → WAITING; não-host → erro
- `lobby:set_ready`: ready/unready; broadcast
- `lobby:start_game`: todos ready → STARTING → IN_PROGRESS; não-host → erro; não-todos-ready → erro

### In-game (1 humano + 3 bots por padrão)

- `game:request_state`: `game:state_sync` privado com `myHand`
- `game:play_cards`: válida → broadcast; inválida → erro privado
- `game:pass_turn`: PASS_PICK → vencedor recebe pile com `insertAtIndex`
- `game:draw_card` + `game:insert_drawn_card`: fluxo RODIZIO
- `game:trick_pick`: `take` move pra mão; `discard` joga fora
- `game:duel_pass_pick`: apenas DEGUSTACAO; insert/discard; plateIndex válido
- `game:market_swap`: apenas MERCADO; índices válidos; inválidos → erro
- `game:send_reaction`: broadcast
- `game:send_message`: chat broadcast

### Disconnect/reconnect

- Cliente cai → status DISCONNECTED → `player:disconnected` broadcast
- Reconecta com novo socket → `game:request_state` retorna estado
- Cai durante turno → bot assume após `TURN_TIMEOUT_MS`

**Meta**: ~50–60 casos WS.

## Layer D — Flow E2E

**Diferença chave**: jogo roda até `GAME_OVER`. Sem interceptar hands.

### Cenários por modo

- `traditional-full-game`: 1 humano + 3 bots; assert `Room.status='FINISHED'`,
  4 `GameResult` com `placement` 1–4, vencedor recebeu coins/xp/pds positivos,
  `UserStats.gamesPlayed` incrementado pro humano.
- `mercado-full-game`: idem + assert ≥1 `game:market_swap` ocorreu.
- `rodizio-full-game`: idem + assert seats rotacionaram entre rodadas.
- `duelo-full-game`: 1 humano + 1 bot; assert 11 cartas + 2 pratos distribuídos,
  fase `DUEL_PASS_PICK` apareceu, `GAME_OVER` atingido.

### Cross-mode

- `ranked-flow`: sala ranked → GAME_OVER → `RankedStats.rankedWins/Losses`,
  PDS atualizado.
- `disconnect-recovery`: humano cai mid-game → bot assume após timeout →
  reconecta → recebe estado → jogo finaliza normalmente.
- `concurrent-rooms`: 2 salas paralelas; isolamento de estado.

### Estratégia de asserts

**Loose**, sobre invariantes — não sobre quem vence:

```ts
expect(room.status).toBe('FINISHED');
expect(gameResults).toHaveLength(4);
expect(gameResults.map(r => r.placement).sort()).toEqual([1, 2, 3, 4]);
expect(gameResults.find(r => r.placement === 1)?.coinsEarned).toBeGreaterThan(0);
```

### Timing

`.env.test` seta `TURN_TIMEOUT_MS=100`. Partida típica termina em ~5–10s.
`jest.setTimeout(60000)` no describe.

### Watchdog anti-flaky

```ts
async function awaitGameOver(client: TestWsClient, timeoutMs = 30000) {
  return client.waitForState(s => s.phase === 'GAME_OVER', timeoutMs);
}
```

### Fora de escopo

- Qualidade da IA dos bots (apenas que terminam o jogo)
- Load/performance
- Queda de rede real (apenas client.close + reconnect manual)

**Meta**: ~15–20 casos flow.

## Volume total

| Layer | Arquivos novos | Casos | Sessões |
|---|---|---|---|
| A | refatora 1 | +50–70 | 1 |
| B | 4 novos | +40 | 1 |
| C | 5 novos + 5 helpers | +50–60 | 2 |
| D | 7 novos | +15–20 | 2 |
| **Total** | **~20 arquivos** | **~150–190** | **~6** |

## Workflow

- Cada sessão = 1 commit local (ou mais, conforme natural).
- **Nenhum push até alinhamento explícito do usuário.**
- Ao final das 6 sessões: 1 PR único agregando todos os commits.
- Branch dedicada (`feat/test-coverage` ou similar) — definir na primeira sessão.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Drift schema vs migrations (em aberto) | Layer B/C/D usam `db push` — não dependem de migrations corretas. Layer A não toca DB. |
| Bots flaky com timeout 100ms | Watchdog `awaitGameOver` com timeout generoso (30s); se travar, falha clara em vez de pendurar. |
| `_setHandsForTest` parece código de produção | Comentário JSDoc explícito `@internal — testing only`; revisão futura pode mover pra um adapter. |
| Múltiplas conexões WS no mesmo Postgres | `runInBand` no Jest e2e (já configurado) garante 1 suite por vez. |
