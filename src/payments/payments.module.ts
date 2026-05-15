import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentsController } from './payments.controller.js';
import { WebhooksController } from './webhooks.controller.js';
import { PaymentsService } from './payments.service.js';
import { MpService } from './mp.service.js';
import { PremiumService } from './premium.service.js';
import { CouponsModule } from '../coupons/coupons.module.js';
import { ShopModule } from '../shop/shop.module.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), CouponsModule, ShopModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [MpService, PaymentsService, PremiumService],
  exports: [PaymentsService, PremiumService],
})
export class PaymentsModule {}
