import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeRollout } from '../scripts/rollout-metrics.mjs';

test('rollout metrics count sampling and tool round trips without retaining content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-rollout-'));
  const path = join(root, 'rollout-test.jsonl');
  const records = [
    { timestamp: '2026-08-10T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 }, last_token_usage: { input_tokens: 100 } }, rate_limits: { primary: { used_percent: 2 } } } },
    { timestamp: '2026-08-10T00:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'private prompt' } },
    { timestamp: '2026-08-10T00:00:02Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: "await tools.mcp__helioterm__observe({cwd:'x'});" } },
    { timestamp: '2026-08-10T00:00:03Z', type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'private output' } },
    { timestamp: '2026-08-10T00:00:04Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 340, cached_input_tokens: 300, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 360 }, last_token_usage: { input_tokens: 240 } }, rate_limits: { primary: { used_percent: 3 } } } },
  ];
  writeFileSync(path, `${records.map(JSON.stringify).join('\n')}\n`);
  try {
    const report = await analyzeRollout(path, { sinceMs: Date.parse('2026-08-10T00:00:01Z') });
    assert.equal(report.tokens.input_tokens, 240);
    assert.equal(report.tokens.cached_input_tokens, 220);
    assert.equal(report.tokens.uncached_input_tokens, 20);
    assert.equal(report.sampling.samples, 1);
    assert.equal(report.sampling.user_messages, 1);
    assert.equal(report.tools.exec_wrappers, 1);
    assert.equal(report.tools.helioterm_observe_wrappers, 1);
    assert.equal(report.tools.helioterm_single_wrappers, 1);
    assert.equal(report.tools.one_nested_wrapper_percent, 100);
    assert.equal(report.rate_limit.current_used_percent, 3);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /private prompt|private output/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
