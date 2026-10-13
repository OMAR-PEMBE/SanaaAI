export type ServiceName = 'api' | 'worker';

export type DependencyStatus = 'ok' | 'error';

export interface HealthData {
  status: 'ok' | 'degraded';
  service: ServiceName;
  postgres: DependencyStatus;
  redis: DependencyStatus;
}

export interface ApiSuccess<T> {
  data: T;
}

export function toHealthData(
  service: ServiceName,
  postgres: DependencyStatus,
  redis: DependencyStatus,
): HealthData {
  const healthy = postgres === 'ok' && redis === 'ok';
  return {
    status: healthy ? 'ok' : 'degraded',
    service,
    postgres,
    redis,
  };
}
