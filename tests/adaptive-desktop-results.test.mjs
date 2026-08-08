import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('adaptive Desktop Luna acceptance proves reuse, validation, and archival', () => {
  const report = JSON.parse(readFileSync('benchmarks/results/adaptive-desktop-luna-2026-08-09.json', 'utf8'));
  assert.equal(report.schemaVersion, 'HELIOTERM_ADAPTIVE_DESKTOP_LUNA_V1');
  assert.equal(report.mcpProjectionProbe.newToolsProjectedBeforeDesktopRestart, false);
  assert.equal(report.mcpProjectionProbe.archived, true);
  assert.equal(report.reuseAcceptance.model, 'gpt-5.6-luna');
  assert.equal(report.reuseAcceptance.effort, 'high');
  assert.equal(report.reuseAcceptance.codexCliModelProcessStarted, false);
  assert.equal(report.reuseAcceptance.archived, true);
  assert.equal(report.reuseAcceptance.turns.length, 2);
  assert.equal(report.reuseAcceptance.turns.every((turn) => turn.accepted), true);
  const [first, reused] = report.reuseAcceptance.turns;
  assert.equal(Number((((first.durationMilliseconds - reused.durationMilliseconds) / first.durationMilliseconds) * 100).toFixed(2)), report.observations.reuseLatencyReductionPercent);
  const rawBytes = report.reuseAcceptance.turns.reduce((sum, turn) => sum + turn.rawBytes, 0);
  const solBytes = report.reuseAcceptance.turns.reduce((sum, turn) => sum + turn.routeBytes + turn.finalBytes, 0);
  assert.equal(rawBytes, report.observations.rawFallbackBytes);
  assert.equal(solBytes, report.observations.solVisibleRouteAndFinalBytes);
  assert.equal(Number(((1 - (solBytes / rawBytes)) * 100).toFixed(2)), report.observations.solVisibleByteReductionVersusRawFallbackPercent);
});
