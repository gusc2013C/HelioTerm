import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { aggregateRolloutMetrics, analyzeRollout, projectBatchSavings } from '../scripts/rollout-metrics.mjs';

test('rollout metrics count sampling and tool round trips without retaining content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-rollout-'));
  const path = join(root, 'rollout-test.jsonl');
  const records = [
    { timestamp: '2026-08-10T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 }, last_token_usage: { input_tokens: 100 } }, rate_limits: { primary: { used_percent: 2 } } } },
    { timestamp: '2026-08-10T00:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'private prompt' } },
    { timestamp: '2026-08-10T00:00:02Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: "await tools.mcp__helioterm__observe({cwd:'x'});" } },
    { timestamp: '2026-08-10T00:00:02.500Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: "await tools.exec_command({cmd:'ht -C x -e 4096 -n git status'});" } },
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
    assert.equal(report.sampling.observed_input_tokens, 240);
    assert.equal(report.sampling.user_messages, 1);
    assert.equal(report.tools.exec_wrappers, 2);
    assert.equal(report.tools.helioterm_observe_wrappers, 1);
    assert.equal(report.tools.helioterm_single_wrappers, 2);
    assert.equal(report.tools.batch_eligible_single_wrappers, 2);
    assert.equal(report.tools.ht_cli_wrappers, 1);
    assert.deepEqual(report.tools.ht_cli_operations, { git: 1 });
    assert.equal(report.tools.one_nested_wrapper_percent, 100);
    assert.equal(report.tools.single_nested_wrappers, 2);
    assert.equal(report.rate_limit.current_used_percent, 3);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /private prompt|private output/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rollout aggregate projects only complete four-call groups without billing claims', () => {
  const projected = projectBatchSavings({ eligibleWrappers: 361, averageInputTokens: 127963, adoptionPercent: 25 });
  assert.deepEqual(projected, {
    adoption_percent: 25,
    grouped_wrappers: 88,
    batch_calls: 22,
    eliminated_sampling_requests: 66,
    raw_context_tokens_avoided: 8_445_558,
    scope: 'counterfactual raw context; provider billing not inferred',
  });
  const base = {
    firstTimestamp: 10, lastTimestamp: 20,
    tokens: { input_tokens: 100, cached_input_tokens: 80, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 },
    sampling: { samples: 2, observed_input_tokens: 100, user_messages: 1 },
    tools: { exec_wrappers: 4, single_nested_wrappers: 4, helioterm_single_wrappers: 4, batch_eligible_single_wrappers: 4, exec_input_bytes: 20, tool_output_bytes: 40, nested_calls_per_wrapper: { 1: 4 }, nested_tools: { mcp__helioterm__observe: 4 }, ht_cli_operations: {} },
  };
  const aggregate = aggregateRolloutMetrics([base, { ...base, firstTimestamp: 5, lastTimestamp: 30 }]);
  assert.equal(aggregate.rollouts, 2);
  assert.equal(aggregate.tokens.input_tokens, 200);
  assert.equal(aggregate.sampling.average_input_tokens, 50);
  assert.equal(aggregate.tools.helioterm_single_wrappers, 8);
  assert.equal(aggregate.tools.batch_eligible_single_wrappers, 8);
  assert.equal(aggregate.batch_projection[2].eliminated_sampling_requests, 6);
  assert.equal(aggregate.batch_projection[2].raw_context_tokens_avoided, 300);
  assert.match(aggregate.scope, /content not retained/u);

  const emptyWindow = aggregateRolloutMetrics([{ ...base, firstTimestamp: null, lastTimestamp: null }]);
  assert.equal(emptyWindow.firstTimestamp, null);
  assert.equal(emptyWindow.lastTimestamp, null);
});
