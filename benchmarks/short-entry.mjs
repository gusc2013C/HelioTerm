#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const directRunner = fileURLToPath(new URL('../scripts/direct-runner.mjs', import.meta.url));
const shortRunner = fileURLToPath(new URL('../scripts/ht.mjs', import.meta.url));

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function execute(script, args) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
  return {
    elapsedMilliseconds: performance.now() - started,
    pass: result.status === 0 && /^OK\|calls=1\|/u.test(result.stdout),
  };
}

function main(argv = process.argv.slice(2)) {
  const runs = Number(option(argv, '--runs', '11'));
  if (!Number.isInteger(runs) || runs < 3 || runs > 101) throw new Error('--runs must be 3..101');
  const cwd = process.cwd();
  const directArgs = ['--cwd', cwd, '--request', 'T|version|node', '--no-adaptive'];
  const shortArgs = ['-C', cwd, '-n', 'version', 'node'];
  execute(directRunner, directArgs);
  execute(shortRunner, shortArgs);
  const direct = [];
  const short = [];
  for (let index = 0; index < runs; index += 1) {
    if (index % 2 === 0) {
      direct.push(execute(directRunner, directArgs));
      short.push(execute(shortRunner, shortArgs));
    } else {
      short.push(execute(shortRunner, shortArgs));
      direct.push(execute(directRunner, directArgs));
    }
  }
  const directMedian = median(direct.map((entry) => entry.elapsedMilliseconds));
  const shortMedian = median(short.map((entry) => entry.elapsedMilliseconds));
  const oldRule = 'node D:\\code\\HelioTerm\\scripts\\direct-runner.mjs --cwd D:\\code\\HelioTerm --request "T|test|tests/*.test.mjs"';
  const newRule = 'ht -C D:\\code\\HelioTerm test tests/*.test.mjs';
  const report = {
    schemaVersion: 'HELIOTERM_SHORT_ENTRY_V1',
    runs,
    pass: direct.every((entry) => entry.pass) && short.every((entry) => entry.pass),
    directMedianMilliseconds: directMedian,
    shortMedianMilliseconds: shortMedian,
    latencyDifferenceMilliseconds: shortMedian - directMedian,
    latencyDifferencePercent: ((shortMedian / directMedian) - 1) * 100,
    oldCommandBytes: Buffer.byteLength(oldRule),
    shortCommandBytes: Buffer.byteLength(newRule),
    commandReductionPercent: (1 - (Buffer.byteLength(newRule) / Buffer.byteLength(oldRule))) * 100,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}

main();
