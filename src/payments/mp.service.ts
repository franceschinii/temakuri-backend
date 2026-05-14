import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfig, Preference, PreApproval, Payment } from 'mercadopago';

/**
 * Wrapper enxuto do SDK do Mercado Pago. Centraliza inicializacao
 * defensiva: se MP_ACCESS_TOKEN nao estiver definido, isAvailable() retorna
 * false e o PaymentsService responde 503. Flag PAYMENTS_ENABLED tem
 * controle separado.
 *
 * Convencoes Temakuri:
 * - Toda preferencia (one-time) usa external_reference no formato
 *   "user:<userId>|sku:<sku>" pra extrair o destino do credito sem
 *   depender de banco.
 * - Toda preapproval (assinatura) usa external_reference "user:<userId>".
 * - Webhook usa x-signature HMAC validation (vide validateSignature).
 */
@Injectable()
export class MpService {
  private readonly logger = new Logger(MpService.name);
  private readonly client: MercadoPagoConfig | null;

  constructor() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      this.logger.warn('MP_ACCESS_TOKEN ausente. PaymentsModule iniciara em modo desabilitado.');
      this.client = null;
      return;
    }
    this.client = new MercadoPagoConfig({
      accessToken: token,
      options: { timeout: 10000 },
    });
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  private requireClient(): MercadoPagoConfig {
    if (!this.client) {
      throw new ServiceUnavailableException('Mercado Pago nao inicializado.');
    }
    return this.client;
  }

  get preference(): Preference {
    return new Preference(this.requireClient());
  }

  get preapproval(): PreApproval {
    return new PreApproval(this.requireClient());
  }

  get payment(): Payment {
    return new Payment(this.requireClient());
  }

  /**
   * Valida x-signature do webhook do Mercado Pago.
   *
   * Manifest: "id:<dataId>;request-id:<xRequestId>;ts:<ts>;"
   * HMAC-SHA256 com MP_WEBHOOK_SECRET, comparado em timing-safe contra v1.
   *
   * Retorna true se valido. Lanca ServiceUnavailableException se secret
   * nao estiver configurado (evita aceitar webhook sem verificar).
   */
  validateSignature(params: {
    xSignature: string | undefined;
    xRequestId: string | undefined;
    dataId: string | undefined;
  }): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('MP_WEBHOOK_SECRET ausente.');
    }
    const { xSignature, xRequestId, dataId } = params;
    if (!xSignature || !xRequestId || !dataId) return false;

    let ts: string | undefined;
    let hash: string | undefined;
    for (const part of xSignature.split(',')) {
      const [k, v] = part.split('=');
      if (!k || !v) continue;
      const key = k.trim();
      const value = v.trim();
      if (key === 'ts') ts = value;
      else if (key === 'v1') hash = value;
    }
    if (!ts || !hash) return false;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const computed = createHmac('sha256', secret).update(manifest).digest('hex');

    if (computed.length !== hash.length) return false;
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  }
}
