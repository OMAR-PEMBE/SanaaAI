import { Module } from '@nestjs/common';
import { GenerationsModule } from '../generations/generations.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [GenerationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
