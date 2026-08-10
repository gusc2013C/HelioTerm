#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { JOB_DIRECTORY } from '../scripts/job-manager.mjs';

const waitMilliseconds = Number(process.argv[2] ?? 12_000);
if (!Number.isInteger(waitMilliseconds) || waitMilliseconds < 100 || waitMilliseconds > 60_000) throw new Error('wait must be 100..60000 milliseconds');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = spawn(process.execPath, ['scripts/mcp-server.mjs'], {
  cwd: root,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let sequence = 0;
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const response = JSON.parse(line);
  const callback = pending.get(response.id);
  if (callback) { pending.delete(response.id); callback.resolve(response); }
});

function call(name, args) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
  return promise;
}

const watchdog = setTimeout(() => {
  for (const callback of pending.values()) callback.reject(new Error(`acceptance timeout: ${stderr}`));
  server.kill();
}, waitMilliseconds + 30_000);

let handle = null;
try {
  const startedAt = Date.now();
  const started = await call('job_start', {
    operation: 'bench',
    argument: `benchmarks/supervise-wait.mjs ${waitMilliseconds}`,
    cwd: root,
    timeoutSeconds: Math.ceil(waitMilliseconds / 1000) + 10,
  });
  handle = started.result.structuredContent.job;
  const observed = await call('observe', {
    operation: 'git', argument: 'status --short', cwd: root, adaptive: false,
  });
  const observationMilliseconds = Date.now() - startedAt;
  const completed = await call('job_wait', {
    job: handle, timeoutSeconds: Math.ceil(waitMilliseconds / 1000) + 20, adaptive: true,
  });
  const totalMilliseconds = Date.now() - startedAt;
  const proof = {
    pass: completed.result.structuredContent.status === 'completed'
      && completed.result.structuredContent.modelPolls === 0
      && observationMilliseconds < waitMilliseconds
      && /^OK\|/u.test(observed.result.content[0].text),
    waitMilliseconds,
    observationMilliseconds,
    totalMilliseconds,
    jobWaitCalls: 1,
    modelPolls: completed.result.structuredContent.modelPolls,
    backgroundStatus: completed.result.structuredContent.status,
    observeBeforeCompletion: observationMilliseconds < waitMilliseconds,
    finalBytes: Buffer.byteLength(completed.result.content[0].text, 'utf8'),
  };
  process.stdout.write(`${JSON.stringify(proof)}\n`);
  if (!proof.pass) process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  server.stdin.end();
  if (handle) {
    try { unlinkSync(join(JOB_DIRECTORY, `${handle}.json`)); } catch { /* best effort */ }
  }
}
