import { PrismaClient } from '@prisma/client';

export function createPrismaClient(datasourceUrl?: string): PrismaClient {
  return new PrismaClient(
    datasourceUrl
      ? { datasources: { db: { url: datasourceUrl } } }
      : undefined,
  );
}
