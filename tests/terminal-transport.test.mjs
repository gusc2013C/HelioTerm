import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cancelBackgroundJob, JOB_DIRECTORY, readBackgroundJob, removeBackgroundJob, startBackgroundTerminalJob, waitBackgroundJob } from '../scripts/job-manager.mjs';
import { runTerminalDirect } from '../scripts/terminal-runner.mjs';
import { runTerminalCommand, terminalCommandFor, TERMINAL_LIMITS } from '../scripts/terminal-transport.mjs';

test('universal terminal validates direct and explicit shell forms', () => {
  const direct = terminalCommandFor({ program: 'node', args: ['--version'] });
  assert.equal(direct.file, 'node');
  assert.deepEqual(direct.args, ['--version']);
  assert.equal(direct.terminalKind, 'direct');

  const shell = terminalCommandFor({ shell: 'default', script: 'echo ok' });
  assert.match(shell.terminalKind, /^shell:/u);
  assert.throws(() => terminalCommandFor({ program: 'node', shell: 'default', script: 'echo no' }), /either program/u);
  assert.throws(() => terminalCommandFor({ program: 'bad\nname' }), /one line/u);
  assert.throws(() => terminalCommandFor({ program: 'node', args: Array(TERMINAL_LIMITS.maxArguments + 1).fill('x') }), /at most/u);
  assert.throws(() => terminalCommandFor({ program: 'node', env: { 'BAD-NAME': 'x' } }), /environment name/u);
  assert.throws(() => terminalCommandFor({ program: 'node', env: { helioterm_windows_shim_spec_v1: 'x' } }), /reserved/u);
});

test('universal terminal carries environment and one-shot stdin without a shell', async () => {
  const result = await runTerminalCommand({
    terminal: {
      program: process.execPath,
      args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',v=>console.log(process.env.HELIO_VALUE+':'+v.toUpperCase()))"],
      env: { HELIO_VALUE: 'env' },
      stdin: 'input',
    },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
    responseMode: 'evidence',
    maxBytes: 4096,
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /env:INPUT/u);
  assert.equal(result.modelPolls, 0);
});

test('universal terminal deliberately supports project mutations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-universal-mutation-'));
  try {
    const result = await runTerminalDirect({
      terminal: {
        program: process.execPath,
        args: ['-e', "require('node:fs').writeFileSync('artifact.txt','owned')"],
      },
      cwd: root,
      timeoutMilliseconds: 5000,
    });
    assert.match(result.text, /^OK\|calls=1/u);
    assert.equal(readFileSync(join(root, 'artifact.txt'), 'utf8'), 'owned');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit shell mode takes over pipelines and returns bounded evidence', async () => {
  const terminal = process.platform === 'win32'
    ? { shell: 'powershell', script: "Write-Output alpha; Write-Output beta | Select-String beta" }
    : { shell: 'sh', script: "printf 'alpha\\nbeta\\n' | grep beta" };
  const result = await runTerminalCommand({
    terminal,
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
    responseMode: 'evidence',
    maxBytes: 4096,
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /beta/u);
  assert.match(result.text, /operation=terminal/u);
});

test('direct universal runner preserves model proof and generic test facts', async () => {
  const result = await runTerminalDirect({
    terminal: { program: process.execPath, args: ['--test', 'tests/firewall.test.mjs'] },
    cwd: process.cwd(),
    timeoutMilliseconds: 10000,
    adaptive: false,
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /^OK\|calls=1\|pass=\d+\|fail=0/u);
  assert.match(result.text, /\|model=0$/u);
  assert.equal(result.text.includes('more=1'), false);
});

test('compact terminal output trusts a top-level JSON check over nested test prose', async () => {
  const result = await runTerminalDirect({
    terminal: {
      program: process.execPath,
      args: ['-e', "console.log(JSON.stringify({pass:true,evidence:'38 passed and 2 failed'}))"],
    },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
    adaptive: false,
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=1\|check=pass\|failed=0\|raw=\d+\|ms=\d+\|model=0$/u);
});

test('terminal runner CLI compresses arbitrary program output', () => {
  const run = spawnSync(process.execPath, [
    'scripts/terminal-runner.mjs', '--cwd', process.cwd(), '--program', process.execPath,
    '--arg', '-e', '--arg', "console.log('cli-ok')", '--no-adaptive',
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout.trim(), /^OK\|calls=1/u);
  assert.match(run.stdout.trim(), /\|model=0$/u);
});

test('terminal runner delimiter prevents child flags from colliding with HelioTerm flags', () => {
  const run = spawnSync(process.execPath, [
    'scripts/terminal-runner.mjs', '--cwd', process.cwd(), '--program', process.execPath, '--no-adaptive', '--',
    '-e', "console.log(process.argv.slice(1).join(','))", '--', '--evidence-bytes', '32768', '--semantic',
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /sample=--evidence-bytes,32768,--semantic/u);
  assert.equal(run.stdout.includes('terminal-error='), false);
});

test('terminal runner rejects malformed base64url stdin before child execution', () => {
  const run = spawnSync(process.execPath, [
    'scripts/terminal-runner.mjs', '--cwd', process.cwd(), '--program', process.execPath,
    '--stdin-base64url', '%invalid', '--no-adaptive', '--', '-e', "console.log('must-not-run')",
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /terminal-error=--stdin-base64url must be valid base64url/u);
  assert.equal(run.stdout.includes('must-not-run'), false);
});

test('Windows command shims retry through a fixed non-injectable wrapper', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-windows-shim-'));
  try {
    writeFileSync(join(root, 'helioterm-shim.cmd'), '@echo off\r\necho shim-ok:%1:%~2:%3\r\n', 'utf8');
    const result = await runTerminalDirect({
      terminal: {
        program: 'helioterm-shim',
        args: ['argument', 'two words', '--flag'],
        env: { PATH: `${root};${process.env.PATH}` },
      },
      cwd: root,
      timeoutMilliseconds: 5000,
      adaptive: false,
    });
    assert.equal(result.pass, true, result.text);
    assert.equal(result.windowsShimRetry, true);
    assert.match(result.text, /shim=windows/u);
    assert.match(result.text, /sample=shim-ok:argument:two words:--flag/u);
    assert.equal(result.command.terminalKind, 'direct:windows-shim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('child output that mentions a spawn error never triggers duplicate execution', async () => {
  const result = await runTerminalCommand({
    terminal: { program: process.execPath, args: ['-e', "console.error('spawn fake ENOENT');process.exit(1)"] },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.spawnErrorCode, null);
  assert.equal(result.windowsShimRetry, undefined);
});

test('generic Git diff check does not count CRLF warnings as code issues', async () => {
  const result = await runTerminalDirect({
    terminal: { program: 'git', args: ['diff', '--check'] },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
    adaptive: false,
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /\|issues=0\|/u);
  assert.equal(result.text.includes('more=1'), false);
});

test('arbitrary background terminal command completes and erases persisted command secrets', async () => {
  const job = startBackgroundTerminalJob({
    terminal: { program: process.execPath, args: ['-e', "setTimeout(()=>console.log('background-ok'),50)"], env: { HELIO_SECRET_TEST: 'temporary' } },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  try {
    const completed = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 5000 });
    assert.equal(completed.completed, true);
    assert.equal(completed.state.status, 'completed');
    assert.equal(completed.state.operation, 'terminal');
    assert.equal(Object.hasOwn(completed.state, 'terminal'), false);
    assert.match(completed.state.result.evidenceBody, /background-ok/u);
    assert.equal(completed.state.result.modelPolls, 0);
    assert.equal(existsSync(join(JOB_DIRECTORY, `${job.handle}.json`)), true);
  } finally {
    removeBackgroundJob(job.handle);
  }
});

test('direct terminal CLI starts and collects one background job without MCP polling', () => {
  const start = spawnSync(process.execPath, [
    'scripts/terminal-runner.mjs', '--cwd', process.cwd(), '--program', process.execPath,
    '--arg', '-e', '--arg', "setTimeout(()=>console.log('direct-background-ok'),40)",
    '--timeout-seconds', '5', '--background',
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const handle = /\|job=([A-Za-z0-9_-]{16})\|/u.exec(start.stdout)?.[1];
  assert.ok(handle, start.stdout);
  try {
    const wait = spawnSync(process.execPath, [
      'scripts/terminal-runner.mjs', '--cwd', process.cwd(), '--wait-job', handle,
      '--timeout-seconds', '5', '--evidence', '--evidence-bytes', '4096',
    ], { encoding: 'utf8', timeout: 10000 });
    assert.equal(wait.status, 0, wait.stderr || wait.stdout);
    assert.match(wait.stdout, /^OK\|calls=1\|evidence=1\|operation=terminal/u);
    assert.match(wait.stdout, /\|background=1\|job=[A-Za-z0-9_-]{16}\|terminal=1\|polls=0\|waitMs=\d+\|model=0\n/u);
    assert.match(wait.stdout, /direct-background-ok/u);
  } finally {
    try { unlinkSync(join(JOB_DIRECTORY, `${handle}.json`)); } catch { /* cleanup best effort */ }
  }
});

test('HelioTerm cancels an arbitrary background process tree and erases its payload', async () => {
  const job = startBackgroundTerminalJob({
    terminal: { program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], env: { HELIO_CANCEL_SECRET: 'temporary' } },
    cwd: process.cwd(),
    timeoutMilliseconds: 10000,
  });
  try {
    const deadline = Date.now() + 5000;
    while (readBackgroundJob(job.handle).status === 'queued' && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    const cancelled = cancelBackgroundJob(job.handle);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.state.status, 'cancelled');
    assert.equal(Object.hasOwn(cancelled.state, 'terminal'), false);
    const waited = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 1000 });
    assert.equal(waited.completed, true);
    assert.equal(waited.state.status, 'cancelled');
  } finally {
    removeBackgroundJob(job.handle);
  }
});
