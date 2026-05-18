import { Global, Module } from '@nestjs/common';
import { LogsService } from './logs.service.js';
import { LogsInterceptor } from './logs.interceptor.js';
import { LogsController } from './logs.controller.js';

/// Global para que QUALQUER modulo possa injetar LogsService sem importar
/// explicitamente. O interceptor eh registrado em app.module via APP_INTERCEPTOR
/// para virar global tambem.
@Global()
@Module({
  providers: [LogsService, LogsInterceptor],
  controllers: [LogsController],
  exports: [LogsService, LogsInterceptor],
})
export class LogsModule {}
