import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// Avatares pagaveis em coins (catalogo legado — slots 4 a 8)
const AVATAR_PRICES: Record<number, number> = { 4: 15, 5: 20, 6: 25, 7: 30, 8: 50 };

// Avatares premium pagaveis em diamantes (slots 9 a 14). Precos calibrados
// pra ficarem abaixo da metade do primeiro pack de diamantes (DIAMONDS_100 = 100).
const AVATAR_DIAMOND_PRICES: Record<number, number> = {
  9: 30,  // Yokai
  10: 30, // Kitsune
  11: 30, // Tanuki
  12: 80, // Geisha
  13: 80, // Samurai
  14: 300, // Dragao Dourado
};

const MODE_PRICES: Record<string, number> = { MERCADO: 20, RODIZIO: 30, DEGUSTACAO: 50 };

const AVATAR_NAMES: Record<number, string> = {
  0: 'Temaki', 1: 'Ramen', 2: 'Onigiri', 3: 'Gyoza',
  4: 'Sashimi', 5: 'Takoyaki', 6: 'Missô', 7: 'Udon', 8: 'Udon Gold',
  9: 'Yokai', 10: 'Kitsune', 11: 'Tanuki',
  12: 'Geisha', 13: 'Samurai', 14: 'Dragão Dourado',
};

const ALL_AVATARS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const PURCHASABLE_MODES = ['MERCADO', 'RODIZIO', 'DEGUSTACAO'];

// Temas de mesa. Bambu Verde e o tema padrao gratuito (preco 0,
// automaticamente "owned" por todos). Demais sao comprados em diamantes.
const THEME_PRICES: Record<string, number> = {
  bambu: 0,
  oceano: 50,
  sakura: 100,
  oni: 150,
};
const THEME_NAMES: Record<string, string> = {
  bambu: 'Bambu Verde',
  oceano: 'Oceano',
  sakura: 'Sakura',
  oni: 'Oni',
};
const FREE_THEMES = new Set(['bambu']);
const ALL_THEMES = ['bambu', 'oceano', 'sakura', 'oni'];

// Pacotes de coins comprados com diamantes
const COIN_PACKS: Record<string, { coins: number; diamonds: number }> = {
  COIN_PACK_50: { coins: 50, diamonds: 5 },
  COIN_PACK_200: { coins: 200, diamonds: 15 },
  COIN_PACK_700: { coins: 700, diamonds: 40 },
};

// Utilitarios em diamantes
const UTILITY_PRICES = {
  RESET_RANKED_WARNINGS: 20,
  RESET_LOSS_STREAK: 10,
};

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true, diamonds: true, isPremium: true },
    });

    const avatars = ALL_AVATARS.map(index => {
      const inDiamond = AVATAR_DIAMOND_PRICES[index] !== undefined;
      return {
        type: 'avatar' as const,
        index,
        name: AVATAR_NAMES[index] ?? `Avatar ${index}`,
        price: inDiamond ? AVATAR_DIAMOND_PRICES[index] : (AVATAR_PRICES[index] ?? 0),
        currency: inDiamond ? ('diamonds' as const) : ('coins' as const),
        owned: inv.unlockedAvatars.includes(index),
        free: index <= 3,
      };
    });

    const modes = PURCHASABLE_MODES.map(mode => ({
      type: 'mode' as const,
      mode,
      name: mode.charAt(0) + mode.slice(1).toLowerCase(),
      price: MODE_PRICES[mode] ?? 0,
      currency: 'coins' as const,
      owned: inv.unlockedModes.includes(mode),
    }));

    const themes = ALL_THEMES.map(key => {
      const isFree = FREE_THEMES.has(key);
      return {
        type: 'theme' as const,
        key,
        name: THEME_NAMES[key] ?? key,
        price: THEME_PRICES[key] ?? 0,
        currency: 'diamonds' as const,
        // Temas gratuitos sao desbloqueados automaticamente para todos.
        owned: isFree || inv.unlockedThemes.includes(key),
        free: isFree,
      };
    });

    const coinPacks = Object.entries(COIN_PACKS).map(([sku, p]) => ({
      type: 'coin_pack' as const,
      sku,
      coins: p.coins,
      price: p.diamonds,
      currency: 'diamonds' as const,
    }));

    const utilities = [
      {
        type: 'utility' as const,
        sku: 'RESET_RANKED_WARNINGS' as const,
        name: 'Limpar avisos ranked',
        price: UTILITY_PRICES.RESET_RANKED_WARNINGS,
        currency: 'diamonds' as const,
      },
      {
        type: 'utility' as const,
        sku: 'RESET_LOSS_STREAK' as const,
        name: 'Zerar streak de derrotas',
        price: UTILITY_PRICES.RESET_LOSS_STREAK,
        currency: 'diamonds' as const,
      },
    ];

    return {
      avatars,
      modes,
      themes,
      coinPacks,
      utilities,
      coins: user?.coins ?? 0,
      diamonds: user?.diamonds ?? 0,
      isPremium: user?.isPremium ?? false,
    };
  }

  async purchaseAvatar(userId: string, avatarIndex: number) {
    const inv = await this.getOrCreateInventory(userId);
    if (inv.unlockedAvatars.includes(avatarIndex)) {
      throw new BadRequestException('Avatar já desbloqueado');
    }

    const coinPrice = AVATAR_PRICES[avatarIndex];
    const diamondPrice = AVATAR_DIAMOND_PRICES[avatarIndex];
    if (!coinPrice && !diamondPrice) {
      throw new BadRequestException('Avatar não disponível para compra');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true, diamonds: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Avatares premium (slots 9-14) — gastam diamantes
    if (diamondPrice) {
      if ((user.diamonds ?? 0) < diamondPrice) {
        throw new ForbiddenException(`Diamantes insuficientes (${user.diamonds ?? 0}/${diamondPrice})`);
      }
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { diamonds: { decrement: diamondPrice } },
        }),
        this.prisma.diamondTransaction.create({
          data: {
            userId,
            type: 'SPEND',
            amount: -diamondPrice,
            description: `Compra avatar ${AVATAR_NAMES[avatarIndex] ?? avatarIndex}`,
            sku: `PREMIUM_AVATAR_${avatarIndex}`,
          },
        }),
        this.prisma.userInventory.update({
          where: { userId },
          data: { unlockedAvatars: { push: avatarIndex } },
        }),
      ]);
      return { success: true, avatarIndex, diamondsSpent: diamondPrice };
    }

    // Avatares pagos em coins (catalogo legado 4-8)
    if ((user.coins ?? 0) < coinPrice) {
      throw new ForbiddenException(`Moedas insuficientes (${user.coins ?? 0}/${coinPrice})`);
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { coins: { decrement: coinPrice } },
      }),
      this.prisma.userInventory.update({
        where: { userId },
        data: { unlockedAvatars: { push: avatarIndex } },
      }),
    ]);
    return { success: true, avatarIndex, coinsSpent: coinPrice };
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

  async purchaseTheme(userId: string, themeKey: string) {
    if (FREE_THEMES.has(themeKey)) {
      throw new BadRequestException('Tema gratuito não precisa ser comprado');
    }
    if (!THEME_PRICES[themeKey]) {
      throw new BadRequestException('Tema não disponível para compra');
    }
    const inv = await this.getOrCreateInventory(userId);
    if (inv.unlockedThemes.includes(themeKey)) {
      throw new BadRequestException('Tema já desbloqueado');
    }
    const price = THEME_PRICES[themeKey];
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { diamonds: true } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if ((user.diamonds ?? 0) < price) {
      throw new ForbiddenException(`Diamantes insuficientes (${user.diamonds ?? 0}/${price})`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { diamonds: { decrement: price } },
      }),
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'SPEND',
          amount: -price,
          description: `Compra tema ${THEME_NAMES[themeKey] ?? themeKey}`,
          sku: `THEME_${themeKey.toUpperCase()}`,
        },
      }),
      this.prisma.userInventory.update({
        where: { userId },
        data: { unlockedThemes: { push: themeKey } },
      }),
    ]);

    return { success: true, themeKey, diamondsSpent: price };
  }

  async setActiveTheme(userId: string, themeKey: string | null) {
    if (themeKey !== null) {
      if (!ALL_THEMES.includes(themeKey)) {
        throw new BadRequestException('Tema inválido');
      }
      if (!FREE_THEMES.has(themeKey)) {
        const inv = await this.getOrCreateInventory(userId);
        if (!inv.unlockedThemes.includes(themeKey)) {
          throw new ForbiddenException('Tema não desbloqueado');
        }
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { activeTheme: themeKey },
    });
    return { success: true, activeTheme: themeKey };
  }

  async purchaseCoinPack(userId: string, sku: string) {
    const pack = COIN_PACKS[sku];
    if (!pack) {
      throw new BadRequestException('Pacote de moedas não encontrado');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { diamonds: true } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if ((user.diamonds ?? 0) < pack.diamonds) {
      throw new ForbiddenException(`Diamantes insuficientes (${user.diamonds ?? 0}/${pack.diamonds})`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { diamonds: { decrement: pack.diamonds }, coins: { increment: pack.coins } },
      }),
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'SPEND',
          amount: -pack.diamonds,
          description: `Conversão para ${pack.coins} moedas`,
          sku,
        },
      }),
    ]);

    return { success: true, sku, coinsGained: pack.coins, diamondsSpent: pack.diamonds };
  }

  async useUtility(userId: string, sku: string) {
    const price = (UTILITY_PRICES as Record<string, number>)[sku];
    if (!price) {
      throw new BadRequestException('Utilitário não encontrado');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { diamonds: true, rankedWarnings: true, lossStreak: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if ((user.diamonds ?? 0) < price) {
      throw new ForbiddenException(`Diamantes insuficientes (${user.diamonds ?? 0}/${price})`);
    }

    const userUpdate: Record<string, unknown> = { diamonds: { decrement: price } };
    if (sku === 'RESET_RANKED_WARNINGS') userUpdate.rankedWarnings = 0;
    if (sku === 'RESET_LOSS_STREAK') userUpdate.lossStreak = 0;

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: userUpdate }),
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'SPEND',
          amount: -price,
          description: sku === 'RESET_RANKED_WARNINGS' ? 'Limpou avisos ranked' : 'Zerou streak de derrotas',
          sku,
        },
      }),
    ]);

    return { success: true, sku, diamondsSpent: price };
  }
}
