import { Module } from '@nestjs/common';
import { ExploreController } from './explore.controller.js';

@Module({ controllers: [ExploreController] })
export class ExploreModule {}
