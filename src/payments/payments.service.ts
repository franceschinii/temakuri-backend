import { Injectable, BadRequestException, ServiceUnavailableException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MpService } from './mp.service.js';
import { DIAMOND_PACKS, type DiamondPackSku, PREMIUM_MONTHLY } from './catalog.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { ShopPricingService } from '../shop/pricing.service.js';

/**
 * Orquestra criacao de Preferencias (Checkout Pro) e PreApprovals
 * (assinatura recorrente) do Mercado Pago. Toda chamada e gateada pela
 * feature flag PAYMENTS_ENABLED: se false, lanca 503 — o frontend mostra
 * "Em breve".
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private mp: MpService,
    private coupons: CouponsService,
    private pricing: ShopPricingService,
  ) {}

  private get isEnabled(): boolean {
    return process.env.PAYMENTS_ENABLED === 'true' && this.mp.isAvailable();
  }

  private requireEnabled() {
    if (!this.isEnabled) {
      throw new ServiceUnavailableException('Pagamentos temporariamente indisponíveis.');
    }
  }

  private getBaseUrls() {
    const base = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    const api = process.env.APP_API_URL ?? 'http://localhost:3001';
    return {
      success: `${base}/payments/success`,
      failure: `${base}/payments/cancel`,
      pending: `${base}/payments/pending`,
      // Mercado Pago envia notificacoes para esta URL via POST.
      notification: `${api}/api/v1/payments/webhooks/mp`,
    };
  }

  /**
   * Cria preferencia de Checkout Pro para compra one-time de diamantes.
   * Retorna init_point (URL para redirecionar o usuario).
   */
  async createDiamondCheckout(userId: string, sku: string, couponCode?: string): Promise<{ url: string }> {
    this.requireEnabled();
    const pack = DIAMOND_PACKS[sku as DiamondPackSku];
    if (!pack) throw new BadRequestException('SKU inválido.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    // Preco base: override do admin (CatalogPrice) se existir, senao o
    // default do catalog.ts. Cupom aplica sobre esse valor.
    const basePrice = await this.pricing.getPrice('diamond_pack_brl', sku, pack.priceBrl);
    let unitPrice = basePrice;
    let couponSegment = '';
    if (couponCode) {
      const validation = await this.coupons.validate(couponCode, 'diamonds', userId);
      if (!validation.valid) {
        throw new BadRequestException(`Cupom inválido: ${validation.reason}`);
      }
      const discount = (basePrice * validation.discountPercent!) / 100;
      unitPrice = Math.max(0.5, Math.round((basePrice - discount) * 100) / 100);
      couponSegment = `|coupon:${validation.couponId}`;
    }

    const urls = this.getBaseUrls();
    const externalReference = `user:${userId}|sku:${sku}${couponSegment}`;
    const payerName = user.username ?? 'Comprador';

    try {
      const result = await this.mp.preference.create({
        body: {
          items: [
            {
              id: sku,
              title: pack.title,
              description: `${pack.diamonds} diamantes Temakuri para uso no jogo`,
              category_id: 'virtual_goods',
              quantity: 1,
              unit_price: unitPrice,
              currency_id: 'BRL',
            },
          ],
          payer: user.email
            ? {
                email: user.email,
                first_name: payerName,
                last_name: 'Temakuri',
              }
            : undefined,
          back_urls: {
            success: urls.success,
            failure: urls.failure,
            pending: urls.pending,
          },
          auto_return: 'approved',
          external_reference: externalReference,
          notification_url: urls.notification,
          statement_descriptor: 'TEMAKURI',
          binary_mode: true,
          metadata: { userId, sku, diamonds: pack.diamonds },
        },
      });

      const useSandbox = process.env.MP_USE_SANDBOX === 'true';
      const url = (useSandbox ? result.sandbox_init_point : result.init_point) ?? '';
      if (!url) {
        this.logger.error(`Preferencia criada sem init_point — id=${result.id}`);
        throw new ServiceUnavailableException('Falha ao iniciar pagamento.');
      }
      return { url };
    } catch (err: any) {
      this.logger.error(`Erro ao criar preferencia MP: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Falha ao iniciar pagamento.');
    }
  }

  /**
   * Cria PreApproval (assinatura recorrente mensal) para o Premium.
   * Usa MP_PREAPPROVAL_PLAN_ID_PREMIUM (criado uma vez no painel MP) ou,
   * em fallback, cria preapproval avulso com auto_recurring inline.
   */
  async createPremiumCheckout(userId: string): Promise<{ url: string }> {
    this.requireEnabled();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, isPremium: true, premiumExpiresAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (!user.email) {
      throw new BadRequestException('Premium exige email cadastrado no perfil.');
    }
    if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt > new Date()) {
      throw new BadRequestException('Você já possui Premium ativo.');
    }

    const urls = this.getBaseUrls();
    const planId = process.env.MP_PREAPPROVAL_PLAN_ID_PREMIUM;
    const externalReference = `user:${userId}`;

    // Com preapproval_plan_id, o checkout de assinatura do MP nao aceita
    // criacao via POST /preapproval sem card_token_id. O fluxo correto e
    // redirecionar o usuario direto para /subscriptions/checkout, onde o
    // proprio MP cria a preapproval ao receber os dados do cartao.
    if (planId) {
      const checkoutUrl = new URL('https://www.mercadopago.com.br/subscriptions/checkout');
      checkoutUrl.searchParams.set('preapproval_plan_id', planId);
      checkoutUrl.searchParams.set('external_reference', externalReference);
      checkoutUrl.searchParams.set('back_url', urls.success);
      return { url: checkoutUrl.toString() };
    }

    try {
      // Fallback (sem plano pre-cadastrado): cria preapproval avulsa via API.
      // Funciona porque sem preapproval_plan_id o MP aceita auto_recurring
      // inline e gera init_point sem exigir card_token_id.
      // Aplica override do admin (kind=premium_brl) caso definido.
      const effectivePrice = await this.pricing.getPrice(
        'premium_brl',
        PREMIUM_MONTHLY.sku,
        PREMIUM_MONTHLY.priceBrl,
      );
      const body: any = {
        payer_email: user.email,
        back_url: urls.success,
        external_reference: externalReference,
        reason: PREMIUM_MONTHLY.reason,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: effectivePrice,
          currency_id: 'BRL',
        },
      };

      const result = await this.mp.preapproval.create({ body });

      const url = result.init_point ?? '';
      if (!url) {
        this.logger.error(`PreApproval criada sem init_point — id=${result.id}`);
        throw new ServiceUnavailableException('Falha ao iniciar assinatura.');
      }
      return { url };
    } catch (err: any) {
      this.logger.error(`Erro ao criar preapproval MP: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Falha ao iniciar assinatura.');
    }
  }

  /**
   * MP nao tem Customer Portal. Cancelar assinatura significa marcar
   * preapproval como 'cancelled' via API. O webhook subsequente sincroniza.
   * Usuario continua Premium ate premiumExpiresAt vencer (cron expira).
   */
  async cancelPremium(userId: string): Promise<{ ok: true }> {
    this.requireEnabled();
    const sub = await this.prisma.premiumSubscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException('Nenhuma assinatura ativa.');

    try {
      await this.mp.preapproval.update({
        id: sub.externalSubscriptionId,
        body: { status: 'cancelled' },
      });
    } catch (err: any) {
      this.logger.error(`Erro ao cancelar preapproval ${sub.externalSubscriptionId}: ${err.message}`);
      throw new ServiceUnavailableException('Falha ao cancelar assinatura.');
    }

    await this.prisma.premiumSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', cancelAtPeriodEnd: true },
    });
    return { ok: true };
  }

  /**
   * Processa notificacao de payment (one-time/diamantes) aprovada.
   * Idempotente via externalPaymentId @unique.
   *
   * Aceita o payment ja resolvido (chamado pelo webhook depois de fazer
   * fetch via API por causa do x-signature).
   */
  async handleDiamondPaymentApproved(payment: any) {
    const paymentId = String(payment.id);
    const status = payment.status as string;
    if (status !== 'approved') {
      this.logger.debug(`Payment ${paymentId} status=${status}, ignorando.`);
      return;
    }
    const externalRef = payment.external_reference as string | undefined;
    if (!externalRef) {
      this.logger.warn(`Payment ${paymentId} sem external_reference, pulando.`);
      return;
    }
    // Formato: "user:<userId>|sku:<sku>" ou "user:<userId>|sku:<sku>|coupon:<couponId>"
    const match = externalRef.match(/^user:([^|]+)\|sku:([^|]+)(?:\|coupon:(.+))?$/);
    if (!match) {
      // Pode ser uma preapproval_authorized_payment (assinatura) — ignora aqui.
      this.logger.debug(`Payment ${paymentId} external_reference nao e de diamante: ${externalRef}`);
      return;
    }
    const [, userId, sku, couponId] = match;
    const pack = DIAMOND_PACKS[sku as DiamondPackSku];
    if (!pack) {
      this.logger.warn(`SKU ${sku} desconhecido no payment ${paymentId}`);
      return;
    }

    const existing = await this.prisma.diamondTransaction.findUnique({
      where: { externalPaymentId: paymentId },
    });
    if (existing) {
      this.logger.debug(`Payment ${paymentId} ja processado, pulando.`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'PURCHASE',
          amount: pack.diamonds,
          description: `Compra ${pack.diamonds} diamantes (${sku})`,
          externalPaymentId: paymentId,
          sku,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { diamonds: { increment: pack.diamonds } },
      }),
    ]);

    // Registra uso do cupom (se houve) — fora da transacao acima pq depende
    // do paid_amount real do MP. Falha de redemption nao reverte a compra.
    if (couponId) {
      const paidAmount = Number(payment.transaction_amount ?? payment.transaction_details?.total_paid_amount ?? 0);
      const discountValue = Math.max(0, pack.priceBrl - paidAmount);
      try {
        await this.coupons.recordRedemption({
          couponId,
          userId,
          paymentSku: sku,
          discountValue,
        });
      } catch (err: any) {
        this.logger.warn(`Falha ao registrar redemption do cupom ${couponId}: ${err.message}`);
      }
    }

    this.logger.log(`+${pack.diamonds} diamantes para ${userId} via payment ${paymentId}${couponId ? ` (cupom ${couponId})` : ''}`);
  }

  isPaymentsEnabled(): boolean {
    return this.isEnabled;
  }
}
