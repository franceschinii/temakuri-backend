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
  if (!isContiguous(played.map((_, i) => i))) {
    return { valid: false, reason: 'Cards must be adjacent in hand' };
  }

  if (!isSameValue(played)) {
    return { valid: false, reason: 'All cards must share the same value' };
  }

  if (saborActive) {
    const breakingSabor = played.length >= saborMinRequired && !isSameCategory(played);
    const meetingRequirement = played.length > saborMinRequired;

    if (!breakingSabor && !meetingRequirement) {
      return {
        valid: false,
        reason: `Sabor active: must play more than ${saborMinRequired} cards or break with mixed categories`,
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

  return { valid: false, reason: 'Play does not beat the current pile' };
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
