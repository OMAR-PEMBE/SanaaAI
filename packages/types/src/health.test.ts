import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toHealthData } from './health.ts';

describe('toHealthData', () => {
  it('is ok only when postgres and redis are both ok', () => {
    const health = toHealthData('api', 'ok', 'ok');
    assert.equal(health.status, 'ok');
    assert.equal(health.service, 'api');
    assert.equal(health.postgres, 'ok');
    assert.equal(health.redis, 'ok');
  });

  it('is degraded when either dependency fails', () => {
    assert.equal(toHealthData('worker', 'error', 'ok').status, 'degraded');
    assert.equal(toHealthData('worker', 'ok', 'error').status, 'degraded');
    assert.equal(toHealthData('api', 'error', 'error').status, 'degraded');
  });
});
