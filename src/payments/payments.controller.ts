import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PaymentsService } from './payments.service.js';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get('status')
  status() {
    return { enabled: this.payments.isPaymentsEnabled() };
  }

  @Post('diamonds/checkout')
  diamondsCheckout(@Request() req: any, @Body() body: { sku: string; couponCode?: string }) {
    return this.payments.createDiamondCheckout(req.user.id, body.sku, body.couponCode);
  }

  @Post('premium/checkout')
  premiumCheckout(@Request() req: any) {
    return this.payments.createPremiumCheckout(req.user.id);
  }

  @Post('premium/cancel')
  premiumCancel(@Request() req: any) {
    return this.payments.cancelPremium(req.user.id);
  }
}
