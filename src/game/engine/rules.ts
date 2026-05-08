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
    const breaksSabor = !isSameCategory(played) && played.length >= saborMinRequired;
    const exceedsRequirement = played.length > saborMinRequired;

    if (!breaksSabor && !exceedsRequirement) {
      return {
        valid: false,
        reason: `Sabor ativo: jogue mais de ${saborMinRequired} carta(s) ou quebre com categorias mistas`,
      };
    }
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
): { valid: boolean; reason?: string } {
  if (indices.length === 0) {
    return { valid: false, reason: 'Must play at least one card' };
  }

  if (indices.some(i => i < 0 || i >= hand.length)) {
    return { valid: false, reason: 'Card index out of bounds' };
  }

  if (!isContiguous(indices)) {
    return { valid: false, reason: 'Selected cards must be adjacent in hand' };
  }

  const selected = indices.sort((a, b) => a - b).map(i => hand[i]);

  if (!isSameValue(selected)) {
    return { valid: false, reason: 'All selected cards must have the same value' };
  }

  return beatsPlay(selected, pile, saborActive, saborMinRequired);
}
