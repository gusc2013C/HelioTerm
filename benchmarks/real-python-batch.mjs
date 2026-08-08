#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateRequest } from '../scripts/firewall.mjs';
import { commandFor } from '../scripts/kernel.mjs';

const runner = fileURLToPath(new URL('../scripts/direct-runner.mjs', import.meta.url));

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

function option(argv, name, fallback) {
  return options(argv, name)[0] ?? fallback;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function run(file, args, cwd) {
  return new Promise((resolveRun) => {
    const started = performance.now();
    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      const message = Buffer.from(error.message);
      resolveRun({ exitCode: 1, elapsedMs: performance.now() - started, stdout: Buffer.alloc(0), stderr: message });
    });
    child.on('close', (exitCode) => resolveRun({
      exitCode: exitCode ?? 1,
      elapsedMs: performance.now() - started,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

async function plainRun(requests, cwd) {
  const started = performance.now();
  const results = [];
  for (const request of requests) {
    const parsed = validateRequest(request);
    if (!parsed.pass) throw new Error(`invalid request: ${request}`);
    const command = commandFor(parsed.operation, parsed.argument);
    results.push(await run(command.file, command.args, cwd));
  }
  return {
    pass: results.every((result) => result.exitCode === 0),
    elapsedMs: performance.now() - started,
    outputBytes: results.reduce((sum, result) => sum + result.stdout.length + result.stderr.length, 0),
  };
}

async function heliotermRun(requests, cwd) {
  const args = [runner, '--cwd', cwd];
  for (const request of requests) args.push('--request', request);
  const result = await run(process.execPath, args, cwd);
  return {
    pass: result.exitCode === 0 && result.stdout.toString('utf8').startsWith('OK|'),
    elapsedMs: result.elapsedMs,
    outputBytes: result.stdout.length + result.stderr.length,
    result: result.stdout.toString('utf8').trim(),
  };
}

async function gitState(cwd) {
  const result = await run('git', ['status', '--porcelain=v1'], cwd);
  if (result.exitCode !== 0) throw new Error('git status failed');
  return result.stdout.toString('utf8');
}

async function main(argv = process.argv.slice(2)) {
  const cwd = resolve(option(argv, '--project', process.cwd()));
  const requests = options(argv, '--request');
  const runs = Number(option(argv, '--runs', '7'));
  if (!requests.length || !Number.isInteger(runs) || runs < 1) {
    process.stderr.write('Usage: real-python-batch.mjs --project <directory> --request <T|op|args>... [--runs 7]\n');
    process.exitCode = 2;
    return;
  }

  const before = await gitState(cwd);
  await plainRun(requests, cwd);
  await heliotermRun(requests, cwd);
  const plain = [];
  const helioterm = [];
  for (let index = 0; index < runs; index += 1) {
    if (index % 2 === 0) {
      plain.push(await plainRun(requests, cwd));
      helioterm.push(await heliotermRun(requests, cwd));
    } else {
      helioterm.push(await heliotermRun(requests, cwd));
      plain.push(await plainRun(requests, cwd));
    }
  }
  const after = await gitState(cwd);
  const plainMedian = median(plain.map((entry) => entry.elapsedMs));
  const heliotermMedian = median(helioterm.map((entry) => entry.elapsedMs));
  const plainBytes = median(plain.map((entry) => entry.outputBytes));
  const heliotermBytes = median(helioterm.map((entry) => entry.outputBytes));
  const report = {
    project: basename(cwd),
    projectPath: cwd,
    runs,
    requests,
    pass: plain.every((entry) => entry.pass) && helioterm.every((entry) => entry.pass),
    workingTreeUnchanged: before === after,
    plainMedianMilliseconds: plainMedian,
    heliotermMedianMilliseconds: heliotermMedian,
    latencyDifferenceMilliseconds: heliotermMedian - plainMedian,
    latencyDifferencePercent: ((heliotermMedian / plainMedian) - 1) * 100,
    plainOutputBytes: plainBytes,
    heliotermOutputBytes: heliotermBytes,
    outputReductionPercent: (1 - (heliotermBytes / plainBytes)) * 100,
    compactResult: helioterm.at(-1).result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass || !report.workingTreeUnchanged) process.exitCode = 1;
}

await main();
