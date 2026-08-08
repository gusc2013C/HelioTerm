import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runDirect, runDirectBatch } from '../scripts/direct-runner.mjs';

test('direct runner executes a batched test request without a model or MCP', async () => {
  const result = await runDirect({ request: 'T|test|tests/firewall.test.mjs tests/mcp-server.test.mjs', cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=1\|exit=0\|(?:pass=\d+\|fail=0|lines=\d+)\|raw=\d+\|ms=\d+\|model=0$/u);
  assert.equal(result.command.file, process.execPath);
});

test('direct runner CLI emits exactly one compact line', () => {
  const run = spawnSync(process.execPath, ['scripts/direct-runner.mjs', '--request', 'T|test|tests/firewall.test.mjs', '--cwd', process.cwd()], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.trim().split(/\r?\n/u).length, 1);
  assert.match(run.stdout.trim(), /\|model=0$/u);
});

test('direct runner batches different observations into one process result', async () => {
  const result = await runDirectBatch({
    requests: ['T|test|tests/firewall.test.mjs', 'T|git|status --short', 'T|git|rev-parse HEAD'],
    cwd: process.cwd(),
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=3\|ok=3\|opfail=0\|pass=\d+\|testfail=0\|raw=\d+\|ms=\d+\|model=0$/u);
  assert.equal(result.commands.length, 3);
});

test('direct runner validates a whole batch before executing anything', async () => {
  const result = await runDirectBatch({ requests: ['T|git|status --short', 'T|git|reset --hard'], cwd: process.cwd() });
  assert.equal(result.pass, false);
  assert.equal(result.text, 'FAIL|calls=0|runner-error|model=0');
  assert.deepEqual(result.commands, []);
});

test('direct runner fails closed before execution for an invalid request', async () => {
  const result = await runDirect({ request: 'please test everything', cwd: process.cwd() });
  assert.equal(result.pass, false);
  assert.equal(result.text, 'FAIL|calls=0|request-invalid|model=0');
});

test('direct runner rejects a mutating git operation before execution', async () => {
  const result = await runDirect({ request: 'T|git|reset --hard', cwd: process.cwd() });
  assert.equal(result.pass, false);
  assert.equal(result.text, 'FAIL|calls=0|runner-error|model=0');
});
