import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/room.dto.js';
import { customAlphabet } from 'nanoid';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async create(hostId: string, dto: CreateRoomDto) {
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 20) throw new BadRequestException('Could not generate unique room code');
    } while (await this.prisma.room.findUnique({ where: { code } }));

    const room = await this.prisma.room.create({
      data: {
        code,
        hostId,
        mode: dto.mode,
        maxPlayers: dto.maxPlayers,
        isPrivate: dto.isPrivate ?? true,
        status: 'WAITING',
        players: {
          create: { userId: hostId, seat: 0, status: 'CONNECTED' },
        },
      },
      include: { players: { include: { user: true } } },
    });

    return this.formatRoom(room);
  }

  async findAll(mode?: string, status?: string) {
    const rooms = await this.prisma.room.findMany({
      where: {
        isPrivate: false,
        status: status ?? 'WAITING',
        ...(mode ? { mode } : {}),
      },
      include: { players: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rooms.map(r => this.formatRoom(r));
  }

  async findByCode(code: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: { include: { user: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    return this.formatRoom(room);
  }

  async joinRoom(userId: string, code: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: true },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.status !== 'WAITING') throw new BadRequestException('Room already started');
    if (room.players.length >= room.maxPlayers) throw new BadRequestException('Room is full');

    const existing = room.players.find(p => p.userId === userId);
    if (existing) return this.findByCode(code);

    const seat = room.players.length;
    await this.prisma.roomPlayer.create({
      data: { roomId: room.id, userId, seat, status: 'CONNECTED' },
    });

    return this.findByCode(code);
  }

  async leaveRoom(userId: string, code: string) {
    const room = await this.prisma.room.findUnique({ where: { code }, include: { players: true } });
    if (!room) return;

    await this.prisma.roomPlayer.deleteMany({ where: { roomId: room.id, userId } });

    if (room.hostId === userId) {
      const remaining = room.players.filter(p => p.userId !== userId);
      if (remaining.length === 0) {
        await this.prisma.room.delete({ where: { id: room.id } });
      } else {
        await this.prisma.room.update({
          where: { id: room.id },
          data: { hostId: remaining[0].userId },
        });
      }
    }
  }

  async markStarted(code: string) {
    await this.prisma.room.update({
      where: { code },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  async markFinished(code: string, results: { userId: string; placement: number; tokensLeft: number }[]) {
    const room = await this.prisma.room.update({
      where: { code },
      data: { status: 'FINISHED', endedAt: new Date() },
    });

    for (const r of results) {
      await this.prisma.gameResult.create({
        data: { roomId: room.id, userId: r.userId, placement: r.placement, tokensLeft: r.tokensLeft },
      });
      await this.prisma.userStats.upsert({
        where: { userId: r.userId },
        create: {
          userId: r.userId,
          gamesPlayed: 1,
          gamesWon: r.placement === 1 ? 1 : 0,
        },
        update: {
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: r.placement === 1 ? 1 : 0 },
        },
      });
    }
  }

  private formatRoom(room: any) {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      mode: room.mode,
      maxPlayers: room.maxPlayers,
      isPrivate: room.isPrivate,
      players: room.players.map((rp: any) => ({
        userId: rp.userId,
        username: rp.user?.username ?? 'Unknown',
        avatarIndex: rp.user?.avatarIndex ?? 0,
        seat: rp.seat,
        isReady: false,
        isConnected: rp.status === 'CONNECTED',
      })),
    };
  }
}
