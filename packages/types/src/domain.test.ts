import assert from 'node:assert/strict';
import test from 'node:test';
import { failureMessageFor, toPublicGenerationStatus } from './domain.ts';

test('needs_reconciliation is shown as processing', () => {
  assert.equal(toPublicGenerationStatus('needs_reconciliation'), 'processing');
  assert.equal(toPublicGenerationStatus('submitted'), 'submitted');
});

test('failure copy never includes a provider name', () => {
  for (const reason of ['policy', 'endpoint_not_configured', 'missing_credentials', 'provider exploded']) {
    const message = failureMessageFor(reason);
    assert.equal(message.toLowerCase().includes('higgsfield'), false);
    assert.equal(message.toLowerCase().includes('kling'), false);
    assert.equal(message.toLowerCase().includes('soul'), false);
  }
});
