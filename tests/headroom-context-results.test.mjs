import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Headroom whole-context benchmark is private, reproducible, and preserves critical structure', () => {
  const report = JSON.parse(readFileSync('benchmarks/results/0.4.0-headroom-context.json', 'utf8'));
  assert.equal(report.schema, 'HELIOTERM_HEADROOM_CONTEXT_BENCHMARK_V1');
  assert.equal(report.pass, true);
  assert.equal(report.syntheticContextOnly, true);
  assert.equal(report.rawContextRetained, false);
  assert.equal(report.externalModelCalls, 0);
  assert.equal(report.scenarios.length, 4);
  assert.ok(report.aggregate.tokenReductionPercent > 40);
  assert.equal(report.aggregate.criticalFactRetentionPercent, 100);
  assert.equal(report.incrementalPrefix.stablePrefixPercent, 100);
  for (const scenario of report.scenarios) {
    assert.ok(scenario.tokensAfter <= scenario.tokensBefore);
    assert.ok(scenario.tokensAfter <= scenario.modelLimit);
    assert.equal(scenario.visibleMarkers, scenario.totalMarkers);
    assert.equal(scenario.protectedSystemAndUserExact, true);
    assert.equal(scenario.toolCallLinksValid, true);
  }
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /"messages"\s*:/u);
  assert.doesNotMatch(serialized, /"content"\s*:/u);
  assert.doesNotMatch(serialized, /"evidence"\s*:/u);
});
