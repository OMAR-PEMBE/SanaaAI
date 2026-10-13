import { RequestMethod, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/http.js';

export function configureApp(app: INestApplication): void {
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.some((origin) => origin === '*')) {
    throw new Error('CORS_ALLOWED_ORIGINS must list explicit origins.');
  }
  app.enableCors({ origin: origins });
  app.use(helmet());
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
