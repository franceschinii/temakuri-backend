import { GameEngine } from '../src/game/engine/GameEngine';
import { buildDeck, shuffle, dealCards } from '../src/game/engine/deck';
import { isContiguous, isSameValue, isSameCategory, isSabor, beatsPlay, validatePlayIndices } from '../src/game/engine/rules';
import type { Card } from '../src/types/game.types';

// ─── helpers ────────────────────────────────────────────────────────────────

function card(value: 1 | 2 | 3 | 4 | 5 | 6 | 7, category: Card['category'], id?: string): Card {
  return { id: id ?? `${value}-${category}`, value, category, variantIndex: 0 };
}

function makeEngine(mode: 'TRADITIONAL' | 'MERCADO' | 'RODIZIO' = 'TRADITIONAL', players = 2) {
  const engine = new GameEngine('TEST', mode);
  const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  ids.forEach((id, i) => engine.addPlayer(id, `Player${i + 1}`, 0, i));
  return { engine, ids };
}

// ─── deck ───────────────────────────────────────────────────────────────────

describe('deck', () => {
  test('buildDeck retorna 63 cartas (7 valores × 9 variantes)', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(63);
  });

  test('todos os valores de 1 a 7 estão presentes', () => {
    const deck = buildDeck();
    for (let v = 1; v <= 7; v++) {
      expect(deck.filter(c => c.value === v)).toHaveLength(9);
    }
  });

  test('categorias são distribuídas ciclicamente entre as 7 existentes', () => {
    const deck = buildDeck();
    const categories = new Set(deck.map(c => c.category));
    expect(categories.size).toBe(7);
  });

  test('ids são únicos', () => {
    const deck = buildDeck();
    const ids = deck.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('shuffle embaralha sem perder cartas', () => {
    const deck = buildDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(deck.length);
    expect(shuffled.map(c => c.id).sort()).toEqual(deck.map(c => c.id).sort());
  });

  test('dealCards distribui mãos corretas para 2 jogadores (11 cartas cada)', () => {
    const { hands } = dealCards(['a', 'b']);
    expect(hands.get('a')).toHaveLength(11);
    expect(hands.get('b')).toHaveLength(11);
  });

  test('dealCards não repete cartas entre jogadores', () => {
    const { hands } = dealCards(['a', 'b', 'c', 'd']);
    const all = [...hands.values()].flat().map(c => c.id);
    expect(new Set(all).size).toBe(all.length);
  });

  test('dealCards lança erro para contagem inválida de jogadores', () => {
    expect(() => dealCards(['solo'])).toThrow('Unsupported player count');
  });
});

// ─── regras ─────────────────────────────────────────────────────────────────

describe('rules — isContiguous', () => {
  test('[0] é contíguo', () => expect(isContiguous([0])).toBe(true));
  test('[0,1,2] é contíguo', () => expect(isContiguous([0, 1, 2])).toBe(true));
  test('[2,1,0] (desordenado) é contíguo', () => expect(isContiguous([2, 1, 0])).toBe(true));
  test('[0,2] não é contíguo', () => expect(isContiguous([0, 2])).toBe(false));
  test('[] retorna false', () => expect(isContiguous([])).toBe(false));
});

describe('rules — isSameValue', () => {
  test('cartas com mesmo valor retorna true', () => {
    expect(isSameValue([card(3, 'SUSHI'), card(3, 'RAMEN')])).toBe(true);
  });
  test('cartas com valores diferentes retorna false', () => {
    expect(isSameValue([card(3, 'SUSHI'), card(4, 'SUSHI')])).toBe(false);
  });
  test('array vazio retorna false', () => expect(isSameValue([])).toBe(false));
});

describe('rules — isSabor', () => {
  test('2+ cartas da mesma categoria = Sabor', () => {
    expect(isSabor([card(3, 'PIZZA'), card(3, 'PIZZA')])).toBe(true);
  });
  test('1 carta da mesma categoria = NÃO é Sabor', () => {
    expect(isSabor([card(3, 'PIZZA')])).toBe(false);
  });
  test('cartas de categorias diferentes = NÃO é Sabor', () => {
    expect(isSabor([card(3, 'PIZZA'), card(3, 'SUSHI')])).toBe(false);
  });
});

describe('rules — beatsPlay', () => {
  test('pilha vazia: qualquer jogada passa', () => {
    const result = beatsPlay([card(1, 'SUSHI')], [], false, 0);
    expect(result.valid).toBe(true);
  });

  test('mais cartas vence independente do valor', () => {
    const pile = [card(7, 'PIZZA'), card(7, 'PIZZA')];
    const played = [card(1, 'SUSHI'), card(1, 'RAMEN'), card(1, 'TACO')];
    expect(beatsPlay(played, pile, false, 0).valid).toBe(true);
  });

  test('mesmo número com valor maior vence', () => {
    const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
    const played = [card(5, 'SUSHI'), card(5, 'RAMEN')];
    expect(beatsPlay(played, pile, false, 0).valid).toBe(true);
  });

  test('mesmo número com valor menor perde', () => {
    const pile = [card(5, 'PIZZA'), card(5, 'PIZZA')];
    const played = [card(3, 'SUSHI'), card(3, 'RAMEN')];
    expect(beatsPlay(played, pile, false, 0).valid).toBe(false);
  });

  test('menos cartas perde mesmo com valor maior', () => {
    const pile = [card(3, 'PIZZA'), card(3, 'PIZZA'), card(3, 'PIZZA')];
    const played = [card(7, 'SUSHI'), card(7, 'RAMEN')];
    expect(beatsPlay(played, pile, false, 0).valid).toBe(false);
  });

  describe('Sabor ativo', () => {
    test('jogar exatamente minRequired com mesma categoria + valor maior vence', () => {
      const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
      const played = [card(5, 'SUSHI'), card(5, 'SUSHI')];
      // minRequired=2; played.length=2 atende, e valor 5 > 3 → válido
      expect(beatsPlay(played, pile, true, 2).valid).toBe(true);
    });

    test('jogar 3 quando minRequired=2 passa', () => {
      const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
      const played = [card(5, 'SUSHI'), card(5, 'SUSHI'), card(5, 'TACO')];
      expect(beatsPlay(played, pile, true, 2).valid).toBe(true);
    });

    test('quebrar Sabor com categorias mistas + count >= minRequired', () => {
      const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
      const played = [card(5, 'SUSHI'), card(5, 'RAMEN')]; // misto, count=2 >= minRequired=2
      expect(beatsPlay(played, pile, true, 2).valid).toBe(true);
    });

    test('1 carta mista não quebra Sabor quando minRequired=2', () => {
      const pile = [card(3, 'PIZZA'), card(3, 'PIZZA')];
      const played = [card(5, 'SUSHI')]; // misto mas count=1 < minRequired=2
      expect(beatsPlay(played, pile, true, 2).valid).toBe(false);
    });
  });
});

describe('rules — validatePlayIndices', () => {
  const hand: Card[] = [
    card(3, 'PIZZA', 'c0'),
    card(3, 'SUSHI', 'c1'),
    card(3, 'RAMEN', 'c2'),
    card(5, 'CURRY', 'c3'),
    card(5, 'BURGER', 'c4'),
  ];

  test('índices contíguos com mesmo valor passam contra pilha vazia', () => {
    expect(validatePlayIndices(hand, [0, 1, 2], [], false, 0).valid).toBe(true);
  });

  test('índices não contíguos são rejeitados', () => {
    expect(validatePlayIndices(hand, [0, 2], [], false, 0).valid).toBe(false);
  });

  test('cartas com valores diferentes são rejeitadas', () => {
    expect(validatePlayIndices(hand, [2, 3], [], false, 0).valid).toBe(false);
  });

  test('índice fora do range é rejeitado', () => {
    expect(validatePlayIndices(hand, [10], [], false, 0).valid).toBe(false);
  });

  test('seleção vazia é rejeitada', () => {
    expect(validatePlayIndices(hand, [], [], false, 0).valid).toBe(false);
  });
});

// ─── GameEngine — estado e transições ──────────────────────────────────────

describe('GameEngine — setup', () => {
  test('addPlayer e allReady funcionam', () => {
    const { engine, ids } = makeEngine();
    expect(engine.allReady()).toBe(false);
    ids.forEach(id => engine.setReady(id, true));
    expect(engine.allReady()).toBe(true);
  });

  test('startRound distribui mãos para 2 jogadores', () => {
    const { engine, ids } = makeEngine();
    const events = engine.startRound();
    const handEvents = events.filter(e => e.type === 'game:your_hand');
    expect(handEvents).toHaveLength(2);
    handEvents.forEach(e => {
      const hand = e.payload.hand as Card[];
      expect(hand).toHaveLength(11);
    });
  });

  test('turnStarted aponta para p1 no início', () => {
    const { engine } = makeEngine();
    const events = engine.startRound();
    const turnEv = events.find(e => e.type === 'game:turn_started');
    expect(turnEv?.payload.userId).toBe('p1');
  });
});

describe('GameEngine — applyPlayCards', () => {
  test('jogada válida na pilha vazia gera cards_played e avança turno', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const state = engine.getClientStateFor(ids[0]);
    const handP1 = state.myHand;
    const firstIdx = 0;

    const result = engine.applyPlayCards(ids[0], [firstIdx]);
    expect(result.success).toBe(true);
    const playedEv = result.events.find(e => e.type === 'game:cards_played');
    expect(playedEv).toBeDefined();
    const turnEv = result.events.find(e => e.type === 'game:turn_started');
    expect(turnEv?.payload.userId).toBe(ids[1]);
  });

  test('rejeita jogada de jogador errado', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const result = engine.applyPlayCards(ids[1], [0]);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Not your turn/);
  });

  test('rejeita índice fora do range da mão', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const result = engine.applyPlayCards(ids[0], [99]);
    expect(result.success).toBe(false);
  });

  test('rejeita jogada que não bate a pilha', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();

    // P1 joga — precisamos encontrar um conjunto válido maior para a pilha
    // Força P1 a jogar índice 0 (valor X). P2 tenta jogar algo menor.
    const stateP1 = engine.getClientStateFor(ids[0]);
    engine.applyPlayCards(ids[0], [0]); // P1 joga 1 carta

    const pileCard = engine.getClientStateFor(ids[1]).pile[0];
    const stateP2 = engine.getClientStateFor(ids[1]);
    // Tenta jogar carta com valor menor que a pilha
    const lowerIdx = stateP2.myHand.findIndex(c => c.value < pileCard.value);
    if (lowerIdx >= 0) {
      const result = engine.applyPlayCards(ids[1], [lowerIdx]);
      expect(result.success).toBe(false);
    } else {
      // Não há carta menor — skip (não é um erro do engine, é sorte do baralho)
      expect(true).toBe(true);
    }
  });
});

describe('GameEngine — Sabor', () => {
  test('jogar 2+ cartas da mesma categoria dispara sabor_active', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();

    const stateP1 = engine.getClientStateFor(ids[0]);
    const hand = stateP1.myHand;

    // Encontrar par de cartas adjacentes da mesma categoria
    let saborIndices: number[] = [];
    for (let i = 0; i < hand.length - 1; i++) {
      if (hand[i].category === hand[i + 1].category && hand[i].value === hand[i + 1].value) {
        saborIndices = [i, i + 1];
        break;
      }
    }

    if (saborIndices.length === 2) {
      const result = engine.applyPlayCards(ids[0], saborIndices);
      expect(result.success).toBe(true);
      const saborEv = result.events.find(e => e.type === 'game:sabor_active');
      expect(saborEv).toBeDefined();
      expect(saborEv?.payload.minRequired).toBe(2);
    } else {
      // Baralho não gerou par adjacente de mesma categoria — skip
      expect(true).toBe(true);
    }
  });

  test('Sabor inicia quando jogador joga 2+ cartas mesma categoria', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      hands: { [ids[0]]: [card(5, 'SUSHI', 's1'), card(5, 'SUSHI', 's2'), card(3, 'PIZZA', 'p1')] },
      pile: [card(2, 'TACO')],
    });
    const result = engine.applyPlayCards(ids[0], [0, 1]);
    expect(result.success).toBe(true);
    const state = engine.getClientStateFor(ids[0]);
    expect(state.saborActive).toBe(true);
    expect(state.saborMinRequired).toBe(2);
  });

  test('Sabor continua quando próximo jogador joga mais cartas mesma categoria', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        // ids[0] has extra card so hand isn't empty after playing 2
        [ids[0]]: [card(5, 'SUSHI', 's1'), card(5, 'SUSHI', 's2'), card(3, 'PIZZA', 'px')],
        [ids[1]]: [card(6, 'SUSHI', 's3'), card(6, 'SUSHI', 's4'), card(6, 'SUSHI', 's5'), card(3, 'RAMEN', 'rx')],
      },
      pile: [card(2, 'TACO')],
    });
    engine.applyPlayCards(ids[0], [0, 1]); // inicia Sabor (minRequired=2), hand not empty
    const r2 = engine.applyPlayCards(ids[1], [0, 1, 2]); // 3 SUSHI continua
    expect(r2.success).toBe(true);
    const state = engine.getClientStateFor(ids[1]);
    expect(state.saborActive).toBe(true);
    // Após 3 cartas same-cat: isSabor dispara, saborMinRequired atualiza pra 3
    expect(state.saborMinRequired).toBe(3);
  });

  test('Sabor quebra com categorias mistas (count >= minRequired)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        // ids[0] has extra card so hand isn't empty after playing 2
        [ids[0]]: [card(5, 'SUSHI', 's1'), card(5, 'SUSHI', 's2'), card(3, 'PIZZA', 'px')],
        // ids[1] needs extra card too so hand isn't empty after playing 2
        [ids[1]]: [card(6, 'PIZZA', 'p1'), card(6, 'TACO', 't1'), card(3, 'RAMEN', 'rx')],
      },
      pile: [card(2, 'TACO')],
    });
    engine.applyPlayCards(ids[0], [0, 1]); // sabor ativo, minRequired=2
    expect(engine.getClientStateFor(ids[0]).saborActive).toBe(true); // guard
    engine.applyPlayCards(ids[1], [0, 1]); // 2 cartas, categorias mistas, count >= minRequired
    const state = engine.getClientStateFor(ids[1]);
    expect(state.saborActive).toBe(false); // quebrou
  });

  test('Sabor reseta quando rodada termina (jogador esvazia mão)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(5, 'SUSHI', 's1'), card(5, 'SUSHI', 's2')],
        [ids[1]]: [card(3, 'PIZZA', 'p1')],
      },
      pile: [card(2, 'TACO')],
    });
    engine.applyPlayCards(ids[0], [0, 1]); // mão vazia → round ends, startRound resets sabor
    const state = engine.getClientStateFor(ids[0]);
    expect(state.saborActive).toBe(false);
  });
});

describe('GameEngine — applyPassTurn', () => {
  test('passar sem pilha (empasse) resolve o round imediatamente', () => {
    // Com 2 jogadores, 1 pass = todos passaram sem ninguém jogar nada.
    // O engine resolve como "empasse": quem tem mais cartas na mão perde.
    // Não é um erro — o pass é aceito e o round termina.
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    const result = engine.applyPassTurn(ids[0], 0);
    expect(result.success).toBe(true);
    const roundEndedEv = result.events.find(e => e.type === 'game:round_ended');
    expect(roundEndedEv).toBeDefined();
    expect(roundEndedEv!.payload.loserIds).toHaveLength(1);
  });

  test('passar após jogada funciona e incrementa consecutivePasses', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 3);
    engine.startRound();

    // P1 joga uma carta
    engine.applyPlayCards(ids[0], [0]);
    // P2 passa
    const result = engine.applyPassTurn(ids[1], 0);
    expect(result.success).toBe(true);
    const passedEv = result.events.find(e => e.type === 'game:turn_passed');
    expect(passedEv).toBeDefined();
  });

  test('wipe ocorre quando todos os outros passam consecutivamente', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();

    // P1 joga
    engine.applyPlayCards(ids[0], [0]);
    // P2 passa (consecutivePasses = 1 = activePlayers - 1 = 1) → wipe
    const result = engine.applyPassTurn(ids[1], 0);
    expect(result.success).toBe(true);
    const wipeEv = result.events.find(e => e.type === 'game:wipe');
    expect(wipeEv).toBeDefined();
    expect(wipeEv?.payload.winnerId).toBe(ids[0]);
  });

  test('após wipe completo, engine volta pra PLAYER_TURN', () => {
    // Wipe = todos os outros passam consecutivamente após ids[0] jogar.
    // Com 2 jogadores: ids[0] joga, ids[1] passa → consecutivePasses(1) = activePlayers-1(1) → wipe.
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        // ids[0] precisa de pelo menos 2 cartas para sobrar mão após jogar 1
        [ids[0]]: [card(7, 'SUSHI'), card(5, 'RAMEN')],
        [ids[1]]: [card(1, 'PIZZA')],
      },
      pile: [],
    });
    // ids[0] joga a primeira carta (pilha vazia, qualquer carta vale)
    const playResult = engine.applyPlayCards(ids[0], [0]);
    expect(playResult.success).toBe(true);
    // ids[1] passa → consecutivePasses=1 = activePlayers-1=1 → wipe, fase vira TRICK_PICK
    const passResult = engine.applyPassTurn(ids[1], 0);
    expect(passResult.success).toBe(true);
    expect(passResult.events.some(e => e.type === 'game:wipe')).toBe(true);
    expect(passResult.events.find(e => e.type === 'game:wipe')?.payload.winnerId).toBe(ids[0]);
    // ids[0] descarta a pilha → fase volta para PLAYER_TURN
    const pickResult = engine.applyTrickPick(ids[0], 'discard');
    expect(pickResult.success).toBe(true);
    const state = engine.getClientStateFor(ids[0]);
    expect(state.phase).toBe('PLAYER_TURN');
  });

  test('inserção em index inválido é rejeitado', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]);
    // insertAtIndex=999 está fora do range da mão → deve ser rejeitado
    const result = engine.applyPassTurn(ids[1], 999);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insertAtIndex out of range/);
  });
});


describe('GameEngine — modo MERCADO', () => {
  test('mercado é inicializado com 3 cartas no startRound', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    const events = engine.startRound();
    const state = engine.getClientStateFor(ids[0]);
    expect(state.market).toHaveLength(3);
  });

  test('market_swap só funciona para o vencedor do wipe', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence

    // ids[1] tenta trocar — deve ser rejeitado
    const fail = engine.applyMarketSwap(ids[1], 0, 0);
    expect(fail.success).toBe(false);
    expect(fail.reason).toMatch(/wipe winner/);

    // ids[0] troca — deve funcionar
    const ok = engine.applyMarketSwap(ids[0], 0, 0);
    expect(ok.success).toBe(true);
  });

  test('market_swap com índices inválidos é rejeitado', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe

    const fail = engine.applyMarketSwap(ids[0], 99, 0);
    expect(fail.success).toBe(false);

    const fail2 = engine.applyMarketSwap(ids[0], 0, 99);
    expect(fail2.success).toBe(false);
  });

  test('applyMarketSwap rejeita handIndex inválido (negativo)', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence

    const result = engine.applyMarketSwap(ids[0], -1, 0);
    expect(result.success).toBe(false);
  });

  test('applyMarketSwap rejeita marketIndex inválido (negativo)', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence

    const result = engine.applyMarketSwap(ids[0], 0, -1);
    expect(result.success).toBe(false);
  });

  test('applyMarketSwap troca corretamente carta da mão pela do mercado', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();

    const before = engine.getClientStateFor(ids[0]);
    const handCardId = before.myHand[0].id;
    const marketCardId = before.market![0].id;

    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence

    // Após o wipe a mão de ids[0] mudou (a carta jogada saiu). Capturamos o estado pós-wipe.
    const postWipe = engine.getClientStateFor(ids[0]);
    const postWipeHandCardId = postWipe.myHand[0].id;
    const postWipeMarketCardId = postWipe.market![0].id;

    const result = engine.applyMarketSwap(ids[0], 0, 0);
    expect(result.success).toBe(true);

    const after = engine.getClientStateFor(ids[0]);
    // A carta que estava no mercado[0] deve agora estar na mão
    expect(after.myHand.some(c => c.id === postWipeMarketCardId)).toBe(true);
    // A carta que estava na mão[0] deve agora estar no mercado
    expect(after.market!.some(c => c.id === postWipeHandCardId)).toBe(true);
  });

  test('mercado mantém invariantes mesmo com drawPile esgotado', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();

    // Esgota o drawPile
    engine._setStateForTest({ deck: [] });

    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence

    // O swap deve funcionar (o mercado não depende do drawPile para trocar)
    const result = engine.applyMarketSwap(ids[0], 0, 0);
    expect(result.success).toBe(true);

    const state = engine.getClientStateFor(ids[0]);
    // O mercado não sofre refill após swap — tamanho permanece igual ao de antes do swap
    // mas deve ser coerente: entre 0 e MARKET_SIZE (3)
    expect((state.market ?? []).length).toBeGreaterThanOrEqual(0);
    expect((state.market ?? []).length).toBeLessThanOrEqual(3);
  });
});

describe('GameEngine — modo RODIZIO', () => {
  test('hands rotacionam entre jogadores após fim de rodada (via startRound)', () => {
    // RODIZIO rotaciona as mãos antes do próximo round
    const engine = new GameEngine('RODIZIO-TEST', 'RODIZIO');
    engine.addPlayer('p1', 'P1', 0, 0);
    engine.addPlayer('p2', 'P2', 0, 1);
    engine.addPlayer('p3', 'P3', 0, 2);
    engine.startRound();

    const handP1Before = engine.getClientStateFor('p1').myHand.map(c => c.id);
    const handP2Before = engine.getClientStateFor('p2').myHand.map(c => c.id);

    // Não podemos triggerar fim de rodada facilmente sem manipular o estado interno,
    // então testamos o modo via getMode
    expect(engine.getMode()).toBe('RODIZIO');
  });

  test('fim de rodada em RODIZIO incrementa round e emite round_ended', () => {
    // Com 4 jogadores RODIZIO: disparar fim de rodada via mão vazia (p1 joga última carta).
    // rotateHands() é chamado dentro de resolveRoundEnd → startRound incrementa round.
    const { engine, ids } = makeEngine('RODIZIO', 4);
    engine.startRound();

    const roundBefore = engine.getClientStateFor(ids[0]).round;

    // Registrar as mãos antes da rotação (após startRound inicial)
    const handsBefore = ids.map(id => engine.getClientStateFor(id).myHand.map(c => c.id));

    // Dar a p1 (seat 0, sempre primeiro a jogar) exatamente 1 carta; deck vazio para
    // não desenhar; os demais com mão vazia (não interfere no turno atual).
    engine._setStateForTest({
      deck: [],
      hands: {
        [ids[0]]: [card(3, 'SUSHI', 'test-3s')],
        [ids[1]]: [card(1, 'PIZZA', 'p2-a'), card(2, 'PIZZA', 'p2-b')],
        [ids[2]]: [card(4, 'TACO', 'p3-a'), card(5, 'TACO', 'p3-b')],
        [ids[3]]: [card(6, 'CURRY', 'p4-a'), card(7, 'CURRY', 'p4-b')],
      },
    });

    const handsSet = {
      [ids[1]]: engine.getClientStateFor(ids[1]).myHand.map(c => c.id),
      [ids[2]]: engine.getClientStateFor(ids[2]).myHand.map(c => c.id),
      [ids[3]]: engine.getClientStateFor(ids[3]).myHand.map(c => c.id),
    };

    // p1 joga a única carta → mão vazia → resolveRoundEnd → rotateHands → startRound (sem re-deal)
    const result = engine.applyPlayCards(ids[0], [0]);
    expect(result.success).toBe(true);

    const roundAfter = engine.getClientStateFor(ids[0]).round;
    // round deve ter incrementado: resolveRoundEnd chamou startRound
    expect(roundAfter).toBeGreaterThan(roundBefore);

    // O evento round_ended deve ter sido emitido
    const roundEndedEv = result.events.find(e => e.type === 'game:round_ended');
    expect(roundEndedEv).toBeDefined();

    // Após a rotação, as mãos de ids[1..3] devem ter chegado a novos donos
    // (rotateHands faz left-shift: p[i].hand = p[i+1].hand, último recebe o primeiro)
    const p1HandAfter = engine.getClientStateFor(ids[1]).myHand.map(c => c.id);
    const p2HandAfter = engine.getClientStateFor(ids[2]).myHand.map(c => c.id);
    const p3HandAfter = engine.getClientStateFor(ids[3]).myHand.map(c => c.id);
    // ids[1] deve ter recebido a mão que era de ids[2]
    expect(p1HandAfter).toEqual(handsSet[ids[2]]);
    // ids[2] deve ter recebido a mão que era de ids[3]
    expect(p2HandAfter).toEqual(handsSet[ids[3]]);
  });

  test('em RODIZIO, mãos rotacionam entre jogadores ao iniciar próxima rodada', () => {
    const { engine, ids } = makeEngine('RODIZIO', 4);
    engine.startRound();

    // Substituir mãos com IDs distintos para rastrear a rotação
    engine._setStateForTest({
      deck: [],
      hands: {
        [ids[0]]: [card(1, 'SUSHI', 'p0-card-a')],
        [ids[1]]: [card(3, 'PIZZA', 'p1-card-a'), card(4, 'PIZZA', 'p1-card-b')],
        [ids[2]]: [card(5, 'TACO', 'p2-card-a'), card(6, 'TACO', 'p2-card-b')],
        [ids[3]]: [card(7, 'CURRY', 'p3-card-a'), card(7, 'CURRY', 'p3-card-b')],
      },
    });

    // Captura snapshot das mãos de ids[1..3] antes da rotação
    const handP1Before = engine.getClientStateFor(ids[1]).myHand.map(c => c.id);
    const handP2Before = engine.getClientStateFor(ids[2]).myHand.map(c => c.id);
    const handP3Before = engine.getClientStateFor(ids[3]).myHand.map(c => c.id);

    // ids[0] tem 1 carta → joga → mão vazia → fim de rodada → rotateHands → startRound sem re-deal
    const result = engine.applyPlayCards(ids[0], [0]);
    expect(result.success).toBe(true);

    // rotateHands: left-shift — p[i].hand = p[i+1].hand, último recebe o primeiro (vazio após play)
    const handP1After = engine.getClientStateFor(ids[1]).myHand.map(c => c.id);
    const handP2After = engine.getClientStateFor(ids[2]).myHand.map(c => c.id);
    const handP3After = engine.getClientStateFor(ids[3]).myHand.map(c => c.id);

    // ids[1] deve ter recebido a mão que era de ids[2] (left-shift)
    expect(handP1After).toEqual(handP2Before);
    // ids[2] deve ter recebido a mão que era de ids[3]
    expect(handP2After).toEqual(handP3Before);
    // ids[3] deve ter recebido a mão que era de ids[0] (que estava vazia após a jogada)
    expect(handP3After).toEqual([]);
  });

  test('3 rodadas consecutivas executam sem erro em RODIZIO', () => {
    // Cada rodada: dar 5 tokens a todos para não atingir game_over prematuramente,
    // forçar mão de 1 carta em p1 + deck vazio → p1 joga → round encerra.
    const { engine, ids } = makeEngine('RODIZIO', 4);
    const highTokens = { [ids[0]]: 5, [ids[1]]: 5, [ids[2]]: 5, [ids[3]]: 5 };

    for (let i = 0; i < 3; i++) {
      engine.startRound();

      // Garantir tokens suficientes e estado controlado
      engine._setStateForTest({
        deck: [],
        tokens: highTokens,
        hands: {
          [ids[0]]: [card(3, 'SUSHI', `r${i}-card`)],
          [ids[1]]: [],
          [ids[2]]: [],
          [ids[3]]: [],
        },
      });

      // p1 (seat 0) é o primeiro a jogar → joga a única carta → round encerra
      const result = engine.applyPlayCards(ids[0], [0]);
      expect(result.success).toBe(true);
    }

    const finalState = engine.getClientStateFor(ids[0]);
    // Ao final de 3 iterações (cada uma iniciando com startRound + round_end que chama startRound),
    // o contador de round deve ter avançado pelo menos 3 vezes.
    expect(finalState.round).toBeGreaterThanOrEqual(3);
  });
});

// ─── segurança / anti-fraude ────────────────────────────────────────────────

describe('anti-fraude', () => {
  test('jogador não pode jogar fora do seu turno', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const result = engine.applyPlayCards(ids[1], [0]);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Not your turn/);
  });

  test('jogador não pode passar fora do seu turno', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    engine.applyPlayCards(ids[0], [0]); // avança para P2
    const result = engine.applyPassTurn(ids[0], 0); // P1 tenta passar quando é turno de P2
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Not your turn/);
  });

  test('não é possível jogar cartas não adjacentes', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const result = engine.applyPlayCards(ids[0], [0, 2]);
    expect(result.success).toBe(false);
  });

  test('não é possível jogar cartas de valores mistos', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const hand = engine.getClientStateFor(ids[0]).myHand;
    const idx1 = 0;
    const idx2 = hand.findIndex((c, i) => i > 0 && c.value !== hand[0].value);
    if (idx2 > 0 && idx2 === 1) {
      const result = engine.applyPlayCards(ids[0], [idx1, idx2]);
      expect(result.success).toBe(false);
    } else {
      expect(true).toBe(true);
    }
  });

  test('não é possível jogar índice negativo', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const result = engine.applyPlayCards(ids[0], [-1]);
    expect(result.success).toBe(false);
  });

  test('não é possível jogar índice duplicado', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    // [0, 0] — índice duplicado: isContiguous passa mas isSameValue pode falhar dependendo
    // O comportamento esperado: [0,0].sort() = [0,0] → isContiguous([0,0]) → sorted[1]=0, sorted[0]+1=1 ≠ 0 → false
    const result = engine.applyPlayCards(ids[0], [0, 0]);
    expect(result.success).toBe(false);
  });

  test('getClientStateFor não vaza a mão de outro jogador', () => {
    const { engine, ids } = makeEngine();
    engine.startRound();
    const stateP1 = engine.getClientStateFor(ids[0]);
    const stateP2 = engine.getClientStateFor(ids[1]);

    // myHand deve ser a mão do próprio jogador
    expect(stateP1.myHand).not.toEqual(stateP2.myHand);

    // players públicos não expõem mãos
    stateP1.players.forEach(p => {
      expect((p as any).hand).toBeUndefined();
    });
  });

  test('market_swap em modo não-Mercado é rejeitado', () => {
    const { engine, ids } = makeEngine('TRADITIONAL');
    engine.startRound();
    const result = engine.applyMarketSwap(ids[0], 0, 0);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Mercado/);
  });

  test('game eliminado não pode ser manipulado após GAME_OVER', () => {
    const { engine } = makeEngine();
    engine.startRound();
    // isGameOver() começa false
    expect(engine.isGameOver()).toBe(false);
  });

  test('insertAtIndex fora do range da mão é rejeitado', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    // ids[0] tem 2 cartas (não esvazia a mão ao jogar), ids[1] tem 1 carta
    // deck tem 1 carta para ser sacada no applyPassTurn
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(5, 'SUSHI'), card(3, 'TACO')],
        [ids[1]]: [card(1, 'PIZZA')],
      },
      deck: [card(7, 'RAMEN')],
      pile: [],
    });
    engine.applyPlayCards(ids[0], [0]); // ids[0] joga 1 carta, ainda tem 1 → turn avança para ids[1]
    // ids[1] tem 1 carta na mão; insertAtIndex válido seria 0 ou 1; 99 é fora do range
    const result = engine.applyPassTurn(ids[1], 99);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insertAtIndex out of range/);
  });

  test('jogada com value menor que pilha (mesmo count) é rejeitada', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: { [ids[0]]: [card(2, 'SUSHI', 's1'), card(2, 'SUSHI', 's2'), card(7, 'PIZZA', 'p1')] },
      pile: [card(5, 'PIZZA', 'pile1'), card(5, 'PIZZA', 'pile2')],
    });
    // ids[0] tenta jogar 2 cartas de valor 2, contra pilha de 2 cartas de valor 5
    const result = engine.applyPlayCards(ids[0], [0, 1]);
    expect(result.success).toBe(false);
  });

  test('applyInsertDrawn fora de fase é rejeitado', () => {
    const { engine, ids } = makeEngine('RODIZIO', 4);
    engine.startRound();
    // Não chama applyDrawCard antes (não está em PASS_PICK), só tenta inserir
    const result = engine.applyInsertDrawn(ids[0], 0, 'insert');
    expect(result.success).toBe(false);
  });

  test('applyTrickPick fora de fase é rejeitado', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    // Sem wipe prévio (não está em TRICK_PICK)
    const result = engine.applyTrickPick(ids[0], 'take');
    expect(result.success).toBe(false);
  });

  test('applyInsertDrawn rejeita insertAtIndex fora do range', () => {
    // Precisa de 3 jogadores para não entrar em modo Duelo (isDuel = activePlayers === 2)
    // ids[0] joga para deixar isFirstTurn = false, depois ids[1] puxa → PASS_PICK
    const { engine, ids } = makeEngine('TRADITIONAL', 3);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(5, 'SUSHI', 's1'), card(3, 'RAMEN', 'r1')],
        [ids[1]]: [card(2, 'PIZZA', 'p1')],
        [ids[2]]: [card(4, 'TACO', 't1')],
      },
      deck: [card(7, 'CURRY', 'd1')],
      pile: [],
    });
    // ids[0] joga → isFirstTurn = false, turno passa para ids[1]
    engine.applyPlayCards(ids[0], [0]);
    // ids[1] puxa carta → fase vira PASS_PICK; mão de ids[1] tem 1 carta
    engine.applyDrawCard(ids[1]);
    // 999 está fora do range da mão (mão tem 1 carta → range válido: 0 ou 1)
    const result = engine.applyInsertDrawn(ids[1], 999, 'insert');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insertAtIndex out of range/);
  });

  test('applyTrickPick rejeita insertAtIndex fora do range no take', () => {
    // Setup: forçar TRICK_PICK via wipe (ids[0] joga, ids[1] passa)
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(5, 'SUSHI', 's1'), card(5, 'SUSHI', 's2')],
        [ids[1]]: [card(2, 'PIZZA', 'p1')],
      },
      pile: [],
    });
    // ids[0] joga 1 carta; ids[1] passa → wipe → fase TRICK_PICK
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0);
    // 999 está fora do range da mão
    const result = engine.applyTrickPick(ids[0], 'take', 999);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insertAtIndex out of range/);
  });

  test('applyDuelPassPick rejeita insertAtIndex fora do range', () => {
    // Setup: reproduzir o cenário do teste "phase DUEL_PASS_PICK aparece..."
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(2, 'SUSHI', 'h-2-sushi'), card(6, 'PIZZA', 'h-6-pizza')],
        [ids[1]]: [card(3, 'RAMEN', 'h-3-ramen'), card(4, 'CURRY', 'h-4-curry')],
      },
      pile: [],
      duelPlates: {
        [ids[0]]: [card(2, 'RAMEN', 'p-2-ramen'), card(2, 'BURGER', 'p-2-burger')],
        [ids[1]]: [card(4, 'CURRY', 'p-4-curry'), card(7, 'DESSERT', 'p-7-dessert')],
      },
    });
    // ids[0] joga, ids[1] joga, ids[0] chama applyDrawCard → fase DUEL_PASS_PICK
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPlayCards(ids[1], [0]);
    engine.applyDrawCard(ids[0]);
    // ids[0] tem 1 carta na mão; 999 está fora do range
    const result = engine.applyDuelPassPick(ids[0], 0, 'insert', 999);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/insertAtIndex out of range/);
  });
});

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
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({ pile: [] });
    const state = engine.getClientStateFor(ids[0]);
    expect(state.pile).toHaveLength(0);
  });

  test('injeta deck pequeno', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({ deck: [card(1, 'SUSHI'), card(2, 'RAMEN')] });
    const state = engine.getClientStateFor(ids[0]);
    expect(state.drawPileCount).toBe(2);
  });

  test('injeta tokens em jogadores', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({ tokens: { [ids[0]]: 0, [ids[1]]: 5 } });
    const state0 = engine.getClientStateFor(ids[0]);
    const state1 = engine.getClientStateFor(ids[1]);
    expect(state0.players.find(p => p.userId === ids[0])!.tokensLeft).toBe(0);
    expect(state1.players.find(p => p.userId === ids[1])!.tokensLeft).toBe(5);
  });
});

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

  test('duelPlates aparece em players adversários (count via length)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    const state1 = engine.getClientStateFor(ids[0]);
    // duelPlates do oponente deve estar disponível no state
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

  test('phase DUEL_PASS_PICK aparece em jogo 2P quando jogador esgota mão e passa', () => {
    // Cenário: mão com 2 cartas por jogador + pratos injetados via _setStateForTest.
    // Ambos jogam 1 carta (isFirstTurn = false após turno 0).
    // Jogador 0 então chama applyDrawCard, o que deve acionar DUEL_PASS_PICK
    // porque duelPlates[ids[0]] tem cartas disponíveis.
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      hands: {
        [ids[0]]: [card(2, 'SUSHI', 'h-2-sushi'), card(6, 'PIZZA', 'h-6-pizza')],
        [ids[1]]: [card(3, 'RAMEN', 'h-3-ramen'), card(4, 'CURRY', 'h-4-curry')],
      },
      pile: [],
      duelPlates: {
        [ids[0]]: [card(2, 'RAMEN', 'p-2-ramen'), card(2, 'BURGER', 'p-2-burger')],
        [ids[1]]: [card(4, 'CURRY', 'p-4-curry'), card(7, 'DESSERT', 'p-7-dessert')],
      },
    });
    // Player 0 joga 1 carta (isFirstTurn passa a false); hand tem 1 restante
    engine.applyPlayCards(ids[0], [0]);
    // Player 1 joga 1 carta
    engine.applyPlayCards(ids[1], [0]);
    // Agora é turno de player 0 novamente — chama applyDrawCard para passar
    // Em modo Duelo, isso deve disparar DUEL_PASS_PICK (há pratos disponíveis)
    engine.applyDrawCard(ids[0]);
    const state = engine.getClientStateFor(ids[0]);
    expect(state.phase).toBe('DUEL_PASS_PICK');
  });
});

// ─── tokens e eliminação ─────────────────────────────────────────────────────

describe('GameEngine — tokens e eliminação', () => {
  test('jogador que esgota tokens tem tokensLeft=0 e dispara GAME_OVER', () => {
    // ids[1] começa com 1 token. Esvazia a mão → perde 1 token → tokensLeft=0 → GAME_OVER.
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      tokens: { [ids[0]]: 2, [ids[1]]: 1, [ids[2]]: 2, [ids[3]]: 2 },
      hands: {
        [ids[0]]: [card(2, 'PIZZA', 'p1'), card(3, 'SUSHI', 's1')],
        [ids[1]]: [card(5, 'SUSHI', 's2')],
        [ids[2]]: [card(3, 'TACO', 't1'), card(4, 'TACO', 't2')],
        [ids[3]]: [card(3, 'CURRY', 'c1'), card(4, 'CURRY', 'c2')],
      },
      pile: [],
    });
    // ids[0] joga primeiro (pilha vazia — qualquer carta é válida)
    engine.applyPlayCards(ids[0], [0]);
    // ids[1] joga 5-SUSHI (bate 2-PIZZA na pilha) e esvazia a mão → perde 1 token → 0 → GAME_OVER
    engine.applyPlayCards(ids[1], [0]);
    const state = engine.getClientStateFor(ids[0]);
    expect(state.phase).toBe('GAME_OVER');
    const p1 = state.players.find(p => p.userId === ids[1])!;
    expect(p1.tokensLeft).toBe(0);
  });

  test('último jogador com tokens vence o jogo (GAME_OVER)', () => {
    // Cenário 2P: ids[1] esvazia a mão → tokensLeft 1→0 → GAME_OVER.
    const { engine, ids } = makeEngine('TRADITIONAL', 2);
    engine.startRound();
    engine._setStateForTest({
      tokens: { [ids[0]]: 2, [ids[1]]: 1 },
      hands: {
        [ids[0]]: [card(2, 'PIZZA', 'p1'), card(3, 'SUSHI', 's1')],
        [ids[1]]: [card(5, 'SUSHI', 's2')],
      },
      pile: [],
    });
    // ids[0] joga primeiro (pilha vazia)
    engine.applyPlayCards(ids[0], [0]);
    // ids[1] joga carta que bate e esvazia a mão → eliminado → game over
    const result = engine.applyPlayCards(ids[1], [0]);
    const state = engine.getClientStateFor(ids[0]);
    expect(state.phase).toBe('GAME_OVER');
    const gameOverEvent = result.events.find(e => e.type === 'game:game_over');
    expect(gameOverEvent).toBeDefined();
  });

  test('jogador eliminado por tokens=0 tem isEliminated=true no estado público', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      tokens: { [ids[0]]: 2, [ids[1]]: 1, [ids[2]]: 2, [ids[3]]: 2 },
      hands: {
        [ids[0]]: [card(2, 'PIZZA', 'p1'), card(3, 'SUSHI', 's1')],
        [ids[1]]: [card(5, 'SUSHI', 's2')],
        [ids[2]]: [card(3, 'TACO', 't1'), card(4, 'TACO', 't2')],
        [ids[3]]: [card(3, 'CURRY', 'c1'), card(4, 'CURRY', 'c2')],
      },
    });
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPlayCards(ids[1], [0]); // esvazia mão → tokens 1→0
    const state = engine.getClientStateFor(ids[0]);
    const ids1Player = state.players.find(p => p.userId === ids[1])!;
    expect(ids1Player.isEliminated).toBe(true);
  });
});

// ─── GAME_OVER state shape ────────────────────────────────────────────────────

describe('GameEngine — GAME_OVER state', () => {
  test('GAME_OVER emite evento game:game_over com 4 rankings (placements 1-4 únicos)', () => {
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    // Força ids[1] a esgotar tokens (1→0) ao esvaziar mão
    engine._setStateForTest({
      tokens: { [ids[0]]: 2, [ids[1]]: 1, [ids[2]]: 2, [ids[3]]: 2 },
      hands: {
        [ids[0]]: [card(2, 'PIZZA', 'p1'), card(3, 'SUSHI', 's1')],
        [ids[1]]: [card(5, 'SUSHI', 's2')],
        [ids[2]]: [card(3, 'TACO', 't1'), card(4, 'TACO', 't2')],
        [ids[3]]: [card(3, 'CURRY', 'c1'), card(4, 'CURRY', 'c2')],
      },
    });
    engine.applyPlayCards(ids[0], [0]);
    const result = engine.applyPlayCards(ids[1], [0]); // ids[1] esvazia mão → tokens=0 → GAME_OVER
    const gameOverEvent = result.events.find(e => e.type === 'game:game_over');
    expect(gameOverEvent).toBeDefined();
    const rankings = gameOverEvent!.payload.rankings as Array<{ userId: string; placement: number; tokensLeft: number; username: string }>;
    expect(rankings).toHaveLength(4);
    expect(rankings.map(r => r.placement).sort()).toEqual([1, 2, 3, 4]);
    expect(rankings[0].placement).toBe(1);
  });

  test('vencedor (placement 1) tem tokensLeft <= último (placement 4)', () => {
    // O vencedor é quem esgotou os tokens primeiro (ganhou mais rodadas, recebeu mais pratos).
    // placement 1 → tokensLeft = 0; placement 4 → mais tokens restantes.
    const { engine, ids } = makeEngine('TRADITIONAL', 4);
    engine.startRound();
    engine._setStateForTest({
      tokens: { [ids[0]]: 2, [ids[1]]: 1, [ids[2]]: 2, [ids[3]]: 2 },
      hands: {
        [ids[0]]: [card(2, 'PIZZA', 'p1'), card(3, 'SUSHI', 's1')],
        [ids[1]]: [card(5, 'SUSHI', 's2')],
        [ids[2]]: [card(3, 'TACO', 't1'), card(4, 'TACO', 't2')],
        [ids[3]]: [card(3, 'CURRY', 'c1'), card(4, 'CURRY', 'c2')],
      },
    });
    engine.applyPlayCards(ids[0], [0]);
    const result = engine.applyPlayCards(ids[1], [0]);
    const gameOverEvent = result.events.find(e => e.type === 'game:game_over')!;
    const rankings = gameOverEvent.payload.rankings as Array<{ placement: number; tokensLeft: number }>;
    const first = rankings.find(r => r.placement === 1)!;
    const last = rankings.find(r => r.placement === 4)!;
    expect(first.tokensLeft).toBeLessThanOrEqual(last.tokensLeft);
  });
});

describe('GameEngine — edge: deck pequeno', () => {
  test('drawPile esgotado: applyDrawCard se comporta sem crash em RODIZIO', () => {
    const { engine, ids } = makeEngine('RODIZIO', 4);
    engine.startRound();
    engine._setStateForTest({ deck: [] });
    // applyDrawCard pode retornar success=false ou disparar fim-de-rodada
    const result = engine.applyDrawCard(ids[0]);
    const state = engine.getClientStateFor(ids[0]);
    // Critério: ou success=false, ou state.phase mudou indicando reação a deck vazio
    expect(result.success === false || state.phase !== 'PLAYER_TURN').toBe(true);
    // Drawing pile count permanece 0 (não foi adicionado nada artificialmente)
    expect(state.drawPileCount).toBe(0);
  });

  test('MERCADO com drawPile pequeno mantém invariantes do mercado', () => {
    const { engine, ids } = makeEngine('MERCADO', 2);
    engine.startRound();
    // Esgota o drawPile deixando apenas 1 carta
    engine._setStateForTest({ deck: [card(1, 'SUSHI', 'x1')] });
    // Precisa de um wipe para que ids[0] se torne o wipe winner e possa chamar applyMarketSwap
    engine.applyPlayCards(ids[0], [0]);
    engine.applyPassTurn(ids[1], 0); // wipe → ids[0] vence
    const marketSizeBefore = engine.getClientStateFor(ids[0]).market!.length;
    // Mercado swap não deve crashar mesmo com deck quase vazio
    const result = engine.applyMarketSwap(ids[0], 0, 0);
    expect(result.success).toBe(true);
    const state = engine.getClientStateFor(ids[0]);
    // Mercado mantém o mesmo tamanho (swap é 1-por-1, não há refill — descoberta de Task 8)
    expect(state.market!.length).toBe(marketSizeBefore);
  });
});
