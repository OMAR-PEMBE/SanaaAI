import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { ExploreModule } from './explore/explore.module.js';
import { GenerationsModule } from './generations/generations.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { MediaModule } from './media/media.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { WalletModule } from './wallet/wallet.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    PaymentsModule,
    GenerationsModule,
    WalletModule,
    ExploreModule,
    AdminModule,
    MediaModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
