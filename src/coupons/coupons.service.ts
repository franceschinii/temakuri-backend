import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type CouponApplyScope = 'all' | 'diamonds' | 'premium';

export interface CouponValidation {
  valid: boolean;
  reason?: string;
  couponId?: string;
  code?: string;
  discountPercent?: number;
}

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { redemptions: true } } },
    });
  }

  async create(data: {
    code: string;
    discountPercent: number;
    appliesTo: CouponApplyScope;
    validUntil: string | Date;
    validFrom?: string | Date | null;
    maxUses?: number | null;
    active?: boolean;
  }) {
    const code = data.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Codigo obrigatorio');
    if (data.discountPercent < 1 || data.discountPercent > 100) {
      throw new BadRequestException('discountPercent deve estar entre 1 e 100');
    }
    if (!['all', 'diamonds', 'premium'].includes(data.appliesTo)) {
      throw new BadRequestException('appliesTo invalido');
    }
    const validUntil = new Date(data.validUntil);
    if (Number.isNaN(validUntil.getTime())) throw new BadRequestException('validUntil invalido');
    const validFrom = data.validFrom ? new Date(data.validFrom) : new Date();

    const exists = await this.prisma.coupon.findUnique({ where: { code } });
    if (exists) throw new BadRequestException('Cupom com esse codigo ja existe');

    return this.prisma.coupon.create({
      data: {
        code,
        discountPercent: data.discountPercent,
        appliesTo: data.appliesTo,
        validFrom,
        validUntil,
        maxUses: data.maxUses ?? null,
        active: data.active ?? true,
      },
    });
  }

  async update(id: string, data: Partial<{
    discountPercent: number;
    appliesTo: CouponApplyScope;
    validUntil: string | Date;
    validFrom: string | Date | null;
    maxUses: number | null;
    active: boolean;
  }>) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Cupom nao encontrado');

    const update: any = {};
    if (data.discountPercent !== undefined) {
      if (data.discountPercent < 1 || data.discountPercent > 100) {
        throw new BadRequestException('discountPercent deve estar entre 1 e 100');
      }
      update.discountPercent = data.discountPercent;
    }
    if (data.appliesTo !== undefined) {
      if (!['all', 'diamonds', 'premium'].includes(data.appliesTo)) {
        throw new BadRequestException('appliesTo invalido');
      }
      update.appliesTo = data.appliesTo;
    }
    if (data.validUntil !== undefined) update.validUntil = new Date(data.validUntil);
    if (data.validFrom !== undefined && data.validFrom !== null) update.validFrom = new Date(data.validFrom);
    if (data.maxUses !== undefined) update.maxUses = data.maxUses;
    if (data.active !== undefined) update.active = data.active;

    return this.prisma.coupon.update({ where: { id }, data: update });
  }

  async remove(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Cupom nao encontrado');
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Valida cupom para uso. Nao consome (currentUses nao incrementa aqui;
   * incremento e feito quando a compra concluir via recordRedemption).
   */
  async validate(code: string, scope: CouponApplyScope, _userId: string): Promise<CouponValidation> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return { valid: false, reason: 'Codigo vazio' };

    const coupon = await this.prisma.coupon.findUnique({ where: { code: normalized } });
    if (!coupon) return { valid: false, reason: 'Cupom inexistente' };
    if (!coupon.active) return { valid: false, reason: 'Cupom inativo' };

    const now = new Date();
    if (coupon.validFrom > now) return { valid: false, reason: 'Cupom ainda nao iniciou' };
    if (coupon.validUntil < now) return { valid: false, reason: 'Cupom expirado' };
    if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) {
      return { valid: false, reason: 'Cupom esgotado' };
    }
    if (coupon.appliesTo !== 'all' && coupon.appliesTo !== scope) {
      return { valid: false, reason: 'Cupom nao aplicavel a este produto' };
    }

    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      discountPercent: coupon.discountPercent,
    };
  }

  /** Registra uso do cupom apos compra confirmada. */
  async recordRedemption(params: {
    couponId: string;
    userId: string;
    paymentSku?: string;
    discountValue: number;
  }) {
    await this.prisma.$transaction([
      this.prisma.couponRedemption.create({
        data: {
          couponId: params.couponId,
          userId: params.userId,
          paymentSku: params.paymentSku,
          discountValue: params.discountValue,
        },
      }),
      this.prisma.coupon.update({
        where: { id: params.couponId },
        data: { currentUses: { increment: 1 } },
      }),
    ]);
  }
}
