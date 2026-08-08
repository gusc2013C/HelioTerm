import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRows } from '../scripts/inspect-proof.mjs';

const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ text }] } });
function rows() {
  return [
    { type: 'session_meta', payload: { id: 'term-1', agent_path: '/root/helioterm', parent_thread_id: 'root-1', originator: 'Codex Desktop', multi_agent_version: 'v2', source: { subagent: { thread_spawn: { agent_role: 'helioterm', parent_thread_id: 'root-1' } } } } },
    { type: 'turn_context', payload: { model: 'gpt-5.3-codex-spark', effort: 'medium', multi_agent_version: 'v2' } },
    message('assistant', 'HELIOTERM_ROLE_APPLIED'),
    message('user', 'T|test|tests/*.test.mjs'),
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'node --test tests/*.test.mjs' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'ok\n'.repeat(100) } },
    message('assistant', 'OK|calls=1|9/9 passed'),
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1234 } } } },
  ];
}

test('proves role, model, effort, V2, leaf state, exact command, and budgets', () => {
  const result = inspectRows(rows(), { expectedParent: 'root-1' });
  assert.equal(result.pass, true);
  assert.equal(result.actual.toolCallCount, 1);
  assert.equal(result.actual.markerSeen, true);
});

test('rejects a model fallback and a discovery command', () => {
  const fallback = rows();
  fallback[1].payload.model = 'gpt-5.6-terra';
  assert.equal(inspectRows(fallback).pass, false);
  const discovery = rows();
  discovery[4].payload.arguments = JSON.stringify({ cmd: 'npm run test' });
  assert.equal(inspectRows(discovery).pass, false);
});

test('supports another explicitly bound Codex model without weakening proof', () => {
  const alternate = rows();
  alternate[1].payload.model = 'gpt-5.6-luna';
  alternate[1].payload.effort = 'high';
  assert.equal(inspectRows(alternate, { expectedModel: 'gpt-5.6-luna', expectedEffort: 'high' }).pass, true);
  assert.equal(inspectRows(alternate, { expectedModel: 'gpt-5.6-sol', expectedEffort: 'high' }).pass, false);
});

test('proves MCP transport without treating compact tool output as raw output', () => {
  const mcp = rows();
  const compact = 'OK|calls=1|exit=0|pass=3|fail=0|raw=400';
  mcp[4].payload.name = 'mcp__helioterm__run';
  mcp[4].payload.arguments = JSON.stringify({ operation: 'test', argument: 'tests/*.test.mjs', cwd: 'D:/project' });
  mcp[5].payload.output = compact;
  mcp[6] = message('assistant', compact);
  const result = inspectRows(mcp, { expectedTransport: 'mcp' });
  assert.equal(result.pass, true);
  assert.equal(result.exchanges[0].metrics.rawOutputBytes, 400);
  assert.deepEqual(result.exchanges[0].commandLines, ['mcp:test|tests/*.test.mjs']);
});
