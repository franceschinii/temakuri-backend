import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHANGELOG_SEED } from './seed-data.js';

@Injectable()
export class ChangelogService implements OnModuleInit {
  private readonly logger = new Logger(ChangelogService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  /**
   * Popula a tabela com o changelog historico UMA vez (no primeiro boot
   * apos a migration). sortIndex segue a ordem do array (0 = mais recente).
   */
  private async seedIfEmpty() {
    const count = await this.prisma.changelogEntry.count();
    if (count > 0) return;
    this.logger.log(`Seedando ${CHANGELOG_SEED.length} entradas de changelog...`);
    await this.prisma.changelogEntry.createMany({
      data: CHANGELOG_SEED.map((e, idx) => ({
        date: e.date,
        version: e.version,
        title: e.title,
        category: e.category,
        highlights: e.highlights,
        details: e.details,
        published: true,
        sortIndex: idx,
      })),
    });
    this.logger.log('Changelog seedado.');
  }

  /** Listagem publica — so entradas publicadas, ordenadas. */
  async listPublic() {
    return this.prisma.changelogEntry.findMany({
      where: { published: true },
      orderBy: { sortIndex: 'asc' },
      select: {
        id: true, date: true, version: true, title: true,
        category: true, highlights: true, details: true,
      },
    });
  }

  /** Listagem admin — todas, incluindo nao publicadas. */
  async listAll() {
    return this.prisma.changelogEntry.findMany({ orderBy: { sortIndex: 'asc' } });
  }

  async create(data: {
    date: string;
    version: string;
    title: string;
    category: string;
    highlights: string[];
    details: string;
    published?: boolean;
  }) {
    // Nova entrada vai pro topo: shift de todos sortIndex +1, novo fica 0.
    await this.prisma.changelogEntry.updateMany({
      data: { sortIndex: { increment: 1 } },
    });
    return this.prisma.changelogEntry.create({
      data: {
        date: data.date,
        version: data.version,
        title: data.title,
        category: data.category,
        highlights: data.highlights,
        details: data.details,
        published: data.published ?? true,
        sortIndex: 0,
      },
    });
  }

  async update(id: string, data: Partial<{
    date: string;
    version: string;
    title: string;
    category: string;
    highlights: string[];
    details: string;
    published: boolean;
    sortIndex: number;
  }>) {
    const entry = await this.prisma.changelogEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada nao encontrada');
    return this.prisma.changelogEntry.update({ where: { id }, data });
  }

  async remove(id: string) {
    const entry = await this.prisma.changelogEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada nao encontrada');
    await this.prisma.changelogEntry.delete({ where: { id } });
    return { ok: true };
  }
}
