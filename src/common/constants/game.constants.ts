import { FoodCategory } from '../../types/game.types.js';

export const FOOD_CATEGORIES: FoodCategory[] = [
  'SUSHI',
  'RAMEN',
  'TACO',
  'PIZZA',
  'CURRY',
  'BURGER',
  'DESSERT',
];

export const CATEGORY_DISPLAY: Record<FoodCategory, string> = {
  SUSHI: 'Temaki',
  RAMEN: 'Tonkotsu',
  TACO: 'Carnitas',
  PIZZA: 'Margherita',
  CURRY: 'Katsu',
  BURGER: 'Smash',
  DESSERT: 'Mochi',
};

export const CARDS_PER_VALUE = 9;
export const VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

export const HAND_SIZE: Record<number, number> = {
  2: 11,
  3: 11,
  4: 9,
  5: 7,
  6: 6,
};

export const INITIAL_TOKENS = 3;
export const TURN_TIMEOUT_MS = 30_000;
export const MARKET_SIZE = 3;
export const STARTING_COUNTDOWN_MS = 3_000;

export const WS_HEARTBEAT_INTERVAL = 30_000;
