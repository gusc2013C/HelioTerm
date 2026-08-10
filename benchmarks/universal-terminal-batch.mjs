#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { TOKEN_ESTIMATOR } from '../scripts/token-savings.mjs';

const runner = fileURLToPath(new URL('../scripts/terminal-runner.mjs', import.meta.url));

function options(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function option(argv, name, fallback) { return options(argv, name)[0] ?? fallback; }

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function execute(file, args, cwd) {
  return new Promise((resolveRun) => {
    const started = performance.now();
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    child.on('error', (error) => output.push(Buffer.from(error.message)));
    child.on('close', (exitCode) => resolveRun({
      exitCode: exitCode ?? 1,
      elapsedMs: performance.now() - started,
      output: Buffer.concat(output),
    }));
  });
}

async function gitState(cwd) {
  const result = await execute('git', ['status', '--porcelain=v1'], cwd);
  if (result.exitCode !== 0) throw new Error('git status failed');
  return result.output.toString('utf8');
}

async function main(argv = process.argv.slice(2)) {
  const project = resolve(option(argv, '--project', process.cwd()));
  const program = option(argv, '--program');
  const args = options(argv, '--arg');
  const runs = Number(option(argv, '--runs', '3'));
  if (!program || !Number.isInteger(runs) || runs < 1) {
    process.stderr.write('Usage: universal-terminal-batch.mjs --project <dir> --program <file> [--arg <value> ...] [--runs 3]\n');
    process.exitCode = 2;
    return;
  }
  const heliotermArgs = [runner, '--cwd', project, '--program', program, '--no-adaptive', '--', ...args];
  const before = await gitState(project);
  await execute(program, args, project);
  await execute(process.execPath, heliotermArgs, project);
  const plain = [];
  const helioterm = [];
  for (let index = 0; index < runs; index += 1) {
    if (index % 2 === 0) {
      plain.push(await execute(program, args, project));
      helioterm.push(await execute(process.execPath, heliotermArgs, project));
    } else {
      helioterm.push(await execute(process.execPath, heliotermArgs, project));
      plain.push(await execute(program, args, project));
    }
  }
  const after = await gitState(project);
  const plainMs = median(plain.map((entry) => entry.elapsedMs));
  const heliotermMs = median(helioterm.map((entry) => entry.elapsedMs));
  const plainBytes = median(plain.map((entry) => entry.output.length));
  const heliotermBytes = median(helioterm.map((entry) => entry.output.length));
  const plainTokens = Math.ceil(plainBytes / 4);
  const heliotermTokens = Math.ceil(heliotermBytes / 4);
  const report = {
    project: basename(project),
    scope: 'terminal-observation-content-only',
    estimator: TOKEN_ESTIMATOR,
    runs,
    program,
    args,
    pass: plain.every((entry) => entry.exitCode === 0) && helioterm.every((entry) => entry.exitCode === 0),
    workingTreeUnchanged: before === after,
    plainMedianMilliseconds: plainMs,
    heliotermMedianMilliseconds: heliotermMs,
    latencyDifferenceMilliseconds: heliotermMs - plainMs,
    latencyDifferencePercent: ((heliotermMs / plainMs) - 1) * 100,
    plainOutputBytes: plainBytes,
    heliotermOutputBytes: heliotermBytes,
    plainEstimatedTokens: plainTokens,
    heliotermEstimatedTokens: heliotermTokens,
    savedEstimatedTokens: plainTokens - heliotermTokens,
    outputReductionPercent: plainBytes ? (1 - (heliotermBytes / plainBytes)) * 100 : 0,
    compactResult: helioterm.at(-1).output.toString('utf8').trim(),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass || !report.workingTreeUnchanged) process.exitCode = 1;
}

await main();
