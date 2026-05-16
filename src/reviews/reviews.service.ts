import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const MIN_GAMES_TO_REVIEW = 2;
const TITLE_MAX = 80;
const COMMENT_MAX = 1000;
const REPLY_MAX = 1000;

type ReactionType = 'helpful' | 'not_helpful';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  private shape(r: any, myReaction?: ReactionType | null, isMine = false) {
    return {
      id: r.id,
      username: r.user?.username ?? '—',
      avatarIndex: r.user?.avatarIndex ?? 0,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      helpful: r.helpful,
      notHelpful: r.notHelpful,
      adminReply: r.adminReply ?? null,
      adminReplyAt: r.adminReplyAt ?? null,
      createdAt: r.createdAt,
      isMine,
      myReaction: myReaction ?? null,
    };
  }

  /** Lista publica — so publicadas. Mais uteis primeiro, depois recentes. */
  async listPublic() {
    const reviews = await this.prisma.review.findMany({
      where: { published: true },
      orderBy: [{ helpful: 'desc' }, { createdAt: 'desc' }],
      include: { user: { select: { username: true, avatarIndex: true } } },
    });
    return reviews.map(r => this.shape(r));
  }

  /**
   * Estado do usuario logado: sua review (se houver) + mapa de reacoes
   * que ele deu, para o front mesclar com a lista publica.
   */
  async getMyState(userId: string) {
    const [mine, reactions, user] = await Promise.all([
      this.prisma.review.findUnique({
        where: { userId },
        include: { user: { select: { username: true, avatarIndex: true } } },
      }),
      this.prisma.reviewReaction.findMany({
        where: { userId },
        select: { reviewId: true, type: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isGuest: true, isBanned: true, stats: { select: { gamesPlayed: true } } },
      }),
    ]);

    const reactionMap: Record<string, ReactionType> = {};
    for (const r of reactions) reactionMap[r.reviewId] = r.type as ReactionType;

    const gamesPlayed = user?.stats?.gamesPlayed ?? 0;
    const canReview =
      !!user && !user.isGuest && !user.isBanned && gamesPlayed >= MIN_GAMES_TO_REVIEW;

    return {
      mine: mine ? this.shape(mine, null, true) : null,
      reactions: reactionMap,
      canReview,
      gamesPlayed,
      minGames: MIN_GAMES_TO_REVIEW,
    };
  }

  async upsertMine(userId: string, data: { rating: number; title: string; comment: string }) {
    const rating = Math.round(Number(data.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('A nota deve ser entre 1 e 5 estrelas.');
    }
    const title = (data.title ?? '').trim();
    const comment = (data.comment ?? '').trim();
    if (!title || !comment) {
      throw new BadRequestException('Título e comentário são obrigatórios.');
    }
    if (title.length > TITLE_MAX || comment.length > COMMENT_MAX) {
      throw new BadRequestException('Título ou comentário muito longos.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isGuest: true, isBanned: true, stats: { select: { gamesPlayed: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.isGuest) throw new ForbiddenException('Convidados não podem avaliar. Crie uma conta.');
    if (user.isBanned) throw new ForbiddenException('Você está banido e não pode avaliar.');
    if ((user.stats?.gamesPlayed ?? 0) < MIN_GAMES_TO_REVIEW) {
      throw new ForbiddenException(`Jogue ao menos ${MIN_GAMES_TO_REVIEW} partidas antes de avaliar.`);
    }

    // Editar reseta a resposta do admin (contexto mudou).
    return this.prisma.review.upsert({
      where: { userId },
      create: { userId, rating, title, comment },
      update: { rating, title, comment, adminReply: null, adminReplyAt: null },
    });
  }

  async react(reviewId: string, userId: string, type: ReactionType) {
    if (type !== 'helpful' && type !== 'not_helpful') {
      throw new BadRequestException('Reação inválida.');
    }
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Avaliação não encontrada.');
    if (review.userId === userId) {
      throw new BadRequestException('Você não pode reagir à própria avaliação.');
    }

    const col = (t: ReactionType) => (t === 'helpful' ? 'helpful' : 'notHelpful');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.reviewReaction.findUnique({
        where: { reviewId_userId: { reviewId, userId } },
      });

      if (!existing) {
        await tx.reviewReaction.create({ data: { reviewId, userId, type } });
        await tx.review.update({
          where: { id: reviewId },
          data: { [col(type)]: { increment: 1 } },
        });
        return;
      }

      if (existing.type === type) {
        // Mesmo voto de novo → desfaz (toggle off).
        await tx.reviewReaction.delete({ where: { id: existing.id } });
        await tx.review.update({
          where: { id: reviewId },
          data: { [col(type)]: { decrement: 1 } },
        });
        return;
      }

      // Troca de voto: decrementa o antigo, incrementa o novo.
      await tx.reviewReaction.update({
        where: { id: existing.id },
        data: { type },
      });
      await tx.review.update({
        where: { id: reviewId },
        data: {
          [col(existing.type as ReactionType)]: { decrement: 1 },
          [col(type)]: { increment: 1 },
        },
      });
    });

    return { ok: true };
  }

  // ===== admin =====

  async listAllForAdmin() {
    const reviews = await this.prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, avatarIndex: true } } },
    });
    return reviews.map(r => ({
      ...this.shape(r),
      published: r.published,
    }));
  }

  async adminReply(id: string, reply: string) {
    const text = (reply ?? '').trim();
    if (!text) throw new BadRequestException('Resposta vazia.');
    if (text.length > REPLY_MAX) throw new BadRequestException('Resposta muito longa.');
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Avaliação não encontrada.');
    return this.prisma.review.update({
      where: { id },
      data: { adminReply: text, adminReplyAt: new Date() },
    });
  }

  async adminRemove(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Avaliação não encontrada.');
    await this.prisma.review.delete({ where: { id } });
    return { ok: true };
  }
}
