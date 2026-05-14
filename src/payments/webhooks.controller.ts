import {
  Controller,
  Post,
  Req,
  Headers,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MpService } from './mp.service.js';
import { PaymentsService } from './payments.service.js';
import { PremiumService } from './premium.service.js';

/**
 * Webhook do Mercado Pago. Recebe notificacoes em formatos:
 *
 *   POST /payments/webhooks/mp?type=payment&data.id=123
 *
 * com header x-signature contendo HMAC SHA256 do manifest
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Toda chamada deve
 * passar validacao de assinatura — caso contrario rejeita 401.
 *
 * MP retenta automaticamente 3 vezes se nao receber 200. Por isso
 * idempotencia e critica (externalPaymentId/externalInvoiceId @unique).
 */
@Controller('payments/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private mp: MpService,
    private payments: PaymentsService,
    private premium: PremiumService,
  ) {}

  @Post('mp')
  @HttpCode(HttpStatus.OK)
  async handleMpWebhook(
    @Req() req: Request,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query() query: Record<string, string>,
    @Body() body: any,
  ) {
    if (process.env.PAYMENTS_ENABLED !== 'true') {
      this.logger.warn('Webhook MP recebido com PAYMENTS_ENABLED=false. Ignorado.');
      return { received: true };
    }
    if (!this.mp.isAvailable()) {
      this.logger.error('MP nao inicializado mas webhook chegou.');
      return { received: true };
    }

    // MP envia data.id via query string (formato moderno) ou body.data.id
    // (formato legacy). Tipo da notificacao igual.
    const dataId = query['data.id'] ?? body?.data?.id ?? body?.id;
    const type = (query.type ?? query.topic ?? body?.type ?? body?.topic) as string | undefined;

    if (!dataId || !type) {
      this.logger.warn(`Webhook MP sem data.id ou type. query=${JSON.stringify(query)} body=${JSON.stringify(body)}`);
      throw new BadRequestException('data.id e type obrigatorios');
    }

    // Validacao de assinatura. Reject duro se invalida.
    const valid = this.mp.validateSignature({
      xSignature,
      xRequestId,
      dataId: String(dataId),
    });
    if (!valid) {
      this.logger.warn(`Webhook MP com assinatura invalida. type=${type} dataId=${dataId}`);
      throw new UnauthorizedException('Assinatura invalida');
    }

    this.logger.log(`Webhook MP: type=${type} dataId=${dataId}`);

    try {
      switch (type) {
        case 'payment': {
          // One-time (diamantes). Busca o pagamento pra ter os campos.
          const payment = await this.mp.payment.get({ id: String(dataId) });
          await this.payments.handleDiamondPaymentApproved(payment);
          break;
        }
        case 'subscription_preapproval':
        case 'preapproval': {
          // Cria/atualiza assinatura Premium.
          const preapproval = await this.mp.preapproval.get({ id: String(dataId) });
          await this.premium.handlePreapprovalNotification(preapproval);
          break;
        }
        case 'subscription_authorized_payment':
        case 'authorized_payment': {
          // Cobranca mensal aprovada. Estende premium + credita diamantes.
          // SDK do MP nao expõe authorized_payments diretamente, entao
          // fazemos fetch via fetch nativo com o access token.
          const authorizedPayment = await this.fetchAuthorizedPayment(String(dataId));
          if (authorizedPayment) {
            await this.premium.handleAuthorizedPayment(authorizedPayment);
          }
          break;
        }
        default:
          this.logger.debug(`Tipo de webhook ignorado: ${type}`);
      }
    } catch (err: any) {
      this.logger.error(`Erro processando webhook MP ${type}/${dataId}: ${err.message}`, err.stack);
      // Retorna 200 mesmo em erro nao-recoverable pra evitar retry infinito.
      // Erros transientes deveriam re-lancar pra MP retentar.
      return { received: true, error: err.message };
    }

    return { received: true };
  }

  private async fetchAuthorizedPayment(id: string): Promise<any | null> {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return null;
    try {
      const res = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.logger.warn(`fetchAuthorizedPayment ${id} HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err: any) {
      this.logger.error(`fetchAuthorizedPayment ${id} falhou: ${err.message}`);
      return null;
    }
  }
}
