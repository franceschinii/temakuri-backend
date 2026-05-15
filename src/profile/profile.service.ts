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
      include: { stats: true, rankedStats: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      username: user.username,
      avatarIndex: user.avatarIndex,
      level: user.level,
      xp: user.xp,
      pds: user.pds,
      winStreak: user.winStreak,
      isAdmin: user.isAdmin,
      isBot: user.isBot,
      isGuest: user.isGuest,
      isPremium: user.isPremium,
      isBanned: user.isBanned,
      premiumExpiresAt: user.premiumExpiresAt,
      createdAt: user.createdAt,
      stats: user.stats,
      rankedStats: user.rankedStats
        ? { rankedWins: user.rankedStats.rankedWins, rankedLosses: user.rankedStats.rankedLosses }
        : null,
    };
  }

  async getLeaderboard() {
    const users = await this.prisma.user.findMany({
      where: { isGuest: false, isBot: false, isBanned: false, pds: { gt: 0 } },
      orderBy: { pds: 'desc' },
      take: 100,
      select: {
        id: true,
        username: true,
        avatarIndex: true,
        level: true,
        pds: true,
        winStreak: true,
        rankedStats: { select: { rankedWins: true, rankedLosses: true } },
      },
    });

    return users.map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      username: u.username,
      avatarIndex: u.avatarIndex,
      level: u.level,
      pds: u.pds,
      winStreak: u.winStreak,
      rankedWins: u.rankedStats?.rankedWins ?? 0,
      rankedLosses: u.rankedStats?.rankedLosses ?? 0,
    }));
  }

  /**
   * Retorna o historico de partidas de um usuario. Cada item agrega
   * placement do user, modo da sala, duracao, recompensas e a lista de
   * oponentes (username + avatarIndex) que jogaram a mesma partida.
   */
  async getMatchHistory(userId: string, limit = 20, offset = 0) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const results = await this.prisma.gameResult.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: Math.max(0, offset),
      include: {
        room: {
          select: {
            id: true,
            code: true,
            mode: true,
            isRanked: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
    });
    if (results.length === 0) return { items: [], hasMore: false };

    const roomIds = results.map(r => r.roomId);
    const opponentsByRoom = await this.prisma.gameResult.findMany({
      where: { roomId: { in: roomIds }, userId: { not: userId } },
      select: {
        roomId: true,
        placement: true,
        user: { select: { id: true, username: true, avatarIndex: true, isBot: true } },
      },
    });
    const oppMap = new Map<string, typeof opponentsByRoom>();
    for (const o of opponentsByRoom) {
      if (!oppMap.has(o.roomId)) oppMap.set(o.roomId, [] as any);
      oppMap.get(o.roomId)!.push(o);
    }

    const items = results.map(r => {
      const durationSec = r.room.startedAt && r.room.endedAt
        ? Math.max(0, Math.floor((r.room.endedAt.getTime() - r.room.startedAt.getTime()) / 1000))
        : null;
      const opponents = (oppMap.get(r.roomId) ?? []).map(o => ({
        userId: o.user.id,
        username: o.user.username,
        avatarIndex: o.user.avatarIndex,
        isBot: o.user.isBot,
        placement: o.placement,
      }));
      return {
        id: r.id,
        finishedAt: r.room.endedAt ?? r.createdAt,
        roomCode: r.room.code,
        mode: r.room.mode,
        isRanked: r.room.isRanked,
        placement: r.placement,
        // isWinner eh a fonte de verdade pra "ganhou ou perdeu". Fallback
        // pra tokensLeft > 0 em registros pre-migration (mesma semantica).
        isWinner: r.isWinner ?? (r.tokensLeft > 0),
        totalPlayers: opponents.length + 1,
        xpEarned: r.xpEarned,
        coinsEarned: r.coinsEarned,
        pdsChange: r.pdsChange,
        durationSec,
        opponents,
      };
    });

    return { items, hasMore: results.length === safeLimit };
  }

  async getLeaderboardRankForUser(userId: string): Promise<{ rank: number | null }> {
    const count = await this.prisma.user.count({
      where: { isGuest: false, isBot: false, isBanned: false, pds: { gt: 0 } },
    });

    if (count === 0) return { rank: null };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pds: true, isGuest: true, isBot: true, isBanned: true },
    });

    if (!user || user.isGuest || user.isBot || user.isBanned || user.pds <= 0) {
      return { rank: null };
    }

    const above = await this.prisma.user.count({
      where: { isGuest: false, isBot: false, isBanned: false, pds: { gt: user.pds } },
    });

    const rank = above + 1;
    return { rank: rank <= 100 ? rank : null };
  }
}
