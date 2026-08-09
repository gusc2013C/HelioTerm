#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELIOTERM_LIMITS, validateRequest } from './firewall.mjs';
import { assertWorkingDirectory, commandFor, runCommand } from './kernel.mjs';
import { attachAdaptiveRoute } from './adaptive-channel.mjs';
import { aggregateTokenSavings } from './token-savings.mjs';

const PARALLEL_OBSERVATIONS = new Set(['git', 'search', 'files', 'process', 'read', 'list', 'json', 'stat', 'deps', 'version']);

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

function observationCount(text) {
  for (const field of ['lines', 'matches', 'files', 'changes', 'records', 'rows', 'issues', 'entries', 'keys', 'packages']) {
    const value = numberFrom(text, field);
    if (value !== null) return value;
  }
  return null;
}

function stringFrom(text, field) {
  return new RegExp(`(?:^|\\|)${field}=([^|]*)(?:\\||$)`, 'u').exec(text)?.[1] ?? null;
}

function clipUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function withSuffix(prefix, suffix, maxBytes = HELIOTERM_LIMITS.maxResponseBytes) {
  const budget = maxBytes - Buffer.byteLength(suffix, 'utf8');
  return `${clipUtf8(prefix, Math.max(0, budget))}${suffix}`;
}

async function executePrepared(prepared, cwd) {
  const results = [];
  let parallel = [];
  const flush = async () => {
    if (!parallel.length) return;
    results.push(...await Promise.all(parallel.map((entry) => runCommand({ command: entry.command, cwd, operation: entry.operation }))));
    parallel = [];
  };
  for (const entry of prepared) {
    if (PARALLEL_OBSERVATIONS.has(entry.operation)) parallel.push(entry);
    else { await flush(); results.push(await runCommand({ command: entry.command, cwd, operation: entry.operation })); }
  }
  await flush();
  return results;
}

export async function runDirectBatch({ requests, cwd, adaptive = false, semantic = false }) {
  const list = Array.isArray(requests) ? requests : [];
  const parsed = list.map(validateRequest);
  if (!list.length || list.length > HELIOTERM_LIMITS.maxCommandsPerRequest || parsed.some((entry) => !entry.pass)) {
    return { text: 'FAIL|calls=0|request-invalid|model=0', pass: false, elapsedMs: 0, commands: [] };
  }
  const started = performance.now();
  try {
    assertWorkingDirectory(cwd);
    const prepared = parsed.map((entry) => ({ operation: entry.operation, command: commandFor(entry.operation, entry.argument, cwd) }));
    const results = await executePrepared(prepared, cwd);
    const elapsedMs = Math.max(0, Math.round(performance.now() - started));
    if (results.length === 1) {
      const baseText = withSuffix(results[0].text, `|ms=${elapsedMs}|model=0`);
      const base = { ...results[0], text: baseText, savings: aggregateTokenSavings([results[0].savings], baseText) };
      const routed = adaptive ? attachAdaptiveRoute({ result: base, semantic, cwd }) : base;
      const text = routed.adaptive?.routed ? withSuffix(routed.text, '|model=0') : routed.text;
      return {
        ...routed,
        text,
        pass: results[0].text.startsWith('OK|'),
        elapsedMs,
        command: results[0].command,
        commands: [results[0].command],
        savings: aggregateTokenSavings([results[0].savings], text),
      };
    }
    const ok = results.filter((entry) => entry.text.startsWith('OK|')).length;
    const allOk = ok === results.length;
    const pass = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'pass') ?? 0), 0);
    const testFail = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'fail') ?? 0), 0);
    const raw = results.reduce((sum, entry) => sum + (numberFrom(entry.text, 'raw') ?? 0), 0);
    const observations = results.map((entry) => {
      const count = observationCount(entry.text);
      const status = allOk ? '' : `:${entry.text.startsWith('OK|') ? 'ok' : 'fail'}`;
      return `${entry.operation}${status}${count === null ? '' : `/${count}`}`;
    }).join(',');
    const failedResults = results.filter((entry) => !entry.text.startsWith('OK|'));
    const more = results.filter((entry) => /(?:^|\|)more=1(?:\||$)/u.test(entry.text)).length;
    const sampleResults = failedResults.length ? failedResults : results;
    const sampleBytes = failedResults.length ? 96 : 36;
    const samples = sampleResults
      .map((entry) => ({ operation: entry.operation, sample: stringFrom(entry.text, 'sample') }))
      .filter((entry) => entry.sample)
      .map((entry) => `${entry.operation}:${clipUtf8(entry.sample.replace(/;/gu, ','), sampleBytes)}`)
      .join(';');
    const health = allOk ? '' : `|ok=${ok}|opfail=${results.length - ok}`;
    const tests = pass || testFail ? `|pass=${pass}${testFail ? `|testfail=${testFail}` : ''}` : '';
    const prefix = `${allOk ? 'OK' : 'FAIL'}|calls=${results.length}${health}${tests}|ops=${observations}${more ? `|more=${more}` : ''}${samples ? `|sample=${samples}` : ''}`;
    const baseText = withSuffix(prefix, `|raw=${raw}|ms=${elapsedMs}|model=0`);
    const base = { text: baseText, pass: allOk, elapsedMs, commands: results.map((entry) => entry.command), results, savings: aggregateTokenSavings(results.map((entry) => entry.savings), baseText) };
    const routed = adaptive ? attachAdaptiveRoute({ result: base, results, semantic, cwd }) : base;
    const text = routed.adaptive?.routed ? withSuffix(routed.text, '|model=0') : routed.text;
    return { ...routed, text, pass: allOk, savings: aggregateTokenSavings(results.map((entry) => entry.savings), text) };
  } catch {
    return { text: 'FAIL|calls=0|runner-error|model=0', pass: false, elapsedMs: Math.max(0, Math.round(performance.now() - started)), commands: [] };
  }
}

export async function runDirect({ request, cwd, adaptive = false, semantic = false }) {
  return runDirectBatch({ requests: [request], cwd, adaptive, semantic });
}

export async function runCli(argv = process.argv.slice(2)) {
  const requests = options(argv, '--request');
  const cwd = resolve(option(argv, '--cwd') ?? process.cwd());
  if (!requests.length) {
    process.stderr.write('Usage: direct-runner.mjs --request <T|operation|argument> [--request <line> ...] [--cwd <directory>] [--semantic] [--no-adaptive]\n');
    process.exitCode = 2;
    return;
  }
  const result = await runDirectBatch({ requests, cwd, adaptive: !argv.includes('--no-adaptive'), semantic: argv.includes('--semantic') });
  process.stdout.write(`${result.text}\n`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
