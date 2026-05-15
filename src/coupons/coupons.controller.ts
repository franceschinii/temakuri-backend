import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { CouponsService, type CouponApplyScope } from './coupons.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

/**
 * Endpoints publicos (autenticado, qualquer user) + admin para gestao
 * de cupons de desconto.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly service: CouponsService) {}

  /** Valida cupom; nao consome. Usado no checkout antes de criar a preferencia. */
  @Post('coupons/validate')
  async validate(
    @Request() req: any,
    @Body() body: { code: string; scope: CouponApplyScope },
  ) {
    return this.service.validate(body.code, body.scope ?? 'all', req.user.id);
  }

  // ===== admin =====

  @UseGuards(AdminGuard)
  @Get('admin/coupons')
  list() {
    return this.service.list();
  }

  @UseGuards(AdminGuard)
  @Post('admin/coupons')
  create(@Body() body: {
    code: string;
    discountPercent: number;
    appliesTo: CouponApplyScope;
    validUntil: string;
    validFrom?: string;
    maxUses?: number | null;
    active?: boolean;
  }) {
    return this.service.create(body);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/coupons/:id')
  update(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.update(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/coupons/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
