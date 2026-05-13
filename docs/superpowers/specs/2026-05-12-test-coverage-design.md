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

2. `src/game/engine/GameEngine.ts`: adicionar método
   `_setStateForTest({ hands?, deck?, pile? })` que substitui partes do estado
   interno. Usado apenas pela Layer A em cenários determinísticos (cartas
   específicas na mão, baralho próximo do fim, pilha pré-armada). Prefixo `_`
   sinaliza uso interno; sem guard de `NODE_ENV` (não é segurança, é
   convenção — equivalente ao `@internal` da JSDoc).

## Infra compartilhada

### Jest configs

- `jest.config.js` — Layer A (já existe). `testMatch: ['test/engine.test.ts']`.
- `test/jest-e2e.json` — Layers B/C/D (já existe).
  `testRegex: '.*\\.e2e-spec\\.ts$'`, transform `@swc/jest`, runInBand,
  forceExit, globalSetup que roda `prisma db push`.

### Banco de teste

- DB `temakuri_test` (já criado).
- `db-cleanup.ts` exporta `resetDb(prisma)` que executa **na ordem**:
  ```ts
  await prisma.gameResult.deleteMany({});  // sem cascade configurado
  await prisma.room.deleteMany({});        // RoomPlayer cascateia de Room
  await prisma.user.deleteMany({});        // cascateia Session, UserStats,
                                           // UserInventory, RankedStats,
                                           // PasswordResetToken
  ```
- `beforeEach` chama `resetDb(prisma)`. `GameResult.room` e `GameResult.user`
  **não** têm `onDelete: Cascade` no schema, por isso a ordem importa. `Room`
  não tem FK formal pra User (`hostId` é só `String`), então não cascateia em
  nenhuma direção partindo de User.

### Helpers chave

**`app-factory.ts`** — `createTestApp(): Promise<INestApplication>`. Faz tudo
que `main.ts` faz (ValidationPipe, setGlobalPrefix, useWebSocketAdapter).
Compartilhado por todas as camadas B/C/D.

**`auth-helpers.ts`** — `registerAndLogin(app, ['alice', 'bob'])`. Faz POST
`/auth/register` pra cada nome e retorna `{ alice: jwt, bob: jwt, ids: { alice, bob } }`.

**`room-helpers.ts`** — wrappers HTTP: `createRoom(token, opts)`,
`addBot(token, code)`, `removeBot(token, code, botId)`, `resetRoom(token, code)`.
Entrar/sair de sala (`lobby:join_room` / `lobby:leave_room`) é evento WS — fica
em `ws-client.ts`, não em `room-helpers.ts`.

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

**Triagem dos 5 testes falhando** — não são dead code, são discrepâncias
entre teste e implementação. Cada um precisa decisão "fixa código vs.
atualiza teste":

| Teste | Esperado | Real | Decidir |
|---|---|---|---|
| `rules — beatsPlay › Sabor ativo › deve jogar MAIS que minRequired` | `valid=false` ao jogar exatamente `minRequired` | `valid=true` | Regra de Sabor: `>` ou `>=`? Verificar com a especificação do jogo |
| `GameEngine — applyPassTurn › passar sem pilha é rejeitado` | falha | sucesso | Pode passar com pilha vazia? Verificar regra |
| `GameEngine — applyPassTurn › após wipe, engine está em PLAYER_TURN` | sem "Not the right phase" | tem | Único com lineage ao refactor `WIPE_RESOLUTION`; provavelmente teste a corrigir |
| `GameEngine — fim de rodada › round_ended quando esvazia mão` | tokens=3 | tokens=2 | Conferir lógica de tokens pós-round-end |
| `anti-fraude › picCardIndex fora do range da pilha` | falha | sucesso | Comment do teste menciona "index 5" mas código passa `0`; teste e/ou validação inconsistentes |

**Ações**:

1. Triar cada teste acima, decidir "fix engine vs fix test", aplicar e commitar
   separadamente das adições de cobertura (pra manter diff revisável).
2. Adicionar método `_setStateForTest({ hands?, deck?, pile? })` ao GameEngine.
3. Estender cobertura com os gaps abaixo.

**Gaps a cobrir**:

| Área | Casos novos |
|---|---|
| Mecânica Duelo (2 jogadores, qualquer modo) | setup com 11 cartas + 2 Pratos do Dia (via `HAND_SIZE[2]=11`); phase `DUEL_PASS_PICK`; ação `duel_pass_pick` (insert/discard); vitória. **`DEGUSTACAO` está no `GameMode` mas não tem branch dedicada no engine — é tratado como TRADITIONAL 2P. Cobrir Duelo via TRADITIONAL com `players=2`.** |
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

Apenas operações CRUD e de configuração ficam em HTTP. **Entrar/sair da sala
(`lobby:join_room`/`lobby:leave_room`) é via WebSocket — coberto na Layer C.**

- POST `/rooms`: pública/privada, todos modos, payload inválido, maxPlayers inválido
- GET `/rooms`: lista públicas WAITING; não lista privadas; não lista IN_PROGRESS
- GET `/rooms/:code`: sucesso; 404 quando inexistente
- POST `/rooms/:code/bots`: host adiciona; não-host → 403; cheia → 400
- DELETE `/rooms/:code/bots/:botId`: host remove; não-host → 403
- POST `/rooms/:code/reset`: host reseta uma sala FINISHED para WAITING; não-host → 403; sala não-FINISHED → 400

### profile (`/api/v1/profile`)

- GET `/profile`: retorna o próprio user + stats + inventory (autenticado)
- GET `/profile/leaderboard`: lista ranking público
- GET `/profile/:userId`: profile público; 404 quando inexistente
- PATCH `/profile`: atualiza avatar/username/etc. dentro do inventory; valor inválido → 400; sem auth → 401

### shop (`/api/v1/shop`)

- GET `/shop/catalog`: lista itens disponíveis
- GET `/shop/inventory`: lista o que o user já possui
- POST `/shop/avatar/:index`: compra avatar; coins insuficientes → 400; já possuído → 400; índice inválido → 400
- POST `/shop/mode/:mode`: compra modo de jogo; coins insuficientes → 400; já possuído → 400

### admin (`/api/v1/admin`) — smoke apenas

- 403 quando não-admin; 200 quando admin (sem testar funcionalidade ainda)

**Meta**: ~40 casos HTTP.

## Layer C — Gateway WebSocket

**Cenários por evento** (15 `@SubscribeMessage` no `notifications.gateway.ts`):

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
- `game:duel_pass_pick`: disparado em jogos 2-player (Duelo) quando entra na phase `DUEL_PASS_PICK`; insert/discard; plateIndex válido
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
- `duelo-full-game`: 1 humano + 1 bot, modo TRADITIONAL com 2 jogadores
  (`HAND_SIZE[2]=11` ativa as mecânicas de Duelo); assert 11 cartas + 2 pratos
  distribuídos, fase `DUEL_PASS_PICK` apareceu pelo menos 1 vez, `GAME_OVER`
  atingido. **Nota**: `DEGUSTACAO` está no `GameMode` mas sem branch no engine;
  é semanticamente redundante com TRADITIONAL 2P por enquanto. Não há arquivo
  separado pra DEGUSTACAO até a feature estar implementada.

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
- Branch `feat/test-coverage` criada do `main` atual no início da próxima sessão.
  Os commits anteriores `d6ec1e8` (infra e2e) e `07ed078` (spec) já estão em
  `main` local e ficam como base. Ao abrir o PR no final, todos os commits
  estarão na branch.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Drift schema vs migrations (em aberto) | Layer B/C/D usam `db push` — não dependem de migrations corretas. Layer A não toca DB. |
| Bots flaky com timeout 100ms | Watchdog `awaitGameOver` com timeout generoso (30s); se travar, falha clara em vez de pendurar. |
| `_setStateForTest` parece código de produção | Comentário JSDoc `@internal — testing only`; revisão futura pode mover pra um adapter. |
| Múltiplas conexões WS no mesmo Postgres | `runInBand` no Jest e2e (já configurado) garante 1 suite por vez. |
| 5 testes pré-existentes falhando (Sabor/pass/wipe/tokens/picCard) podem ser bugs reais | Triagem em Layer A é o primeiro passo. Cada um vira commit isolado com decisão "fix engine vs fix test" antes de adicionar cobertura nova. |
| DEGUSTACAO declarado mas não implementado | Tratado como TRADITIONAL 2P; testes específicos de DEGUSTACAO ficam fora do escopo até a feature existir. |
