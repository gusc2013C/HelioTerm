#!/usr/bin/env node

const milliseconds = Number(process.argv[2] ?? 100);
if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 60_000) throw new Error('wait must be 1..60000 milliseconds');
const outputBytes = Number(process.argv[3] ?? 0);
if (!Number.isInteger(outputBytes) || outputBytes < 0 || outputBytes > 5 * 1024 * 1024) throw new Error('output bytes must be 0..5242880');
const started = Date.now();
if (outputBytes) process.stdout.write('x'.repeat(outputBytes));
await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
process.stdout.write(`${JSON.stringify({ pass: true, waitedMilliseconds: Date.now() - started })}\n`);
