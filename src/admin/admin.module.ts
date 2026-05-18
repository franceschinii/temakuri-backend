import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { DashboardService } from './dashboard.service.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, RoomsModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, DashboardService, AdminGuard],
})
export class AdminModule {}
