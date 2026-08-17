#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ContentCompressionService } from '../scripts/content-compression.mjs';
import { HeadroomMcpClient } from '../scripts/headroom-mcp-client.mjs';

const MAX_VISIBLE_BYTES = 32768;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function clipUtf8(value, maxBytes = MAX_VISIBLE_BYTES) {
  let output = '';
  let bytes = 0;
  for (const character of String(value ?? '')) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value) { return value === null ? null : Number(value.toFixed(3)); }

function commandOutput(program, args) {
  const result = spawnSync(program, args, { cwd: process.cwd(), encoding: 'utf8', timeout: 120000, windowsHide: true });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function corpus() {
  const json = JSON.stringify(Array.from({ length: 240 }, (_, index) => ({
    id: index,
    status: index === 173 ? 'error' : 'ok',
    latency_ms: index === 121 ? 99001 : 12 + (index % 7),
    message: index === 173 ? 'SENTINEL_JSON_FAILURE database unavailable' : `request ${index} completed ${'x'.repeat(90)}`,
  })), null, 2);
  const logs = Array.from({ length: 600 }, (_, index) => {
    if (index === 417) return `2026-08-10T12:34:56Z ERROR SENTINEL_LOG_FAILURE timeout_ms=90001 request=${index}`;
    const level = index % 97 === 0 ? 'WARN' : 'INFO';
    return `2026-08-10T12:${String(index % 60).padStart(2, '0')}:00Z ${level} request=${index} latency_ms=${10 + (index % 9)} route=/api/items`;
  }).join('\n');
  const tap = `${commandOutput(process.execPath, ['--test', 'tests/content-compression.test.mjs'])}\n# SENTINEL_TAP_SUMMARY`;
  const code = `${readFileSync('scripts/content-compression.mjs', 'utf8')}\n// SENTINEL_CODE_MARKER`;
  const diffBody = commandOutput('git', ['diff', '--', 'scripts/mcp-server.mjs']);
  const diff = `${diffBody || 'diff --git a/example.js b/example.js\n--- a/example.js\n+++ b/example.js\n@@ -1 +1 @@\n-old\n+new'}\n+SENTINEL_DIFF_MARKER`;
  const docs = `${readFileSync('README.md', 'utf8')}\nSENTINEL_DOC_MARKER`;
  const prose = Array.from({ length: 160 }, (_, index) => index === 93
    ? 'The approved deployment policy is SENTINEL_POLICY_DECISION: retain seven daily snapshots before rotation.'
    : `Section ${index} explains the service architecture, operational ownership, review process, and deployment expectations in ordinary prose. ${'context '.repeat(8)}`).join('\n');
  const html = Array.from({ length: 180 }, (_, index) => `<article data-id="${index}"><h2>Record ${index}</h2><p>${index === 117 ? 'SENTINEL_HTML_DECISION retain the audit record' : `Routine rendered content ${'detail '.repeat(12)}`}</p></article>`).join('\n');
  const csv = ['id,status,latency_ms,owner,description', ...Array.from({ length: 500 }, (_, index) => `${index},ok,${10 + (index % 8)},team-${index % 5},${index === 377 ? 'SENTINEL_TABLE_DECISION' : `routine row ${index}`}`)].join('\n');
  const nestedJson = JSON.stringify({
    service: 'helioterm',
    policy: { retention: { days: 7, marker: 'SENTINEL_NESTED_JSON_DECISION' }, owners: ['runtime', 'desktop'] },
    regions: Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`region-${index}`, { healthy: true, latency: 10 + (index % 5), description: 'x'.repeat(80) }])),
  }, null, 2);
  return [
    { name: 'structured-json', kind: 'json', content: json, query: 'SENTINEL_JSON_FAILURE' },
    { name: 'application-log', kind: 'text', content: logs, query: 'SENTINEL_LOG_FAILURE' },
    { name: 'real-tap-output', kind: 'text', content: tap, query: 'SENTINEL_TAP_SUMMARY' },
    { name: 'source-code', kind: 'text', content: code, query: 'SENTINEL_CODE_MARKER' },
    { name: 'git-diff', kind: 'text', content: diff, query: 'SENTINEL_DIFF_MARKER' },
    { name: 'project-readme', kind: 'text', content: docs, query: 'SENTINEL_DOC_MARKER' },
    { name: 'generic-prose', kind: 'text', content: prose, query: 'SENTINEL_POLICY_DECISION' },
    { name: 'html-tool-output', kind: 'text', content: html, query: 'SENTINEL_HTML_DECISION' },
    { name: 'csv-table', kind: 'text', content: csv, query: 'SENTINEL_TABLE_DECISION' },
    { name: 'nested-json-object', kind: 'json-object', content: nestedJson, query: 'SENTINEL_NESTED_JSON_DECISION' },
  ];
}

function variant(entry, backend) {
  if (entry.kind === 'json' || entry.kind === 'json-object') {
    const parsed = JSON.parse(entry.content);
    if (Array.isArray(parsed)) parsed[0].benchmark_variant = backend;
    else parsed.benchmark_variant = backend;
    return JSON.stringify(parsed, null, 2);
  }
  return `${entry.content}\nBENCHMARK_VARIANT_${backend}`;
}

function settings(backend, executable) {
  return {
    backend,
    minimumBytes: 1024,
    headroomCommand: executable,
    headroomArgs: ['mcp', 'serve'],
    headroomTimeoutMilliseconds: 120000,
    storeTtlSeconds: 3600,
  };
}

async function serviceMeasurements(backend, entries, executable, rounds, environment) {
  const service = new ContentCompressionService({ settings: settings(backend, executable), environment });
  const results = [];
  try {
    for (const entry of entries) {
      const input = variant(entry, backend);
      const durations = [];
      let latest;
      for (let round = 0; round < rounds; round += 1) {
        const started = performance.now();
        latest = await service.compress(input, { maxBytes: MAX_VISIBLE_BYTES, allowHeadroom: true });
        durations.push(performance.now() - started);
      }
      let retrievalCorrect = null;
      let retrievalMilliseconds = null;
      if (latest.handle) {
        const started = performance.now();
        const retrieved = await service.retrieve(latest.handle, { query: entry.query, maxBytes: MAX_VISIBLE_BYTES });
        retrievalMilliseconds = performance.now() - started;
        retrievalCorrect = retrieved.content.includes(entry.query);
      }
      results.push({
        corpus: entry.name,
        rawBytes: Buffer.byteLength(input, 'utf8'),
        visibleBytes: latest.compressedBytes,
        reductionPercent: rounded((1 - (latest.compressedBytes / Buffer.byteLength(input, 'utf8'))) * 100),
        backend: latest.backend,
        format: latest.format,
        compressed: latest.compressed,
        retrievable: latest.retrievable,
        retrievalCorrect,
        sentinelVisible: latest.content.includes(entry.query),
        retrievalMilliseconds: rounded(retrievalMilliseconds),
        firstMilliseconds: rounded(durations[0]),
        warmMedianMilliseconds: rounded(median(durations.slice(1))),
        transforms: latest.transforms,
        fallback: latest.fallback === true,
      });
    }
  } finally { service.close(); }
  return results;
}

async function directHeadroomMeasurements(entries, executable, rounds) {
  const client = new HeadroomMcpClient({ command: executable, args: ['mcp', 'serve'], timeoutMilliseconds: 120000 });
  const startup = performance.now();
  await client.start();
  const startupMilliseconds = performance.now() - startup;
  const results = [];
  try {
    for (const entry of entries) {
      const input = variant(entry, 'headroom-direct');
      const durations = [];
      let latest;
      for (let round = 0; round < rounds; round += 1) {
        const started = performance.now();
        latest = await client.compress(input);
        durations.push(performance.now() - started);
      }
      const shown = clipUtf8(latest.content);
      let retrievalCorrect = null;
      let retrievalMilliseconds = null;
      if (latest.hash) {
        const started = performance.now();
        const retrieved = await client.retrieve(latest.hash, entry.query);
        retrievalMilliseconds = performance.now() - started;
        retrievalCorrect = retrieved.includes(entry.query);
      }
      results.push({
        corpus: entry.name,
        rawBytes: Buffer.byteLength(input, 'utf8'),
        visibleBytes: Buffer.byteLength(shown, 'utf8'),
        reductionPercent: rounded((1 - (Buffer.byteLength(shown, 'utf8') / Buffer.byteLength(input, 'utf8'))) * 100),
        backend: 'headroom',
        compressed: Buffer.byteLength(shown, 'utf8') < Buffer.byteLength(input, 'utf8'),
        retrievable: Boolean(latest.hash),
        retrievalCorrect,
        sentinelVisible: shown.includes(entry.query),
        retrievalMilliseconds: rounded(retrievalMilliseconds),
        firstMilliseconds: rounded(durations[0]),
        warmMedianMilliseconds: rounded(median(durations.slice(1))),
        transforms: latest.transforms,
      });
    }
    return { startupMilliseconds: rounded(startupMilliseconds), results, stats: await client.stats() };
  } finally { client.close(); }
}

const executable = resolve(option('--headroom', process.env.HEADROOM_EXECUTABLE ?? 'headroom'));
const rounds = Number(option('--rounds', '3'));
if (!Number.isSafeInteger(rounds) || rounds < 2 || rounds > 10) throw new Error('--rounds must be 2..10');
const output = resolve(option('--output', 'benchmarks/results/0.4.0-headroom-strategy.json'));
const entries = corpus().map((entry) => ({ ...entry, content: clipUtf8(entry.content, 96 * 1024) }));
const root = mkdtempSync(join(tmpdir(), 'helioterm-headroom-benchmark-'));
const environment = { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: root };
const version = commandOutput(executable, ['--version']).trim();
const started = new Date().toISOString();

try {
  const native = await serviceMeasurements('native', entries, executable, rounds, environment);
  const headroom = await directHeadroomMeasurements(entries, executable, rounds);
  const auto = await serviceMeasurements('auto', entries, executable, rounds, environment);
  const result = {
    schema: 'HELIOTERM_HEADROOM_STRATEGY_BENCHMARK_V1',
    generatedAt: new Date().toISOString(),
    startedAt: started,
    platform: process.platform,
    node: process.version,
    rounds,
    maxVisibleBytes: MAX_VISIBLE_BYTES,
    accountingNotice: 'Exact content bytes and wall time only; no Desktop quota or provider billing inference.',
    corpora: entries.map((entry) => ({ name: entry.name, rawBytes: Buffer.byteLength(entry.content, 'utf8') })),
    native,
    headroom: { ...headroom, version, executable },
    auto,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ pass: true, output, version, rounds, corpora: entries.length })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
