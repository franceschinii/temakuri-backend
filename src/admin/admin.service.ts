import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { UpdateUserDto, ResetPasswordDto, UpdateStatsDto, ModerationDto, UpdateProgressionDto } from './dto/admin.dto.js';

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  isGuest: true,
  isBot: true,
  isAdmin: true,
  isBanned: true,
  suspendedUntil: true,
  avatarIndex: true,
  xp: true,
  level: true,
  coins: true,
  diamonds: true,
  pds: true,
  rankedWarnings: true,
  rankedSuspendedUntil: true,
  isPremium: true,
  premiumExpiresAt: true,
  activeTheme: true,
  createdAt: true,
  stats: {
    select: {
      gamesPlayed: true,
      gamesWon: true,
      saborTriggers: true,
      tricksWon: true,
    },
  },
  inventory: {
    select: {
      unlockedAvatars: true,
      unlockedModes: true,
      unlockedThemes: true,
    },
  },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private roomsService: RoomsService,
    private events: EventEmitter2,
  ) {}

  async findAllRooms() {
    const rooms = await this.prisma.room.findMany({
      include: { players: { include: { user: { select: { id: true, username: true, isBot: true, isGuest: true, avatarIndex: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rooms.map(r => ({
      id: r.id,
      code: r.code,
      status: r.status,
      mode: r.mode,
      maxPlayers: r.maxPlayers,
      isPrivate: r.isPrivate,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      hostId: r.hostId,
      players: r.players.map(rp => ({
        userId: rp.userId,
        username: rp.user?.username ?? 'Unknown',
        seat: rp.seat,
        status: rp.status,
        isBot: rp.user?.isBot ?? false,
        avatarIndex: rp.user?.avatarIndex ?? 0,
      })),
    }));
  }

  async adminDeleteRoom(code: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: { include: { user: { select: { id: true, isBot: true, isGuest: true } } } } },
    });
    if (!room) throw new NotFoundException('Sala não encontrada');

    const ephemeralIds = room.players
      .filter(rp => rp.user?.isBot || rp.user?.isGuest)
      .map(rp => rp.userId);

    await this.prisma.gameResult.deleteMany({ where: { roomId: room.id } });
    await this.prisma.room.delete({ where: { id: room.id } });

    if (ephemeralIds.length > 0) {
      await this.roomsService['deleteEphemeralUsers'](ephemeralIds);
    }
  }

  async adminKickPlayer(code: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { code } });
    if (!room) throw new NotFoundException('Sala não encontrada');
    // Usa a logica oficial de leaveRoom — cuida de host change, room cleanup
    // e dispara o evento rooms.public.changed.
    await this.roomsService.leaveRoom(userId, code);
    // Emite evento custom para a gateway forcar disconnect do socket do
    // usuario kickado e enviar uma notificacao visual ("Voce foi removido
    // pelo admin"). Sem isso o cliente continua com socket aberto e estado
    // in-memory antigo no engine.
    this.events.emit('admin.kicked', { roomCode: code, userId });
    // Idempotencia para retornar 200 mesmo se a sala for deletada por leave.
    return this.roomsService.findByCode(code).catch(() => ({ code, deleted: true }));
  }

  async findAllUsers() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.findUser(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.avatarIndex !== undefined && { avatarIndex: dto.avatarIndex }),
      },
      select: USER_SELECT,
    });
  }

  async moderateUser(id: string, dto: ModerationDto) {
    await this.findUser(id);
    const data: Record<string, unknown> = {};
    if (dto.isBanned !== undefined) data.isBanned = dto.isBanned;
    if ('suspendedUntil' in dto) {
      data.suspendedUntil = dto.suspendedUntil ? new Date(dto.suspendedUntil) : null;
    }
    return this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
  }

  async deleteUser(id: string) {
    await this.findUser(id);
    // Remove dependent records that don't cascade automatically
    await this.prisma.gameResult.deleteMany({ where: { userId: id } });
    await this.prisma.user.delete({ where: { id } });
  }

  async resetUserPassword(id: string, dto: ResetPasswordDto) {
    await this.findUser(id);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.prisma.session.deleteMany({ where: { userId: id } });
  }

  async updateUserStats(id: string, dto: UpdateStatsDto) {
    await this.findUser(id);
    return this.prisma.userStats.upsert({
      where: { userId: id },
      create: {
        userId: id,
        gamesPlayed: dto.gamesPlayed ?? 0,
        gamesWon: dto.gamesWon ?? 0,
        saborTriggers: dto.saborTriggers ?? 0,
        tricksWon: dto.tricksWon ?? 0,
      },
      update: {
        ...(dto.gamesPlayed !== undefined && { gamesPlayed: dto.gamesPlayed }),
        ...(dto.gamesWon !== undefined && { gamesWon: dto.gamesWon }),
        ...(dto.saborTriggers !== undefined && { saborTriggers: dto.saborTriggers }),
        ...(dto.tricksWon !== undefined && { tricksWon: dto.tricksWon }),
      },
    });
  }

  async updateUserProgression(id: string, dto: UpdateProgressionDto) {
    await this.findUser(id);

    // Update user fields
    const userUpdate: Record<string, unknown> = {};
    if (dto.xp !== undefined) userUpdate.xp = dto.xp;
    if (dto.level !== undefined) userUpdate.level = dto.level;
    if (dto.coins !== undefined) userUpdate.coins = dto.coins;
    if (dto.pds !== undefined) userUpdate.pds = dto.pds;
    if (dto.rankedWarnings !== undefined) userUpdate.rankedWarnings = dto.rankedWarnings;
    if (dto.clearRankedSuspension) userUpdate.rankedSuspendedUntil = null;
    if (dto.isPremium !== undefined) userUpdate.isPremium = dto.isPremium;

    if (Object.keys(userUpdate).length > 0) {
      await this.prisma.user.update({ where: { id }, data: userUpdate });
    }

    // Update inventory (avatars and modes)
    if (dto.grantAvatars?.length || dto.revokeAvatars?.length || dto.grantModes?.length || dto.revokeModes?.length) {
      let inv = await this.prisma.userInventory.findUnique({ where: { userId: id } });
      if (!inv) {
        inv = await this.prisma.userInventory.create({
          data: { userId: id, unlockedAvatars: [0, 1, 2, 3], unlockedModes: ['TRADITIONAL'] },
        });
      }

      let avatars = [...inv.unlockedAvatars];
      let modes = [...inv.unlockedModes];

      if (dto.grantAvatars) avatars = [...new Set([...avatars, ...dto.grantAvatars])];
      if (dto.revokeAvatars) avatars = avatars.filter(a => !dto.revokeAvatars!.includes(a));
      if (dto.grantModes) modes = [...new Set([...modes, ...dto.grantModes])];
      if (dto.revokeModes) modes = modes.filter(m => !dto.revokeModes!.includes(m));

      // Always keep avatar 0-3 and TRADITIONAL
      if (!avatars.includes(0)) avatars.unshift(0);
      if (!modes.includes('TRADITIONAL')) modes.unshift('TRADITIONAL');

      await this.prisma.userInventory.update({
        where: { userId: id },
        data: { unlockedAvatars: avatars, unlockedModes: modes },
      });
    }

    return this.findUser(id);
  }

  /**
   * Credita diamantes manualmente. Util pra testes na Fase A (MP ainda
   * nao integrado) e pra suporte/recompensas em prod. Sempre cria um registro
   * em DiamondTransaction com type=ADMIN_GRANT para rastreabilidade.
   */
  async creditDiamonds(userId: string, amount: number, reason?: string) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new NotFoundException('Quantidade invalida.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, diamonds: true } });
    if (!user) throw new NotFoundException('Usuario nao encontrado.');
    if (amount < 0 && (user.diamonds + amount) < 0) {
      throw new NotFoundException('Saldo de diamantes ficaria negativo.');
    }
    await this.prisma.$transaction([
      this.prisma.diamondTransaction.create({
        data: {
          userId,
          type: 'ADMIN_GRANT',
          amount,
          description: reason ?? `Credito manual via admin (${amount > 0 ? '+' : ''}${amount})`,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { diamonds: { increment: amount } },
      }),
    ]);
    return this.findUser(userId);
  }
}
