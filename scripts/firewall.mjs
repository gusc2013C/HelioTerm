#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidOperationArgument, OPERATIONS } from './kernel.mjs';
import { measureTokenSavings } from './token-savings.mjs';

export const HELIOTERM_LIMITS = Object.freeze({ maxRequests: 8, maxCommandsPerRequest: 4, maxRequestBytes: 256, maxResponseBytes: 256 });
const RESPONSE_KINDS = new Set(['OK', 'FAIL', 'MATCH', 'MORE']);
const check = (name, pass, actual, expected) => ({ name, pass: Boolean(pass), actual, ...(expected === undefined ? {} : { expected }) });
export const utf8Bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');

export function validateRequest(request) {
  const match = typeof request === 'string' ? /^T\|([a-z]+)\|([^\r\n]+)$/u.exec(request) : null;
  const bytes = utf8Bytes(request);
  const operation = match?.[1] ?? null;
  const argument = match?.[2] ?? null;
  const checks = [
    check('request-shape', Boolean(match), request ?? null, 'T|operation|argument on one line'),
    check('request-operation', OPERATIONS.has(operation), operation, [...OPERATIONS]),
    ...(OPERATIONS.has(operation) ? [check('operation-argument', isValidOperationArgument(operation, argument), argument, 'safe arguments for the selected operation')] : []),
    check('request-byte-limit', bytes <= HELIOTERM_LIMITS.maxRequestBytes, bytes, HELIOTERM_LIMITS.maxRequestBytes),
  ];
  return { pass: checks.every((entry) => entry.pass), bytes, operation, argument, checks };
}

// Static guidance only: rejected paths, arguments, and payloads stay out of output.
export function formatRequestRejection(validation, { index = 1, evidence = false } = {}) {
  const reason = validation.bytes > HELIOTERM_LIMITS.maxRequestBytes
    ? 'request-byte-limit'
    : validation.checks.find((entry) => !entry.pass)?.name ?? 'request-shape';
  const hints = {
    'request-byte-limit': 'max256-UTF8-bytes',
    'request-shape': 'one-line T/operation/argument',
    'request-operation': 'supported operation required',
    'operation-argument': {
      read: 'read path [start>=1] [count=1..200]',
      list: 'list directory',
      files: 'files relative-directory',
      json: 'json path [selector ...]',
      git: 'read-only git arguments',
    }[validation.operation] ?? 'check operation syntax',
  };
  return `FAIL|calls=0|${evidence ? 'evidence-' : ''}request-invalid|at=${index}|reason=${reason}|hint=${hints[reason]}|model=0`;
}

export function validateResponse(response) {
  const match = typeof response === 'string' ? /^(OK|FAIL|MATCH|MORE)\|([^\r\n]+)$/u.exec(response) : null;
  const bytes = utf8Bytes(response);
  const kind = match?.[1] ?? null;
  const checks = [
    check('response-shape', Boolean(match), response ?? null, 'one compact result line'),
    check('response-kind', RESPONSE_KINDS.has(kind), kind, [...RESPONSE_KINDS]),
    check('response-byte-limit', bytes <= HELIOTERM_LIMITS.maxResponseBytes, bytes, HELIOTERM_LIMITS.maxResponseBytes),
  ];
  return { pass: checks.every((entry) => entry.pass), bytes, kind, observation: match?.[2] ?? null, checks };
}

export function measureExchange({ request, response, commands, rawOutput = '' }) {
  const requestResult = validateRequest(request);
  const responseResult = validateResponse(response);
  const claimed = typeof response === 'string' ? Number(/(?:^|\|)calls=(\d+)(?:\||$)/u.exec(response)?.[1] ?? Number.NaN) : Number.NaN;
  const checks = [
    ...requestResult.checks,
    ...responseResult.checks,
    check('command-budget', Number.isSafeInteger(commands) && commands >= 0 && commands <= HELIOTERM_LIMITS.maxCommandsPerRequest, commands, `integer 0..${HELIOTERM_LIMITS.maxCommandsPerRequest}`),
    check('response-command-count', Number.isSafeInteger(claimed) && claimed === commands, Number.isSafeInteger(claimed) ? claimed : null, commands),
  ];
  const rawOutputBytes = utf8Bytes(rawOutput);
  const savings = measureTokenSavings({ rawText: rawOutput, compactText: response ?? '' });
  return {
    schemaVersion: 'HELIOTERM_EXCHANGE_V1',
    pass: checks.every((entry) => entry.pass),
    request,
    response,
    commands,
    metrics: {
      requestBytes: requestResult.bytes,
      responseBytes: responseResult.bytes,
      rawOutputBytes,
      compressedBytes: responseResult.bytes,
      compressionRatio: rawOutputBytes > 0 ? responseResult.bytes / rawOutputBytes : null,
      estimatedRawTokens: savings.rawEstimatedTokens,
      estimatedCompressedTokens: savings.compactEstimatedTokens,
      estimatedTokensSaved: savings.savedEstimatedTokens,
      tokenEstimator: savings.estimator,
    },
    checks,
  };
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function runCli(argv = process.argv.slice(2)) {
  const request = option(argv, '--request');
  const response = option(argv, '--response');
  const commandValue = option(argv, '--commands');
  if (request === undefined || response === undefined || !/^\d+$/u.test(commandValue ?? '')) {
    process.stderr.write('Usage: firewall.mjs --request <line> --response <line> --commands <0..4> [--raw-output <path>]\n');
    process.exitCode = 2;
    return;
  }
  const rawPath = option(argv, '--raw-output');
  const result = measureExchange({ request, response, commands: Number(commandValue), rawOutput: rawPath ? readFileSync(resolve(rawPath), 'utf8') : '' });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
