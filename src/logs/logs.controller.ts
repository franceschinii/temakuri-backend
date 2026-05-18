import { Controller, Get, Query, UseGuards, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { LogCategory, LogLevel, LogsService } from './logs.service.js';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  list(
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('level') level?: string,
    @Query('userId') userId?: string,
    @Query('username') username?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.list({
      category: (category as LogCategory) || undefined,
      action: action || undefined,
      level: (level as LogLevel) || undefined,
      userId: userId || undefined,
      username: username || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      cursor: cursor || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('stats')
  stats(@Query('hours') hours?: string) {
    return this.logs.stats(hours ? parseInt(hours, 10) : 24);
  }

  @Delete('purge')
  @HttpCode(HttpStatus.OK)
  purge(@Query('days') days?: string) {
    const d = days ? parseInt(days, 10) : 90;
    return this.logs.purgeOlderThan(d).then(count => ({ purged: count, days: d }));
  }
}
