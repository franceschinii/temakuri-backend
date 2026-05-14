import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Stripe } from 'stripe/cjs/stripe.core.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PREMIUM_MONTHLY } from './catalog.js';

/**
 * Gerencia o ciclo de vida das assinaturas Premium:
 * - Cron diario expira premiums vencidos (User.isPremium = false).
 * - Webhook handlers atualizam User.premiumExpiresAt e creditam
 *   diamantes mensais via DiamondTransaction (idempotente por
 *   stripeInvoiceId).
 *
 * O grant de diamantes acontece a cada invoice.paid (Stripe garante
 * exatamente uma invoice por periodo de cobranca), nao por cron — assim
 * nao corremos risco de creditar duas vezes.
 */
@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async syncExpiredPremiums() {
    const now = new Date();
    const expiredUsers = await this.prisma.user.updateMany({
      where: { isPremium: true, premiumExpiresAt: { lt: now } },
      data: { isPremium: false },
    });
    const expiredSubs = await this.prisma.premiumSubscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    if (expiredUsers.count > 0 || expiredSubs.count > 0) {
      this.logger.log(
        `Premium cron: ${expiredUsers.count} usuario(s) expirado(s), ${expiredSubs.count} assinatura(s) marcada(s) EXPIRED`,
      );
    }
  }

  /**
   * Handler de checkout.session.completed para mode=subscription.
   * Stripe cria a Subscription e dispara este evento + invoice.paid.
   * Aqui apenas registramos a Subscription; o credito de diamantes vem
   * em handleInvoicePaid.
   */
  async handleSubscriptionCreated(session: Stripe.Checkout.Session) {
    const userId = session.client_reference_id;
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;
    if (!userId || !subscriptionId || !customerId) {
      this.logger.warn(`handleSubscriptionCreated: campos faltando — userId=${userId} sub=${subscriptionId} cust=${customerId}`);
      return;
    }
    // Salva stripeCustomerId no User (idempotente).
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  /**
   * Handler de invoice.paid — chamado na primeira fatura e em cada
   * renovacao mensal. Estende premiumExpiresAt, credita 50 diamantes
   * (idempotente via stripeInvoiceId unique).
   */
  async handleInvoicePaid(invoice: Stripe.Invoice, stripe: Stripe) {
    const invoiceId = invoice.id;
    if (!invoiceId) {
      this.logger.warn('handleInvoicePaid: invoice sem id');
      return;
    }
    // Idempotencia: se ja temos DiamondTransaction com este stripeInvoiceId,
    // ja processamos esta cobranca.
    const existing = await this.prisma.diamondTransaction.findUnique({
      where: { stripeInvoiceId: invoiceId },
    });
    if (existing) {
      this.logger.debug(`Invoice ${invoiceId} ja processada, pulando.`);
      return;
    }

    // Obtem subscription para extrair user_id e periodo
    // (invoice.subscription_details.subscription pode ser string)
    const subId = (invoice as any).subscription as string | undefined;
    if (!subId) {
      this.logger.warn(`Invoice ${invoiceId} sem subscription, pulando.`);
      return;
    }
    const subscription = await stripe.subscriptions.retrieve(subId);
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;
    const user = await this.prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!user) {
      this.logger.warn(`Nenhum user para customer ${customerId}, pulando invoice ${invoiceId}.`);
      return;
    }

    // current_period_end existe em subscription items
    const item = subscription.items.data[0];
    const periodEndUnix = item?.current_period_end ?? subscription.billing_cycle_anchor;
    const expiresAt = new Date(periodEndUnix * 1000);

    // Atualiza ou cria PremiumSubscription
    await this.prisma.premiumSubscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      create: {
        userId: user.id,
        status: 'ACTIVE',
        expiresAt,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
      },
      update: {
        status: 'ACTIVE',
        expiresAt,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    // Credita diamantes mensais + atualiza user em transacao atomica
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.diamondTransaction.create({
        data: {
          userId: user.id,
          type: 'PREMIUM_GRANT',
          amount: PREMIUM_MONTHLY.diamondsPerMonth,
          description: 'Grant mensal Premium',
          stripeInvoiceId: invoiceId,
          sku: 'PREMIUM_MONTHLY',
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          isPremium: true,
          premiumExpiresAt: expiresAt,
          lastPremiumGrantAt: now,
          diamonds: { increment: PREMIUM_MONTHLY.diamondsPerMonth },
        },
      }),
    ]);

    this.logger.log(`Premium renovado para ${user.username}, expira ${expiresAt.toISOString()}`);
  }

  /**
   * Handler de customer.subscription.updated — sincroniza cancel_at_period_end
   * e status. Nao mexe em isPremium aqui (o cron faz isso quando vencer).
   */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const sub = await this.prisma.premiumSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!sub) return;
    const item = subscription.items.data[0];
    const periodEndUnix = item?.current_period_end ?? subscription.billing_cycle_anchor;
    await this.prisma.premiumSubscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        expiresAt: new Date(periodEndUnix * 1000),
      },
    });
  }

  /**
   * Handler de customer.subscription.deleted — marca cancelada. O User
   * continua isPremium=true ate premiumExpiresAt passar (proximo cron).
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    await this.prisma.premiumSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: { status: 'CANCELLED' },
    });
  }
}
