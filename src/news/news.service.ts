import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NEWS_SEED } from './news.seed.js';

@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger(NewsService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  /**
   * Popula a tabela com a noticia historica UMA vez (primeiro boot apos a
   * migration). sortIndex segue a ordem do array (0 = mais recente).
   */
  private async seedIfEmpty() {
    const count = await this.prisma.newsEntry.count();
    if (count > 0) return;
    this.logger.log(`Seedando ${NEWS_SEED.length} noticia(s)...`);
    await this.prisma.newsEntry.createMany({
      data: NEWS_SEED.map((n, idx) => ({
        date: n.date,
        pinned: n.pinned,
        title: n.title,
        summary: n.summary,
        body: n.body,
        published: true,
        sortIndex: idx,
      })),
    });
    this.logger.log('Noticias seedadas.');
  }

  /** Listagem publica — so publicadas. Fixadas primeiro, depois por ordem. */
  async listPublic() {
    return this.prisma.newsEntry.findMany({
      where: { published: true },
      orderBy: [{ pinned: 'desc' }, { sortIndex: 'asc' }],
      select: {
        id: true, date: true, pinned: true,
        title: true, summary: true, body: true,
      },
    });
  }

  /** Listagem admin — todas, incluindo nao publicadas. */
  async listAll() {
    return this.prisma.newsEntry.findMany({
      orderBy: [{ pinned: 'desc' }, { sortIndex: 'asc' }],
    });
  }

  async create(data: {
    date: string;
    pinned?: boolean;
    title: string;
    summary: string;
    body: string;
    published?: boolean;
  }) {
    // Nova noticia vai pro topo: shift de todos sortIndex +1, novo fica 0.
    await this.prisma.newsEntry.updateMany({
      data: { sortIndex: { increment: 1 } },
    });
    return this.prisma.newsEntry.create({
      data: {
        date: data.date,
        pinned: data.pinned ?? false,
        title: data.title,
        summary: data.summary,
        body: data.body,
        published: data.published ?? true,
        sortIndex: 0,
      },
    });
  }

  async update(id: string, data: Partial<{
    date: string;
    pinned: boolean;
    title: string;
    summary: string;
    body: string;
    published: boolean;
    sortIndex: number;
  }>) {
    const entry = await this.prisma.newsEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Notícia não encontrada');
    return this.prisma.newsEntry.update({ where: { id }, data });
  }

  async remove(id: string) {
    const entry = await this.prisma.newsEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Notícia não encontrada');
    await this.prisma.newsEntry.delete({ where: { id } });
    return { ok: true };
  }
}
