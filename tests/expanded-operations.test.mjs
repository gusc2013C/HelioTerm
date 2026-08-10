import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateRequest } from '../scripts/firewall.mjs';
import { runDirectBatch } from '../scripts/direct-runner.mjs';
import { commandFor, INTERNAL_OBSERVER, OPERATIONS, semanticFacts } from '../scripts/kernel.mjs';

test('exposes seventeen bounded operation classes', () => {
  assert.deepEqual([...OPERATIONS].sort(), [
    'bench', 'build', 'check', 'count', 'deps', 'files', 'git', 'hash', 'json', 'list',
    'process', 'pytest', 'read', 'search', 'stat', 'test', 'version',
  ]);
});

test('accepts repository inspection and rejects path escape', () => {
  for (const request of [
    'T|read|scripts/kernel.mjs 1 20',
    'T|list|tests',
    'T|json|package.json name scripts',
    'T|stat|package.json scripts/kernel.mjs',
    'T|count|package.json scripts/kernel.mjs',
    'T|hash|package.json scripts/kernel.mjs',
  ]) assert.equal(validateRequest(request).pass, true, request);

  for (const request of [
    'T|read|../secret.txt',
    'T|read|README.md 0 20',
    'T|read|README.md 1 201',
    'T|list|C:\\Windows',
    'T|json|/etc/passwd',
    'T|stat|scripts/../package.json',
    'T|count|../secret.txt',
    'T|hash|C:\\Windows\\win.ini',
  ]) assert.equal(validateRequest(request).pass, false, request);
});

test('allows common quality and dependency observations but rejects mutating forms', () => {
  for (const request of [
    'T|check|node --check scripts/kernel.mjs',
    'T|check|npm test',
    'T|check|npm run lint',
    'T|check|py -m pytest tests',
    'T|check|py scripts/quick_validate.py skills/helioterm',
    'T|check|ruff check .',
    'T|check|tsc --noEmit',
    'T|check|cargo clippy',
    'T|check|go vet ./...',
    'T|deps|npm ls --depth=0',
    'T|deps|py -m pip check',
    'T|version|node',
  ]) assert.equal(validateRequest(request).pass, true, request);

  for (const request of [
    'T|check|node -e process.exit(0)',
    'T|check|npm install left-pad',
    'T|check|py -c print(1)',
    'T|check|py scripts/delete.py .',
    'T|deps|npm install',
    'T|deps|pip uninstall thing',
    'T|version|powershell',
  ]) assert.equal(validateRequest(request).pass, false, request);
});

test('maps expanded commands without a shell', () => {
  const read = commandFor('read', 'package.json 1 5');
  assert.equal(read.file, INTERNAL_OBSERVER);
  assert.deepEqual(read.args, ['read', 'package.json', '1', '5']);
  assert.deepEqual(commandFor('count', 'package.json').args, ['count', 'package.json']);
  assert.deepEqual(commandFor('hash', 'package.json').args, ['hash', 'package.json']);
  assert.equal(commandFor('check', 'node --check scripts/kernel.mjs').file, process.execPath);
  assert.deepEqual(commandFor('check', 'py -m pytest tests').args, ['-m', 'pytest', '-p', 'no:cacheprovider', 'tests']);
  assert.deepEqual(commandFor('version', 'git'), { file: 'git', args: ['--version'] });
});

test('keeps pathless search off stdin and maps bounded process queries', () => {
  assert.deepEqual(commandFor('search', '0.1.0'), { file: 'rg', args: ['--no-config', '0.1.0', '.'] });
  assert.deepEqual(commandFor('search', '-n 0.1.0'), { file: 'rg', args: ['--no-config', '-n', '0.1.0', '.'] });
  assert.deepEqual(commandFor('search', '-g *.mjs model=0'), { file: 'rg', args: ['--no-config', '-g', '*.mjs', 'model=0', '.'] });
  assert.deepEqual(commandFor('search', '-n model=0 README.md').args, ['--no-config', '-n', 'model=0', 'README.md']);

  const byName = commandFor('process', 'node');
  if (process.platform === 'win32') assert.deepEqual(byName, { file: 'tasklist.exe', args: ['/FI', 'IMAGENAME eq node.exe'] });
  else assert.deepEqual(byName, { file: 'pgrep', args: ['-a', '-x', 'node'] });
  assert.throws(() => commandFor('process', 'node extra'));
  assert.throws(() => commandFor('process', '*'));
});

test('rejects execution escape hatches found by real-project probing', () => {
  for (const request of [
    'T|build|definitely_missing_helioterm_script',
    'T|bench|scripts/luna-ticket-reader.mjs --ticket invalid',
    'T|search|--pre definitely_missing_preprocessor HelioTerm README.md',
    String.raw`T|search|localhost C:\Windows\System32\drivers\etc\hosts`,
    'T|git|diff --output=NUL',
    'T|git|diff --ext-diff',
    'T|git|grep -O less HelioTerm',
    'T|check|mvn test deploy',
    'T|check|gradle test publish',
  ]) assert.equal(validateRequest(request).pass, false, request);

  for (const request of [
    'T|build|preflight',
    'T|bench|benchmarks/supervise-wait.mjs 10',
    'T|search|-n HelioTerm README.md',
    'T|git|diff --check',
  ]) assert.equal(validateRequest(request).pass, true, request);
});

test('disables repository-configured external Git diff and text conversion', () => {
  assert.deepEqual(commandFor('git', 'diff --check').args, ['diff', '--no-ext-diff', '--no-textconv', '--check']);
  assert.deepEqual(commandFor('git', 'show HEAD').args, ['show', '--no-ext-diff', '--no-textconv', 'HEAD']);
  assert.deepEqual(commandFor('git', 'status --short').args, ['status', '--short']);
});

test('covers common read-only Git inventory while rejecting mixed-command mutations', () => {
  for (const argument of [
    'branch --show-current', 'branch --list codex/*', 'tag --list v*', 'remote -v',
    'remote get-url origin', 'worktree list --porcelain', 'stash list --oneline',
  ]) assert.doesNotThrow(() => commandFor('git', argument), argument);

  for (const argument of [
    'branch new-name', 'branch -D old-name', 'tag v1.0.0', 'tag --delete v1.0.0',
    'remote set-url origin https://example.com/repo.git', 'worktree remove other', 'stash drop',
  ]) assert.throws(() => commandFor('git', argument), /mutating git/u, argument);
});

test('rejects repository-relative symlinks that resolve outside the working directory', () => {
  const parent = mkdtempSync(join(tmpdir(), 'helioterm-containment-'));
  const root = join(parent, 'root');
  const outside = join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside\n');
  writeFileSync(join(outside, 'tool.mjs'), 'process.stdout.write("outside")\n');
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.throws(() => commandFor('search', 'outside escape', root), /inside the working directory/u);
    assert.throws(() => commandFor('files', 'escape', root), /inside the working directory/u);
    assert.throws(() => commandFor('bench', 'escape/tool.mjs', root), /inside the working directory/u);
    assert.throws(() => commandFor('read', 'escape/secret.txt 1 5', root), /inside the working directory/u);
    assert.throws(() => commandFor('count', 'escape/secret.txt', root), /inside the working directory/u);
    assert.throws(() => commandFor('hash', 'escape/secret.txt', root), /inside the working directory/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('runs pathless search and a named process observation without hanging', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: ['T|search|0.1.0', 'T|process|node'],
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /ops=search\/\d+,process\/\d+/u);
  assert.match(result.text, /model=0$/u);
});

test('treats ripgrep no-match as a successful zero-match observation', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: ['T|search|__helioterm_deliberate_no_match__ README.md'],
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /^OK\|calls=1\|matches=0\|raw=0\|/u);
  assert.match(result.text, /model=0$/u);
});

test('runs four expanded observations in one compressed result', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: [
      'T|read|package.json 1 6',
      'T|list|tests',
      'T|json|package.json name version scripts',
      'T|stat|package.json scripts/kernel.mjs',
    ],
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /^OK\|calls=4\|/u);
  assert.match(result.text, /ops=read\/6,list\/\d+,json\/3,stat\/2/u);
  assert.match(result.text, /model=0$/u);
  assert.ok(result.savings.savedEstimatedTokens > 0);
});

test('counts and hashes project files without external commands', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: ['T|count|package.json scripts/kernel.mjs', 'T|hash|package.json scripts/kernel.mjs'],
  });
  assert.equal(result.pass, true, result.text);
  assert.match(result.text, /ops=count\/2,hash\/2/u);
  assert.match(result.text, /model=0$/u);
});

test('compresses successful generic checks, dependencies, and versions', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: [
      'T|check|node --check scripts/kernel.mjs',
      'T|deps|npm ls --depth=0',
      'T|version|node',
    ],
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /ops=check\/0,deps\/\d+,version\/\d+/u);
  assert.match(result.text, /model=0$/u);
});

test('summarizes new operation output without a model', () => {
  assert.equal(semanticFacts('1:a\n2:b\n', 'read'), 'lines=2');
  assert.equal(semanticFacts('file\t1\ta\ndir\t0\tb\n', 'list'), 'entries=2');
  assert.equal(semanticFacts('name="x"\nscripts={3}\n', 'json'), 'keys=2');
  assert.equal(semanticFacts('2\t3\t10\ta.txt\n4\t5\t20\tb.txt\n', 'count'), 'files=2|lines=6|words=8|bytes=30');
  assert.equal(semanticFacts('sha256\t10\tabcd\ta.txt\n', 'hash'), 'files=1|algorithm=sha256');
  assert.equal(semanticFacts('warning: x\nerror: y\n', 'check'), 'errors=1|warnings=1|lines=2');
  assert.equal(semanticFacts('34 passed in 0.12s\n', 'check', { args: ['-m', 'pytest'] }), 'pass=34|fail=0');
});

test('calculates byte-based token estimates deterministically through HelioTerm', async () => {
  const result = await runDirectBatch({
    cwd: process.cwd(),
    requests: ['T|bench|scripts/estimate-bytes.mjs 18118 488'],
  });
  assert.equal(result.pass, true);
  assert.match(result.text, /savedEst":4408/u);
  assert.match(result.text, /pct":97\.31/u);
});
