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

test('preflight fails closed when required terminal dependencies are unavailable', () => {
  const run = spawnSync(process.execPath, ['scripts/preflight.mjs', '--compact'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(run.status, 1, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failedChecks.filter((name) => name.endsWith('-available')).sort(), ['git-available', 'ripgrep-available']);
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

test('ordinary codex delegation is never mistaken for a temporary Luna leaf', () => {
  const skill = readFileSync('skills/helioterm/SKILL.md', 'utf8');
  assert.match(skill, /exact marker `<helioterm_luna_leaf ticket=/u);
  assert.match(skill, /Never treat `source_thread_id` as a ticket/u);
  const isLeaf = (input) => /<helioterm_luna_leaf ticket="[A-Za-z0-9_-]{16}">/u.test(input)
    && /temporary HelioTerm semantic compressor/u.test(input);
  const ordinaryDelegation = '<codex_delegation><source_thread_id>019fc3c5-da37-7a13-8f79-d04107843fff</source_thread_id><input>You are the HelioTerm 0.3.1 engineering owner.</input></codex_delegation>';
  assert.equal(isLeaf(ordinaryDelegation), false);
  assert.equal(isLeaf('<helioterm_luna_leaf ticket="AbCdEf0123_-xyZ9"> This task is the temporary HelioTerm semantic compressor.'), true);
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

test('bootstrap previews Codex writes and performs isolated project setup with explicit write mode', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'helioterm-bootstrap-'));
  const script = resolve('scripts/bootstrap-install.mjs');
  try {
    const preview = spawnSync(process.execPath, [script, '--project', directory, '--compact'], { encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const previewPayload = JSON.parse(preview.stdout);
    assert.equal(previewPayload.written, false);
    assert.equal(previewPayload.commands.some(({ name }) => name === 'marketplace'), true);
    assert.equal(existsSync(resolve(directory, '.codex')), false);

    const typo = spawnSync(process.execPath, [script, '--project', directory, '--skip-codez', '--write', '--compact'], { encoding: 'utf8' });
    assert.notEqual(typo.status, 0);
    assert.equal(existsSync(resolve(directory, '.codex')), false);

    const written = spawnSync(process.execPath, [script, '--project', directory, '--skip-codex', '--write', '--compact'], { encoding: 'utf8' });
    assert.equal(written.status, 0, written.stderr || written.stdout);
    const payload = JSON.parse(written.stdout);
    assert.equal(payload.written, true);
    assert.equal(payload.codexHome, null);
    assert.equal(existsSync(resolve(directory, '.codex', 'agents', 'helioterm.toml')), true);
    assert.equal(existsSync(resolve(directory, '.codex', 'agents', 'helioterm-mcp.toml')), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release packager validates the extracted ZIP and isolated bootstrap output', () => {
  const packaging = readFileSync('scripts/package-release.ps1', 'utf8');
  assert.match(packaging, /git .* archive/u);
  assert.match(packaging, /Expand-Archive/u);
  assert.match(packaging, /scripts\\preflight\.mjs/u);
  assert.match(packaging, /bootstrap-install\.mjs/u);
  assert.match(packaging, /--skip-codex --write --compact/u);
  assert.match(packaging, /Get-FileHash/u);
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
