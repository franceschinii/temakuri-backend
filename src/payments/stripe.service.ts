import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import StripeFactory = require('stripe');
import type { Stripe } from 'stripe/cjs/stripe.core.js';

/**
 * Wrapper enxuto do SDK do Stripe. Centraliza inicializacao defensiva: se
 * STRIPE_SECRET_KEY nao estiver definida, o client e null e qualquer
 * chamada lanca ServiceUnavailableException. A flag PAYMENTS_ENABLED tem
 * controle separado no PaymentsService.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.warn('STRIPE_SECRET_KEY ausente. PaymentsModule iniciara em modo desabilitado.');
      this.client = null;
      return;
    }
    this.client = new StripeFactory(key, {
      typescript: true,
    });
  }

  get raw(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException('Stripe não inicializado.');
    }
    return this.client;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Valida assinatura do webhook e retorna o evento parseado. Lanca erro
   * se a assinatura nao bate, evitando que paylods falsificados creditem
   * diamantes ou ativem premium.
   */
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET ausente.');
    }
    return this.raw.webhooks.constructEvent(rawBody, signature, secret);
  }
}
