import assert from 'node:assert/strict';
import test from 'node:test';
import { HELIOTERM_LIMITS, measureExchange, validateRequest, validateResponse } from '../scripts/firewall.mjs';

test('accepts a compact truthful exchange and measures compression', () => {
  const rawOutput = 'ok\n'.repeat(1000);
  const result = measureExchange({ request: 'T|test|tests/*.test.mjs', response: 'OK|calls=1|9/9 passed', commands: 1, rawOutput });
  assert.equal(result.pass, true);
  assert.equal(result.schemaVersion, 'HELIOTERM_EXCHANGE_V1');
  assert.ok(result.metrics.compressionRatio < 0.02);
  assert.equal(result.metrics.tokenEstimator, 'utf8-bytes-ceil-div4-v1');
  assert.ok(result.metrics.estimatedTokensSaved > 0);
});

test('rejects malformed, oversized, unsupported, and multiline requests', () => {
  assert.equal(validateRequest('test please').pass, false);
  assert.equal(validateRequest('T|write|x').pass, false);
  assert.equal(validateRequest(`T|test|${'x'.repeat(HELIOTERM_LIMITS.maxRequestBytes)}`).pass, false);
  assert.equal(validateRequest('T|test|a\nb').pass, false);
  assert.equal(validateRequest(`T|search|-n ${'HelioTerm|'.repeat(12)} README.md`).pass, true);
});

test('files accepts only one repo-relative directory', () => {
  assert.equal(validateRequest('T|files|tests').pass, true);
  for (const argument of ['', ' ', '/tmp', String.raw`\\server\share`, String.raw`C:\repo`, 'C:repo', '../src', 'src/../other', String.raw`src\..\other`, 'src other', '-hidden']) {
    assert.equal(validateRequest(`T|files|${argument}`).pass, false, argument);
  }
});

test('process accepts only a bounded name, pid, or all query', () => {
  for (const argument of ['node', 'node.exe', '1234', 'all']) {
    assert.equal(validateRequest(`T|process|${argument}`).pass, true, argument);
  }
  for (const argument of ['', 'node extra', '*', '/FI IMAGENAME eq node.exe', '../node']) {
    assert.equal(validateRequest(`T|process|${argument}`).pass, false, argument);
  }
});

test('rejects verbose responses and dishonest or excessive calls', () => {
  assert.equal(validateResponse('passed').pass, false);
  assert.equal(validateResponse(`OK|${'x'.repeat(HELIOTERM_LIMITS.maxResponseBytes)}`).pass, false);
  assert.equal(measureExchange({ request: 'T|test|x', response: 'OK|calls=1|pass', commands: 2 }).pass, false);
  assert.equal(measureExchange({ request: 'T|test|x', response: 'OK|calls=5|pass', commands: 5 }).pass, false);
});
