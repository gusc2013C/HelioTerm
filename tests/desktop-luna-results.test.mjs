import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Desktop-native Luna evidence is archived, CLI-free, and arithmetically consistent', () => {
  const report = JSON.parse(readFileSync('benchmarks/results/desktop-luna-native-2026-08-08.json', 'utf8'));
  assert.equal(report.transport, 'codex-desktop-native-thread-tools');
  assert.equal(report.model, 'gpt-5.6-luna');
  assert.equal(report.defaultEffort, 'high');
  assert.deepEqual(report.effortsTested, ['low', 'high', 'xhigh']);
  assert.equal(report.archived, true);
  assert.equal(report.cliProcessStarted, false);
  assert.equal(report.tokenUsageAvailableFromDesktopTools, false);
  const first = report.turns[0].durationMilliseconds;
  const fastestReused = Math.min(...report.turns.slice(1, 3).map((turn) => turn.durationMilliseconds));
  const reduction = Number((((first - fastestReused) / first) * 100).toFixed(2));
  assert.equal(fastestReused, report.observations.fastestReusedTurnMilliseconds);
  assert.equal(reduction, report.observations.firstToFastestReusedLatencyReductionPercent);
});
