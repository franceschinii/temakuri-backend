import { Injectable, BadRequestException, ServiceUnavailableException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MpService } from './mp.service.js';
import { DIAMOND_PACKS, type DiamondPackSku, PREMIUM_MONTHLY } from './catalog.js';

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
  async createDiamondCheckout(userId: string, sku: string): Promise<{ url: string }> {
    this.requireEnabled();
    const pack = DIAMOND_PACKS[sku as DiamondPackSku];
    if (!pack) throw new BadRequestException('SKU inválido.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const urls = this.getBaseUrls();
    const externalReference = `user:${userId}|sku:${sku}`;
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
              unit_price: pack.priceBrl,
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

    try {
      const body: any = {
        payer_email: user.email,
        back_url: urls.success,
        external_reference: externalReference,
        reason: PREMIUM_MONTHLY.reason,
      };

      if (planId) {
        body.preapproval_plan_id = planId;
      } else {
        // Fallback: cria assinatura sem plano pre-cadastrado.
        body.auto_recurring = {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: PREMIUM_MONTHLY.priceBrl,
          currency_id: 'BRL',
        };
      }

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
    // Formato: "user:<userId>|sku:<sku>"
    const match = externalRef.match(/^user:([^|]+)\|sku:(.+)$/);
    if (!match) {
      // Pode ser uma preapproval_authorized_payment (assinatura) — ignora aqui.
      this.logger.debug(`Payment ${paymentId} external_reference nao e de diamante: ${externalRef}`);
      return;
    }
    const [, userId, sku] = match;
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

    this.logger.log(`+${pack.diamonds} diamantes para ${userId} via payment ${paymentId}`);
  }

  isPaymentsEnabled(): boolean {
    return this.isEnabled;
  }
}
