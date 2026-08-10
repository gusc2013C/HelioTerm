#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachAdaptiveRoute } from './adaptive-channel.mjs';
import { cancelBackgroundJob, confirmBackgroundJobStart, startBackgroundTerminalBatchJob, startBackgroundTerminalJob, waitBackgroundJob } from './job-manager.mjs';
import { evidenceOutput } from './kernel.mjs';
import { replaceCompactTokenSavings } from './token-savings.mjs';
import { runTerminalCommand } from './terminal-transport.mjs';

function runnerArguments(argv) {
  const delimiter = argv.indexOf('--');
  return delimiter < 0 ? argv : argv.slice(0, delimiter);
}

function trailingArguments(argv) {
  const delimiter = argv.indexOf('--');
  return delimiter < 0 ? [] : argv.slice(delimiter + 1);
}

function options(argv, name) {
  const valuesToScan = runnerArguments(argv);
  const values = [];
  for (let index = 0; index < valuesToScan.length; index += 1) {
    if (valuesToScan[index] === name && valuesToScan[index + 1] !== undefined) {
      values.push(valuesToScan[index + 1]);
      index += 1;
    }
  }
  return values;
}

function option(argv, name) { return options(argv, name)[0]; }
function flag(argv, name) { return runnerArguments(argv).includes(name); }

function clipUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of String(value ?? '')) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function appendFacts(text, facts) {
  const suffix = `${facts.length ? `|${facts.join('|')}` : ''}|model=0`;
  const base = text.replace(/\|model=0$/u, '');
  return `${clipUtf8(base, Math.max(0, 256 - Buffer.byteLength(suffix, 'utf8')))}${suffix}`;
}

function environment(argv) {
  return Object.fromEntries(options(argv, '--env').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) throw new Error('--env requires NAME=VALUE');
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

function terminalSpec(argv) {
  const program = option(argv, '--program');
  const shell = option(argv, '--shell');
  const input = option(argv, '--stdin');
  const inputBase64url = option(argv, '--stdin-base64url');
  if (input !== undefined && inputBase64url !== undefined) throw new Error('choose --stdin or --stdin-base64url');
  if (inputBase64url !== undefined && (!/^[A-Za-z0-9_-]*$/u.test(inputBase64url) || inputBase64url.length % 4 === 1)) {
    throw new Error('--stdin-base64url must be valid base64url');
  }
  const stdin = inputBase64url === undefined ? input : Buffer.from(inputBase64url, 'base64url').toString('utf8');
  return {
    ...(program !== undefined ? { program, args: [...options(argv, '--arg'), ...trailingArguments(argv)] } : {}),
    ...(shell !== undefined ? { shell, script: option(argv, '--script') } : {}),
    env: environment(argv),
    ...(stdin !== undefined ? { stdin } : {}),
  };
}

function integerOption(argv, name, fallback) {
  const value = option(argv, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer`);
  return Number(value);
}

export async function runTerminalDirect({
  terminal,
  cwd,
  timeoutMilliseconds = 240_000,
  responseMode = 'compact',
  maxBytes = 8192,
  adaptive = true,
  semantic = false,
}) {
  const result = await runTerminalCommand({ terminal, cwd, timeoutMilliseconds, responseMode, maxBytes });
  if (responseMode === 'evidence') return result;
  const baseText = appendFacts(result.text, [
    ...(result.windowsShimRetry ? ['shim=windows'] : []),
    `ms=${result.durationMilliseconds}`,
  ]);
  const base = {
    ...result,
    text: baseText,
    pass: result.text.startsWith('OK|'),
    savings: replaceCompactTokenSavings(result.savings, baseText),
  };
  if (!adaptive) return base;
  const routed = attachAdaptiveRoute({ result: base, semantic, cwd });
  if (!routed.adaptive?.routed) return routed;
  const text = appendFacts(routed.text, []);
  return { ...routed, text, savings: replaceCompactTokenSavings(routed.savings, text) };
}

export async function runCli(argv = process.argv.slice(2)) {
  const cwd = resolve(option(argv, '--cwd') ?? process.cwd());
  try {
    const timeoutSeconds = integerOption(argv, '--timeout-seconds', 240);
    if (timeoutSeconds < 1 || timeoutSeconds > 43200) throw new Error('--timeout-seconds must be 1..43200');
    const cancelHandle = option(argv, '--cancel-job');
    if (cancelHandle !== undefined) {
      const cancelled = cancelBackgroundJob(cancelHandle);
      process.stdout.write(`OK|calls=0|status=${cancelled.state.status}|job=${cancelHandle}|cancelled=${cancelled.cancelled ? 1 : 0}|background=1|model=0\n`);
      return;
    }
    const waitHandle = option(argv, '--wait-job');
    if (waitHandle !== undefined) {
      const waited = await waitBackgroundJob({ handle: waitHandle, timeoutMilliseconds: timeoutSeconds * 1000 });
      if (!waited.completed) {
        process.stdout.write(`MORE|calls=0|status=${waited.state.status}|job=${waitHandle}|background=1|waitMs=${waited.waitedMilliseconds}|polls=0|model=0\n`);
        return;
      }
      if (!waited.state.result) throw new Error(waited.state.error ?? 'background worker failed');
      const stored = waited.state.result;
      const facts = [
        'background=1', `job=${waitHandle}`,
        ...(waited.state.operation.startsWith('terminal') ? ['terminal=1'] : []),
        ...(waited.state.operation === 'terminal_batch' ? ['batch=1', `wakeupsAvoided=${stored.avoidedOwnerWakeups}`, `boundariesAvoided=${stored.avoidedSamplingBoundaries}`] : []),
        'polls=0', `waitMs=${waited.waitedMilliseconds}`,
      ];
      if (flag(argv, '--evidence')) {
        const evidence = evidenceOutput({
          exitCode: stored.exitCode ?? (stored.text?.startsWith('FAIL|') ? 1 : 0),
          stdout: stored.evidenceBody ?? stored.adaptiveEvidence ?? '',
          operation: waited.state.operation,
          command: stored.command,
          maxBytes: integerOption(argv, '--evidence-bytes', 8192),
          rawBytesOverride: stored.rawBytes ?? stored.savings?.rawBytes ?? null,
          facts,
        });
        process.stdout.write(`${evidence.text}\n`);
        if (!evidence.pass) process.exitCode = 1;
        return;
      }
      const baseText = appendFacts(stored.text, facts);
      const base = { ...stored, text: baseText, pass: baseText.startsWith('OK|'), savings: replaceCompactTokenSavings(stored.savings, baseText) };
      const routed = flag(argv, '--no-adaptive')
        ? base
        : attachAdaptiveRoute({ result: base, semantic: flag(argv, '--semantic'), cwd: waited.state.cwd });
      const text = routed.adaptive?.routed ? appendFacts(routed.text, []) : routed.text;
      process.stdout.write(`${text}\n`);
      if (!base.pass) process.exitCode = 1;
      return;
    }
    const batchPayload = option(argv, '--background-batch-base64url');
    if (batchPayload !== undefined) {
      if (!/^[A-Za-z0-9_-]+$/u.test(batchPayload) || batchPayload.length % 4 === 1) throw new Error('--background-batch-base64url must be valid base64url');
      let commands;
      try { commands = JSON.parse(Buffer.from(batchPayload, 'base64url').toString('utf8')); } catch { throw new Error('--background-batch-base64url must encode a JSON command array'); }
      const started = startBackgroundTerminalBatchJob({
        commands,
        allowedKeys: new Set(['program', 'args', 'shell', 'script', 'env', 'stdin']),
        cwd,
        timeoutMilliseconds: timeoutSeconds * 1000,
      });
      const confirmed = await confirmBackgroundJobStart({ handle: started.handle });
      const failed = confirmed.state.status === 'failed';
      process.stdout.write(`${failed ? 'FAIL' : 'MORE'}|calls=0|requested=${commands.length}|status=${confirmed.state.status}|job=${started.handle}|background=1|terminal=1|batch=1|startupMs=${confirmed.waitedMilliseconds}|polls=0|model=0\n`);
      if (failed) process.exitCode = 1;
      return;
    }
    const terminal = terminalSpec(argv);
    if (flag(argv, '--background')) {
      const started = startBackgroundTerminalJob({ terminal, cwd, timeoutMilliseconds: timeoutSeconds * 1000 });
      const confirmed = await confirmBackgroundJobStart({ handle: started.handle });
      const failed = confirmed.state.status === 'failed';
      process.stdout.write(`${failed ? 'FAIL' : 'MORE'}|calls=0|status=${confirmed.state.status}|job=${started.handle}|background=1|terminal=1|startupMs=${confirmed.waitedMilliseconds}|polls=0|model=0\n`);
      if (failed) process.exitCode = 1;
      return;
    }
    const responseMode = flag(argv, '--evidence') ? 'evidence' : 'compact';
    const result = await runTerminalDirect({
      terminal,
      cwd,
      timeoutMilliseconds: timeoutSeconds * 1000,
      responseMode,
      maxBytes: integerOption(argv, '--evidence-bytes', 8192),
      adaptive: !flag(argv, '--no-adaptive'),
      semantic: flag(argv, '--semantic'),
    });
    process.stdout.write(`${result.text}\n`);
    if (!result.pass && !result.text.startsWith('OK|')) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`FAIL|calls=0|terminal-error=${String(error.message).replace(/\|/gu, '/').slice(0, 180)}|model=0\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
