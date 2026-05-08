import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsGateway } from './notifications.gateway.js';
import { RoomManager } from '../game/room-manager.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [JwtModule.register({}), RoomsModule],
  providers: [NotificationsGateway, RoomManager],
})
export class NotificationsModule {}
