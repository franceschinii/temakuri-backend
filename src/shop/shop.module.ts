import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';
import { ShopPricingService } from './pricing.service.js';
import { PricingController } from './pricing.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ShopController, PricingController],
  providers: [ShopService, ShopPricingService],
  exports: [ShopPricingService],
})
export class ShopModule {}
