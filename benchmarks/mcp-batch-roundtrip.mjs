#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import readline from 'node:readline';

const PROFILES = Object.freeze({
  node: Object.freeze([
    { operation: 'git', argument: 'status --short' },
    { operation: 'files', argument: 'tests' },
    { operation: 'json', argument: 'package.json' },
    { operation: 'count', argument: 'scripts/mcp-server.mjs tests/mcp-server.test.mjs' },
  ]),
  python: Object.freeze([
    { operation: 'git', argument: 'status --short' },
    { operation: 'files', argument: 'tests' },
    { operation: 'list', argument: 'src' },
    { operation: 'count', argument: 'main.py README.md requirements.txt' },
  ]),
  generic: Object.freeze([
    { operation: 'git', argument: 'status --short' },
    { operation: 'files', argument: 'tests' },
    { operation: 'list', argument: 'plugins' },
    { operation: 'count', argument: 'README.md CHANGELOG.md' },
  ]),
});

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
      const promise = new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
      child.stdin.write(`${JSON.stringify(request)}\n`);
      return { requestBytes: Buffer.byteLength(JSON.stringify(request), 'utf8'), promise };
    },
    close() { child.stdin.end(); },
  });
}

const rounds = Math.max(3, Number(process.argv[2] ?? 15));
const cwd = resolve(process.argv[3] ?? process.cwd());
const profile = process.argv[4] ?? 'node';
const requests = PROFILES[profile];
if (!requests) throw new Error(`profile must be one of: ${Object.keys(PROFILES).join(', ')}`);
const client = createClient();
const baselineMs = [];
const batchMs = [];
let baselineRequestBytes = 0;
let batchRequestBytes = 0;
let baselineBytes = 0;
let batchBytes = 0;
let pass = true;

try {
  for (let round = 0; round < rounds; round += 1) {
    const baselineStarted = performance.now();
    let requestBytes = 0;
    let responseBytes = 0;
    for (const request of requests) {
      const pending = client.call('observe', { ...request, cwd, adaptive: false });
      requestBytes += pending.requestBytes;
      const response = await pending.promise;
      responseBytes += Buffer.byteLength(response.result.content[0].text, 'utf8');
      pass &&= response.result.isError === false;
    }
    baselineMs.push(performance.now() - baselineStarted);
    baselineRequestBytes = requestBytes;
    baselineBytes = responseBytes;

    const batchStarted = performance.now();
    const pending = client.call('batch', { cwd, adaptive: false, requests });
    batchRequestBytes = pending.requestBytes;
    const response = await pending.promise;
    batchMs.push(performance.now() - batchStarted);
    batchBytes = Buffer.byteLength(response.result.content[0].text, 'utf8');
    pass &&= response.result.isError === false && response.result.structuredContent.calls === requests.length;
  }
} finally {
  client.close();
}

const baselineMedian = median(baselineMs);
const batchMedian = median(batchMs);
process.stdout.write(`${JSON.stringify({
  pass,
  rounds,
  project: basename(cwd),
  profile,
  observations: requests.length,
  baseline: { model_tool_round_trips: 4, median_ms: Number(baselineMedian.toFixed(3)), request_bytes: baselineRequestBytes, compact_bytes: baselineBytes },
  batch: { model_tool_round_trips: 1, median_ms: Number(batchMedian.toFixed(3)), request_bytes: batchRequestBytes, compact_bytes: batchBytes },
  reduction: {
    model_tool_round_trips_percent: 75,
    request_bytes_percent: Number((((baselineRequestBytes - batchRequestBytes) / baselineRequestBytes) * 100).toFixed(2)),
    compact_bytes_percent: Number((((baselineBytes - batchBytes) / baselineBytes) * 100).toFixed(2)),
    local_latency_percent: Number((((baselineMedian - batchMedian) / baselineMedian) * 100).toFixed(2)),
  },
  scope: 'local deterministic transport; provider billing not inferred',
})}\n`);
if (!pass) process.exitCode = 1;
