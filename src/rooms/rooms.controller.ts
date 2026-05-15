import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RoomsService } from './rooms.service.js';
import { CreateRoomDto } from './dto/room.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

@ApiTags('Rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'List public waiting rooms' })
  findAll(@Query('mode') mode?: string, @Query('status') status?: string) {
    return this.roomsService.findAll(mode, status);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get room by code' })
  findOne(@Param('code') code: string) {
    return this.roomsService.findByCode(code);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a room' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(userId, dto);
  }

  @Post(':code/bots')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a bot to the room (host only)' })
  addBot(
    @CurrentUser('id') userId: string,
    @Param('code') code: string,
    @Body() body?: { difficulty?: 'easy' | 'medium' | 'hard' },
  ) {
    return this.roomsService.addBot(code, userId, body?.difficulty);
  }

  @Delete(':code/bots/:botId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a bot from the room (host only)' })
  removeBot(
    @CurrentUser('id') userId: string,
    @Param('code') code: string,
    @Param('botId') botId: string,
  ) {
    return this.roomsService.removeBot(code, userId, botId);
  }

  @Post(':code/reset')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset room to WAITING state for a new game (host only)' })
  resetRoom(@CurrentUser('id') userId: string, @Param('code') code: string) {
    return this.roomsService.resetRoom(code, userId);
  }
}
