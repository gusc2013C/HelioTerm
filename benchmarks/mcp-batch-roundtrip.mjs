#!/usr/bin/env node

import { runDirectBatch } from '../scripts/direct-runner.mjs';
import { runOperation } from '../scripts/kernel.mjs';

const requests = Object.freeze([
  { operation: 'git', argument: 'status --short' },
  { operation: 'files', argument: 'tests' },
  { operation: 'json', argument: 'package.json' },
  { operation: 'count', argument: 'scripts/mcp-server.mjs tests/mcp-server.test.mjs' },
]);

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

const rounds = Math.max(3, Number(process.argv[2] ?? 15));
const baselineRequestBytes = requests.reduce((sum, request, index) => sum + Buffer.byteLength(JSON.stringify({
  jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'observe', arguments: { ...request, cwd: process.cwd(), adaptive: false } },
}), 'utf8'), 0);
const batchRequestBytes = Buffer.byteLength(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'batch', arguments: { cwd: process.cwd(), adaptive: false, requests } },
}), 'utf8');
const baselineMs = [];
const batchMs = [];
let baselineBytes = 0;
let batchBytes = 0;
let pass = true;

for (let round = 0; round < rounds; round += 1) {
  const baselineStarted = performance.now();
  const baseline = [];
  for (const request of requests) baseline.push(await runOperation({ ...request, cwd: process.cwd() }));
  baselineMs.push(performance.now() - baselineStarted);
  baselineBytes = baseline.reduce((sum, result) => sum + Buffer.byteLength(result.text, 'utf8'), 0);
  pass &&= baseline.every((result) => result.text.startsWith('OK|'));

  const batchStarted = performance.now();
  const batch = await runDirectBatch({
    requests: requests.map((request) => `T|${request.operation}|${request.argument}`),
    cwd: process.cwd(), adaptive: false,
  });
  batchMs.push(performance.now() - batchStarted);
  batchBytes = Buffer.byteLength(batch.text, 'utf8');
  pass &&= batch.pass;
}

const baselineMedian = median(baselineMs);
const batchMedian = median(batchMs);
process.stdout.write(`${JSON.stringify({
  pass,
  rounds,
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
