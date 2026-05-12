import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RoomsModule } from './rooms/rooms.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ShopModule } from './shop/shop.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    RoomsModule,
    ProfileModule,
    NotificationsModule,
    AdminModule,
    ShopModule,
    MatchmakingModule,
  ],
})
export class AppModule {}
