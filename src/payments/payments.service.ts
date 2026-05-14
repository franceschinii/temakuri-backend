import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StripeService } from './stripe.service.js';
import { DIAMOND_PACKS, type DiamondPackSku, PREMIUM_MONTHLY } from './catalog.js';

/**
 * Orquestra a criacao de Checkout Sessions e Customer Portal sessions
 * do Stripe. Toda chamada e gateada pela feature flag PAYMENTS_ENABLED:
 * se false, lanca 503 — o frontend mostra "Em breve".
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private stripe: StripeService,
  ) {}

  private get isEnabled(): boolean {
    return process.env.PAYMENTS_ENABLED === 'true' && this.stripe.isAvailable();
  }

  private requireEnabled() {
    if (!this.isEnabled) {
      throw new ServiceUnavailableException('Pagamentos temporariamente indisponíveis.');
    }
  }

  private requirePriceId(envVar: string): string {
    const id = process.env[envVar];
    if (!id) {
      this.logger.error(`Env var ${envVar} ausente — Stripe Price ID necessario.`);
      throw new ServiceUnavailableException('Configuração de pagamentos incompleta.');
    }
    return id;
  }

  private getReturnUrls() {
    const base = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    return {
      success_url: `${base}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/payments/cancel`,
    };
  }

  /**
   * Garante que o user tem stripeCustomerId. Cria no Stripe na primeira
   * vez. Retorna o id.
   */
  private async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, stripeCustomerId: true },
    });
    if (!user) throw new BadRequestException('Usuário não encontrado.');
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await this.stripe.raw.customers.create({
      email: user.email ?? undefined,
      name: user.username,
      metadata: { userId: user.id },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  async createDiamondCheckout(userId: string, sku: string): Promise<{ url: string }> {
    this.requireEnabled();
    const pack = DIAMOND_PACKS[sku as DiamondPackSku];
    if (!pack) throw new BadRequestException('SKU inválido.');
    const priceId = this.requirePriceId(pack.envVar);
    const customerId = await this.getOrCreateStripeCustomer(userId);
    const { success_url, cancel_url } = this.getReturnUrls();

    const session = await this.stripe.raw.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      customer: customerId,
      client_reference_id: userId,
      metadata: { userId, sku, diamonds: String(pack.diamonds) },
      payment_method_types: ['card'],
      locale: 'pt-BR',
    });

    return { url: session.url ?? '' };
  }

  async createPremiumCheckout(userId: string): Promise<{ url: string }> {
    this.requireEnabled();
    const priceId = this.requirePriceId(PREMIUM_MONTHLY.envVar);
    const customerId = await this.getOrCreateStripeCustomer(userId);
    const { success_url, cancel_url } = this.getReturnUrls();

    const session = await this.stripe.raw.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      customer: customerId,
      client_reference_id: userId,
      metadata: { userId, type: 'premium' },
      locale: 'pt-BR',
    });

    return { url: session.url ?? '' };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    this.requireEnabled();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('Você ainda não tem assinatura.');
    }
    const base = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    const portal = await this.stripe.raw.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/profile`,
    });
    return { url: portal.url };
  }

  /**
   * Processa checkout.session.completed para mode=payment (compra de
   * pacote de diamantes one-time). Idempotente via stripeSessionId @unique.
   */
  async handleDiamondCheckoutCompleted(session: Stripe.Checkout.Session) {
    if (session.mode !== 'payment') return;
    const sessionId = session.id;
    const userId = session.client_reference_id;
    const sku = session.metadata?.sku as DiamondPackSku | undefined;
    if (!userId || !sku) {
      this.logger.warn(`checkout.session.completed sem userId/sku — session=${sessionId}`);
      return;
    }
    const pack = DIAMOND_PACKS[sku];
    if (!pack) {
      this.logger.warn(`SKU ${sku} desconhecido na session ${sessionId}`);
      return;
    }

    // Idempotencia
    const existing = await this.prisma.diamondTransaction.findUnique({
      where: { stripeSessionId: sessionId },
    });
    if (existing) {
      this.logger.debug(`Session ${sessionId} ja processada, pulando.`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'PURCHASE',
          amount: pack.diamonds,
          description: `Compra ${pack.diamonds} diamantes (${sku})`,
          stripeSessionId: sessionId,
          sku,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { diamonds: { increment: pack.diamonds } },
      }),
    ]);

    this.logger.log(`+${pack.diamonds} 💎 para ${userId} via session ${sessionId}`);
  }

  isPaymentsEnabled(): boolean {
    return this.isEnabled;
  }
}
