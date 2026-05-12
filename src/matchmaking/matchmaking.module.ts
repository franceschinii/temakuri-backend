import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';
import { MatchmakingGateway } from './matchmaking.gateway.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [RoomsModule, PrismaModule],
  providers: [MatchmakingService, MatchmakingGateway],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
