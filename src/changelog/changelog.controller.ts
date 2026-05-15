import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ChangelogService } from './changelog.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

@Controller()
export class ChangelogController {
  constructor(private readonly service: ChangelogService) {}

  /** Publico, sem auth — consumido pelo ChangelogCard e tela completa. */
  @Get('changelog')
  listPublic() {
    return this.service.listPublic();
  }

  // ===== admin =====

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/changelog')
  listAll() {
    return this.service.listAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/changelog')
  create(@Body() body: {
    date: string;
    version: string;
    title: string;
    category: string;
    highlights: string[];
    details: string;
    published?: boolean;
  }) {
    return this.service.create(body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/changelog/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/changelog/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
