import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/room.dto.js';
import { customAlphabet } from 'nanoid';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

@Injectable()
export class RoomsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

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
        handBias: dto.handBias ?? 0,
        initialTokens: dto.initialTokens ?? 2,
        status: 'WAITING',
        players: {
          create: { userId: hostId, seat: 0, status: 'CONNECTED' },
        },
      },
      include: { players: { include: { user: true } } },
    });

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
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

    const usedSeats = new Set(room.players.map(p => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat++;

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
      // Host leaving always closes the room (not transferred)
      // Clean up any bot Users before deleting the room
      const botIds = room.players
        .filter(p => p.userId !== userId)
        .map(p => p.userId);
      if (botIds.length > 0) {
        const bots = await this.prisma.user.findMany({
          where: { id: { in: botIds }, isBot: true },
          select: { id: true },
        });
        if (bots.length > 0) {
          await this.prisma.user.deleteMany({ where: { id: { in: bots.map(b => b.id) } } });
        }
      }
      await this.prisma.room.delete({ where: { id: room.id } });
    }

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
  }

  async addBot(code: string, hostUserId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: true },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.hostId !== hostUserId) throw new BadRequestException('Only the host can add bots');
    if (room.status !== 'WAITING') throw new BadRequestException('Room already started');
    if (room.players.length >= room.maxPlayers) throw new BadRequestException('Room is full');

    // Check names against ALL bots in DB (not just current room) to avoid @unique conflicts
    const botBaseNames = [
      'Sukiyaki-san',    // Sr. Sukiyaki
      'Tonkotsu-kun',    // garoto do tonkotsu
      'Misoshiru-sama',  // o grande sopa de missô
      'Karaage-chan',    // franguinho frito
      'Gyoza-sensei',    // mestre dos pastéis
      'Tempurão',        // tempura + -ão (pt-br mashup)
      'Onigiri-dono',    // senhor bolinho de arroz
      'Ramen-hime',      // princesa do ramen
      'Taiyaki-bucho',   // chefe taiyaki
      'Yakiniku-osho',   // rei do churrasco japonês
    ];
    const allBotUsernames = await this.prisma.user.findMany({
      where: { isBot: true },
      select: { username: true },
    });
    const usedBotNames = new Set(allBotUsernames.map(b => b.username));
    const availableBase = botBaseNames.find(n => !usedBotNames.has(n));
    const username = availableBase ?? `Bot-${Date.now().toString(36).slice(-5).toUpperCase()}`;

    const bot = await this.prisma.user.create({
      data: { username, isBot: true, isGuest: true },
    });

    // First available seat (handles gaps left by departed players)
    const usedSeats = new Set(room.players.map(p => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat++;

    await this.prisma.roomPlayer.create({
      data: { roomId: room.id, userId: bot.id, seat, status: 'CONNECTED' },
    });

    const updated = await this.findByCode(code);
    this.events.emit('rooms.lobby.changed', { roomCode: code, room: updated });
    return updated;
  }

  async removeBot(code: string, hostUserId: string, botUserId: string) {
    const room = await this.prisma.room.findUnique({ where: { code }, include: { players: true } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.hostId !== hostUserId) throw new BadRequestException('Only the host can remove bots');

    const bot = await this.prisma.user.findUnique({ where: { id: botUserId } });
    if (!bot?.isBot) throw new BadRequestException('Player is not a bot');

    await this.prisma.roomPlayer.deleteMany({ where: { roomId: room.id, userId: botUserId } });
    await this.prisma.user.delete({ where: { id: botUserId } });

    const updated = await this.findByCode(code);
    this.events.emit('rooms.lobby.changed', { roomCode: code, room: updated });
    return updated;
  }

  async markStarted(code: string) {
    await this.prisma.room.update({
      where: { code },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    this.events.emit('rooms.public.changed');
  }

  async markFinished(code: string, results: { userId: string; placement: number; tokensLeft: number }[]) {
    const room = await this.prisma.room.update({
      where: { code },
      data: { status: 'FINISHED', endedAt: new Date() },
      include: { players: { include: { user: { select: { id: true, isBot: true } } } } },
    });

    // Identify bot users before recording results (bots get no stats)
    const botIds = new Set(
      room.players.filter(p => p.user?.isBot).map(p => p.userId),
    );

    for (const r of results) {
      if (botIds.has(r.userId)) continue; // skip bots for stats/results

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

    // Clean up bot users — frees their usernames for future games
    if (botIds.size > 0) {
      await this.prisma.user.deleteMany({ where: { id: { in: [...botIds] } } });
    }

    this.events.emit('rooms.public.changed');
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
      handBias: room.handBias ?? 0,
      initialTokens: room.initialTokens ?? 2,
      players: room.players.map((rp: any) => ({
        userId: rp.userId,
        username: rp.user?.username ?? 'Unknown',
        avatarIndex: rp.user?.avatarIndex ?? 0,
        seat: rp.seat,
        isReady: false,
        isConnected: rp.status === 'CONNECTED',
        isBot: rp.user?.isBot ?? false,
      })),
    };
  }
}
