import { Card } from '../../types/game.types.js';

export function isContiguous(indices: number[]): boolean {
  if (indices.length === 0) return false;
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

export function isSameValue(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.value === cards[0].value);
}

export function isSameCategory(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  return cards.every(c => c.category === cards[0].category);
}

export function isSabor(cards: Card[]): boolean {
  return cards.length >= 2 && isSameCategory(cards);
}

export function beatsPlay(
  played: Card[],
  pile: Card[],
  saborActive: boolean,
  saborMinRequired: number,
): { valid: boolean; reason?: string } {
  if (saborActive) {
    if (played.length < saborMinRequired) {
      return {
        valid: false,
        reason: `Sabor ativo: jogue pelo menos ${saborMinRequired} carta(s)`,
      };
    }
    // Quebrar: categorias mistas com count suficiente — válido (passa para check normal)
    // Continuar: mesmo count ou mais com mesma/qualquer categoria — check normal decide
  }

  if (pile.length === 0) return { valid: true };

  const pileValue = pile[0].value;
  const pileCount = pile.length;
  const playCount = played.length;
  const playValue = played[0].value;

  if (playCount > pileCount) return { valid: true };
  if (playCount === pileCount && playValue > pileValue) return { valid: true };

  return { valid: false, reason: 'A jogada não supera a pilha atual' };
}

export function validatePlayIndices(
  hand: Card[],
  indices: number[],
  pile: Card[],
  saborActive: boolean,
  saborMinRequired: number,
  plateCards?: Card[],
): { valid: boolean; reason?: string } {
  const hasPlates = plateCards && plateCards.length > 0;

  if (indices.length === 0 && !hasPlates) {
    return { valid: false, reason: 'Must play at least one card' };
  }

  // Pratos só podem ser usados em combinação com cartas da mão — nunca sozinhos
  if (indices.length === 0 && hasPlates) {
    return { valid: false, reason: 'Plate cards must be combined with at least one hand card' };
  }

  if (indices.some(i => i < 0 || i >= hand.length)) {
    return { valid: false, reason: 'Card index out of bounds' };
  }

  if (!isContiguous(indices)) {
    return { valid: false, reason: 'Selected cards must be adjacent in hand' };
  }

  const handCards = [...indices].sort((a, b) => a - b).map(i => hand[i]);
  const allCards = hasPlates ? [...handCards, ...plateCards] : handCards;

  if (!isSameValue(allCards)) {
    return { valid: false, reason: 'All selected cards must have the same value' };
  }

  return beatsPlay(allCards, pile, saborActive, saborMinRequired);
}
