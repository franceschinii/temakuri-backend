import { Controller, Get, Post, Param, ParseIntPipe, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ShopService } from './shop.service.js';

@UseGuards(JwtAuthGuard)
@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('catalog')
  getCatalog(@Request() req: any) {
    return this.shopService.getCatalog(req.user.userId);
  }

  @Get('inventory')
  getInventory(@Request() req: any) {
    return this.shopService.getInventory(req.user.userId);
  }

  @Post('avatar/:index')
  purchaseAvatar(@Request() req: any, @Param('index', ParseIntPipe) index: number) {
    return this.shopService.purchaseAvatar(req.user.userId, index);
  }

  @Post('mode/:mode')
  purchaseMode(@Request() req: any, @Param('mode') mode: string) {
    return this.shopService.purchaseMode(req.user.userId, mode.toUpperCase());
  }
}
