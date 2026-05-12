import { Controller, Get, Patch, Body, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProfileService } from './profile.service.js';
import { UpdateProfileDto } from './dto/profile.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my profile with stats' })
  getMyProfile(@CurrentUser('id') userId: string) {
    return this.profileService.getProfile(userId);
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update my profile' })
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(userId, dto);
  }

  @Get('check-username')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if username is available' })
  async checkUsername(@Query('username') username: string) {
    const taken = await this.profileService.isUsernameTaken(username);
    if (taken) throw new NotFoundException('Username taken');
    return { available: true };
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get top 100 leaderboard' })
  getLeaderboard() {
    return this.profileService.getLeaderboard();
  }

  @Get('leaderboard/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my leaderboard rank' })
  getMyLeaderboardRank(@CurrentUser('id') userId: string) {
    return this.profileService.getLeaderboardRankForUser(userId);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get public profile' })
  getPublicProfile(@Param('userId') userId: string) {
    return this.profileService.getPublicProfile(userId);
  }
}
