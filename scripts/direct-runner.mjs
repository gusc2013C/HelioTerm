#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest } from './firewall.mjs';
import { runOperation } from './mcp-server.mjs';

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export async function runDirect({ request, cwd }) {
  const parsed = validateRequest(request);
  if (!parsed.pass) return { text: 'FAIL|calls=0|request-invalid|model=0', pass: false, elapsedMs: 0 };
  const started = performance.now();
  try {
    const result = await runOperation({ operation: parsed.operation, argument: parsed.argument, cwd });
    const elapsedMs = Math.max(0, Math.round(performance.now() - started));
    const text = `${result.text}|ms=${elapsedMs}|model=0`;
    return { text, pass: text.startsWith('OK|'), elapsedMs, command: result.command };
  } catch {
    return { text: 'FAIL|calls=0|runner-error|model=0', pass: false, elapsedMs: Math.max(0, Math.round(performance.now() - started)) };
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const request = option(argv, '--request');
  const cwd = resolve(option(argv, '--cwd') ?? process.cwd());
  if (request === undefined) {
    process.stderr.write('Usage: direct-runner.mjs --request <T|operation|argument> [--cwd <directory>]\n');
    process.exitCode = 2;
    return;
  }
  const result = await runDirect({ request, cwd });
  process.stdout.write(`${result.text}\n`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
