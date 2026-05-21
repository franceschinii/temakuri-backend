import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // rawBody=true preservado por defesa. Mercado Pago usa HMAC sobre
  // headers + data.id, nao sobre o body, entao tecnicamente nao depende
  // disso — mas mantemos pra evitar regressao caso o provider mude.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Atras de nginx/proxy reverso. Sem isso req.ip retorna o IP do hop
  // (rede docker, ex: ::ffff:10.0.1.11) em vez do cliente real do
  // X-Forwarded-For. Confiamos em 1 hop (o nginx).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / server-to-server
      const ok =
        allowedOrigins.some(o => origin === o) ||
        /^http:\/\/localhost:\d+$/.test(origin);
      cb(ok ? null : new Error('Not allowed by CORS'), ok);
    },
    credentials: true,
  });

  app.useWebSocketAdapter(new WsAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Temakuri API')
    .setDescription('Temakuri card game — REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Temakuri backend running on http://localhost:${port}`);
  console.log(`API docs at http://localhost:${port}/docs`);
}

bootstrap();
