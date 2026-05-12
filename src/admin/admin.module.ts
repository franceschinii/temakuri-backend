import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';

@Module({
  imports: [AuthModule, RoomsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
