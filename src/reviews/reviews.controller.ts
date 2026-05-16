import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  /** Publico — lista de avaliacoes para o card do lobby. */
  @Get('reviews')
  listPublic() {
    return this.service.listPublic();
  }

  /** Estado do usuario logado: sua review + reacoes + se pode avaliar. */
  @UseGuards(JwtAuthGuard)
  @Get('reviews/me')
  getMyState(@CurrentUser('id') userId: string) {
    return this.service.getMyState(userId);
  }

  /** Cria ou edita a unica avaliacao do usuario. */
  @UseGuards(JwtAuthGuard)
  @Post('reviews')
  upsert(
    @CurrentUser('id') userId: string,
    @Body() body: { rating: number; title: string; comment: string },
  ) {
    return this.service.upsertMine(userId, body);
  }

  /** Reage (util/nao-util) a uma avaliacao de outro usuario. */
  @UseGuards(JwtAuthGuard)
  @Post('reviews/:id/react')
  react(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { type: 'helpful' | 'not_helpful' },
  ) {
    return this.service.react(id, userId, body.type);
  }

  // ===== admin =====

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/reviews')
  listAll() {
    return this.service.listAllForAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/reviews/:id/reply')
  reply(@Param('id') id: string, @Body() body: { reply: string }) {
    return this.service.adminReply(id, body.reply);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/reviews/:id')
  remove(@Param('id') id: string) {
    return this.service.adminRemove(id);
  }
}
