import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeBackgroundJob } from '../scripts/job-manager.mjs';

function run(args, timeout = 15000, environment = {}) {
  return spawnSync(process.execPath, ['scripts/ht.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...environment },
  });
}

test('package registers both short and descriptive executable names', () => {
  const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.deepEqual(metadata.bin, { ht: 'scripts/ht.mjs', helioterm: 'scripts/ht.mjs' });
});

test('short CLI reports the release version and concise help', () => {
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr || version.stdout);
  assert.equal(version.stdout.trim(), '0.4.1');
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /^Usage:\n  ht /u);
  assert.ok(help.stdout.length < 900, help.stdout);
});

test('globally linked short CLI remains executable while an isolated source version is under test', () => {
  const locator = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['ht'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
  });
  if (locator.status !== 0) return;
  const linked = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'ht --version'], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 })
    : spawnSync('ht', ['--version'], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  assert.match(linked.stdout.trim(), /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u);
});

test('short CLI maps deterministic operations without a protocol envelope', () => {
  const result = run(['-C', process.cwd(), 'version', 'node']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^OK\|calls=1\|/u);
  assert.match(result.stdout, /\|sample=v?\d+/u);
  assert.match(result.stdout, /\|model=0\n$/u);
});

test('short CLI preserves quoted argument boundaries for deterministic operations', () => {
  const result = run(['-C', process.cwd(), '-e', '4096', 'search', 'structured MCP server', 'CHANGELOG.md']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /structured MCP server/u);
  assert.doesNotMatch(result.stdout, /系统找不到指定的文件|No such file/u);
});

test('short CLI maps arbitrary programs and keeps child flags collision-free', () => {
  const result = run(['-C', process.cwd(), 'node', '--version']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^OK\|calls=1\|/u);
  assert.match(result.stdout, /\|sample=v?\d+/u);
  assert.match(result.stdout, /\|model=0\n$/u);
  const forced = run(['-C', process.cwd(), '--', 'git', '--version']);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.match(forced.stdout, /^OK\|calls=1\|/u);
  assert.match(forced.stdout, /\|sample=git version/u);
  const explicit = run(['-C', process.cwd(), 'exec', 'git', '--version']);
  assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
  assert.match(explicit.stdout, /\|sample=git version/u);
});

test('short CLI keeps evidence options outside the child argument list', () => {
  const result = run(['-C', process.cwd(), '-e', '1024', 'node', '-e', 'process.stdout.write("short-evidence")']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^OK\|calls=1\|evidence=1\|operation=terminal/u);
  assert.match(result.stdout, /short-evidence/u);
});

test('short CLI forwards structured environment and stdin without a shell', () => {
  const source = 'process.stdin.once("data",d=>process.stdout.write(process.env.HT_SHORT+":"+d))';
  const result = run(['-C', process.cwd(), '-E', 'HT_SHORT=env-ok', '-i', 'stdin-ok', 'node', '-e', source]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /sample=env-ok:stdin-ok/u);
});

test('short CLI keeps explicit shell execution inside HelioTerm', () => {
  const command = process.platform === 'win32'
    ? ['-C', process.cwd(), 'shell', 'powershell', 'Write-Output short-shell']
    : ['-C', process.cwd(), 'shell', 'sh', 'printf short-shell'];
  const result = run(command);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /sample=short-shell/u);
});

test('short CLI starts and collects one background command without polling', () => {
  const started = run(['-C', process.cwd(), '-t', '10', 'bg', 'node', '-e', 'setTimeout(()=>console.log("short-bg"),80)']);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const handle = /\|job=([A-Za-z0-9_-]{16})\|/u.exec(started.stdout)?.[1];
  assert.ok(handle, started.stdout);
  try {
    const waited = run(['-C', process.cwd(), '-t', '10', '-e', '2048', 'wait', handle]);
    assert.equal(waited.status, 0, waited.stderr || waited.stdout);
    assert.match(waited.stdout, /short-bg/u);
    assert.match(waited.stdout, /\|polls=0\|/u);
  } finally {
    removeBackgroundJob(handle);
  }
});

test('short CLI config manages automatic migration and archival settings with safe defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-settings-'));
  const path = join(root, 'settings.json');
  const environment = { HELIOTERM_SETTINGS_PATH: path };
  try {
    const defaults = run(['config', 'show'], 15000, environment);
    assert.equal(defaults.status, 0, defaults.stderr || defaults.stdout);
    assert.deepEqual(JSON.parse(defaults.stdout).settings.migration, {
      autoMigrate: false,
      archiveOldSession: false,
      samplesPerUserThreshold: 40,
      contextTokensThreshold: 120000,
    });
    assert.deepEqual(JSON.parse(defaults.stdout).settings.compression, {
      backend: 'native',
      minimumBytes: 8192,
      headroomCommand: 'headroom',
      headroomArgs: ['mcp', 'serve'],
      headroomTimeoutMilliseconds: 5000,
      storeTtlSeconds: 3600,
    });
    for (const [key, value] of [
      ['migration.autoMigrate', 'true'],
      ['migration.archiveOldSession', 'true'],
      ['migration.samplesPerUserThreshold', '50'],
      ['migration.contextTokensThreshold', '140000'],
      ['compression.backend', 'auto'],
      ['compression.minimumBytes', '4096'],
      ['compression.headroomCommand', process.execPath],
      ['compression.headroomArgs', '["tests/fixtures/fake-headroom-mcp.mjs"]'],
      ['compression.headroomTimeoutMilliseconds', '7000'],
      ['compression.storeTtlSeconds', '1800'],
    ]) {
      const updated = run(['config', 'set', key, value], 15000, environment);
      assert.equal(updated.status, 0, updated.stderr || updated.stdout);
    }
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(saved.migration, { autoMigrate: true, archiveOldSession: true, samplesPerUserThreshold: 50, contextTokensThreshold: 140000 });
    assert.deepEqual(saved.compression, {
      backend: 'auto', minimumBytes: 4096, headroomCommand: process.execPath,
      headroomArgs: ['tests/fixtures/fake-headroom-mcp.mjs'], headroomTimeoutMilliseconds: 7000, storeTtlSeconds: 1800,
    });
    const rejected = run(['config', 'set', 'migration.autoMigrate', 'yes'], 15000, environment);
    assert.equal(rejected.status, 2);
    assert.match(rejected.stdout, /^FAIL\|calls=0\|short-cli-error=/u);
    writeFileSync(path, `${JSON.stringify({ version: 1, migration: saved.migration })}\n`);
    const legacy = run(['config', 'show'], 15000, environment);
    assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);
    assert.deepEqual(JSON.parse(legacy.stdout).settings.compression, {
      backend: 'native', minimumBytes: 8192, headroomCommand: 'headroom', headroomArgs: ['mcp', 'serve'],
      headroomTimeoutMilliseconds: 5000, storeTtlSeconds: 3600,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('short CLI starts and collects one preplanned background batch', () => {
  const commands = [
    { program: process.execPath, args: ['-e', 'console.log("batch-bg-one")'] },
    { program: process.execPath, args: ['-e', 'console.log("batch-bg-two")'] },
  ];
  const payload = Buffer.from(JSON.stringify(commands), 'utf8').toString('base64url');
  const started = run(['-C', process.cwd(), '-t', '10', 'batch-bg', payload]);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const handle = /\|job=([A-Za-z0-9_-]{16})\|/u.exec(started.stdout)?.[1];
  assert.ok(handle, started.stdout);
  try {
    const waited = run(['-C', process.cwd(), '-t', '10', '-e', '4096', 'wait', handle]);
    assert.equal(waited.status, 0, waited.stderr || waited.stdout);
    assert.match(waited.stdout, /batch-bg-one[\s\S]*batch-bg-two/u);
    assert.match(waited.stdout, /\|batch=1\|wakeupsAvoided=0\|boundariesAvoided=0\|/u);
  } finally {
    removeBackgroundJob(handle);
  }
});

test('short CLI cancels a background command and erases its handle', () => {
  const started = run(['-C', process.cwd(), '-t', '10', 'bg', 'node', '-e', 'setInterval(()=>{},1000)']);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  const handle = /\|job=([A-Za-z0-9_-]{16})\|/u.exec(started.stdout)?.[1];
  assert.ok(handle, started.stdout);
  try {
    const cancelled = run(['-C', process.cwd(), 'cancel', handle]);
    assert.equal(cancelled.status, 0, cancelled.stderr || cancelled.stdout);
    assert.match(cancelled.stdout, /^OK\|calls=0\|status=cancelled/u);
    assert.match(cancelled.stdout, /\|cancelled=1\|/u);
  } finally {
    removeBackgroundJob(handle);
  }
});

test('short CLI rejects unknown wrapper options before execution', () => {
  const result = run(['--wat', 'node', '--version']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^FAIL\|calls=0\|short-cli-error=unknown HelioTerm option/u);
});
