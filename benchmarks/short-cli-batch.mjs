#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = resolve(root, 'scripts/ht.mjs');
const commands = [
  ['version', 'node'],
  ['json', 'package.json', 'name', 'version'],
  ['count', 'README.md'],
  ['stat', 'package.json'],
];
const invoke = (args) => {
  const result = spawnSync(process.execPath, [executable, '-C', root, '-n', ...args], {
    cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^OK\|/u);
  return result.stdout.trim();
};
const individual = commands.map(invoke);
const batched = invoke(['batch', ...commands.map((args) => args.join(' '))]);
assert.match(batched, /^OK\|calls=4\|ops=version\/1,json\/2,count\/1,stat\/1\|/u);
assert.ok(Buffer.byteLength(batched) <= 256);
const beforeBytes = individual.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
const afterBytes = Buffer.byteLength(batched);
assert.ok(afterBytes < beforeBytes);
console.log(JSON.stringify({
  schema: 'HELIOTERM_SHORT_BATCH_BENCHMARK_V1',
  callerInvocations: { before: 4, after: 1 },
  outputBytes: { before: beforeBytes, after: afterBytes, saved: beforeBytes - afterBytes },
  outputReductionPercent: Number(((beforeBytes - afterBytes) / beforeBytes * 100).toFixed(1)),
  scope: 'CLI response text only; excludes caller wrappers and provider billing',
}));
