#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import readline from 'node:readline';
import { removeBackgroundJob } from '../scripts/job-manager.mjs';

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}
function rawBytes(text) { return Number(/\|raw=(\d+)/u.exec(text)?.[1] ?? 0); }
function createClient() {
  const child = spawn(process.execPath, ['scripts/mcp-server.mjs'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message.result); }
  });
  let nextId = 1;
  return {
    call(name, args) {
      const id = nextId++;
      const request = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
      const promise = new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
      const encoded = JSON.stringify(request);
      child.stdin.write(`${encoded}\n`);
      return { requestBytes: Buffer.byteLength(encoded, 'utf8'), promise };
    },
    close() { child.stdin.end(); },
  };
}

const rounds = Math.max(3, Number(process.argv[2] ?? 7));
const targetCwd = resolve(process.argv[3] ?? process.cwd());
const commands = [1, 2, 3, 4].map((value) => ({ program: process.execPath, args: ['-e', `process.stdout.write('${value}'.repeat(1024))`] }));
const client = createClient();
const samples = { individual: [], foreground_batch: [], background_batch: [] };
let pass = true;

async function measureIndividual() {
  const started = performance.now();
  let requestBytes = 0;
  let compactBytes = 0;
  let raw = 0;
  for (const command of commands) {
    const call = client.call('terminal', { cwd: targetCwd, adaptive: false, ...command });
    requestBytes += call.requestBytes;
    const result = await call.promise;
    const text = result.content[0].text;
    compactBytes += Buffer.byteLength(text, 'utf8');
    raw += rawBytes(text);
    pass &&= result.isError === false;
  }
  return { wall_ms: performance.now() - started, request_bytes: requestBytes, compact_bytes: compactBytes, raw_output_bytes: raw };
}
async function measureForegroundBatch() {
  const started = performance.now();
  const call = client.call('terminal_batch', { cwd: targetCwd, adaptive: false, commands });
  const result = await call.promise;
  const text = result.content[0].text;
  pass &&= result.isError === false && result.structuredContent.calls === commands.length;
  return { wall_ms: performance.now() - started, request_bytes: call.requestBytes, compact_bytes: Buffer.byteLength(text, 'utf8'), raw_output_bytes: rawBytes(text) };
}
async function measureBackgroundBatch() {
  const started = performance.now();
  const start = client.call('terminal_batch_start', { cwd: targetCwd, timeoutSeconds: 30, commands });
  const startedResult = await start.promise;
  const handle = startedResult.structuredContent.job;
  try {
    const wait = client.call('job_wait', { job: handle, timeoutSeconds: 30, adaptive: false });
    const waitedResult = await wait.promise;
    const startText = startedResult.content[0].text;
    const waitText = waitedResult.content[0].text;
    pass &&= startedResult.isError === false && waitedResult.isError === false && waitedResult.structuredContent.steps.length === commands.length;
    return {
      wall_ms: performance.now() - started,
      request_bytes: start.requestBytes + wait.requestBytes,
      compact_bytes: Buffer.byteLength(startText, 'utf8') + Buffer.byteLength(waitText, 'utf8'),
      raw_output_bytes: rawBytes(waitText),
    };
  } finally {
    removeBackgroundJob(handle);
  }
}

try {
  for (let round = 0; round < rounds; round += 1) {
    samples.individual.push(await measureIndividual());
    samples.foreground_batch.push(await measureForegroundBatch());
    samples.background_batch.push(await measureBackgroundBatch());
  }
} finally {
  client.close();
}

const summarize = (name, toolBoundaries, avoidedOwnerWakeups) => ({
  tool_boundaries: toolBoundaries,
  avoided_owner_wakeups: avoidedOwnerWakeups,
  avoided_model_sampling_boundaries: avoidedOwnerWakeups,
  median_wall_ms: Number(median(samples[name].map((sample) => sample.wall_ms)).toFixed(3)),
  raw_output_bytes: median(samples[name].map((sample) => sample.raw_output_bytes)),
  compact_response_bytes: median(samples[name].map((sample) => sample.compact_bytes)),
  request_bytes: median(samples[name].map((sample) => sample.request_bytes)),
});
process.stdout.write(`${JSON.stringify({
  schema: 'helioterm-terminal-workflow-benchmark-v1',
  pass,
  rounds,
  project: basename(targetCwd),
  commands: commands.length,
  individual: summarize('individual', 4, 0),
  terminal_batch: summarize('foreground_batch', 1, 3),
  terminal_batch_start_wait: summarize('background_batch', 2, 2),
  scope: 'local MCP transport and raw tool bytes only; Desktop quota and provider billing not inferred',
})}\n`);
if (!pass) process.exitCode = 1;
