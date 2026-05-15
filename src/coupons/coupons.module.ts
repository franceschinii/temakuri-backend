import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service.js';
import { CouponsController } from './coupons.controller.js';

@Module({
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
