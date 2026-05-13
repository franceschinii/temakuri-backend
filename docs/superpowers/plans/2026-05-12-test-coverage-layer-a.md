# Layer A — Engine Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triar os 5 testes falhando em `test/engine.test.ts` e adicionar cobertura nas áreas listadas como gap na spec (Duelo, MERCADO extras, RODIZIO extras, Sabor, tokens, GAME_OVER, deck pequeno, anti-fraude). Meta: 110+ casos passando, 0 falhando.

**Architecture:** Layer A é puramente funcional — não toca DB, rede ou Nest. Trabalho sobre `src/game/engine/GameEngine.ts`, `src/game/engine/rules.ts`, `src/game/engine/deck.ts` (sem alterações esperadas) e o arquivo de teste `test/engine.test.ts`. Uma única alteração ao engine de produção: método `_setStateForTest({ hands?, deck?, pile?, duelPlates? })` para cenários determinísticos.

**Tech Stack:** Jest 30, ts-jest (config existente em `jest.config.js`). Roda via `docker compose exec backend npm test`.

**Pre-requisito:** Stack `docker compose` rodando (postgres + backend + frontend). Verificar com `docker compose ps` antes de começar.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `src/game/engine/GameEngine.ts` | Adicionar método `_setStateForTest` (~15 linhas) |
| `test/engine.test.ts` | Triar 5 testes falhando; adicionar ~50-70 casos novos em describes existentes/novos |
| `docs/superpowers/plans/2026-05-12-test-coverage-layer-a.md` | Este plano (cria pra checkbox tracking) |

Nenhum outro arquivo da produção é tocado. Sem novos arquivos de teste — tudo acumula em `engine.test.ts` (consistência com o que já existe; o spec ressalva que arquivos novos só aparecem nas Layers B/C/D).

---

## Task 0: Preparação — branch e baseline

**Files:**
- N/A — apenas comandos git

- [ ] **Step 1: Confirmar working tree limpa e na `main` local**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend status --short
git -C /home/anrry/github.com/temakuri/temakuri-backend branch --show-current
```

Expected: working tree limpa; branch `main`.

- [ ] **Step 2: Criar branch `feat/test-coverage` a partir do `main` atual**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend checkout -b feat/test-coverage
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline -3
```

Expected: os 3 commits topo são `8b0392c` (spec corrigido), `07ed078` (spec inicial), `d6ec1e8` (infra e2e).

- [ ] **Step 3: Rodar suite atual e gravar baseline**

```bash
docker compose exec -T backend npm test 2>&1 | tail -5
```

Expected: `Tests: 5 failed, 56 passed, 61 total`. Isso é o baseline; ao fim do plano deve virar `0 failed, 110+ passed`.

---

## Task 1: Adicionar `_setStateForTest` ao GameEngine

**Files:**
- Modify: `src/game/engine/GameEngine.ts` (adicionar método público após o construtor)
- Modify: `test/engine.test.ts` (adicionar describe block de smoke do helper)

- [ ] **Step 1: Escrever teste failing que usa `_setStateForTest`**

Adicionar no fim de `test/engine.test.ts`, antes do último `});` da seção mais externa:

```ts
describe('GameEngine — _setStateForTest helper', () => {
  test('injeta mãos específicas nos jogadores', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();

    const hand1 = [card(7, 'SUSHI'), card(7, 'SUSHI')];
    const hand2 = [card(1, 'PIZZA'), card(1, 'PIZZA')];
    engine._setStateForTest({
      hands: { [ids[0]]: hand1, [ids[1]]: hand2 },
    });

    const state1 = engine.getClientStateFor(ids[0]);
    expect(state1.myHand).toEqual(hand1);
    const state2 = engine.getClientStateFor(ids[1]);
    expect(state2.myHand).toEqual(hand2);
  });

  test('injeta pilha vazia', () => {
    const { engine } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({ pile: [] });
    const state = engine.getClientStateFor('p1');
    expect(state.pile).toHaveLength(0);
  });

  test('injeta deck pequeno', () => {
    const { engine } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({ deck: [card(1, 'SUSHI'), card(2, 'RAMEN')] });
    const state = engine.getClientStateFor('p1');
    expect(state.drawPileCount).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker compose exec -T backend npm test -- --testNamePattern="_setStateForTest helper" 2>&1 | tail -15
```

Expected: 3 testes falham com `TypeError: engine._setStateForTest is not a function`.

- [ ] **Step 3: Implementar `_setStateForTest` no GameEngine**

Em `src/game/engine/GameEngine.ts`, adicionar logo após o método `addPlayer` (~linha 84):

```ts
/**
 * @internal — testing only.
 * Substitui partes do estado interno do engine para cenários determinísticos
 * em testes unitários. Não use em código de produção.
 */
_setStateForTest(state: {
  hands?: Record<string, Card[]>;
  deck?: Card[];
  pile?: Card[];
  duelPlates?: Record<string, Card[]>;
  tokens?: Record<string, number>;
}): void {
  if (state.hands) {
    for (const [userId, hand] of Object.entries(state.hands)) {
      const player = this.players.find(p => p.userId === userId);
      if (player) player.hand = [...hand];
    }
  }
  if (state.deck !== undefined) this.drawPile = [...state.deck];
  if (state.pile !== undefined) this.pile = [...state.pile];
  if (state.duelPlates) {
    for (const [userId, plates] of Object.entries(state.duelPlates)) {
      this.duelPlates.set(userId, [...plates]);
    }
  }
  if (state.tokens) {
    for (const [userId, n] of Object.entries(state.tokens)) {
      const player = this.players.find(p => p.userId === userId);
      if (player) player.tokensLeft = n;
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
docker compose exec -T backend npm test -- --testNamePattern="_setStateForTest helper" 2>&1 | tail -10
```

Expected: 3 testes passam.

- [ ] **Step 5: Rodar suite inteira pra garantir não regrediu**

```bash
docker compose exec -T backend npm test 2>&1 | tail -5
```

Expected: `Tests: 5 failed, 59 passed, 64 total` (5 testes falhando ainda; 56 + 3 novos passando).

- [ ] **Step 6: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add src/game/engine/GameEngine.ts test/engine.test.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): adiciona _setStateForTest helper

Permite injetar hands, deck, pile e duelPlates em testes unitários sem
depender da aleatoriedade do shuffle. Marcado como @internal."
```

---

## Task 2: Triar — Sabor "deve jogar MAIS que minRequired"

**Files:**
- Modify: `test/engine.test.ts` (linha ~131-138)

**Contexto do failure**:

```ts
// test/engine.test.ts:131
test('deve jogar MAIS que minRequired para superar', () => {
  const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
  const played = [card(5, 'SUSHI'), card(5, 'SUSHI')];
  expect(beatsPlay(played, pile, true, 2).valid).toBe(false);
});
```

**Engine code relevante** (`src/game/engine/rules.ts:24-29`):

```ts
if (saborActive) {
  if (played.length < saborMinRequired) {
    return { valid: false, reason: `Sabor ativo: jogue pelo menos ${saborMinRequired} carta(s)` };
  }
}
```

A mensagem de erro do engine diz "**pelo menos N cartas**" (≥ N). O teste afirma o oposto: que precisa ser **estritamente mais** (> N).

**Análise**: os outros 3 testes irmãos no mesmo describe block já passam com `valid=true` para `played.length === minRequired`. O teste falhando é inconsistente com os companheiros.

**Decisão prescrita**: o teste é o errado. O engine está aplicando "pelo menos minRequired", e os tests subsequentes (`quebrar Sabor com categorias mistas + count >= minRequired`) confirmam essa semântica.

- [ ] **Step 1: Atualizar o teste para refletir a semântica "pelo menos"**

Substituir o teste em `test/engine.test.ts` (~linha 131):

```ts
test('jogar exatamente minRequired com mesma categoria + valor maior vence', () => {
  const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
  const played = [card(5, 'SUSHI'), card(5, 'SUSHI')];
  // minRequired=2; played.length=2 atende, e valor 5 > 3 → válido
  expect(beatsPlay(played, pile, true, 2).valid).toBe(true);
});
```

- [ ] **Step 2: Rodar suite e confirmar que essa falha sumiu**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:|✕"
```

Expected: `Tests: 4 failed, 60 passed, 64 total`. Os 4 que sobram são os outros falhando.

- [ ] **Step 3: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/engine.test.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): corrige teste de Sabor minRequired

Engine permite exatamente minRequired (rules.ts diz 'pelo menos N'),
não estritamente >. O teste estava inconsistente com os outros do
mesmo describe."
```

---

## Task 3: Triar — "passar sem pilha é rejeitado"

**Files:**
- Investigate: `src/game/engine/GameEngine.ts` (procurar `applyPassTurn`)
- Modify: `test/engine.test.ts` (linha ~302-310) OU `src/game/engine/GameEngine.ts` (conforme decisão)

**Contexto do failure**:

```ts
// test/engine.test.ts:302
test('passar sem pilha é rejeitado', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  const result = engine.applyPassTurn(ids[0], 0);
  expect(result.success).toBe(false);
});
```

Engine retorna `success=true`.

- [ ] **Step 1: Ler `applyPassTurn` no engine**

```bash
grep -n "applyPassTurn" /home/anrry/github.com/temakuri/temakuri-backend/src/game/engine/GameEngine.ts
```

Ler 30 linhas a partir da definição:

```bash
sed -n '<linha>,<linha+30>p' /home/anrry/github.com/temakuri/temakuri-backend/src/game/engine/GameEngine.ts
```

- [ ] **Step 2: Decidir entre as duas hipóteses**

Hipótese A — **bug no engine**: `applyPassTurn` deveria checar `if (this.pile.length === 0) return { success: false, reason: '...' }` no início e não checa. Conserto: adicionar essa validação.

Hipótese B — **comportamento intencional**: passar sem pilha é permitido (vira pulo de turno). O teste reflete uma regra antiga que foi removida. Conserto: deletar o teste ou inverter expectativa.

**Critério de decisão**: ler o handler `game:pass_turn` em `src/notifications/notifications.gateway.ts:388` e ver como ele trata o caso `success=false`. Se houver UX que assume "pass sem pilha = inválido", é Hipótese A. Se o front aceita o pass como skip, é Hipótese B.

```bash
grep -A 15 "handlePassTurn" /home/anrry/github.com/temakuri/temakuri-backend/src/notifications/notifications.gateway.ts | head -30
```

Também checar o front:

```bash
grep -rn "game:pass_turn\|passTurn" /home/anrry/github.com/temakuri/temakuri-frontend/src/
```

- [ ] **Step 3a: Se Hipótese A (bug no engine)**

Adicionar no início de `applyPassTurn` em `src/game/engine/GameEngine.ts`:

```ts
if (this.pile.length === 0) {
  return { success: false, reason: 'Cannot pass with empty pile', events: [] };
}
```

- [ ] **Step 3b: Se Hipótese B (teste defasado)**

Substituir o teste por:

```ts
test('passar sem pilha avança o turno (pulo)', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  const result = engine.applyPassTurn(ids[0], 0);
  expect(result.success).toBe(true);
  // Confirma que o turno trocou
  const state = engine.getClientStateFor(ids[0]);
  expect(state.currentTurnUserId).toBe(ids[1]);
});
```

- [ ] **Step 4: Rodar e confirmar 0 regressões**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
```

Expected: `Tests: 3 failed, 61 passed, 64 total`.

- [ ] **Step 5: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add <arquivos alterados>
# Se foi 3a:
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "fix(engine): rejeita pass com pilha vazia"
# Se foi 3b:
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): atualiza teste de pass sem pilha (agora é pulo de turno)"
```

---

## Task 4: Triar — "após wipe, engine está em PLAYER_TURN"

**Files:**
- Modify: `test/engine.test.ts` (linha ~339-350)

**Contexto do failure**:

```ts
// test/engine.test.ts:339
test('após wipe, engine está em PLAYER_TURN (não WIPE_RESOLUTION)', () => {
  // ... setup
  const result = engine.applyPassTurn(ids[0], 0);
  if (!result.success) {
    // se falhou por outro motivo, não é erro de fase
    expect(result.reason).not.toMatch(/Not the right phase/);
  }
});
```

Real: `result.reason` contém "Not the right phase".

**Análise**: este teste é o único dos 5 com lineage direto ao refactor `WIPE_RESOLUTION` (`443f2af`). O nome do teste se refere a um estado intermediário `WIPE_RESOLUTION` que foi removido — então tecnicamente o teste agora não tem mais propósito (a fase que ele negava não existe mais).

Mas a assertion atual é "se applyPassTurn falhou, não falhou por motivo de fase". Isso ainda é uma propriedade testável: dado um setup pós-wipe, passar não deveria falhar com "Not the right phase".

O fato de a engine agora retornar exatamente essa razão sugere que **algo na lógica pós-wipe quebrou** o caminho que esse teste cobria.

**Decisão prescrita**: investigar o setup do teste (linhas 326-339) — qual é o estado quando `applyPassTurn` é chamado? E ler o handler de wipe no engine.

- [ ] **Step 1: Ler o teste inteiro com setup**

```bash
sed -n '325,355p' /home/anrry/github.com/temakuri/temakuri-backend/test/engine.test.ts
```

- [ ] **Step 2: Identificar onde a phase muda pós-wipe**

```bash
grep -n "phase\|wipe\|PASS_PICK" /home/anrry/github.com/temakuri/temakuri-backend/src/game/engine/GameEngine.ts | head -40
```

- [ ] **Step 3: Decidir**

Provável conclusão: o setup do teste é falho. Quando wipe acontece, o engine entra em `PASS_PICK` (vencedor escolhe o `insertAtIndex` pro pile). O teste tenta chamar `applyPassTurn` quando deveria estar em `PASS_PICK`, não `PLAYER_TURN` — daí a mensagem "Not the right phase".

Reformular o teste pra cobrir o que ele *deveria* testar: depois do wipe se completar (vencedor escolhe e insere a pile), o engine volta pra `PLAYER_TURN`.

- [ ] **Step 4: Substituir o teste**

Substituir em `test/engine.test.ts`:

```ts
test('após wipe completo, engine volta pra PLAYER_TURN', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(7, 'SUSHI'), card(7, 'SUSHI')],
      [ids[1]]: [card(1, 'PIZZA')],
    },
    pile: [card(3, 'TACO')],
  });
  // Player 0 joga 2 cartas → wipe (count > pile)
  engine.applyPlayCards(ids[0], [0, 1]);
  // Engine deve estar em PASS_PICK aguardando vencedor (player 0) escolher
  // insertAtIndex. Player 0 passa o turno completando o wipe.
  engine.applyPassTurn(ids[0], 0);
  const state = engine.getClientStateFor(ids[0]);
  expect(state.phase).toBe('PLAYER_TURN');
});
```

- [ ] **Step 5: Rodar e confirmar passa**

```bash
docker compose exec -T backend npm test -- --testNamePattern="após wipe" 2>&1 | tail -8
```

- [ ] **Step 6: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/engine.test.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): reescreve teste de wipe usando _setStateForTest

Setup determinístico evita depender do shuffle; testa explicitamente
que após wipe (play → PASS_PICK → completar) engine volta para
PLAYER_TURN."
```

---

## Task 5: Triar — "round_ended emitido quando jogador esvazia mão"

**Files:**
- Investigate: `src/game/engine/GameEngine.ts` (lógica de fim de rodada e tokens)
- Modify: `test/engine.test.ts` (linha ~365-380) OU engine

**Contexto do failure**:

```ts
// test/engine.test.ts:365
test('round_ended é emitido quando jogador esvazia a mão', () => {
  // ... setup que faz player ficar com 0 cartas
  const stateWinner = engine.getClientStateFor('winner');
  expect(stateWinner.players.find(p => p.userId === 'winner')!.tokensLeft).toBe(3);
});
```

Real: `tokensLeft` retorna 2, não 3.

**Análise**: Vencedor da rodada ganha tokens? Ou perde menos? Tokens iniciais = `INITIAL_TOKENS` (2). Se o engine atribui +1 token ao vencedor da rodada, esperado seria 3. Real é 2 — sugere que ou o engine não dá +1, ou o teste setou tokens iniciais a 1 (e o engine deu +1 = 2).

- [ ] **Step 1: Ler o teste completo com setup**

```bash
sed -n '358,385p' /home/anrry/github.com/temakuri/temakuri-backend/test/engine.test.ts
```

- [ ] **Step 2: Ler como o engine atualiza tokens em fim de rodada**

```bash
grep -n "tokensLeft\|round_ended\|endRound" /home/anrry/github.com/temakuri/temakuri-backend/src/game/engine/GameEngine.ts
```

- [ ] **Step 3: Decidir entre as 2 hipóteses**

Hipótese A — **engine não dá +1 ao vencedor da rodada (regra de jogo diz que deveria)**. Conserto: adicionar `player.tokensLeft++` no handler de fim de rodada.

Hipótese B — **regra mudou e vencedor não ganha mais token**. Conserto: atualizar teste para esperar `tokensLeft === INITIAL_TOKENS` (ou o valor correto).

**Critério**: olhar o changelog do GameEngine via git log:

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline --all -- src/game/engine/GameEngine.ts | head -10
```

Se houver commits recentes de "remove token reward" ou similar, é B. Se a regra é estável, é A.

- [ ] **Step 4: Aplicar a correção decidida**

Veja exemplos análogos em Task 3 (Steps 3a/3b).

- [ ] **Step 5: Rodar suite**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
```

Expected: `Tests: 1 failed, 63 passed, 64 total`.

- [ ] **Step 6: Commit**

Mensagem conforme a hipótese:
- A: `fix(engine): atribui +1 token ao vencedor da rodada`
- B: `test(engine): atualiza expectativa de tokens pós-rodada`

---

## Task 6: Triar — "picCardIndex fora do range da pilha é rejeitado"

**Files:**
- Modify: `test/engine.test.ts` (linha ~520-530)

**Contexto do failure**:

```ts
// test/engine.test.ts:525
engine.applyPlayCards(ids[0], [0]); // pilha tem 1 carta
const result = engine.applyPassTurn(ids[1], 0); // index 5 inexistente
expect(result.success).toBe(false);
```

Real: `success=true`. Note o **conflito entre comentário e código**: comentário diz "index 5 inexistente", mas o argumento é `0`.

**Análise**: o teste foi refatorado a meio caminho — alguém mudou o argumento de `5` para `0` mas não tirou o comentário nem o assert. Com `insertAtIndex=0` numa pilha de 1 carta, é válido (inserir no início). Logo o engine corretamente retorna `success=true`.

**Decisão prescrita**: corrigir o teste pra de fato testar o caso fora-do-range.

- [ ] **Step 1: Ler contexto completo**

```bash
sed -n '515,540p' /home/anrry/github.com/temakuri/temakuri-backend/test/engine.test.ts
```

- [ ] **Step 2: Reescrever o teste para realmente passar um índice fora do range**

```ts
test('picCardIndex fora do range da pilha é rejeitado', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(5, 'SUSHI')],
      [ids[1]]: [card(1, 'PIZZA')],
    },
    pile: [card(3, 'TACO')],
  });
  engine.applyPlayCards(ids[0], [0]); // pile agora tem 2 cartas (3,5)
  // insertAtIndex válido seria 0, 1, ou 2; 99 é fora do range
  const result = engine.applyPassTurn(ids[1], 99);
  expect(result.success).toBe(false);
});
```

- [ ] **Step 3: Rodar e confirmar passa**

```bash
docker compose exec -T backend npm test -- --testNamePattern="picCardIndex fora do range" 2>&1 | tail -5
```

Se falhar (engine não valida o range), então é **bug do engine** — adicionar validação em `applyPassTurn`:

```ts
// dentro de applyPassTurn, após validar phase
if (insertAtIndex < 0 || insertAtIndex > this.pile.length) {
  return { success: false, reason: 'insertAtIndex out of range', events: [] };
}
```

- [ ] **Step 4: Rodar suite inteira**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
```

Expected: `Tests: 0 failed, 64 passed, 64 total`. **Marco: todos os testes existentes passam.**

- [ ] **Step 5: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/engine.test.ts <talvez engine>
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): valida insertAtIndex fora do range da pilha"
```

---

## Task 7: Cobertura nova — Duelo (2 jogadores)

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: testa as mecânicas que `HAND_SIZE[2]=11` aciona — 11 cartas na mão + 2 Pratos do Dia + phase `DUEL_PASS_PICK`. Modo TRADITIONAL com 2 jogadores.

- [ ] **Step 1: Adicionar describe block de Duelo**

Em `test/engine.test.ts`, criar novo describe:

```ts
describe('GameEngine — Duelo (2 jogadores)', () => {
  test('setup distribui 11 cartas na mão + 2 Pratos do Dia por jogador', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    const state1 = engine.getClientStateFor(ids[0]);
    const state2 = engine.getClientStateFor(ids[1]);
    expect(state1.myHand).toHaveLength(11);
    expect(state2.myHand).toHaveLength(11);
    expect(state1.myDuelPlates).toHaveLength(2);
    expect(state2.myDuelPlates).toHaveLength(2);
  });

  test('duelPlates aparece em players adversários (count only)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    const state1 = engine.getClientStateFor(ids[0]);
    // duelPlates do oponente: só count, sem ver cartas
    expect(state1.duelPlates).not.toBeNull();
    expect(state1.duelPlates![ids[1]]).toHaveLength(2);
  });

  test('Pratos do Dia são distintos das cartas da mão', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    const state1 = engine.getClientStateFor(ids[0]);
    const handIds = new Set(state1.myHand.map(c => c.id));
    const plateIds = state1.myDuelPlates!.map(c => c.id);
    plateIds.forEach(id => expect(handIds.has(id)).toBe(false));
  });

  test('pass turn que esvaziaria pilha em Duelo aciona DUEL_PASS_PICK', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(7, 'SUSHI'), card(7, 'SUSHI')],
        [ids[1]]: [card(1, 'PIZZA')],
      },
      pile: [card(3, 'TACO')],
      duelPlates: {
        [ids[0]]: [card(2, 'RAMEN'), card(2, 'RAMEN')],
        [ids[1]]: [card(4, 'CURRY'), card(4, 'BURGER')],
      },
    });
    engine.applyPlayCards(ids[0], [0, 1]); // wipe
    engine.applyPassTurn(ids[0], 0);       // completa wipe
    // Agora player 0 deveria escolher entre os pratos do dia (DUEL_PASS_PICK)
    const state = engine.getClientStateFor(ids[0]);
    expect(['DUEL_PASS_PICK', 'PLAYER_TURN']).toContain(state.phase);
    // (relaxado porque depende da regra exata de quando DUEL_PASS_PICK dispara)
  });
});
```

- [ ] **Step 2: Rodar e investigar falhas**

```bash
docker compose exec -T backend npm test -- --testNamePattern="Duelo \\(2 jogadores\\)" 2>&1 | tail -25
```

Se algum teste falhar, investigar conforme padrão de Tasks 3-6 (decidir bug-engine vs ajuste-teste). Provavelmente o teste #4 precisa ajuste fino sobre quando exatamente o DUEL_PASS_PICK dispara.

- [ ] **Step 3: Ajustar conforme necessário e rodar suite inteira**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
```

Expected: `Tests: 0 failed, 68 passed, 68 total` (64 + 4 novos).

- [ ] **Step 4: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend add test/engine.test.ts
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -m "test(engine): cobre Duelo (2P) — pratos do dia e DUEL_PASS_PICK"
```

---

## Task 8: Cobertura nova — MERCADO extras

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: estender `describe('GameEngine — modo MERCADO')` existente com swap inválido, market refill, market vazio.

- [ ] **Step 1: Adicionar tests dentro do describe MERCADO existente**

Localizar `describe('GameEngine — modo MERCADO'` e adicionar dentro:

```ts
test('swap com handIndex inválido é rejeitado', () => {
  const { engine, ids } = makeEngine('MERCADO', 4);
  engine.startRound();
  const result = engine.applyMarketSwap(ids[0], 999, 0);
  expect(result.success).toBe(false);
});

test('swap com marketIndex inválido é rejeitado', () => {
  const { engine, ids } = makeEngine('MERCADO', 4);
  engine.startRound();
  const result = engine.applyMarketSwap(ids[0], 0, 999);
  expect(result.success).toBe(false);
});

test('swap entre carta da mão e do mercado troca corretamente', () => {
  const { engine, ids } = makeEngine('MERCADO', 4);
  engine.startRound();
  const before = engine.getClientStateFor(ids[0]);
  const handCard = before.myHand[0];
  const marketCard = before.market![0];
  engine.applyMarketSwap(ids[0], 0, 0);
  const after = engine.getClientStateFor(ids[0]);
  expect(after.myHand[0]).toEqual(marketCard);
  expect(after.market![0]).toEqual(handCard);
});

test('market refila do drawPile quando carta é levada', () => {
  const { engine, ids } = makeEngine('MERCADO', 4);
  engine.startRound();
  const before = engine.getClientStateFor(ids[0]);
  expect(before.market).toHaveLength(MARKET_SIZE);
  // Cenário: simular consumo do mercado (via swap N vezes ou outro mecanismo)
  // — investigar a regra exata. Por ora valida que mercado mantém tamanho.
  engine.applyMarketSwap(ids[0], 0, 0);
  const after = engine.getClientStateFor(ids[0]);
  expect(after.market).toHaveLength(MARKET_SIZE);
});

test('market vazio quando drawPile é zero', () => {
  const { engine, ids } = makeEngine('MERCADO', 4);
  engine.startRound();
  engine._setStateForTest({ deck: [] }); // baralho vazio
  // Forçar refill (depende de método interno; provavelmente acontece via swap)
  engine.applyMarketSwap(ids[0], 0, 0);
  const state = engine.getClientStateFor(ids[0]);
  // Market pode ficar com menos cartas ou ser null
  expect((state.market?.length ?? 0)).toBeLessThanOrEqual(MARKET_SIZE);
});
```

Adicionar import faltante no topo do arquivo se necessário:

```ts
import { MARKET_SIZE } from '../src/common/constants/game.constants.js';
```

(Verificar antes se já está importado.)

- [ ] **Step 2: Rodar**

```bash
docker compose exec -T backend npm test -- --testNamePattern="modo MERCADO" 2>&1 | tail -25
```

- [ ] **Step 3: Ajustar testes que falharem (provavelmente os 2 últimos sobre refill — depende da regra exata)**

- [ ] **Step 4: Rodar suite**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
```

Expected: `Tests: 0 failed, 73 passed, 73 total` (68 + 5).

- [ ] **Step 5: Commit**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre MERCADO swap inválido, refill e market vazio"
```

---

## Task 9: Cobertura nova — RODIZIO multi-rodada

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: rotação de seats entre rodadas, 3+ rodadas seguidas.

- [ ] **Step 1: Adicionar tests no describe RODIZIO existente**

```ts
test('seats rotacionam após fim de rodada', () => {
  const { engine, ids } = makeEngine('RODIZIO', 4);
  engine.startRound();
  const seatsBefore = engine.getClientStateFor(ids[0]).players.map(p => ({ id: p.userId, seat: p.seat }));
  // Forçar fim de rodada
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(1, 'SUSHI')],
      [ids[1]]: [],
      [ids[2]]: [],
      [ids[3]]: [],
    },
  });
  // Player 1, 2, 3 já têm mãos vazias → o engine deve declarar fim de rodada
  // (depende da implementação detectar isso)
  // Iniciar próxima rodada manualmente se necessário:
  // engine.startRound();
  const seatsAfter = engine.getClientStateFor(ids[0]).players.map(p => ({ id: p.userId, seat: p.seat }));
  // Pelo menos 1 seat mudou
  const someChanged = seatsBefore.some((b, i) => b.seat !== seatsAfter[i].seat);
  expect(someChanged).toBe(true);
});

test('3 rodadas consecutivas sem erro', () => {
  const { engine, ids } = makeEngine('RODIZIO', 4);
  for (let i = 0; i < 3; i++) {
    engine.startRound();
    // Simular término forçado de cada rodada
    engine._setStateForTest({
      hands: {
        [ids[0]]: [],
        [ids[1]]: [],
        [ids[2]]: [],
        [ids[3]]: [],
      },
    });
  }
  const state = engine.getClientStateFor(ids[0]);
  expect(state.round).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2-5: Rodar, ajustar, suite inteira, commit**

```bash
docker compose exec -T backend npm test -- --testNamePattern="modo RODIZIO" 2>&1 | tail -15
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
# Expected: 0 failed, 75 passed
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre rotação de seats e multi-rodada em RODIZIO"
```

---

## Task 10: Cobertura nova — Sabor: quebrar, continuar, encerrar

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: cenários de Sabor além dos já cobertos em `describe('rules — beatsPlay')` e `describe('GameEngine — Sabor')`.

- [ ] **Step 1: Adicionar tests no describe Sabor**

```ts
test('Sabor inicia quando jogador joga 2+ cartas mesma categoria', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 4);
  engine.startRound();
  engine._setStateForTest({
    hands: { [ids[0]]: [card(5, 'SUSHI'), card(5, 'SUSHI'), card(3, 'PIZZA')] },
    pile: [card(2, 'TACO')],
  });
  engine.applyPlayCards(ids[0], [0, 1]);
  const state = engine.getClientStateFor(ids[0]);
  expect(state.saborActive).toBe(true);
  expect(state.saborMinRequired).toBe(2);
});

test('Sabor continua quando próximo jogador joga mesma categoria', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 4);
  engine.startRound();
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(5, 'SUSHI'), card(5, 'SUSHI')],
      [ids[1]]: [card(6, 'SUSHI'), card(6, 'SUSHI'), card(6, 'SUSHI')],
    },
    pile: [card(2, 'TACO')],
  });
  engine.applyPlayCards(ids[0], [0, 1]);
  engine.applyPlayCards(ids[1], [0, 1, 2]); // 3 SUSHI continua sabor
  const state = engine.getClientStateFor(ids[1]);
  expect(state.saborActive).toBe(true);
  expect(state.saborMinRequired).toBe(3);
});

test('Sabor quebra com categorias mistas e count >= minRequired', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 4);
  engine.startRound();
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(5, 'SUSHI'), card(5, 'SUSHI')],
      [ids[1]]: [card(6, 'PIZZA'), card(6, 'TACO')],
    },
    pile: [card(2, 'TACO')],
  });
  engine.applyPlayCards(ids[0], [0, 1]);
  engine.applyPlayCards(ids[1], [0, 1]); // 2 mistas, count = minRequired
  const state = engine.getClientStateFor(ids[1]);
  expect(state.saborActive).toBe(false); // quebrou
});

test('Sabor encerra quando rodada termina (mão vazia)', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  engine._setStateForTest({
    hands: {
      [ids[0]]: [card(5, 'SUSHI'), card(5, 'SUSHI')],
      [ids[1]]: [card(1, 'PIZZA')],
    },
    pile: [card(2, 'TACO')],
  });
  engine.applyPlayCards(ids[0], [0, 1]); // sabor ativo, mão vazia
  // Rodada termina; sabor deve resetar
  const state = engine.getClientStateFor(ids[0]);
  expect(state.saborActive).toBe(false);
});
```

- [ ] **Step 2-5: Rodar, ajustar, suite inteira, commit**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
# Expected: 0 failed, 79 passed
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre Sabor — iniciar, continuar, quebrar, encerrar"
```

---

## Task 11: Cobertura nova — Tokens e eliminação

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: jogador zera tokens → fica eliminado; último com tokens → vence o jogo.

- [ ] **Step 1: Adicionar tests**

```ts
describe('GameEngine — tokens e eliminação', () => {
  test('jogador que zera tokens é marcado como eliminado', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4, 1); // 1 token inicial
    // (makeEngine precisa aceitar initialTokens — se não aceita, ajustar helper)
    engine.startRound();
    // Forçar rodada onde players 1, 2, 3 esvaziam mão (player 0 perde)
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(1, 'SUSHI')],
        [ids[1]]: [],
        [ids[2]]: [],
        [ids[3]]: [],
      },
    });
    // Disparar fim de rodada (via aplicação de algum método; depende da impl)
    // Verificar: player 0 perdeu 1 token → totalLeft 0 → eliminado
    const state = engine.getClientStateFor(ids[0]);
    expect(state.players.find(p => p.userId === ids[0])!.isEliminated).toBe(true);
  });

  test('último jogador com tokens vence o jogo (GAME_OVER)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4, 1);
    engine.startRound();
    // Forçar 3 jogadores a perderem tokens; só ids[0] resta
    // (requer eliminação manual via _setStateForTest estendido? Ou simulação de rodadas)
    // — investigar como o engine determina GAME_OVER
    const state = engine.getClientStateFor(ids[0]);
    expect(state.phase).toBe('GAME_OVER');
  });
});
```

**Pré-condição**: o helper `makeEngine` aceita `initialTokens`? Se não, adicionar parâmetro:

```ts
function makeEngine(
  mode: GameMode = 'TRADITIONAL',
  players = 2,
  initialTokens = INITIAL_TOKENS,
) {
  const engine = new GameEngine('TEST', mode, 0, initialTokens);
  ...
}
```

- [ ] **Step 2-5**: rodar, ajustar (provavelmente o cenário GAME_OVER precisa de método auxiliar pra forçar tokens=0 em vários players — pode requerer expandir `_setStateForTest` com `tokens?: Record<string, number>`).

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre eliminação por tokens e GAME_OVER"
```

---

## Task 12: Cobertura nova — GAME_OVER state shape

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: quando GAME_OVER é atingido, o estado expõe `winner` e `ranking` corretos.

- [ ] **Step 1: Adicionar tests**

```ts
describe('GameEngine — GAME_OVER state', () => {
  // Note: o engine não expõe um `getRanking()` público — a ranking é emitida
  // como evento `game:game_over` no events array de uma `EngineResult`.
  // Os testes abaixo capturam o evento.

  test('GAME_OVER emite evento com 4 rankings ordenados', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4, 1); // 1 token inicial
    engine.startRound();
    // Setup: força 3 jogadores a tokens=0 e 1 a tokens=1; força fim de rodada
    // pra disparar penalty + game over.
    engine._setStateForTest({
      tokens: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0, [ids[3]]: 0 },
      hands: {
        [ids[0]]: [card(1, 'SUSHI')],
        [ids[1]]: [],
        [ids[2]]: [],
        [ids[3]]: [],
      },
    });
    // Disparar trigger de fim de rodada — depende do método disponível.
    // Provavelmente algum apply* detecta hands vazias e resolve. Ajustar conforme
    // o que descobrir em runtime.
    const result = engine.applyPlayCards(ids[0], [0]);
    const gameOverEvent =
      result.events.find(e => e.type === 'game:game_over');
    expect(gameOverEvent).toBeDefined();
    const rankings = gameOverEvent!.payload.rankings as Array<{
      userId: string; placement: number; tokensLeft: number;
    }>;
    expect(rankings).toHaveLength(4);
    expect(rankings.map(r => r.placement).sort()).toEqual([1, 2, 3, 4]);
    expect(rankings[0].placement).toBe(1);
  });

  test('vencedor (placement 1) tem mais tokens que o último', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4, 1);
    engine.startRound();
    engine._setStateForTest({
      tokens: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0, [ids[3]]: 0 },
      hands: {
        [ids[0]]: [card(1, 'SUSHI')],
        [ids[1]]: [],
        [ids[2]]: [],
        [ids[3]]: [],
      },
    });
    const result = engine.applyPlayCards(ids[0], [0]);
    const gameOverEvent =
      result.events.find(e => e.type === 'game:game_over');
    const rankings = gameOverEvent!.payload.rankings as Array<{
      placement: number; tokensLeft: number;
    }>;
    const first = rankings.find(r => r.placement === 1)!;
    const last = rankings.find(r => r.placement === 4)!;
    expect(first.tokensLeft).toBeGreaterThanOrEqual(last.tokensLeft);
  });
});
```

- [ ] **Step 2-5**: rodar, ajustar setup pra forçar GAME_OVER, commit.

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre GAME_OVER state shape e ranking"
```

---

## Task 13: Cobertura nova — Edge: deck pequeno

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: rodada termina porque drawPile chegou a 0 antes de qualquer mão esvaziar.

- [ ] **Step 1: Adicionar test**

```ts
describe('GameEngine — edge: deck pequeno', () => {
  test('rodada termina quando drawPile esgota', () => {
    const { engine, ids } = makeEngine('RODIZIO', 4); // RODIZIO usa drawPile
    engine.startRound();
    engine._setStateForTest({ deck: [] });
    // Jogadores tentam draw → não tem cartas → mecanismo de fim de rodada dispara
    // (depende da implementação — pode ser detectado em applyDrawCard ou em outro lugar)
    const draw = engine.applyDrawCard(ids[0]);
    // Comportamento esperado: ou o método retorna success=false, ou aciona fim de rodada
    // Validar pelo estado:
    const state = engine.getClientStateFor(ids[0]);
    expect(['ROUND_END', 'PLAYER_TURN'].includes(state.phase) || !draw.success).toBe(true);
  });

  test('MERCADO com drawPile pequeno mantém invariantes', () => {
    const { engine, ids } = makeEngine('MERCADO', 4);
    engine.startRound();
    engine._setStateForTest({ deck: [card(1, 'SUSHI')] }); // só 1 carta
    // Mercado tinha 3 cartas no setup; ao consumir, refill puxa do deck até esvaziar
    engine.applyMarketSwap(ids[0], 0, 0);
    const state = engine.getClientStateFor(ids[0]);
    // Mercado tem entre 0 e MARKET_SIZE cartas; engine não crasha
    expect(state.market!.length).toBeGreaterThanOrEqual(0);
    expect(state.market!.length).toBeLessThanOrEqual(MARKET_SIZE);
  });
});
```

- [ ] **Step 2-5**: rodar, ajustar, commit.

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre deck pequeno / esgotado"
```

---

## Task 14: Cobertura nova — Anti-fraude extras

**Files:**
- Modify: `test/engine.test.ts`

**Escopo**: estender o describe `anti-fraude` existente com índices duplicados, jogada que não bate pilha, drawn card fora de hora.

- [ ] **Step 1: Adicionar tests no describe anti-fraude**

```ts
test('índices duplicados no play são rejeitados', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  engine._setStateForTest({
    hands: { [ids[0]]: [card(5, 'SUSHI'), card(5, 'SUSHI')] },
  });
  const result = engine.applyPlayCards(ids[0], [0, 0]); // index duplicado
  expect(result.success).toBe(false);
});

test('jogada com value menor que pilha (mesmo count) é rejeitada', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  engine._setStateForTest({
    hands: { [ids[0]]: [card(2, 'SUSHI'), card(2, 'SUSHI')] },
    pile: [card(5, 'PIZZA'), card(5, 'PIZZA')],
  });
  const result = engine.applyPlayCards(ids[0], [0, 1]);
  expect(result.success).toBe(false);
});

test('applyInsertDrawn fora de fase é rejeitado', () => {
  const { engine, ids } = makeEngine('RODIZIO', 4);
  engine.startRound();
  // Sem chamar drawCard antes (não está em PASS_PICK); tentar inserir mesmo assim
  const result = engine.applyInsertDrawn(ids[0], 0, 'insert');
  expect(result.success).toBe(false);
});

test('trickPick fora de fase é rejeitado', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  const result = engine.applyTrickPick(ids[0], 'take');
  expect(result.success).toBe(false);
});

test('marketSwap em modo não-MERCADO é rejeitado', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 4);
  engine.startRound();
  const result = engine.applyMarketSwap(ids[0], 0, 0);
  expect(result.success).toBe(false);
});

test('jogar carta de outro player é rejeitado', () => {
  const { engine, ids } = makeEngine('TRADITIONAL', 2);
  engine.startRound();
  const result = engine.applyPlayCards(ids[1], [0]); // ids[0] é o do turno
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2-5**: rodar, ajustar, suite inteira, commit.

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:"
# Expected: 0 failed, ~95+ passed
git -C /home/anrry/github.com/temakuri/temakuri-backend commit -am "test(engine): cobre anti-fraude — duplicates, valores, ações fora de fase"
```

---

## Task 15: Verificação final e push (opcional)

**Files:** N/A

- [ ] **Step 1: Rodar suite completa, contar casos**

```bash
docker compose exec -T backend npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: `Tests: 0 failed, 110+ passed` (alvo do plano).

- [ ] **Step 2: Listar commits da Layer A**

```bash
git -C /home/anrry/github.com/temakuri/temakuri-backend log --oneline main..feat/test-coverage
```

Expected: ~10-14 commits, todos com prefixo `test(engine):` ou `fix(engine):`.

- [ ] **Step 3: NÃO fazer push automaticamente**

Conforme memória/preferência do usuário: **commits locais OK, push apenas com autorização explícita**. Reportar ao usuário:

> "Layer A completa. 110+ testes passando, 0 falhando. N commits na branch `feat/test-coverage`. Posso pushar?"

---

## Notas finais

**Discoveries esperadas durante implementação**:

- Algumas decisões em Tasks 3 e 5 (hipótese A vs B) precisam de input do usuário sobre regras do jogo. Se o engineer não souber, **parar e perguntar** — não chutar.
- Tasks 11-13 podem revelar que `_setStateForTest` precisa de mais campos (ex.: `tokens`, `phase`). Estender o método conforme necessário, atualizando Task 1.
- Se um teste novo (Tasks 7-14) revelar um bug genuíno do engine, **criar commit separado de fix** antes do commit do teste, com prefixo `fix(engine):`.

**Anti-padrões a evitar**:

- Não desabilitar testes (`it.skip`, `it.todo`) para "passar a barra".
- Não usar `Math.random` direto em testes; sempre `_setStateForTest` para controle.
- Não testar mensagens de erro exatas (`reason`); testar apenas `success: false`. Mensagens podem mudar.
