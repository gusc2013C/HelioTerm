#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const TOKEN_FIELDS = Object.freeze([
  'input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens',
]);

function zeroTokens() { return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0])); }
function bytes(value) { return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? ''), 'utf8'); }
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}
function timestampMilliseconds(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function nestedToolNames(source) {
  return [...source.matchAll(/tools\.([A-Za-z0-9_]+)\s*\(/gu)].map((match) => match[1]);
}
function increment(target, key, amount = 1) { target[key] = (target[key] ?? 0) + amount; }

export async function analyzeRollout(path, { sinceMs = 0 } = {}) {
  const totals = zeroTokens();
  let previousTotal = null;
  const lastInputs = [];
  const eventTypes = {};
  const responseKinds = {};
  const nestedTools = {};
  const nestedCallsPerWrapper = {};
  const rateChanges = [];
  let lastRatePercent = null;
  let samples = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let execWrappers = 0;
  let execInputBytes = 0;
  let toolOutputBytes = 0;
  let heliotermWrappers = 0;
  let heliotermSingleWrappers = 0;
  let heliotermObserveWrappers = 0;
  let htCliWrappers = 0;

  const lines = readline.createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const timestamp = timestampMilliseconds(record.timestamp);
    if (timestamp === null) continue;
    const payload = record.payload ?? {};

    if (record.type === 'event_msg' && payload.type === 'token_count' && payload.info?.total_token_usage) {
      const current = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, Number(payload.info.total_token_usage[field] ?? 0)]));
      if (timestamp >= sinceMs) {
        const base = previousTotal ?? zeroTokens();
        for (const field of TOKEN_FIELDS) totals[field] += Math.max(0, current[field] - base[field]);
        samples += 1;
        lastInputs.push(Number(payload.info.last_token_usage?.input_tokens ?? 0));
        const percent = payload.rate_limits?.primary?.used_percent;
        if (Number.isFinite(percent) && percent !== lastRatePercent) {
          rateChanges.push({ timestamp, usedPercent: percent });
          lastRatePercent = percent;
        }
      }
      previousTotal = current;
    }

    if (timestamp < sinceMs) continue;
    firstTimestamp ??= timestamp;
    lastTimestamp = timestamp;
    if (record.type === 'event_msg') increment(eventTypes, String(payload.type));
    if (record.type !== 'response_item') continue;
    increment(responseKinds, String(payload.type));
    if (payload.type === 'custom_tool_call' && payload.name === 'exec') {
      const input = String(payload.input ?? '');
      const names = nestedToolNames(input);
      execWrappers += 1;
      execInputBytes += bytes(input);
      increment(nestedCallsPerWrapper, String(names.length));
      for (const name of names) increment(nestedTools, name);
      const projectedHelioterm = names.some((name) => name.startsWith('mcp__helioterm__'));
      const shortCliHelioterm = names.includes('exec_command') && /(?:^|[^A-Za-z0-9_])ht(?:[^A-Za-z0-9_]|$)/u.test(input);
      if (projectedHelioterm) heliotermWrappers += 1;
      if (names.length === 1 && (projectedHelioterm || shortCliHelioterm)) heliotermSingleWrappers += 1;
      if (names.includes('mcp__helioterm__observe')) heliotermObserveWrappers += 1;
      if (shortCliHelioterm) htCliWrappers += 1;
    } else if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      toolOutputBytes += bytes(payload.output ?? '');
    }
  }

  const inputTokens = totals.input_tokens;
  const oneNested = nestedCallsPerWrapper['1'] ?? 0;
  return Object.freeze({
    schema: 'helioterm-rollout-metrics-v1',
    rollout: basename(path),
    sinceMs,
    firstTimestamp,
    lastTimestamp,
    tokens: Object.freeze({
      ...totals,
      uncached_input_tokens: Math.max(0, inputTokens - totals.cached_input_tokens - totals.cache_write_input_tokens),
      cache_percent: inputTokens ? Number(((totals.cached_input_tokens / inputTokens) * 100).toFixed(3)) : 0,
    }),
    sampling: Object.freeze({
      samples,
      average_input_tokens: samples ? Math.round(lastInputs.reduce((sum, value) => sum + value, 0) / samples) : 0,
      p50_input_tokens: percentile(lastInputs, 0.5),
      p90_input_tokens: percentile(lastInputs, 0.9),
      max_input_tokens: percentile(lastInputs, 1),
      user_messages: eventTypes.user_message ?? 0,
      samples_per_user_message: eventTypes.user_message ? Number((samples / eventTypes.user_message).toFixed(2)) : null,
    }),
    tools: Object.freeze({
      exec_wrappers: execWrappers,
      exec_input_bytes: execInputBytes,
      tool_output_bytes: toolOutputBytes,
      one_nested_wrapper_percent: execWrappers ? Number(((oneNested / execWrappers) * 100).toFixed(2)) : 0,
      helioterm_wrappers: heliotermWrappers,
      helioterm_single_wrappers: heliotermSingleWrappers,
      helioterm_observe_wrappers: heliotermObserveWrappers,
      ht_cli_wrappers: htCliWrappers,
      nested_calls_per_wrapper: Object.freeze(nestedCallsPerWrapper),
      nested_tools: Object.freeze(nestedTools),
    }),
    event_types: Object.freeze(eventTypes),
    response_kinds: Object.freeze(responseKinds),
    rate_limit: Object.freeze({ current_used_percent: lastRatePercent, changes: Object.freeze(rateChanges) }),
  });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseSince(value) {
  if (value === undefined) return 0;
  if (/^\d+$/u.test(value)) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('--since must be an ISO timestamp or Unix epoch');
  return parsed;
}

export async function runCli(argv = process.argv.slice(2)) {
  const path = option(argv, '--rollout');
  if (!path) throw new Error('Usage: rollout-metrics.mjs --rollout <jsonl> [--since <ISO|epoch>]');
  const report = await analyzeRollout(resolve(path), { sinceMs: parseSince(option(argv, '--since')) });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
