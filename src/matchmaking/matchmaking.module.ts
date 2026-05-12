import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';
import { MatchmakingGateway } from './matchmaking.gateway.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [RoomsModule],
  providers: [MatchmakingService, MatchmakingGateway],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
