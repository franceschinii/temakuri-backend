import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Stripe } from 'stripe/cjs/stripe.core.js';
import { StripeService } from './stripe.service.js';
import { PaymentsService } from './payments.service.js';
import { PremiumService } from './premium.service.js';

/**
 * Webhook do Stripe. Recebe eventos brutos, valida assinatura e despacha
 * pros handlers correspondentes. Sem JwtAuthGuard — Stripe nao passa
 * token. Seguranca: signature check obrigatorio.
 *
 * IMPORTANTE: main.ts deve configurar rawBody=true pra essa rota, senao
 * a validacao da assinatura falha.
 */
@Controller('payments/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private stripe: StripeService,
    private payments: PaymentsService,
    private premium: PremiumService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (process.env.PAYMENTS_ENABLED !== 'true') {
      // Webhooks chegam, mas defensivamente nao mutamos dados se a flag
      // estiver off. Retornamos 200 pro Stripe nao reenviar.
      this.logger.warn('Webhook recebido com PAYMENTS_ENABLED=false. Ignorado.');
      return { received: true };
    }
    if (!this.stripe.isAvailable()) {
      this.logger.error('Stripe nao inicializado mas webhook chegou.');
      return { received: true };
    }

    const rawBody = req.rawBody ?? (req as any).body;
    if (!rawBody) {
      this.logger.error('rawBody ausente — configure main.ts com rawBody=true');
      throw new BadRequestException('rawBody required');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch (err: any) {
      this.logger.error(`Assinatura invalida: ${err.message}`);
      throw new BadRequestException(`Invalid signature: ${err.message}`);
    }

    this.logger.log(`Stripe event: ${event.type} (${event.id})`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'payment') {
          await this.payments.handleDiamondCheckoutCompleted(session);
        } else if (session.mode === 'subscription') {
          await this.premium.handleSubscriptionCreated(session);
        }
        break;
      }
      case 'invoice.paid': {
        await this.premium.handleInvoicePaid(event.data.object as Stripe.Invoice, this.stripe.raw);
        break;
      }
      case 'customer.subscription.updated': {
        await this.premium.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        await this.premium.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        this.logger.warn(`Cobranca falhou: invoice=${(event.data.object as Stripe.Invoice).id}`);
        // Stripe ja retenta automaticamente. Nao mexemos em isPremium aqui —
        // o cron expira naturalmente quando premiumExpiresAt passar.
        break;
      }
      default:
        this.logger.debug(`Evento ignorado: ${event.type}`);
    }

    return { received: true };
  }
}
