import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { PREMIUM_MONTHLY } from './catalog.js';

/**
 * Gerencia ciclo de vida das assinaturas Premium via Mercado Pago.
 *
 * Conceitos MP:
 * - preapproval: a assinatura em si (status authorized/paused/cancelled).
 * - authorized_payment: cada cobranca mensal individual da preapproval.
 *
 * Fluxo:
 * 1. Usuario aceita assinatura -> webhook "subscription_preapproval"
 *    com status=authorized -> registra PremiumSubscription.
 * 2. MP cobra mensalmente -> webhook "subscription_authorized_payment"
 *    com status=approved -> estende premiumExpiresAt + credita 50
 *    diamantes (idempotente por externalInvoiceId).
 * 3. Cancelamento -> webhook preapproval com status=cancelled -> marca
 *    CANCELLED. User segue Premium ate premiumExpiresAt vencer (cron).
 *
 * Cron diario expira premiums vencidos.
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
   * Processa notificacao de preapproval (assinatura criada/atualizada).
   * Recebe o objeto preapproval ja resolvido do MP.
   *
   * status possiveis: authorized | paused | cancelled | pending
   */
  async handlePreapprovalNotification(preapproval: any) {
    const preapprovalId = String(preapproval.id);
    const externalRef = preapproval.external_reference as string | undefined;
    const status = preapproval.status as string;
    const payerEmail = preapproval.payer_email as string | undefined;
    const payerId = preapproval.payer_id ? String(preapproval.payer_id) : undefined;

    // external_reference formato "user:<userId>"
    const userId = externalRef?.match(/^user:(.+)$/)?.[1];
    if (!userId) {
      this.logger.warn(`Preapproval ${preapprovalId} sem external_reference valido (${externalRef}).`);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) {
      this.logger.warn(`User ${userId} nao encontrado para preapproval ${preapprovalId}.`);
      return;
    }

    if (payerId) {
      // Mapeia para externalCustomerId so na primeira vez.
      await this.prisma.user.update({
        where: { id: userId },
        data: { externalCustomerId: payerId },
      }).catch(() => {
        // Pode falhar por @unique se outro user ja usa o mesmo payerId.
        // Nao bloqueia o fluxo.
      });
    }

    // expiresAt: tenta extrair de next_payment_date; se faltar, deixa nulo
    // (vai ser preenchido no proximo authorized_payment).
    const nextPayment = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null;
    const dbStatus = status === 'authorized' ? 'ACTIVE'
      : status === 'cancelled' ? 'CANCELLED'
      : status === 'paused' ? 'PAST_DUE'
      : 'ACTIVE';

    await this.prisma.premiumSubscription.upsert({
      where: { externalSubscriptionId: preapprovalId },
      create: {
        userId,
        status: dbStatus,
        expiresAt: nextPayment ?? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: status === 'cancelled',
        externalSubscriptionId: preapprovalId,
        externalCustomerId: payerId ?? payerEmail ?? 'unknown',
      },
      update: {
        status: dbStatus,
        cancelAtPeriodEnd: status === 'cancelled',
        ...(nextPayment ? { expiresAt: nextPayment } : {}),
      },
    });

    this.logger.log(`Preapproval ${preapprovalId} (user ${userId}) status=${status} -> ${dbStatus}`);
  }

  /**
   * Processa cobranca mensal aprovada (authorized_payment). Estende
   * premiumExpiresAt e credita 50 diamantes. Idempotente via
   * externalInvoiceId @unique.
   */
  async handleAuthorizedPayment(authorizedPayment: any) {
    const apId = String(authorizedPayment.id);
    const status = authorizedPayment.status as string;
    const preapprovalId = authorizedPayment.preapproval_id ? String(authorizedPayment.preapproval_id) : undefined;

    if (status !== 'approved' && status !== 'processed') {
      this.logger.debug(`AuthorizedPayment ${apId} status=${status}, ignorando.`);
      return;
    }
    if (!preapprovalId) {
      this.logger.warn(`AuthorizedPayment ${apId} sem preapproval_id.`);
      return;
    }

    const sub = await this.prisma.premiumSubscription.findUnique({
      where: { externalSubscriptionId: preapprovalId },
    });
    if (!sub) {
      this.logger.warn(`PremiumSubscription nao encontrada para preapproval ${preapprovalId}.`);
      return;
    }

    const existing = await this.prisma.diamondTransaction.findUnique({
      where: { externalInvoiceId: apId },
    });
    if (existing) {
      this.logger.debug(`AuthorizedPayment ${apId} ja processada, pulando.`);
      return;
    }

    // Estende 31 dias a partir de agora (mensal). MP nao informa o periodo
    // exato no authorized_payment; o handlePreapprovalNotification depois
    // ajusta para next_payment_date se necessario.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.diamondTransaction.create({
        data: {
          userId: sub.userId,
          type: 'PREMIUM_GRANT',
          amount: PREMIUM_MONTHLY.diamondsPerMonth,
          description: 'Grant mensal Premium',
          externalInvoiceId: apId,
          sku: 'PREMIUM_MONTHLY',
        },
      }),
      this.prisma.user.update({
        where: { id: sub.userId },
        data: {
          isPremium: true,
          premiumExpiresAt: expiresAt,
          lastPremiumGrantAt: now,
          diamonds: { increment: PREMIUM_MONTHLY.diamondsPerMonth },
        },
      }),
      this.prisma.premiumSubscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', expiresAt },
      }),
    ]);

    this.logger.log(`Premium renovado (preapproval ${preapprovalId}) -> expira ${expiresAt.toISOString()}`);
  }
}
