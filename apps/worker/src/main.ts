import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { startWorkers } from './workers.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port);
  const workers = await startWorkers();
  const shutdown = async () => {
    await workers.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
await bootstrap();
