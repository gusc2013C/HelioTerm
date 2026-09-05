import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runDirect, runDirectBatch, runDirectEvidence } from '../scripts/direct-runner.mjs';
import { evidenceSample, runCommand, semanticFacts } from '../scripts/kernel.mjs';

test('direct runner executes a batched test request without a model or MCP', async () => {
  const result = await runDirect({ request: 'T|test|tests/firewall.test.mjs tests/mcp-server.test.mjs', cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=1\|(?:pass=\d+\|fail=0|lines=\d+)\|raw=\d+\|ms=\d+\|model=0$/u);
  assert.equal(result.command.file, process.execPath);
});

test('direct runner CLI emits exactly one compact line', () => {
  const run = spawnSync(process.execPath, ['scripts/direct-runner.mjs', '--request', 'T|test|tests/firewall.test.mjs', '--cwd', process.cwd()], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.trim().split(/\r?\n/u).length, 1);
  assert.match(run.stdout.trim(), /\|model=0$/u);
});

test('direct evidence mode returns an exact bounded source slice through HelioTerm', async () => {
  const result = await runDirectEvidence({
    request: 'T|read|package.json 1 5',
    cwd: process.cwd(),
    maxBytes: 4096,
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=1\|evidence=1\|operation=read\|raw=\d+\|shown=\d+\|model=0\n1:\{/u);
  assert.match(result.text, /2:  "name": "helioterm"/u);
  assert.equal(result.more, false);
});

test('direct evidence mode clips locally and rejects execution operations', async () => {
  const clipped = await runDirectEvidence({
    request: 'T|read|README.md 1 200',
    cwd: process.cwd(),
    maxBytes: 256,
  });
  assert.equal(clipped.pass, true, clipped.text);
  assert.equal(clipped.more, true);
  assert.equal(clipped.shownBytes, 256);
  assert.match(clipped.text, /\|more=1\|model=0\n/u);

  const rejected = await runDirectEvidence({
    request: 'T|process|node',
    cwd: process.cwd(),
  });
  assert.equal(rejected.pass, false);
  assert.equal(rejected.text, 'FAIL|calls=0|evidence-request-invalid|model=0');
});

test('direct evidence CLI is explicit and may return multiple lines', () => {
  const run = spawnSync(process.execPath, [
    'scripts/direct-runner.mjs', '--request', 'T|read|package.json 1 3', '--cwd', process.cwd(), '--evidence', '--evidence-bytes', '4096',
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /^OK\|calls=1\|evidence=1\|operation=read/u);
  assert.match(run.stdout, /\n1:\{/u);
});

test('direct runner source CLI rejects an invalid timeout with one bounded failure line', () => {
  const run = spawnSync(process.execPath, [
    'scripts/direct-runner.mjs', '--request', 'T|bench|benchmarks/supervise-wait.mjs 1800',
    '--cwd', process.cwd(), '--timeout-seconds', '0',
  ], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.equal(run.stdout, 'FAIL|calls=0|direct-runner-error=--timeout-seconds must be 1..43200|model=0\n');
  assert.equal(run.stdout.trim().split(/\r?\n/u).length, 1);
});

test('direct runner propagates a bounded timeout through compact and evidence paths', async () => {
  const compact = await runDirect({
    request: 'T|bench|benchmarks/supervise-wait.mjs 1800',
    cwd: process.cwd(),
    timeoutMilliseconds: 1000,
  });
  assert.equal(compact.pass, false, compact.text);
  assert.equal(compact.exitCode, 124);
  assert.match(compact.text, /^FAIL\|calls=1\|exit=124\|/u);

  const evidence = await runDirectEvidence({
    request: 'T|bench|benchmarks/supervise-wait.mjs 1800',
    cwd: process.cwd(),
    maxBytes: 4096,
    timeoutMilliseconds: 1000,
  });
  assert.equal(evidence.pass, false, evidence.text);
  assert.equal(evidence.exitCode, 124);
  assert.match(evidence.text, /^FAIL\|calls=1\|exit=124\|evidence=1\|operation=bench/u);
});

test('direct runner batches different observations into one process result', async () => {
  const result = await runDirectBatch({
    requests: ['T|test|tests/firewall.test.mjs', 'T|git|status --short', 'T|git|rev-parse HEAD'],
    cwd: process.cwd(),
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /^OK\|calls=3\|pass=\d+\|ops=test,git\/\d+,git\/\d+/u);
  assert.match(result.text, /\|model=0$/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
  assert.equal(result.commands.length, 3);
});

test('batch evidence gives each non-empty observation a bounded sample', async () => {
  const result = await runDirectBatch({
    requests: ['T|git|status --short', 'T|search|-n HelioTerm README.md', 'T|files|tests'],
    cwd: process.cwd(),
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /\|more=[23]\|/u);
  assert.match(result.text, /(?:\|sample=|;)search:[^|;]+;files:[^|;]+/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
});

test('direct search returns bounded evidence instead of only a line count', async () => {
  const result = await runDirect({ request: 'T|search|-n HelioTerm README.md', cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /\|more=1\|sample=[^|]*HelioTerm/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
});

test('a realistic multi-pattern search longer than 64 bytes stays compact', async () => {
  const request = `T|search|-n "${'HelioTerm|'.repeat(10)}model=0" README.md`;
  assert.ok(Buffer.byteLength(request, 'utf8') > 64);
  const result = await runDirect({ request, cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /\|matches=\d+\|more=1\|sample=/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
});

test('semantic facts compress Git diff, status, search, files, and process output', () => {
  const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1,2 @@\n-old\n+new\n+next\n';
  assert.equal(semanticFacts(diff, 'git', { args: ['diff'] }), 'files=1|hunks=1|add=2|del=1');
  assert.equal(semanticFacts(' M a.js\n?? b.js\n', 'git', { args: ['status'] }), 'changes=2');
  assert.equal(semanticFacts('a:1:x\nb:2:y\n', 'search'), 'matches=2');
  assert.equal(semanticFacts('a.js\nb.js\n', 'files'), 'files=2');
  assert.equal(semanticFacts('header\nrow\n', 'process'), 'rows=2');
  assert.equal(semanticFacts('', 'git', { args: ['diff', '--check'] }), 'issues=0');
  assert.equal(semanticFacts('line one\nline two\n', 'git', { args: ['show', 'HEAD:file.js'] }), 'lines=2');
  assert.equal(semanticFacts('{"pass":true,"failedChecks":[]}', 'bench', { args: ['preflight.mjs'] }), 'check=pass|failed=0');
  assert.equal(semanticFacts('npm banner\n{"pass":true,"failedChecks":[]}\n', 'build', { args: ['preflight'] }), 'check=pass|failed=0');
  assert.equal(semanticFacts('================ 12 passed, 1 skipped in 0.42s ================', 'pytest'), 'pass=12|fail=0');
  assert.equal(semanticFacts('=========== 2 failed, 3 passed, 1 error in 0.42s ===========', 'pytest'), 'pass=3|fail=3');
});

test('git show source content is marked incomplete and keeps its first source lines', async () => {
  const result = await runDirect({ request: 'T|git|show HEAD:README.md', cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /\|lines=\d+\|more=1\|sample=# HelioTerm/u);
});

test('a failed operation keeps failure evidence instead of successful prefix lines', async () => {
  const result = await runDirect({ request: 'T|test|tests/does-not-exist.test.mjs', cwd: process.cwd() });
  assert.equal(result.pass, false, result.text);
  assert.match(result.text, /\|sample=.*(?:Could not find|not found|error)/iu);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
});

test('a failed batch prioritizes failure evidence over successful observations', async () => {
  const result = await runDirectBatch({
    requests: ['T|test|tests/does-not-exist.test.mjs', 'T|git|status --short'],
    cwd: process.cwd(),
  });
  assert.equal(result.pass, false, result.text);
  assert.match(result.text, /\|sample=test:.*(?:Could not find|not found|error)/iu);
  assert.doesNotMatch(result.text, /;git:/u);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
});

test('a process-level failure with empty stderr retains the exec error', async () => {
  const result = await runCommand({
    command: { file: 'helioterm-command-that-does-not-exist', args: [] },
    cwd: process.cwd(),
    operation: 'process',
  });
  assert.match(result.text, /^FAIL\|calls=1\|exit=1\|/u);
  assert.match(result.text, /\|sample=.*(?:ENOENT|not found|cannot find)/iu);
});

test('a failed operation prioritizes stderr over successful-looking stdout', async () => {
  const result = await runCommand({
    command: { file: process.execPath, args: ['-e', 'process.stdout.write("match one\\nmatch two\\n"); process.stderr.write("rg: missing path error\\n"); process.exit(2)'] },
    cwd: process.cwd(),
    operation: 'search',
  });
  assert.match(result.text, /^FAIL\|calls=1\|exit=2\|matches=3\|more=1\|sample=rg: missing path error/u);
});

test('successful process inventory suppresses locale-dependent text but signals more', async () => {
  const result = await runCommand({
    command: { file: process.execPath, args: ['-e', 'console.log("localized process row")'] },
    cwd: process.cwd(),
    operation: 'process',
  });
  assert.match(result.text, /^OK\|calls=1\|rows=1\|more=1\|raw=\d+$/u);
  assert.doesNotMatch(result.text, /localized/u);
});

test('a passing JSON check is complete without a redundant sample', async () => {
  const result = await runCommand({
    command: { file: process.execPath, args: ['-e', 'console.log(JSON.stringify({pass:true,failedChecks:[]}))'] },
    cwd: process.cwd(),
    operation: 'bench',
  });
  assert.match(result.text, /^OK\|calls=1\|check=pass\|failed=0\|raw=\d+$/u);
});

test('failure evidence skips successful TAP prefixes, including ANSI output', () => {
  const sample = evidenceSample('✔ passed first\n\u001B[31m✖ actual failure\u001B[0m\nAssertionError [ERR_ASSERTION]: mismatch', 104, true);
  assert.equal(sample.startsWith('✖ actual failure'), true, sample);
  assert.doesNotMatch(sample, /passed first/u);
});

test('evidence removes repeated diagnostics and normalizes the workspace path', () => {
  const cwd = process.platform === 'win32' ? String.raw`D:\work\demo` : '/work/demo';
  const file = process.platform === 'win32' ? String.raw`D:\work\demo\src\app.py` : '/work/demo/src/app.py';
  const expected = process.platform === 'win32' ? String.raw`ERROR: .\src\app.py:10;AssertionError: mismatch` : 'ERROR: ./src/app.py:10;AssertionError: mismatch';
  const sample = evidenceSample(`ERROR: ${file}:10\nERROR: ${file}:10\nAssertionError: mismatch`, 160, true, cwd);
  assert.equal(sample, expected);
});

test('files lists one repo-relative directory without a shell', async () => {
  const result = await runDirect({ request: 'T|files|tests', cwd: process.cwd() });
  assert.equal(result.pass, true, result.text);
  assert.deepEqual(result.command, { file: 'rg', args: ['--no-config', '--files', 'tests'] });
  assert.match(result.text, /\|sample=[^|]*tests[\\/][^|;]+\.test\.mjs/u);
});

test('direct runner validates a whole batch before executing anything', async () => {
  const result = await runDirectBatch({ requests: ['T|git|status --short', 'T|git|reset --hard'], cwd: process.cwd() });
  assert.equal(result.pass, false);
  assert.equal(result.text, 'FAIL|calls=0|request-invalid|model=0');
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
  assert.equal(result.text, 'FAIL|calls=0|request-invalid|model=0');
});
