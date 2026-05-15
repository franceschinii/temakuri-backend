import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ShopPricingService, type PriceKind } from './pricing.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { DIAMOND_PACKS, PREMIUM_MONTHLY } from '../payments/catalog.js';

// Defaults espelhados de shop.service.ts e catalog.ts. Usados so para a
// UI admin mostrar "valor atual (default X)". A fonte de verdade dos
// defaults continua nos arquivos originais; aqui e referencia de display.
const DEFAULTS: { kind: PriceKind; key: string; label: string; unit: string; def: number }[] = [
  { kind: 'avatar_coins', key: '4', label: 'Avatar Sashimi', unit: 'moedas', def: 15 },
  { kind: 'avatar_coins', key: '5', label: 'Avatar Takoyaki', unit: 'moedas', def: 20 },
  { kind: 'avatar_coins', key: '6', label: 'Avatar Missô', unit: 'moedas', def: 25 },
  { kind: 'avatar_coins', key: '7', label: 'Avatar Udon', unit: 'moedas', def: 30 },
  { kind: 'avatar_coins', key: '8', label: 'Avatar Udon Gold', unit: 'moedas', def: 50 },
  { kind: 'avatar_diamonds', key: '9', label: 'Avatar Yokai', unit: 'diamantes', def: 30 },
  { kind: 'avatar_diamonds', key: '10', label: 'Avatar Kitsune', unit: 'diamantes', def: 30 },
  { kind: 'avatar_diamonds', key: '11', label: 'Avatar Tanuki', unit: 'diamantes', def: 30 },
  { kind: 'avatar_diamonds', key: '12', label: 'Avatar Geisha', unit: 'diamantes', def: 80 },
  { kind: 'avatar_diamonds', key: '13', label: 'Avatar Samurai', unit: 'diamantes', def: 80 },
  { kind: 'avatar_diamonds', key: '14', label: 'Avatar Dragão Dourado', unit: 'diamantes', def: 300 },
  { kind: 'avatar_diamonds', key: '15', label: 'Avatar Corinthians', unit: 'diamantes', def: 100 },
  { kind: 'mode', key: 'MERCADO', label: 'Modo Mercado', unit: 'moedas', def: 20 },
  { kind: 'mode', key: 'RODIZIO', label: 'Modo Rodízio', unit: 'moedas', def: 30 },
  { kind: 'mode', key: 'DEGUSTACAO', label: 'Modo Degustação', unit: 'moedas', def: 50 },
  { kind: 'theme', key: 'oceano', label: 'Tema Oceano', unit: 'diamantes', def: 50 },
  { kind: 'theme', key: 'sakura', label: 'Tema Sakura', unit: 'diamantes', def: 100 },
  { kind: 'theme', key: 'oni', label: 'Tema Oni', unit: 'diamantes', def: 150 },
  { kind: 'theme', key: 'corinthians', label: 'Tema Corinthians', unit: 'diamantes', def: 200 },
  { kind: 'coin_pack_diamonds', key: 'COIN_PACK_50', label: 'Pacote 50 moedas', unit: 'diamantes', def: 5 },
  { kind: 'coin_pack_diamonds', key: 'COIN_PACK_200', label: 'Pacote 200 moedas', unit: 'diamantes', def: 15 },
  { kind: 'coin_pack_diamonds', key: 'COIN_PACK_700', label: 'Pacote 700 moedas', unit: 'diamantes', def: 40 },
  { kind: 'utility', key: 'RESET_RANKED_WARNINGS', label: 'Limpar avisos ranked', unit: 'diamantes', def: 20 },
  { kind: 'utility', key: 'RESET_LOSS_STREAK', label: 'Zerar streak derrotas', unit: 'diamantes', def: 10 },
  { kind: 'diamond_pack_brl', key: 'DIAMONDS_100', label: 'Compra 100 diamantes', unit: 'R$', def: DIAMOND_PACKS.DIAMONDS_100.priceBrl },
  { kind: 'diamond_pack_brl', key: 'DIAMONDS_500', label: 'Compra 500 diamantes', unit: 'R$', def: DIAMOND_PACKS.DIAMONDS_500.priceBrl },
  { kind: 'diamond_pack_brl', key: 'DIAMONDS_1200', label: 'Compra 1200 diamantes', unit: 'R$', def: DIAMOND_PACKS.DIAMONDS_1200.priceBrl },
  { kind: 'diamond_pack_brl', key: 'DIAMONDS_3000', label: 'Compra 3000 diamantes', unit: 'R$', def: DIAMOND_PACKS.DIAMONDS_3000.priceBrl },
  { kind: 'premium_brl', key: 'PREMIUM_MONTHLY', label: 'Premium mensal', unit: 'R$', def: PREMIUM_MONTHLY.priceBrl },
];

@Controller('admin/pricing')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PricingController {
  constructor(private readonly pricing: ShopPricingService) {}

  /** Lista todos os itens editaveis com default + override atual (se houver). */
  @Get()
  async list() {
    const overrides = await this.pricing.listOverrides();
    const map = new Map(overrides.map(o => [`${o.kind}:${o.key}`, o.price]));
    return DEFAULTS.map(d => ({
      ...d,
      override: map.get(`${d.kind}:${d.key}`) ?? null,
      effective: map.get(`${d.kind}:${d.key}`) ?? d.def,
    }));
  }

  @Post()
  async set(@Body() body: { kind: PriceKind; key: string; price: number }) {
    return this.pricing.setOverride(body.kind, body.key, body.price);
  }

  @Delete(':kind/:key')
  async reset(@Param('kind') kind: string, @Param('key') key: string) {
    return this.pricing.removeOverride(kind, key);
  }
}
