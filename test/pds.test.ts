import { calcPdsChange, clampPds, rankFromPds, RANK_FLOORS } from '../src/common/pds.utils.js';

describe('rankFromPds', () => {
  test('mapeia limites de tier corretamente', () => {
    expect(rankFromPds(0)).toBe('Bronze');
    expect(rankFromPds(199)).toBe('Bronze');
    expect(rankFromPds(200)).toBe('Prata');
    expect(rankFromPds(499)).toBe('Prata');
    expect(rankFromPds(500)).toBe('Ouro');
    expect(rankFromPds(999)).toBe('Ouro');
    expect(rankFromPds(1000)).toBe('Platina');
    expect(rankFromPds(1799)).toBe('Platina');
    expect(rankFromPds(1800)).toBe('Diamante');
    expect(rankFromPds(2799)).toBe('Diamante');
    expect(rankFromPds(2800)).toBe('Esmeralda');
    expect(rankFromPds(3999)).toBe('Esmeralda');
    expect(rankFromPds(4000)).toBe('SuperSabor');
    expect(rankFromPds(99999)).toBe('SuperSabor');
  });
});

describe('clampPds', () => {
  test('mantem PDS dentro do mesmo tier sem mexer', () => {
    expect(clampPds(150, 100)).toBe(150);
    expect(clampPds(50, 100)).toBe(50);
    expect(clampPds(199, 100)).toBe(199);
  });

  test('previne PDS negativo (floor Bronze=0)', () => {
    expect(clampPds(-10, 5)).toBe(0);
    expect(clampPds(-100, 0)).toBe(0);
  });

  test('permite democao para tier anterior (Prata -> Bronze)', () => {
    // Antes do fix: clampPds(180, 200) retornava 200 (preso no floor de Prata).
    // Agora: permite cair para Bronze (floor 0), retornando 180.
    expect(clampPds(180, 200)).toBe(180);
  });

  test('permite promocao para tier superior', () => {
    expect(clampPds(210, 190)).toBe(210); // Bronze -> Prata
    expect(clampPds(510, 490)).toBe(510); // Prata -> Ouro
  });

  test('previne queda abaixo do floor do tier de chegada', () => {
    // Caso impossivel na pratica (PDS sempre >=0), mas defensive
    expect(clampPds(-50, 100)).toBe(0);
  });

  test('preserva tier alto sem cair multiplos tiers de uma vez', () => {
    // Diamante (1800) com perda -20: deve cair para 1780 (Platina superior),
    // nao ficar preso em 1800 (floor Diamante).
    expect(clampPds(1780, 1800)).toBe(1780);
  });
});

describe('calcPdsChange', () => {
  describe('2 jogadores', () => {
    test('vencedor (placement 1) ganha 30 PDS', () => {
      expect(calcPdsChange(1, 2, 0, 0)).toBe(30);
    });
    test('perdedor (placement 2) perde 20 PDS', () => {
      expect(calcPdsChange(2, 2, 0, 0)).toBe(-20);
    });
  });

  describe('4 jogadores', () => {
    test('placement 1: +30', () => expect(calcPdsChange(1, 4, 0, 0)).toBe(30));
    test('placement 2: +10', () => expect(calcPdsChange(2, 4, 0, 0)).toBe(10));
    test('placement 3: -10', () => expect(calcPdsChange(3, 4, 0, 0)).toBe(-10));
    test('placement 4: -20', () => expect(calcPdsChange(4, 4, 0, 0)).toBe(-20));
  });

  describe('win streak bonus', () => {
    test('streak 0 ou 1: sem bonus', () => {
      expect(calcPdsChange(1, 4, 0, 0)).toBe(30);
      expect(calcPdsChange(1, 4, 1, 0)).toBe(30);
    });
    test('streak 2: +10 bonus', () => {
      expect(calcPdsChange(1, 4, 2, 0)).toBe(40);
    });
    test('streak 3: +20 bonus', () => {
      expect(calcPdsChange(1, 4, 3, 0)).toBe(50);
    });
    test('streak 4: +30 bonus (cap)', () => {
      expect(calcPdsChange(1, 4, 4, 0)).toBe(60);
    });
    test('streak 10: ainda +30 bonus (cap mantem)', () => {
      expect(calcPdsChange(1, 4, 10, 0)).toBe(60);
    });
    test('bonus de streak nao aplica em derrota', () => {
      expect(calcPdsChange(3, 4, 5, 0)).toBe(-10);
    });
  });

  describe('loss streak recovery', () => {
    test('streak < 3: sem recovery', () => {
      expect(calcPdsChange(3, 4, 0, 2)).toBe(-10);
    });
    test('streak 3+: -5 a menos', () => {
      expect(calcPdsChange(3, 4, 0, 3)).toBe(-5);
      expect(calcPdsChange(4, 4, 0, 5)).toBe(-15);
    });
    test('recovery nao aplica em vitoria', () => {
      expect(calcPdsChange(1, 4, 0, 5)).toBe(30);
    });
  });
});
