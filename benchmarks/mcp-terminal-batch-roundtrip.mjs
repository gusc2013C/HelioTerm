#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import readline from 'node:readline';

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function createClient() {
  const child = spawn(process.execPath, ['scripts/mcp-server.mjs'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  const failPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.once('error', failPending);
  child.once('exit', (code) => { if (pending.size) failPending(new Error(`MCP server exited before replying: ${code}`)); });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message); }
  });
  let nextId = 1;
  return Object.freeze({
    call(name, args) {
      const id = nextId++;
      const request = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify(request)}\n`);
      return { requestBytes: Buffer.byteLength(JSON.stringify(request), 'utf8'), promise };
    },
    close() { child.stdin.end(); },
  });
}

const rounds = Math.max(3, Number(process.argv[2] ?? 15));
const targetCwd = resolve(process.argv[3] ?? process.cwd());
const client = createClient();
const commands = [1, 2, 3, 4].map((value) => ({ program: process.execPath, args: ['-e', `process.stdout.write('${value}')`] }));
const baselineMs = [];
const batchMs = [];
let baselineRequestBytes = 0;
let baselineResponseBytes = 0;
let batchRequestBytes = 0;
let batchResponseBytes = 0;
let pass = true;

try {
  for (let round = 0; round < rounds; round += 1) {
    const baselineStarted = performance.now();
    let requestBytes = 0;
    let responseBytes = 0;
    for (const command of commands) {
      const pending = client.call('terminal', { cwd: targetCwd, adaptive: false, ...command });
      requestBytes += pending.requestBytes;
      const response = await pending.promise;
      const result = response.result;
      responseBytes += Buffer.byteLength(result.content[0].text, 'utf8');
      pass &&= result.isError === false;
    }
    baselineMs.push(performance.now() - baselineStarted);
    baselineRequestBytes = requestBytes;
    baselineResponseBytes = responseBytes;

    const batchStarted = performance.now();
    const pending = client.call('terminal_batch', { cwd: targetCwd, adaptive: false, commands });
    batchRequestBytes = pending.requestBytes;
    const response = await pending.promise;
    batchMs.push(performance.now() - batchStarted);
    batchResponseBytes = Buffer.byteLength(response.result.content[0].text, 'utf8');
    pass &&= response.result.isError === false && response.result.structuredContent.calls === 4;
  }
} finally {
  client.close();
}

const baselineMedian = median(baselineMs);
const batchMedian = median(batchMs);
process.stdout.write(`${JSON.stringify({
  pass,
  rounds,
  project: basename(targetCwd),
  commands: commands.length,
  baseline: { model_tool_round_trips: 4, median_ms: Number(baselineMedian.toFixed(3)), request_bytes: baselineRequestBytes, compact_bytes: baselineResponseBytes },
  batch: { model_tool_round_trips: 1, median_ms: Number(batchMedian.toFixed(3)), request_bytes: batchRequestBytes, compact_bytes: batchResponseBytes },
  reduction: {
    model_tool_round_trips_percent: 75,
    request_bytes_percent: Number((((baselineRequestBytes - batchRequestBytes) / baselineRequestBytes) * 100).toFixed(2)),
    compact_bytes_percent: Number((((baselineResponseBytes - batchResponseBytes) / baselineResponseBytes) * 100).toFixed(2)),
    local_latency_percent: Number((((baselineMedian - batchMedian) / baselineMedian) * 100).toFixed(2)),
  },
  semantics: 'sequential, atomically validated, stop on first failure, model=0',
  scope: 'local MCP transport; provider billing not inferred',
})}\n`);
if (!pass) process.exitCode = 1;
