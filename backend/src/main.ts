import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // strip unknown properties (mass-assignment guard)
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: true });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on :${port}`, 'Bootstrap');
}
bootstrap();
