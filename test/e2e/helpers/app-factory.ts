import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from '../../../src/app.module.js';
import { AddressInfo } from 'net';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

export interface ListeningTestApp {
  app: INestApplication;
  port: number;
  wsUrl: string;
}

/**
 * Bootstrapa o Nest e faz `listen(0)` para bindar em port aleatório.
 * Necessário para clientes WS de teste se conectarem.
 */
export async function createListeningTestApp(): Promise<ListeningTestApp> {
  const app = await createTestApp();
  await app.listen(0);
  const server = app.getHttpServer();
  const addr = server.address() as AddressInfo;
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to get listening address');
  }
  const port = addr.port;
  return {
    app,
    port,
    wsUrl: `ws://localhost:${port}/ws`,
  };
}
