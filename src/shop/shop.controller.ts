import { Controller, Get, Post, Param, ParseIntPipe, UseGuards, Request, Body } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ShopService } from './shop.service.js';

@UseGuards(JwtAuthGuard)
@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('catalog')
  getCatalog(@Request() req: any) {
    return this.shopService.getCatalog(req.user.id);
  }

  @Get('inventory')
  getInventory(@Request() req: any) {
    return this.shopService.getInventory(req.user.id);
  }

  @Post('avatar/:index')
  purchaseAvatar(@Request() req: any, @Param('index', ParseIntPipe) index: number) {
    return this.shopService.purchaseAvatar(req.user.id, index);
  }

  @Post('mode/:mode')
  purchaseMode(@Request() req: any, @Param('mode') mode: string) {
    return this.shopService.purchaseMode(req.user.id, mode.toUpperCase());
  }

  @Post('theme/active')
  setActiveTheme(@Request() req: any, @Body() body: { theme: string | null }) {
    return this.shopService.setActiveTheme(req.user.id, body?.theme ?? null);
  }

  @Post('theme/:key')
  purchaseTheme(@Request() req: any, @Param('key') key: string) {
    return this.shopService.purchaseTheme(req.user.id, key.toLowerCase());
  }

  @Post('coin-pack/:sku')
  purchaseCoinPack(@Request() req: any, @Param('sku') sku: string) {
    return this.shopService.purchaseCoinPack(req.user.id, sku.toUpperCase());
  }

  @Post('utility/:sku')
  useUtility(@Request() req: any, @Param('sku') sku: string) {
    return this.shopService.useUtility(req.user.id, sku.toUpperCase());
  }
}
