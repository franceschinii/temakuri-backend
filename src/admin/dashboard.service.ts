import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface DashboardData {
  game: {
    matchesByDay: { date: string; finished: number; abandoned: number }[];
    abandonRate24h: { abandoned: number; finished: number; rate: number };
    winnersByMode: { mode: string; count: number }[];
  };
  system: {
    errorsByCategory24h: { category: string; warn: number; error: number }[];
    requestsByHour7d: { hour: string; count: number }[];
    topErrorActions24h: { action: string; count: number }[];
  };
  monetization: {
    revenueByDay30d: { date: string; coins: number; premium: number; bundle: number; total: number }[];
    totalRevenue30d: number;
    topBuyers30d: { userId: string; username: string; count: number; totalSpent: number }[];
    salesBySku30d: { sku: string; count: number }[];
  };
  moderation: {
    topAdminActions7d: { username: string; userId: string; count: number }[];
    bannedTotal: number;
    suspendedRankedTotal: number;
    failedLogins24h: number;
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<DashboardData> {
    const [game, system, monetization, moderation] = await Promise.all([
      this.gameMetrics(),
      this.systemMetrics(),
      this.monetizationMetrics(),
      this.moderationMetrics(),
    ]);
    return { game, system, monetization, moderation };
  }

  private async gameMetrics(): Promise<DashboardData['game']> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const matchLogs = await this.prisma.adminLog.findMany({
      where: {
        category: 'game',
        action: { in: ['game.over', 'game.abandon'] },
        createdAt: { gte: since },
      },
      select: { action: true, createdAt: true, metadata: true },
    });

    // Agrupa por dia
    const byDay = new Map<string, { finished: number; abandoned: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { finished: 0, abandoned: 0 });
    }
    for (const log of matchLogs) {
      const key = log.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(key);
      if (!entry) continue;
      if (log.action === 'game.over') entry.finished++;
      else entry.abandoned++;
    }

    // Taxa de abandono 24h
    const last24 = matchLogs.filter(l => l.createdAt >= yesterday);
    const abandoned24 = last24.filter(l => l.action === 'game.abandon').length;
    const finished24 = last24.filter(l => l.action === 'game.over').length;
    const rate = (finished24 + abandoned24) === 0 ? 0 : abandoned24 / (finished24 + abandoned24);

    // Vencedores por modo (placeholder — precisa do mode no metadata)
    // Por enquanto agrupa por # de rankings com isWinner=true ao longo dos 7d
    const winnersByMode: { mode: string; count: number }[] = [];
    const modeCount = new Map<string, number>();
    for (const log of matchLogs) {
      if (log.action !== 'game.over') continue;
      const meta = log.metadata as { mode?: string; rankings?: { isWinner?: boolean }[] } | null;
      const mode = meta?.mode ?? 'TRADITIONAL';
      const winners = meta?.rankings?.filter(r => r.isWinner).length ?? 0;
      modeCount.set(mode, (modeCount.get(mode) ?? 0) + winners);
    }
    for (const [mode, count] of modeCount) winnersByMode.push({ mode, count });

    return {
      matchesByDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      abandonRate24h: { abandoned: abandoned24, finished: finished24, rate },
      winnersByMode,
    };
  }

  private async systemMetrics(): Promise<DashboardData['system']> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const errorLogs = await this.prisma.adminLog.findMany({
      where: {
        level: { in: ['warn', 'error'] },
        createdAt: { gte: yesterday },
      },
      select: { category: true, level: true, action: true },
    });

    const categoryMap = new Map<string, { warn: number; error: number }>();
    const actionMap = new Map<string, number>();
    for (const log of errorLogs) {
      const cat = categoryMap.get(log.category) ?? { warn: 0, error: 0 };
      if (log.level === 'error') cat.error++;
      else cat.warn++;
      categoryMap.set(log.category, cat);
      if (log.level === 'error') {
        actionMap.set(log.action, (actionMap.get(log.action) ?? 0) + 1);
      }
    }

    const errorsByCategory24h = [...categoryMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => (b.error + b.warn) - (a.error + a.warn));

    const topErrorActions24h = [...actionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));

    // Requests por hora últimos 7d (24*7 = 168 buckets — limitamos a 7d em buckets de hora)
    const requestLogs = await this.prisma.adminLog.findMany({
      where: { createdAt: { gte: sevenDays } },
      select: { createdAt: true },
    });
    const hourMap = new Map<string, number>();
    // Pré-inicializa 7d em buckets de 6h (28 pontos) — granularidade suficiente
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setHours(d.getHours() - i * 6, 0, 0, 0);
      const key = d.toISOString();
      hourMap.set(key, 0);
    }
    for (const log of requestLogs) {
      const d = new Date(log.createdAt);
      d.setHours(Math.floor(d.getHours() / 6) * 6, 0, 0, 0);
      const key = d.toISOString();
      if (hourMap.has(key)) hourMap.set(key, (hourMap.get(key) ?? 0) + 1);
    }

    return {
      errorsByCategory24h,
      requestsByHour7d: [...hourMap.entries()].map(([hour, count]) => ({ hour, count })),
      topErrorActions24h,
    };
  }

  private async monetizationMetrics(): Promise<DashboardData['monetization']> {
    const thirtyDays = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const transactions = await this.prisma.diamondTransaction.findMany({
      where: { createdAt: { gte: thirtyDays }, type: 'PURCHASE' },
      select: { id: true, userId: true, amount: true, sku: true, createdAt: true },
    });

    // Receita por dia (30d)
    const byDay = new Map<string, { coins: number; premium: number; bundle: number; total: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { coins: 0, premium: 0, bundle: 0, total: 0 });
    }

    for (const tx of transactions) {
      const key = tx.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(key);
      if (!entry) continue;
      const value = tx.amount ?? 0;
      entry.total += value;
      const sku = (tx.sku ?? '').toLowerCase();
      if (sku.includes('premium')) entry.premium += value;
      else if (sku.includes('bundle')) entry.bundle += value;
      else entry.coins += value;
    }

    const totalRevenue30d = transactions.reduce((s, t) => s + (t.brlValue ?? 0), 0);

    // Top compradores
    const buyerMap = new Map<string, { count: number; totalSpent: number }>();
    for (const tx of transactions) {
      const e = buyerMap.get(tx.userId) ?? { count: 0, totalSpent: 0 };
      e.count++;
      e.totalSpent += tx.amount ?? 0;
      buyerMap.set(tx.userId, e);
    }
    const topBuyerIds = [...buyerMap.entries()]
      .sort((a, b) => b[1].totalSpent - a[1].totalSpent)
      .slice(0, 5)
      .map(([userId, v]) => ({ userId, ...v }));

    const users = topBuyerIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: topBuyerIds.map(b => b.userId) } },
          select: { id: true, username: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u.username]));
    const topBuyers30d = topBuyerIds.map(b => ({
      userId: b.userId,
      username: userMap.get(b.userId) ?? '—',
      count: b.count,
      totalSpent: b.totalSpent,
    }));

    // Vendas por SKU
    const skuMap = new Map<string, number>();
    for (const tx of transactions) {
      const sku = tx.sku ?? 'unknown';
      skuMap.set(sku, (skuMap.get(sku) ?? 0) + 1);
    }
    const salesBySku30d = [...skuMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sku, count]) => ({ sku, count }));

    return {
      revenueByDay30d: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      totalRevenue30d,
      topBuyers30d,
      salesBySku30d,
    };
  }

  private async moderationMetrics(): Promise<DashboardData['moderation']> {
    const sevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Top admins por ações 7d
    const adminLogs = await this.prisma.adminLog.findMany({
      where: {
        category: 'admin',
        userId: { not: null },
        createdAt: { gte: sevenDays },
      },
      select: { userId: true, username: true },
    });
    const adminMap = new Map<string, { username: string; count: number }>();
    for (const log of adminLogs) {
      if (!log.userId) continue;
      const e = adminMap.get(log.userId) ?? { username: log.username ?? '—', count: 0 };
      e.count++;
      adminMap.set(log.userId, e);
    }
    const topAdminActions7d = [...adminMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([userId, v]) => ({ userId, username: v.username, count: v.count }));

    const [bannedTotal, suspendedRankedTotal, failedLogins] = await Promise.all([
      this.prisma.user.count({ where: { isBanned: true } }),
      this.prisma.user.count({ where: { rankedSuspendedUntil: { gt: new Date() } } }),
      this.prisma.adminLog.count({
        where: {
          action: 'post /auth/login',
          level: { in: ['warn', 'error'] },
          createdAt: { gte: yesterday },
        },
      }),
    ]);

    return {
      topAdminActions7d,
      bannedTotal,
      suspendedRankedTotal,
      failedLogins24h: failedLogins,
    };
  }
}
