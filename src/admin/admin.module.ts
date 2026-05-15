import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, RoomsModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
