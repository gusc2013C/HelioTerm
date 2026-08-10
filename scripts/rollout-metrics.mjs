#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const TOKEN_FIELDS = Object.freeze([
  'input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens',
]);
const BATCH_OPERATIONS = new Set(['git', 'search', 'files', 'process', 'read', 'list', 'json', 'stat', 'count', 'hash', 'deps', 'version']);

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
function execCommandSources(source) {
  const commands = [];
  for (const call of source.matchAll(/tools\.exec_command\s*\(/gu)) {
    const tail = source.slice((call.index ?? 0) + call[0].length);
    const property = /(?:["']?cmd["']?)\s*:\s*/u.exec(tail);
    if (!property) continue;
    const start = property.index + property[0].length;
    const quote = tail[start];
    if (!['"', "'", '`'].includes(quote)) continue;
    let value = '';
    let escaped = false;
    for (let index = start + 1; index < tail.length; index += 1) {
      const character = tail[index];
      if (escaped) { value += character; escaped = false; continue; }
      if (character === '\\') { value += character; escaped = true; continue; }
      if (character === quote) break;
      value += character;
    }
    if (!value.includes('${')) commands.push(value);
  }
  return commands;
}
function shortCliOperation(source) {
  const match = /(?:^|[\r\n;])\s*(?:&\s*)?(ht)(?=\s)/u.exec(source);
  if (!match) return null;
  const tail = source.slice(match.index + match[0].length - match[1].length);
  const tokens = [...tail.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)}\]]+/gu)]
    .map((entry) => entry[0].replace(/^(?:"|')|(?:"|')$/gu, ''));
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (['-C', '--cwd', '-t', '--timeout', '-E', '--env', '-i', '--stdin'].includes(token)) { index += 2; continue; }
    if (['-s', '--semantic', '-n', '--no-adaptive'].includes(token)) { index += 1; continue; }
    if (['-e', '--evidence'].includes(token)) {
      index += /^\d+$/u.test(tokens[index + 1] ?? '') ? 2 : 1;
      continue;
    }
    if (token === '--') return tokens[index + 1] ?? null;
    return token.replace(/["']+$/gu, '');
  }
  return null;
}
function increment(target, key, amount = 1) { target[key] = (target[key] ?? 0) + amount; }

export function projectBatchSavings({ eligibleWrappers, averageInputTokens, adoptionPercent }) {
  if (!Number.isSafeInteger(eligibleWrappers) || eligibleWrappers < 0) throw new Error('eligibleWrappers must be a non-negative safe integer');
  if (!Number.isSafeInteger(averageInputTokens) || averageInputTokens < 0) throw new Error('averageInputTokens must be a non-negative safe integer');
  if (!Number.isInteger(adoptionPercent) || adoptionPercent < 0 || adoptionPercent > 100) throw new Error('adoptionPercent must be 0..100');
  const groupedWrappers = Math.floor((eligibleWrappers * adoptionPercent) / 100 / 4) * 4;
  const batchCalls = groupedWrappers / 4;
  const eliminatedSamplingRequests = groupedWrappers - batchCalls;
  return Object.freeze({
    adoption_percent: adoptionPercent,
    grouped_wrappers: groupedWrappers,
    batch_calls: batchCalls,
    eliminated_sampling_requests: eliminatedSamplingRequests,
    raw_context_tokens_avoided: eliminatedSamplingRequests * averageInputTokens,
    scope: 'counterfactual raw context; provider billing not inferred',
  });
}

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
  let batchEligibleSingleWrappers = 0;
  let heliotermObserveWrappers = 0;
  let htCliWrappers = 0;
  const htCliOperations = {};

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
      const shortOperations = names.includes('exec_command')
        ? execCommandSources(input).map(shortCliOperation).filter(Boolean)
        : [];
      const shortOperation = shortOperations[0] ?? null;
      const shortCliHelioterm = shortOperation !== null;
      if (projectedHelioterm) heliotermWrappers += 1;
      if (names.length === 1 && (projectedHelioterm || shortCliHelioterm)) heliotermSingleWrappers += 1;
      if (names.length === 1 && (names.includes('mcp__helioterm__observe') || shortOperations.some((operation) => BATCH_OPERATIONS.has(operation)))) {
        batchEligibleSingleWrappers += 1;
      }
      if (names.includes('mcp__helioterm__observe')) heliotermObserveWrappers += 1;
      if (shortCliHelioterm) {
        htCliWrappers += 1;
        for (const operation of new Set(shortOperations)) increment(htCliOperations, operation);
      }
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
      observed_input_tokens: lastInputs.reduce((sum, value) => sum + value, 0),
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
      single_nested_wrappers: oneNested,
      one_nested_wrapper_percent: execWrappers ? Number(((oneNested / execWrappers) * 100).toFixed(2)) : 0,
      helioterm_wrappers: heliotermWrappers,
      helioterm_single_wrappers: heliotermSingleWrappers,
      batch_eligible_single_wrappers: batchEligibleSingleWrappers,
      helioterm_observe_wrappers: heliotermObserveWrappers,
      ht_cli_wrappers: htCliWrappers,
      ht_cli_operations: Object.freeze(htCliOperations),
      nested_calls_per_wrapper: Object.freeze(nestedCallsPerWrapper),
      nested_tools: Object.freeze(nestedTools),
    }),
    event_types: Object.freeze(eventTypes),
    response_kinds: Object.freeze(responseKinds),
    rate_limit: Object.freeze({ current_used_percent: lastRatePercent, changes: Object.freeze(rateChanges) }),
  });
}

function mergeCounts(reports, selector) {
  const merged = {};
  for (const report of reports) {
    for (const [key, value] of Object.entries(selector(report) ?? {})) increment(merged, key, value);
  }
  return merged;
}

export function aggregateRolloutMetrics(reports) {
  const list = Array.isArray(reports) ? reports : [];
  if (!list.length) throw new Error('at least one rollout report is required');
  const tokens = zeroTokens();
  for (const report of list) for (const field of TOKEN_FIELDS) tokens[field] += report.tokens[field];
  const samples = list.reduce((sum, report) => sum + report.sampling.samples, 0);
  const observedInputTokens = list.reduce((sum, report) => sum + report.sampling.observed_input_tokens, 0);
  const averageInputTokens = samples ? Math.round(observedInputTokens / samples) : 0;
  const heliotermSingleWrappers = list.reduce((sum, report) => sum + report.tools.helioterm_single_wrappers, 0);
  const eligibleWrappers = list.reduce((sum, report) => sum + report.tools.batch_eligible_single_wrappers, 0);
  const firstTimestamps = list.map((report) => report.firstTimestamp).filter(Number.isFinite);
  const lastTimestamps = list.map((report) => report.lastTimestamp).filter(Number.isFinite);
  return Object.freeze({
    schema: 'helioterm-rollout-aggregate-v1',
    rollouts: list.length,
    firstTimestamp: firstTimestamps.length ? Math.min(...firstTimestamps) : null,
    lastTimestamp: lastTimestamps.length ? Math.max(...lastTimestamps) : null,
    tokens: Object.freeze({
      ...tokens,
      uncached_input_tokens: Math.max(0, tokens.input_tokens - tokens.cached_input_tokens - tokens.cache_write_input_tokens),
      cache_percent: tokens.input_tokens ? Number(((tokens.cached_input_tokens / tokens.input_tokens) * 100).toFixed(3)) : 0,
    }),
    sampling: Object.freeze({
      samples,
      observed_input_tokens: observedInputTokens,
      average_input_tokens: averageInputTokens,
      user_messages: list.reduce((sum, report) => sum + report.sampling.user_messages, 0),
    }),
    tools: Object.freeze({
      exec_wrappers: list.reduce((sum, report) => sum + report.tools.exec_wrappers, 0),
      single_nested_wrappers: list.reduce((sum, report) => sum + report.tools.single_nested_wrappers, 0),
      helioterm_single_wrappers: heliotermSingleWrappers,
      batch_eligible_single_wrappers: eligibleWrappers,
      exec_input_bytes: list.reduce((sum, report) => sum + report.tools.exec_input_bytes, 0),
      tool_output_bytes: list.reduce((sum, report) => sum + report.tools.tool_output_bytes, 0),
      nested_calls_per_wrapper: Object.freeze(mergeCounts(list, (report) => report.tools.nested_calls_per_wrapper)),
      nested_tools: Object.freeze(mergeCounts(list, (report) => report.tools.nested_tools)),
      ht_cli_operations: Object.freeze(mergeCounts(list, (report) => report.tools.ht_cli_operations)),
    }),
    batch_projection: Object.freeze([25, 50, 100].map((adoptionPercent) => projectBatchSavings({
      eligibleWrappers, averageInputTokens, adoptionPercent,
    }))),
    scope: 'metadata-only aggregate; prompt, command, and output content not retained',
  });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function options(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1] !== undefined) { values.push(argv[index + 1]); index += 1; }
  }
  return values;
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
  const paths = options(argv, '--rollout');
  if (!paths.length) throw new Error('Usage: rollout-metrics.mjs --rollout <jsonl> [--rollout <jsonl> ...] [--since <ISO|epoch>]');
  const sinceMs = parseSince(option(argv, '--since'));
  const reports = [];
  for (const path of paths) reports.push(await analyzeRollout(resolve(path), { sinceMs }));
  const report = reports.length === 1 ? reports[0] : aggregateRolloutMetrics(reports);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
