import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  providers: [PrismaService, RedisService, QueueService],
  exports: [PrismaService, RedisService, QueueService],
})
export class CoreModule {}
