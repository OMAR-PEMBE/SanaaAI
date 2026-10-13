import { Module } from '@nestjs/common';
import { GenerationsModule } from '../generations/generations.module.js';
import { MediaController } from './media.controller.js';

@Module({
  imports: [GenerationsModule],
  controllers: [MediaController],
})
export class MediaModule {}
