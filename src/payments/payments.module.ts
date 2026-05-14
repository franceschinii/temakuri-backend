import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentsController } from './payments.controller.js';
import { WebhooksController } from './webhooks.controller.js';
import { PaymentsService } from './payments.service.js';
import { MpService } from './mp.service.js';
import { PremiumService } from './premium.service.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PaymentsController, WebhooksController],
  providers: [MpService, PaymentsService, PremiumService],
  exports: [PaymentsService, PremiumService],
})
export class PaymentsModule {}
