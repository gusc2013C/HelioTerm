#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextForAdaptiveTicket } from './adaptive-channel.mjs';

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function runCli(argv = process.argv.slice(2)) {
  const ticket = option(argv, '--ticket');
  if (!/^[A-Za-z0-9_-]{16}$/u.test(ticket ?? '')) {
    process.stderr.write('Usage: luna-ticket-reader.mjs --ticket <opaque-ticket>\n');
    process.exitCode = 2;
    return;
  }
  const context = contextForAdaptiveTicket(ticket);
  process.stdout.write(`${context.prompt}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
