import { Card, FoodCategory } from '../../types/game.types.js';
import { FOOD_CATEGORIES, VALUES, CARDS_PER_VALUE, HAND_SIZE } from '../../common/constants/game.constants.js';

export function buildDeck(): Card[] {
  const deck: Card[] = [];

  for (const value of VALUES) {
    // Category is fixed to the value: value 1 = SUSHI, value 2 = RAMEN, etc.
    const category = FOOD_CATEGORIES[value - 1] as FoodCategory;
    for (let variantIndex = 0; variantIndex < CARDS_PER_VALUE; variantIndex++) {
      deck.push({
        id: `${value}-${variantIndex}`,
        value,
        category,
        variantIndex,
      });
    }
  }

  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealCards(
  playerIds: string[],
  bias = 0,
): { hands: Map<string, Card[]>; drawPile: Card[] } {
  const count = playerIds.length;
  const handSize = HAND_SIZE[count];
  if (!handSize) throw new Error(`Unsupported player count: ${count}`);

  const deck = shuffle(buildDeck());
  const hands = new Map<string, Card[]>();

  playerIds.forEach((id, i) => {
    let hand = deck.slice(i * handSize, (i + 1) * handSize);
    if (bias > 0) hand = applyHandBias(hand, bias);
    hands.set(id, hand);
  });

  const drawPile = deck.slice(count * handSize);
  return { hands, drawPile };
}

// Sorts hand by value (grouping same-value cards together) then applies
// random swaps inversely proportional to bias, so bias=1 = fully grouped,
// bias=0 = fully random (called only when bias > 0).
function applyHandBias(hand: Card[], bias: number): Card[] {
  const sorted = [...hand].sort((a, b) => a.value - b.value);
  const swaps = Math.floor((1 - bias) * hand.length * 2);
  for (let i = 0; i < swaps; i++) {
    const a = Math.floor(Math.random() * sorted.length);
    const b = Math.floor(Math.random() * sorted.length);
    [sorted[a], sorted[b]] = [sorted[b], sorted[a]];
  }
  return sorted;
}
