import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { NewsService } from './news.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

@Controller()
export class NewsController {
  constructor(private readonly service: NewsService) {}

  /** Publico, sem auth — consumido pelo NewsCard do lobby. */
  @Get('news')
  listPublic() {
    return this.service.listPublic();
  }

  // ===== admin =====

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/news')
  listAll() {
    return this.service.listAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/news')
  create(@Body() body: {
    date: string;
    pinned?: boolean;
    title: string;
    summary: string;
    body: string;
    published?: boolean;
  }) {
    return this.service.create(body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/news/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/news/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
