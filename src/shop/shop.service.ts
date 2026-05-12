import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const AVATAR_PRICES: Record<number, number> = { 4: 15, 5: 20, 6: 25, 7: 30 };
const MODE_PRICES: Record<string, number> = { MERCADO: 20, RODIZIO: 30, DEGUSTACAO: 50 };
const AVATAR_NAMES: Record<number, string> = {
  0: 'Temaki', 1: 'Ramen', 2: 'Onigiri', 3: 'Gyoza',
  4: 'Sashimi', 5: 'Takoyaki', 6: 'Missô', 7: 'Udon',
};
const ALL_AVATARS = [0, 1, 2, 3, 4, 5, 6, 7];
const PURCHASABLE_MODES = ['MERCADO', 'RODIZIO', 'DEGUSTACAO'];

@Injectable()
export class ShopService {
  constructor(private prisma: PrismaService) {}

  private async getOrCreateInventory(userId: string) {
    let inv = await this.prisma.userInventory.findUnique({ where: { userId } });
    if (!inv) {
      inv = await this.prisma.userInventory.create({
        data: { userId, unlockedAvatars: [0, 1, 2, 3], unlockedModes: ['TRADITIONAL'] },
      });
    }
    return inv;
  }

  async getInventory(userId: string) {
    return this.getOrCreateInventory(userId);
  }

  async getCatalog(userId: string) {
    const inv = await this.getOrCreateInventory(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });

    const avatars = ALL_AVATARS.map(index => ({
      type: 'avatar' as const,
      index,
      name: AVATAR_NAMES[index] ?? `Avatar ${index}`,
      price: AVATAR_PRICES[index] ?? 0,
      owned: inv.unlockedAvatars.includes(index),
      free: index <= 3,
    }));

    const modes = PURCHASABLE_MODES.map(mode => ({
      type: 'mode' as const,
      mode,
      name: mode.charAt(0) + mode.slice(1).toLowerCase(),
      price: MODE_PRICES[mode] ?? 0,
      owned: inv.unlockedModes.includes(mode),
    }));

    return { avatars, modes, coins: user?.coins ?? 0 };
  }

  async purchaseAvatar(userId: string, avatarIndex: number) {
    if (!AVATAR_PRICES[avatarIndex]) {
      throw new BadRequestException('Avatar não disponível para compra');
    }

    const inv = await this.getOrCreateInventory(userId);
    if (inv.unlockedAvatars.includes(avatarIndex)) {
      throw new BadRequestException('Avatar já desbloqueado');
    }

    const price = AVATAR_PRICES[avatarIndex];
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if ((user.coins ?? 0) < price) {
      throw new ForbiddenException(`Moedas insuficientes (${user.coins ?? 0}/${price})`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { coins: { decrement: price } },
      }),
      this.prisma.userInventory.update({
        where: { userId },
        data: { unlockedAvatars: { push: avatarIndex } },
      }),
    ]);

    return { success: true, avatarIndex, coinsSpent: price };
  }

  async purchaseMode(userId: string, mode: string) {
    if (!MODE_PRICES[mode]) {
      throw new BadRequestException('Modo não disponível para compra');
    }

    const inv = await this.getOrCreateInventory(userId);
    if (inv.unlockedModes.includes(mode)) {
      throw new BadRequestException('Modo já desbloqueado');
    }

    const price = MODE_PRICES[mode];
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if ((user.coins ?? 0) < price) {
      throw new ForbiddenException(`Moedas insuficientes (${user.coins ?? 0}/${price})`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { coins: { decrement: price } },
      }),
      this.prisma.userInventory.update({
        where: { userId },
        data: { unlockedModes: { push: mode } },
      }),
    ]);

    return { success: true, mode, coinsSpent: price };
  }
}
