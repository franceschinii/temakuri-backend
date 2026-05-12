import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/profile.dto.js';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { stats: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, ...rest } = user as any;
    return rest;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const existing = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (existing && existing.id !== userId) throw new BadRequestException('Username already taken');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.username ? { username: dto.username } : {}), ...(dto.avatarIndex !== undefined ? { avatarIndex: dto.avatarIndex } : {}) },
    });

    const { passwordHash, ...rest } = updated as any;
    return rest;
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    return !!existing;
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { stats: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      username: user.username,
      avatarIndex: user.avatarIndex,
      stats: user.stats,
    };
  }
}
