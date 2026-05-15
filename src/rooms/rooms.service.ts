import { Injectable, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/room.dto.js';
import { customAlphabet } from 'nanoid';
import { xpGain, coinsGain, computeLevel } from '../common/xp.utils.js';
import { calcPdsChange, clampPds, rankFromPds } from '../common/pds.utils.js';
import { Prisma } from '@prisma/client';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

@Injectable()
export class RoomsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {
    // Cleanup periodico de salas mortas (FINISHED >24h)
    // Roda no boot (lazy: 60s depois) e depois a cada 1h.
    setTimeout(() => this.cleanupStaleRooms().catch(() => {}), 60_000);
    setInterval(() => this.cleanupStaleRooms().catch(() => {}), 60 * 60 * 1000);
  }

  /**
   * Marca como FINISHED salas que ficaram presas em IN_PROGRESS apos restart do servidor.
   * Engines vivem em memoria, entao sem engine a partida e irrecuperavel.
   * Chamado uma vez no boot via NotificationsGateway.afterInit.
   */
  async markOrphanInProgressAsFinished() {
    await this.prisma.room.updateMany({
      where: { status: 'IN_PROGRESS' },
      data: { status: 'FINISHED', endedAt: new Date() },
    }).catch(() => {});
  }

  /**
   * Remove salas que devem morrer:
   * - status=FINISHED com endedAt > 24h
   * - status=WAITING sem players (orfas)
   * - bots/guests sem RoomPlayer ativo (residuo de salas mortas)
   */
  private async cleanupStaleRooms() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Salas FINISHED antigas
    await this.prisma.room.deleteMany({
      where: { status: 'FINISHED', endedAt: { lt: cutoff } },
    }).catch(() => {});
    // Salas WAITING sem nenhum player
    const orphans = await this.prisma.room.findMany({
      where: { status: 'WAITING' },
      include: { _count: { select: { players: true } } },
    }).catch(() => []);
    const emptyIds = orphans.filter(r => r._count.players === 0).map(r => r.id);
    if (emptyIds.length > 0) {
      await this.prisma.room.deleteMany({ where: { id: { in: emptyIds } } }).catch(() => {});
    }
    // Bots/guests orfaos (sem RoomPlayer)
    const orphanUsers = await this.prisma.user.findMany({
      where: {
        OR: [{ isBot: true }, { isGuest: true }],
        roomPlayers: { none: {} },
      },
      select: { id: true },
    }).catch(() => []);
    if (orphanUsers.length > 0) {
      await this.deleteEphemeralUsers(orphanUsers.map(u => u.id));
    }
  }

  async createMatchmakingRoom(hostId: string, dto: CreateRoomDto) {
    const room = await this.createRoomWithUniqueCodeRetry({
      hostId,
      mode: dto.mode,
      maxPlayers: dto.maxPlayers,
      isPrivate: dto.isPrivate ?? false,
      isRanked: dto.isRanked ?? false,
      handBias: dto.handBias ?? 0,
      initialTokens: dto.initialTokens ?? 2,
      password: dto.password?.trim() || null,
    });

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
    return this.formatRoom(room);
  }

  async create(hostId: string, dto: CreateRoomDto) {
    // Host nao pode estar banido + valida que o usuário ainda existe
    // (defesa contra JWT stale após o usuário ser removido do banco).
    const host = await this.prisma.user.findUnique({ where: { id: hostId } });
    if (!host) throw new UnauthorizedException('Sessão expirada — entre novamente');
    if (host.isBanned) throw new ForbiddenException('Você está banido e não pode criar salas');

    if (dto.isRanked) {
      if (dto.mode !== 'TRADITIONAL') {
        throw new BadRequestException('Ranked só está disponível no modo Tradicional');
      }
      if ((host.level ?? 1) < 10) {
        throw new ForbiddenException('Ranqueada requer nível 10 ou superior');
      }
      if (host.rankedSuspendedUntil && host.rankedSuspendedUntil > new Date()) {
        const until = host.rankedSuspendedUntil.toLocaleDateString('pt-BR');
        throw new ForbiddenException(`Você está suspenso da ranqueada até ${until}`);
      }
    }

    // Gate de modo: verificar se o host tem o modo desbloqueado
    if (dto.mode !== 'TRADITIONAL') {
      const inv = await this.prisma.userInventory.findUnique({ where: { userId: hostId } });
      if (!inv || !inv.unlockedModes.includes(dto.mode)) {
        throw new ForbiddenException(`Modo ${dto.mode} não desbloqueado. Adquira na loja.`);
      }
    }

    const room = await this.createRoomWithUniqueCodeRetry({
      hostId,
      mode: dto.mode,
      maxPlayers: dto.maxPlayers,
      isPrivate: dto.isPrivate ?? true,
      isRanked: dto.isRanked ?? false,
      handBias: dto.handBias ?? 0,
      initialTokens: dto.initialTokens ?? 2,
      password: dto.password?.trim() || null,
    });

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
    return this.formatRoom(room);
  }

  private async createRoomWithUniqueCodeRetry(data: {
    hostId: string;
    mode: string;
    maxPlayers: number;
    isPrivate: boolean;
    isRanked: boolean;
    handBias: number;
    initialTokens: number;
    password: string | null;
  }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.room.create({
          data: {
            code: generateCode(),
            hostId: data.hostId,
            mode: data.mode,
            maxPlayers: data.maxPlayers,
            isPrivate: data.isPrivate,
            isRanked: data.isRanked,
            handBias: data.handBias,
            initialTokens: data.initialTokens,
            password: data.password,
            status: 'WAITING',
            players: {
              create: { userId: data.hostId, seat: 0, status: 'CONNECTED' },
            },
          },
          include: { players: { include: { user: true } } },
        });
      } catch (err) {
        const isUniqueViolation =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!isUniqueViolation) throw err;
        if (attempt >= 19) throw new BadRequestException('Could not generate unique room code');
      }
    }
  }

  async findAll(mode?: string, status?: string) {
    const rooms = await this.prisma.room.findMany({
      where: {
        isPrivate: false,
        // Mostrar salas WAITING e IN_PROGRESS — lobby exibe ambas, distinguindo visualmente
        status: status ? status : { in: ['WAITING', 'IN_PROGRESS'] },
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

  async joinRoom(userId: string, code: string, password?: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    const existing = room.players.find(p => p.userId === userId);
    if (!existing && room.password && password !== room.password) {
      throw new ForbiddenException('Senha incorreta');
    }

    // Gate de modo para não-TRADITIONAL (apenas para novos membros, não para reconexão)
    if (!existing && room.isRanked) {
      const joiner = await this.prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true, isBot: true, level: true, rankedSuspendedUntil: true } });
      if (!joiner || joiner.isGuest || joiner.isBot) throw new ForbiddenException('Convidados não podem jogar ranqueadas');
      if ((joiner.level ?? 1) < 10) throw new ForbiddenException('Ranqueada requer nível 10 ou superior');
      if (joiner.rankedSuspendedUntil && joiner.rankedSuspendedUntil > new Date()) {
        const until = joiner.rankedSuspendedUntil.toLocaleDateString('pt-BR');
        throw new ForbiddenException(`Você está suspenso da ranqueada até ${until}`);
      }
    }
    if (!existing && room.mode !== 'TRADITIONAL') {
      const inv = await this.prisma.userInventory.findUnique({ where: { userId } });
      if (!inv || !inv.unlockedModes.includes(room.mode)) {
        throw new ForbiddenException(`Modo ${room.mode} não desbloqueado. Adquira na loja.`);
      }
    }

    const alreadyIn = room.players.find(p => p.userId === userId);
    if (alreadyIn) return this.findByCode(code);

    if (room.status === 'IN_PROGRESS') {
      throw new BadRequestException('Partida em andamento. Tente outra sala.');
    }

    if (room.status !== 'WAITING') throw new BadRequestException('Room already started');

    if (room.players.length >= room.maxPlayers) {
      throw new BadRequestException('Sala cheia.');
    }

    // O usuario pode ter sido deletado entre a emissao do JWT e este join
    // (ex: guest limpo por cleanup concorrente). Sem essa checagem o
    // roomPlayer.create estoura FK RoomPlayer_userId_fkey e o cliente ve
    // um erro tecnico cru.
    const joiner = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!joiner) throw new UnauthorizedException('Sessão expirada — entre novamente');

    // Sala orfa: host aponta pra um User que nao existe mais (guest
    // deletado deixou a sala pendurada). Em vez de propagar erro de FK
    // ao tentar entrar, limpa a sala morta e avisa o usuario.
    const hostExists = await this.prisma.user.findUnique({ where: { id: room.hostId }, select: { id: true } });
    if (!hostExists) {
      await this.prisma.roomPlayer.deleteMany({ where: { roomId: room.id } });
      await this.prisma.room.delete({ where: { id: room.id } }).catch(() => {});
      if (!room.isPrivate) this.events.emit('rooms.public.changed');
      throw new NotFoundException('Esta sala não está mais disponível.');
    }

    const usedSeats = new Set(room.players.map(p => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat++;

    await this.prisma.roomPlayer.create({
      data: { roomId: room.id, userId, seat, status: 'CONNECTED' },
    });

    return this.findByCode(code);
  }

  async leaveRoom(userId: string, code: string) {
    // Race condition: 2 jogadores saindo simultaneamente leem o mesmo snapshot
    // do room e processam decisões com dados desatualizados, deixando a sala
    // com host fantasma. Solução: transação que re-le o estado após o delete
    // e decide com snapshot fresco.
    const result = await this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { code }, include: { players: true } });
      if (!room) return null;

      await tx.roomPlayer.deleteMany({ where: { roomId: room.id, userId } });

      // Re-lê players após o delete para ver o estado pós-saída
      const freshPlayers = await tx.roomPlayer.findMany({
        where: { roomId: room.id },
        include: { user: { select: { id: true, isBot: true, isGuest: true } } },
      });

      const isHostLeaving = room.hostId === userId;
      const remainingIds = freshPlayers.map(p => p.userId);
      const humanRemaining = freshPlayers.filter(p => !p.user?.isBot && !p.user?.isGuest);

      // Caso 1: ninguém restou → deleta sala
      if (freshPlayers.length === 0) {
        await tx.room.delete({ where: { id: room.id } });
        return { action: 'deleted', isPrivate: room.isPrivate };
      }

      // Caso 2: só sobraram bots/guests → limpa efêmeros e deleta sala
      if (humanRemaining.length === 0) {
        const ephemeralIds = freshPlayers.filter(p => p.user?.isBot || p.user?.isGuest).map(p => p.userId);
        if (ephemeralIds.length > 0) {
          await tx.gameResult.deleteMany({ where: { userId: { in: ephemeralIds } } });
          await tx.userInventory.deleteMany({ where: { userId: { in: ephemeralIds } } });
          await tx.userStats.deleteMany({ where: { userId: { in: ephemeralIds } } });
          await tx.rankedStats.deleteMany({ where: { userId: { in: ephemeralIds } } });
          await tx.roomPlayer.deleteMany({ where: { userId: { in: ephemeralIds } } });
          await tx.user.deleteMany({ where: { id: { in: ephemeralIds } } });
        }
        await tx.room.delete({ where: { id: room.id } });
        return { action: 'deleted', isPrivate: room.isPrivate };
      }

      // Caso 3: host saiu, mas sobrou humano → promove primeiro humano
      if (isHostLeaving) {
        const newHostId = humanRemaining[0].userId;
        await tx.room.update({ where: { id: room.id }, data: { hostId: newHostId } });
        return { action: 'hostChanged', newHostId, isPrivate: room.isPrivate };
      }

      // Caso 4: non-host saiu, ainda há humano → segue
      return { action: 'continue', remainingIds, freshPlayers, room };
    });

    if (!result) return;

    if (result.action === 'deleted') {
      if (!result.isPrivate) this.events.emit('rooms.public.changed');
      return;
    }

    if (result.action === 'hostChanged') {
      if (!result.isPrivate) this.events.emit('rooms.public.changed');
      this.events.emit('rooms.host_changed', { roomCode: code, newHostId: result.newHostId });
      return;
    }

    // result.action === 'continue' — non-host saiu
    const { room } = result;
    {
      // Non-host leaving — free username if guest
      const leaving = await this.prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true } });
      if (leaving?.isGuest) {
        await this.deleteEphemeralUsers([userId]);
      }
    }

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
  }

  async addBot(code: string, hostUserId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: true },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.hostId !== hostUserId) throw new ForbiddenException('Only the host can add bots');
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

    // Retry loop handles concurrent addBot calls racing on the same name (P2002).
    // Each attempt re-reads used names so a concurrent winner is reflected.
    let bot: { id: string; username: string };
    for (let attempt = 0; ; attempt++) {
      const allBotUsernames = await this.prisma.user.findMany({
        where: { isBot: true },
        select: { username: true },
      });
      const usedBotNames = new Set(allBotUsernames.map(b => b.username));
      const availableBase = botBaseNames.find(n => !usedBotNames.has(n));
      const username = availableBase ?? `Bot-${Date.now().toString(36).slice(-5).toUpperCase()}-${attempt}`;

      try {
        bot = await this.prisma.user.create({
          data: { username, isBot: true, isGuest: true },
        });
        break;
      } catch (err) {
        const isUniqueViolation =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!isUniqueViolation || attempt >= 9) throw err;
        // Another concurrent request claimed this name — retry with fresh name list.
      }
    }

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

  async fillWithBots(code: string) {
    const room = await this.prisma.room.findUnique({ where: { code }, include: { players: true } });
    if (!room || room.status !== 'WAITING') return;
    // Salas ranqueadas nao recebem bots — descaracteriza a partida
    if (room.isRanked) return;
    const needed = room.maxPlayers - room.players.length;
    for (let i = 0; i < needed; i++) {
      try { await this.addBot(code, room.hostId); } catch { break; }
    }
  }

  async removeBot(code: string, hostUserId: string, botUserId: string) {
    const room = await this.prisma.room.findUnique({ where: { code }, include: { players: true } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.hostId !== hostUserId) throw new ForbiddenException('Only the host can remove bots');

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

  async markFinished(
    code: string,
    results: { userId: string; placement: number; tokensLeft: number }[],
    gameStats?: { saborTriggers: number; tricksWon: Record<string, number> },
  ): Promise<Record<string, { xpEarned: number; coinsEarned: number; newLevel: number; leveledUp: boolean; pdsChange: number; newPds: number; newRank: string }>> {
    // Idempotência: se room já está FINISHED, retorna sem reprocessar
    const existing = await this.prisma.room.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Room not found');
    if (existing.status === 'FINISHED') {
      // Já processado — recupera os GameResults e devolve estado atual
      const existingResults = await this.prisma.gameResult.findMany({
        where: { roomId: existing.id },
        include: { user: { select: { pds: true } } },
      });
      const replay: Record<string, { xpEarned: number; coinsEarned: number; newLevel: number; leveledUp: boolean; pdsChange: number; newPds: number; newRank: string }> = {};
      for (const gr of existingResults) {
        replay[gr.userId] = {
          xpEarned: gr.xpEarned,
          coinsEarned: gr.coinsEarned,
          newLevel: 1,
          leveledUp: false,
          pdsChange: 0,
          newPds: gr.user?.pds ?? 0,
          newRank: rankFromPds(gr.user?.pds ?? 0),
        };
      }
      return replay;
    }

    const room = await this.prisma.room.update({
      where: { code },
      data: { status: 'FINISHED', endedAt: new Date() },
      include: { players: { include: { user: { select: { id: true, isBot: true, isGuest: true } } } } },
    });

    const ephemeralIds = new Set(
      room.players.filter(p => p.user?.isBot || p.user?.isGuest).map(p => p.userId),
    );
    // Players que ainda estao na sala no momento do fim do jogo (nao saiu via
    // leaveRoom). Quem abandonou nao deve receber XP nem moedas — placement
    // gerado pelo engine ainda inclui esses ids, mas filtramos aqui na
    // distribuicao de recompensas.
    const stillInRoom = new Set(room.players.map(p => p.userId));

    const totalPlayers = results.length;
    const rewards: Record<string, { xpEarned: number; coinsEarned: number; newLevel: number; leveledUp: boolean; pdsChange: number; newPds: number; newRank: string }> = {};

    for (const r of results) {
      if (ephemeralIds.has(r.userId)) continue;
      if (!stillInRoom.has(r.userId)) continue;

      const earned = xpGain(r.placement, totalPlayers);
      const coins = coinsGain(r.placement, totalPlayers);

      // Tudo dentro de uma transação para evitar race condition de streaks:
      // user.findUnique → calcPdsChange → user.update não pode ser interrompido
      const txResult = await this.prisma.$transaction(async (tx) => {
        // Idempotência por (roomId, userId): se já tem GameResult, pula
        const existingResult = await tx.gameResult.findFirst({
          where: { roomId: room.id, userId: r.userId },
          select: { id: true },
        });
        if (existingResult) return null;

        await tx.gameResult.create({
          data: {
            roomId: room.id,
            userId: r.userId,
            placement: r.placement,
            tokensLeft: r.tokensLeft,
            xpEarned: earned,
            coinsEarned: coins,
            isRanked: room.isRanked,
          },
        });

        // Stats vindos do engine: tricksWon por player (vaza ganha = wipe) e
        // saborTriggers do jogo todo. Quem ativou ganha o credito; como o engine
        // hoje so guarda total agregado, atribuimos ao vencedor (placement 1).
        // Em jogos sem vencedor unico, o credito do sabor cai no primeiro lugar
        // — solucao simples sem mudar o engine.
        const tricksWonByMe = gameStats?.tricksWon?.[r.userId] ?? 0;
        const saborGainedByMe = r.placement === 1 ? (gameStats?.saborTriggers ?? 0) : 0;
        await tx.userStats.upsert({
          where: { userId: r.userId },
          create: {
            userId: r.userId,
            gamesPlayed: 1,
            gamesWon: r.placement === 1 ? 1 : 0,
            tricksWon: tricksWonByMe,
            saborTriggers: saborGainedByMe,
          },
          update: {
            gamesPlayed: { increment: 1 },
            gamesWon: { increment: r.placement === 1 ? 1 : 0 },
            tricksWon: { increment: tricksWonByMe },
            saborTriggers: { increment: saborGainedByMe },
          },
        });

        const user = await tx.user.findUnique({
          where: { id: r.userId },
          select: { xp: true, level: true, pds: true, winStreak: true, lossStreak: true },
        });
        if (!user) return null;

        const newXp = (user.xp ?? 0) + earned;
        const oldLevel = user.level ?? 1;
        const newLevel = Math.min(computeLevel(newXp), 100);

        let pdsDelta = 0;
        let newPds = user.pds ?? 0;
        let newWinStreak = user.winStreak ?? 0;
        let newLossStreak = user.lossStreak ?? 0;

        if (room.isRanked) {
          const isWinner = r.placement === 1;
          // Calcula delta usando streaks atuais (antes de atualizar), depois atualiza streaks
          pdsDelta = calcPdsChange(r.placement, totalPlayers, user.winStreak ?? 0, user.lossStreak ?? 0);
          newPds = clampPds((user.pds ?? 0) + pdsDelta, user.pds ?? 0);
          if (isWinner) {
            newWinStreak = (user.winStreak ?? 0) + 1;
            newLossStreak = 0;
          } else {
            newLossStreak = (user.lossStreak ?? 0) + 1;
            newWinStreak = 0;
          }

          const existingStats = await tx.rankedStats.findUnique({ where: { userId: r.userId }, select: { peakPds: true } });
          await tx.rankedStats.upsert({
            where: { userId: r.userId },
            create: {
              userId: r.userId,
              rankedWins: isWinner ? 1 : 0,
              rankedLosses: isWinner ? 0 : 1,
              peakPds: newPds,
            },
            update: {
              ...(isWinner ? { rankedWins: { increment: 1 } } : { rankedLosses: { increment: 1 } }),
              ...(newPds > (existingStats?.peakPds ?? 0) ? { peakPds: newPds } : {}),
            },
          });
        }

        await tx.user.update({
          where: { id: r.userId },
          data: {
            xp: newXp,
            level: newLevel,
            coins: { increment: coins },
            ...(room.isRanked ? { pds: newPds, winStreak: newWinStreak, lossStreak: newLossStreak } : {}),
          },
        });

        return { newXp, newLevel, oldLevel, pdsDelta, newPds };
      });

      if (!txResult) continue;

      rewards[r.userId] = {
        xpEarned: earned,
        coinsEarned: coins,
        newLevel: txResult.newLevel,
        leveledUp: txResult.newLevel > txResult.oldLevel,
        pdsChange: txResult.pdsDelta,
        newPds: txResult.newPds,
        newRank: rankFromPds(txResult.newPds),
      };
    }

    // Incrementa sessionWins do vencedor antes de deletar efêmeros
    const winner = results.find(r => r.placement === 1);
    if (winner && !ephemeralIds.has(winner.userId)) {
      await this.prisma.roomPlayer.updateMany({
        where: { roomId: room.id, userId: winner.userId },
        data: { sessionWins: { increment: 1 } },
      }).catch(() => {});
    }

    if (ephemeralIds.size > 0) {
      await this.deleteEphemeralUsers([...ephemeralIds]);
    }

    this.events.emit('rooms.public.changed');
    return rewards;
  }

  async resetRoom(code: string, userId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: { include: { user: { select: { id: true, isBot: true } } } } },
    });
    if (!room) throw new NotFoundException('Room not found');
    if (room.hostId !== userId) throw new ForbiddenException('Only the host can reset the room');

    // Identificar e remover bots
    const botUserIds = room.players
      .filter(rp => rp.user?.isBot)
      .map(rp => rp.userId);

    if (botUserIds.length > 0) {
      await this.prisma.roomPlayer.deleteMany({
        where: { roomId: room.id, userId: { in: botUserIds } },
      });
      await this.deleteEphemeralUsers(botUserIds);
    }

    const updated = await this.prisma.room.update({
      where: { code },
      data: { status: 'WAITING', startedAt: null, endedAt: null },
      include: { players: { include: { user: true } } },
    });

    if (!updated.isPrivate) this.events.emit('rooms.public.changed');
    return this.formatRoom(updated);
  }

  async getUserForAbandonment(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { isBot: true, isGuest: true } });
  }

  async applyRankedAbandonment(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pds: true, winStreak: true, lossStreak: true, rankedWarnings: true },
    });
    if (!user) return;

    const newPds = clampPds((user.pds ?? 0) - 40, user.pds ?? 0);
    const newWarnings = (user.rankedWarnings ?? 0) + 1;

    let rankedSuspendedUntil: Date | null = null;
    if (newWarnings >= 5) {
      rankedSuspendedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (newWarnings >= 3) {
      rankedSuspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pds: newPds,
        rankedWarnings: newWarnings,
        ...(rankedSuspendedUntil !== null ? { rankedSuspendedUntil } : {}),
        lossStreak: { increment: 1 },
        winStreak: 0,
      },
    });
  }

  async leaveRoomIfGuest(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isGuest: true, isBot: true },
    });
    if (!user?.isGuest && !user?.isBot) return false;

    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { players: true },
    });
    if (!room || room.status === 'IN_PROGRESS') return false;

    await this.prisma.roomPlayer.deleteMany({ where: { roomId: room.id, userId } });
    await this.deleteEphemeralUsers([userId]);

    const remaining = room.players.filter(p => p.userId !== userId);
    if (remaining.length === 0) {
      await this.prisma.room.delete({ where: { id: room.id } });
    }

    if (!room.isPrivate) this.events.emit('rooms.public.changed');
    return true;
  }

  async deleteGuestIfOrphan(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isGuest: true },
    });
    if (!user?.isGuest) return;
    const inRoom = await this.prisma.roomPlayer.findFirst({ where: { userId } });
    if (inRoom) return;
    await this.deleteEphemeralUsers([userId]);
  }

  /**
   * Versão agressiva do cleanup: deleta guest mesmo se ainda tem RoomPlayer
   * ativo (caso típico: convidado fechou a aba durante uma partida em curso).
   * Remove os RoomPlayer dele primeiro pra liberar o seat, depois o User —
   * o que automaticamente libera o username pra próximo convidado usar.
   *
   * Engine em memória ainda tem o PlayerState desse user, mas como o socket
   * sumiu há tempo (>= GUEST_CLEANUP_DELAY_MS), faz sentido considerar
   * abandonado. Bot scheduler segue o jogo; quando match termina, engine
   * é destruído normalmente.
   */
  async forceDeleteGuest(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isGuest: true },
    });
    if (!user?.isGuest) return;

    // Salas das quais o guest participa. Se ele ficou como unico membro
    // (ou era host sem mais ninguem humano), a sala vira orfa apos o
    // delete: hostId aponta pra um User que nao existe mais, e qualquer
    // joinRoom subsequente quebra com FK violada. Resolve deletando a
    // sala junto, ou transferindo host se sobrar humano.
    const memberships = await this.prisma.roomPlayer.findMany({
      where: { userId },
      select: { roomId: true },
    });

    await this.prisma.roomPlayer.deleteMany({ where: { userId } });
    await this.deleteEphemeralUsers([userId]);

    for (const { roomId } of memberships) {
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        include: { players: { include: { user: { select: { id: true, isBot: true, isGuest: true } } } } },
      });
      if (!room) continue;

      const humans = room.players.filter(p => p.user && !p.user.isBot && !p.user.isGuest);

      if (room.players.length === 0 || humans.length === 0) {
        // Ninguem humano restou — limpa a sala e efemeros remanescentes.
        const ephemerals = room.players
          .filter(p => p.user && (p.user.isBot || p.user.isGuest))
          .map(p => p.userId);
        if (ephemerals.length > 0) {
          await this.prisma.roomPlayer.deleteMany({ where: { roomId, userId: { in: ephemerals } } });
          await this.deleteEphemeralUsers(ephemerals);
        }
        await this.prisma.room.delete({ where: { id: roomId } }).catch(() => {});
        if (!room.isPrivate) this.events.emit('rooms.public.changed');
      } else if (!room.players.some(p => p.userId === room.hostId)) {
        // Host saiu (era o guest deletado) mas sobrou humano — promove.
        await this.prisma.room.update({
          where: { id: roomId },
          data: { hostId: humans[0].userId },
        });
        if (!room.isPrivate) this.events.emit('rooms.public.changed');
      }
    }
  }

  protected async deleteEphemeralUsers(ids: string[]) {
    if (ids.length === 0) return;
    await this.prisma.gameResult.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.userStats.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.user.deleteMany({ where: { id: { in: ids } } });
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
      isRanked: room.isRanked ?? false,
      handBias: room.handBias ?? 0,
      initialTokens: room.initialTokens ?? 2,
      hasPassword: !!room.password,
      players: room.players.map((rp: any) => ({
        userId: rp.userId,
        username: rp.user?.username ?? 'Unknown',
        avatarIndex: rp.user?.avatarIndex ?? 0,
        level: rp.user?.level ?? 1,
        pds: rp.user?.pds ?? 0,
        seat: rp.seat,
        isReady: false,
        isConnected: rp.status === 'CONNECTED',
        isBot: rp.user?.isBot ?? false,
        isGuest: rp.user?.isGuest ?? false,
        isAdmin: rp.user?.isAdmin ?? false,
        isSpectator: false,
        sessionWins: rp.sessionWins ?? 0,
      })),
    };
  }
}
