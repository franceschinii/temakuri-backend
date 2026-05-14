/**
 * Catalogo de produtos pagaveis em dinheiro real via Stripe.
 *
 * Cada SKU mapeia para um Stripe Price ID via env var. Mantemos preco BRL
 * aqui apenas como referencia visual; o valor real cobrado vem do Stripe.
 */

export type DiamondPackSku =
  | 'DIAMONDS_100'
  | 'DIAMONDS_500'
  | 'DIAMONDS_1200'
  | 'DIAMONDS_3000';

export interface DiamondPack {
  sku: DiamondPackSku;
  diamonds: number;
  priceBrl: number;
  bonus: number;
  envVar: string; // nome da variavel de ambiente que tem o price_id
}

export const DIAMOND_PACKS: Record<DiamondPackSku, DiamondPack> = {
  DIAMONDS_100: {
    sku: 'DIAMONDS_100',
    diamonds: 100,
    priceBrl: 4.9,
    bonus: 0,
    envVar: 'STRIPE_PRICE_DIAMONDS_100',
  },
  DIAMONDS_500: {
    sku: 'DIAMONDS_500',
    diamonds: 500,
    priceBrl: 19.9,
    bonus: 2,
    envVar: 'STRIPE_PRICE_DIAMONDS_500',
  },
  DIAMONDS_1200: {
    sku: 'DIAMONDS_1200',
    diamonds: 1200,
    priceBrl: 39.9,
    bonus: 22,
    envVar: 'STRIPE_PRICE_DIAMONDS_1200',
  },
  DIAMONDS_3000: {
    sku: 'DIAMONDS_3000',
    diamonds: 3000,
    priceBrl: 89.9,
    bonus: 50,
    envVar: 'STRIPE_PRICE_DIAMONDS_3000',
  },
};

export const PREMIUM_MONTHLY = {
  sku: 'PREMIUM_MONTHLY' as const,
  priceBrl: 7.9,
  diamondsPerMonth: 50,
  envVar: 'STRIPE_PRICE_PREMIUM_MONTHLY',
};
