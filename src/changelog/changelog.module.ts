import { Module } from '@nestjs/common';
import { ChangelogService } from './changelog.service.js';
import { ChangelogController } from './changelog.controller.js';

@Module({
  providers: [ChangelogService],
  controllers: [ChangelogController],
  exports: [ChangelogService],
})
export class ChangelogModule {}
