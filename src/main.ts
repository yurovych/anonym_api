import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import process from "node:process";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = process.env.NODE_ENV === 'prod'
      ? ['https://enonym.com']
      : ['http://localhost:3000']

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`Server running on port ${port}`);
}
bootstrap().catch((err) => {
  console.error('Помилка при запуску програми:', err);
  process.exit(1);
});
