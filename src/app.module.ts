import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { LogsModule } from './logs/logs.module.js';
import { LogsInterceptor } from './logs/logs.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { RoomsModule } from './rooms/rooms.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ShopModule } from './shop/shop.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { ChangelogModule } from './changelog/changelog.module.js';
import { NewsModule } from './news/news.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    LogsModule,
    AuthModule,
    RoomsModule,
    ProfileModule,
    NotificationsModule,
    AdminModule,
    ShopModule,
    MatchmakingModule,
    PaymentsModule,
    CouponsModule,
    ChangelogModule,
    NewsModule,
    ReviewsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LogsInterceptor },
  ],
})
export class AppModule {}
