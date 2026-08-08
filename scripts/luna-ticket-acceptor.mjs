#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptAdaptiveLunaResponse } from './adaptive-channel.mjs';

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function runCli(argv = process.argv.slice(2)) {
  const ticket = option(argv, '--ticket');
  const encoded = option(argv, '--response-base64url');
  if (!/^[A-Za-z0-9_-]{16}$/u.test(ticket ?? '') || !/^[A-Za-z0-9_-]{3,1024}$/u.test(encoded ?? '')) {
    process.stderr.write('Usage: luna-ticket-acceptor.mjs --ticket <opaque-ticket> --response-base64url <encoded-json>\n');
    process.exitCode = 2;
    return;
  }
  const response = Buffer.from(encoded, 'base64url').toString('utf8');
  if (Buffer.byteLength(response, 'utf8') > 512) throw new Error('Luna response exceeds 512 bytes');
  const accepted = acceptAdaptiveLunaResponse({ ticket, response });
  process.stdout.write(`${JSON.stringify({
    accepted: accepted.accepted,
    reason: accepted.reason,
    text: accepted.text,
    effort: accepted.effort,
    metrics: accepted.metrics,
  })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
