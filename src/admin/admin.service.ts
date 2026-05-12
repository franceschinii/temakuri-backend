import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateUserDto, ResetPasswordDto, UpdateStatsDto, ModerationDto } from './dto/admin.dto.js';

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
  createdAt: true,
  stats: {
    select: {
      gamesPlayed: true,
      gamesWon: true,
      saborTriggers: true,
      tricksWon: true,
    },
  },
} as const;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
}
