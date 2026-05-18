import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogCategory =
  | 'auth'
  | 'admin'
  | 'payment'
  | 'shop'
  | 'game'
  | 'matchmaking'
  | 'system';

export interface RecordLogInput {
  category: LogCategory;
  action: string;
  level?: LogLevel;
  userId?: string | null;
  username?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
  statusCode?: number | null;
}

export interface ListLogsQuery {
  category?: LogCategory;
  action?: string;
  level?: LogLevel;
  userId?: string;
  username?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /// Gravacao tolerante a falhas: erro de log nao derruba a request.
  async record(input: RecordLogInput): Promise<void> {
    try {
      await this.prisma.adminLog.create({
        data: {
          category: input.category,
          action: input.action,
          level: input.level ?? 'info',
          userId: input.userId ?? null,
          username: input.username ?? null,
          ip: input.ip ?? null,
          metadata: (input.metadata as never) ?? undefined,
          statusCode: input.statusCode ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Falha ao gravar AdminLog ${input.category}.${input.action}: ${(err as Error).message}`);
    }
  }

  async list(query: ListLogsQuery) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const where: any = {};

    if (query.category) where.category = query.category;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.level) where.level = query.level;
    if (query.userId) where.userId = query.userId;
    if (query.username) where.username = { contains: query.username, mode: 'insensitive' };
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }

    const rows = await this.prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async stats(sinceHours = 24) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const grouped = await this.prisma.adminLog.groupBy({
      by: ['category', 'level'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    return grouped.map(g => ({
      category: g.category,
      level: g.level,
      count: g._count._all,
    }));
  }

  /// Purga registros com mais de N dias. Pode ser chamada por cron externo
  /// ou manualmente via endpoint admin.
  async purgeOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.prisma.adminLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
