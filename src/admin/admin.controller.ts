import {
  Controller, Get, Patch, Post, Delete,
  Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { AdminService } from './admin.service.js';
import { UpdateUserDto, ResetPasswordDto, UpdateStatsDto, ModerationDto } from './dto/admin.dto.js';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  @Get('users/:id')
  findUser(@Param('id') id: string) {
    return this.adminService.findUser(id);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Patch('users/:id/moderation')
  moderateUser(@Param('id') id: string, @Body() dto: ModerationDto) {
    return this.adminService.moderateUser(id, dto);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetUserPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.adminService.resetUserPassword(id, dto);
  }

  @Patch('users/:id/stats')
  updateUserStats(@Param('id') id: string, @Body() dto: UpdateStatsDto) {
    return this.adminService.updateUserStats(id, dto);
  }
}
