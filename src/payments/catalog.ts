/**
 * Catalogo de produtos pagaveis em dinheiro real via Mercado Pago.
 *
 * Diferente do Stripe, o MP nao tem price_id pre-cadastrado para Checkout
 * Pro. O valor e enviado direto na criacao da preferencia. Premium usa
 * Preapproval Plan (criado uma vez no painel), referenciado por
 * MP_PREAPPROVAL_PLAN_ID_PREMIUM.
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
  title: string;
}

export const DIAMOND_PACKS: Record<DiamondPackSku, DiamondPack> = {
  DIAMONDS_100: {
    sku: 'DIAMONDS_100',
    diamonds: 100,
    priceBrl: 4.9,
    bonus: 0,
    title: '100 diamantes',
  },
  DIAMONDS_500: {
    sku: 'DIAMONDS_500',
    diamonds: 500,
    priceBrl: 19.9,
    bonus: 2,
    title: '500 diamantes',
  },
  DIAMONDS_1200: {
    sku: 'DIAMONDS_1200',
    diamonds: 1200,
    priceBrl: 39.9,
    bonus: 22,
    title: '1200 diamantes',
  },
  DIAMONDS_3000: {
    sku: 'DIAMONDS_3000',
    diamonds: 3000,
    priceBrl: 89.9,
    bonus: 50,
    title: '3000 diamantes',
  },
};

export const PREMIUM_MONTHLY = {
  sku: 'PREMIUM_MONTHLY' as const,
  priceBrl: 7.9,
  diamondsPerMonth: 50,
  reason: 'Temakuri Premium (mensal)',
};
