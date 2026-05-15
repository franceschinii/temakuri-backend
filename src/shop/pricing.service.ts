import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type PriceKind =
  | 'avatar_coins'
  | 'avatar_diamonds'
  | 'mode'
  | 'theme'
  | 'coin_pack_diamonds'
  | 'diamond_pack_brl'
  | 'premium_brl'
  | 'utility';

/**
 * Camada de precos do catalogo. Mantem os defaults hardcoded como fonte
 * primaria; um override no DB (CatalogPrice) tem prioridade quando existe.
 *
 * Estrategia defensiva: se o DB falhar ou nao houver override, sempre
 * cai no default — a loja nunca para por causa disso. Cache em memoria
 * com TTL curto pra evitar 1 query por item em getCatalog.
 */
@Injectable()
export class ShopPricingService {
  private readonly logger = new Logger(ShopPricingService.name);
  private cache = new Map<string, number>();
  private cacheLoadedAt = 0;
  // Curto pra que mudancas do admin reflitam quase em tempo real na loja.
  // O invalidate() ja limpa imediatamente, mas o TTL e a rede de seguranca
  // pra outros pontos do codigo que leem sem warm() explicito.
  private static readonly TTL_MS = 5_000;

  constructor(private prisma: PrismaService) {}

  private async ensureCache() {
    const now = Date.now();
    if (now - this.cacheLoadedAt < ShopPricingService.TTL_MS && this.cache.size >= 0 && this.cacheLoadedAt > 0) {
      return;
    }
    try {
      const rows = await this.prisma.catalogPrice.findMany();
      this.cache = new Map(rows.map(r => [`${r.kind}:${r.key}`, r.price]));
      this.cacheLoadedAt = now;
    } catch (err: any) {
      this.logger.warn(`Falha ao carregar overrides de preco (usando defaults): ${err.message}`);
      // Mantem cache antigo (ou vazio) — getters caem no default.
    }
  }

  /**
   * Invalida o cache imediatamente (chamado apos admin editar preco).
   * Limpa o Map tambem — so zerar cacheLoadedAt nao basta porque o
   * getPriceSync nao chama ensureCache; ele continuaria lendo valores
   * velhos do Map cheio ate o proximo warm assincrono.
   */
  invalidate() {
    this.cache.clear();
    this.cacheLoadedAt = 0;
  }

  /**
   * Retorna o preco efetivo: override do DB se existir, senao o default.
   */
  async getPrice(kind: PriceKind, key: string | number, fallback: number): Promise<number> {
    await this.ensureCache();
    const v = this.cache.get(`${kind}:${key}`);
    return typeof v === 'number' ? v : fallback;
  }

  /** Versao sincrona — usa cache ja carregado. Pra hot paths. */
  getPriceSync(kind: PriceKind, key: string | number, fallback: number): number {
    const v = this.cache.get(`${kind}:${key}`);
    return typeof v === 'number' ? v : fallback;
  }

  /** Pre-carrega o cache (chamar no inicio de getCatalog). */
  async warm() {
    await this.ensureCache();
  }

  // ===== admin =====

  async listOverrides() {
    return this.prisma.catalogPrice.findMany({ orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
  }

  async setOverride(kind: PriceKind, key: string, price: number) {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Preco invalido');
    }
    const row = await this.prisma.catalogPrice.upsert({
      where: { kind_key: { kind, key } },
      create: { kind, key, price },
      update: { price },
    });
    this.invalidate();
    return row;
  }

  async removeOverride(kind: string, key: string) {
    await this.prisma.catalogPrice.deleteMany({ where: { kind, key } });
    this.invalidate();
    return { ok: true };
  }
}
