#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELIOTERM_LIMITS, validateRequest } from './firewall.mjs';
import { assertWorkingDirectory, commandFor, runCommand } from './kernel.mjs';

const PARALLEL_OBSERVATIONS = new Set(['git', 'search', 'process']);

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function options(argv, name) {
  const values = [];
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) { values.push(argv[index + 1]); index += 1; }
    else if (argv[index].startsWith(prefix)) values.push(argv[index].slice(prefix.length));
  }
  return values;
}

function numberFrom(text, field) {
  const value = new RegExp(`(?:^|\\|)${field}=(\\d+)(?:\\||$)`, 'u').exec(text)?.[1];
  return value === undefined ? null : Number(value);
}

async function executePrepared(prepared, cwd) {
  const results = [];
  let parallel = [];
  const flush = async () => {
    if (!parallel.length) return;
    results.push(...await Promise.all(parallel.map((entry) => runCommand({ command: entry.command, cwd }))));
    parallel = [];
  };
  for (const entry of prepared) {
    if (PARALLEL_OBSERVATIONS.has(entry.operation)) parallel.push(entry);
    else { await flush(); results.push(await runCommand({ command: entry.command, cwd })); }
  }
  await flush();
  return results;
}

export async function runDirectBatch({ requests, cwd }) {
  const list = Array.isArray(requests) ? requests : [];
  const parsed = list.map(validateRequest);
  if (!list.length || list.length > HELIOTERM_LIMITS.maxCommandsPerRequest || parsed.some((entry) => !entry.pass)) {
    return { text: 'FAIL|calls=0|request-invalid|model=0', pass: false, elapsedMs: 0, commands: [] };
  }
  const started = performance.now();
  try {
    assertWorkingDirectory(cwd);
    const prepared = parsed.map((entry) => ({ operation: entry.operation, command: commandFor(entry.operation, entry.argument) }));
    const results = await executePrepared(prepared, cwd);
    const elapsedMs = Math.max(0, Math.round(performance.now() - started));
    if (results.length === 1) {
      const text = `${results[0].text}|ms=${elapsedMs}|model=0`;
      return { text, pass: text.startsWith('OK|'), elapsedMs, command: results[0].command, commands: [results[0].command] };
    }
    const ok = results.filter((entry) => entry.text.startsWith('OK|')).length;
    const pass = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'pass') ?? 0), 0);
    const testFail = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'fail') ?? 0), 0);
    const raw = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'raw') ?? 0), 0);
    const text = `${ok === results.length ? 'OK' : 'FAIL'}|calls=${results.length}|ok=${ok}|opfail=${results.length - ok}|pass=${pass}|testfail=${testFail}|raw=${raw}|ms=${elapsedMs}|model=0`;
    return { text, pass: ok === results.length, elapsedMs, commands: results.map((entry) => entry.command), results };
  } catch {
    return { text: 'FAIL|calls=0|runner-error|model=0', pass: false, elapsedMs: Math.max(0, Math.round(performance.now() - started)), commands: [] };
  }
}

export async function runDirect({ request, cwd }) {
  return runDirectBatch({ requests: [request], cwd });
}

export async function runCli(argv = process.argv.slice(2)) {
  const requests = options(argv, '--request');
  const cwd = resolve(option(argv, '--cwd') ?? process.cwd());
  if (!requests.length) {
    process.stderr.write('Usage: direct-runner.mjs --request <T|operation|argument> [--request <line> ...] [--cwd <directory>]\n');
    process.exitCode = 2;
    return;
  }
  const result = await runDirectBatch({ requests, cwd });
  process.stdout.write(`${result.text}\n`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
