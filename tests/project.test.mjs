import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('standalone preflight passes and exposes the active binding', () => {
  const run = spawnSync(process.execPath, ['scripts/preflight.mjs', '--compact'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.pass, true);
  assert.equal(payload.binding.agentType, 'helioterm');
  assert.equal(payload.binding.model, 'gpt-5.6-luna');
  assert.equal(payload.binding.effort, 'high');
});

test('all model-backed standalone terminal roles use Luna high', () => {
  const binding = JSON.parse(readFileSync('model-binding.json', 'utf8'));
  assert.equal(binding.model, 'gpt-5.6-luna');
  assert.equal(binding.effort, 'high');
  for (const roleName of ['helioterm.toml', 'helioterm-mcp.toml']) {
    const role = readFileSync(resolve('agents', roleName), 'utf8');
    assert.match(role, /model = "gpt-5\.6-luna"/u);
    assert.doesNotMatch(role, /gpt-5\.3-codex-spark/u);
  }
});

test('configurator inspects without writes and fails closed on unsafe requests', () => {
  const inspect = spawnSync(process.execPath, ['scripts/configure-model.mjs'], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr || inspect.stdout);
  assert.equal(JSON.parse(inspect.stdout).written, false);
  assert.notEqual(spawnSync(process.execPath, ['scripts/configure-model.mjs', '--model', 'gpt-5.6-luna'], { encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync(process.execPath, ['scripts/configure-model.mjs', '--model', '../bad', '--write'], { encoding: 'utf8' }).status, 0);
});

test('project installer registers a stable local role idempotently', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'helioterm-install-'));
  try {
    const first = spawnSync(process.execPath, ['scripts/install-project.mjs', '--project', directory, '--write'], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(JSON.parse(first.stdout).ready, true);
    const configPath = resolve(directory, '.codex', 'config.toml');
    assert.match(readFileSync(configPath, 'utf8'), /\[agents\.helioterm\]/u);
    assert.equal(existsSync(resolve(directory, '.codex', 'agents', 'helioterm.toml')), true);
    assert.equal(existsSync(resolve(directory, '.codex', 'agents', 'helioterm-mcp.toml')), true);
    const second = spawnSync(process.execPath, ['scripts/install-project.mjs', '--project', directory, '--write'], { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal((readFileSync(configPath, 'utf8').match(/\[agents\.helioterm\]/gu) ?? []).length, 1);
    assert.equal((readFileSync(configPath, 'utf8').match(/\[agents\.helioterm_mcp\]/gu) ?? []).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rollout locator handles metadata lines larger than 16 KiB', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'helioterm-locator-'));
  try {
    const sessions = resolve(directory, 'sessions', '2026', '08', '08');
    mkdirSync(sessions, { recursive: true });
    const path = resolve(sessions, 'rollout.jsonl');
    writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: 'term-long', agent_path: '/root/helioterm', parent_thread_id: 'root-1', padding: 'x'.repeat(20000), source: { subagent: { thread_spawn: { agent_role: 'helioterm' } } } } })}\n`);
    const run = spawnSync(process.execPath, ['scripts/find-rollout.mjs', '--codex-root', directory, '--agent-path', '/root/helioterm', '--role', 'helioterm', '--parent-session-id', 'root-1'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(JSON.parse(run.stdout).matches[0].sessionId, 'term-long');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
