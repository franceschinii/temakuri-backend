import { Module } from '@nestjs/common';
import { NewsService } from './news.service.js';
import { NewsController } from './news.controller.js';

@Module({
  providers: [NewsService],
  controllers: [NewsController],
  exports: [NewsService],
})
export class NewsModule {}
