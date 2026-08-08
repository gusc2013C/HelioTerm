#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELIOTERM_LIMITS, measureExchange } from './firewall.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binding = JSON.parse(readFileSync(resolve(root, 'model-binding.json'), 'utf8'));
const check = (name, pass, actual, expected) => ({ name, pass: Boolean(pass), actual, ...(expected === undefined ? {} : { expected }) });
const texts = (payload) => (payload?.content ?? []).map((entry) => entry?.text ?? '').filter(Boolean);
const output = (payload) => typeof payload?.output === 'string' ? payload.output : Array.isArray(payload?.output) ? payload.output.map((entry) => entry?.text ?? '').join('') : '';

function callCommand(payload) {
  if (payload?.type === 'function_call') {
    try {
      const args = JSON.parse(payload.arguments ?? '{}');
      if (/(?:^|__)helioterm(?:__|\.)run$/u.test(payload.name ?? '') || /helioterm.*run/u.test(payload.name ?? '')) return `mcp:${args.operation}|${args.argument}`;
      return args.cmd ?? null;
    } catch { return null; }
  }
  if (payload?.type === 'custom_tool_call' && typeof payload.input === 'string') {
    const match = /\bcmd\s*:\s*("(?:\\.|[^"\\])*")/u.exec(payload.input);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }
  return null;
}

function expectedCommand(request, transport) {
  const match = /^T\|([a-z]+)\|(.+)$/u.exec(request ?? '');
  if (!match) return null;
  if (transport === 'mcp') return `mcp:${match[1]}|${match[2]}`;
  const prefix = { test: 'node --test ', build: 'npm run ', git: 'git ', search: 'rg ', bench: 'node ', process: 'tasklist ' }[match[1]];
  return prefix ? `${prefix}${match[2]}` : null;
}

export function inspectRows(rows, {
  expectedParent = null,
  minimumRequests = 1,
  evidence = [],
  expectedRole = binding.agentType,
  expectedModel = binding.model,
  expectedEffort = binding.effort,
  expectedTransport = 'direct',
} = {}) {
  const metadata = rows.find((row) => row.type === 'session_meta')?.payload ?? {};
  const contexts = rows.filter((row) => row.type === 'turn_context').map((row) => row.payload ?? {});
  const tokenEvents = rows.filter((row) => row.type === 'event_msg' && row.payload?.type === 'token_count');
  const turns = [];
  let active = null;
  let pendingRequest = null;
  let childSpawnCount = 0;
  let markerSeen = false;
  for (const row of rows) {
    const payload = row.payload ?? {};
    if (row.type === 'turn_context') {
      active = { request: pendingRequest, response: null, commands: 0, commandLines: [], toolOutputs: [], rawOutput: '' };
      pendingRequest = null;
      turns.push(active);
      continue;
    }
    if (row.type !== 'response_item') continue;
    if (payload.type === 'message') {
      if (texts(payload).some((text) => text.includes('HELIOTERM_ROLE_APPLIED'))) markerSeen = true;
      if (payload.role === 'user') {
        const request = texts(payload).map((text) => text.trim()).find((text) => /^T\|/u.test(text));
        if (request) {
          if (active && active.response === null && active.commands === 0) active.request = request;
          else pendingRequest = request;
        }
      } else if (payload.role === 'assistant' && active && active.response === null) {
        const response = texts(payload).map((text) => text.trim()).find((text) => /^(?:OK|FAIL|MATCH|MORE)\|/u.test(text));
        if (response) active.response = response;
      }
      continue;
    }
    if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
      if (/(?:spawn_agent|create_thread)/u.test(payload.name ?? '')) childSpawnCount += 1;
      if (active && active.response === null) { active.commands += 1; active.commandLines.push(callCommand(payload)); }
    } else if ((payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') && active && active.response === null) {
      const value = output(payload);
      active.toolOutputs.push(value.trim());
      active.rawOutput += value;
    }
  }
  const observed = turns.filter((entry) => entry.request || entry.response || entry.commands || entry.rawOutput);
  const exchanges = observed.map((entry, index) => {
    const request = entry.request ?? evidence[index]?.request;
    const rawClaim = expectedTransport === 'mcp' ? Number(/(?:^|\|)raw=(\d+)(?:\||$)/u.exec(entry.toolOutputs.at(-1) ?? '')?.[1] ?? Number.NaN) : Number.NaN;
    const measured = measureExchange({ request, response: entry.response, commands: entry.commands, rawOutput: expectedTransport === 'mcp' && Number.isSafeInteger(rawClaim) ? 'x'.repeat(rawClaim) : entry.rawOutput });
    const expected = expectedCommand(request, expectedTransport);
    const semantic = check(`exchange-${index + 1}-command-semantics`, expected !== null && entry.commandLines.length > 0 && entry.commandLines.every((command) => command === expected), entry.commandLines, expected);
    measured.commandLines = entry.commandLines;
    measured.checks.push(semantic);
    if (expectedTransport === 'mcp') measured.checks.push(check(`exchange-${index + 1}-mcp-output`, entry.toolOutputs.length === 1 && entry.toolOutputs[0] === entry.response && Number.isSafeInteger(rawClaim), entry.toolOutputs, [entry.response]));
    measured.pass = measured.checks.every((entry) => entry.pass);
    return measured;
  });
  const context = contexts.at(-1) ?? {};
  const role = metadata.source?.subagent?.thread_spawn?.agent_role ?? metadata.agent_role ?? null;
  const actual = {
    sessionId: metadata.id ?? null,
    agentPath: metadata.agent_path ?? null,
    parentThreadId: metadata.parent_thread_id ?? metadata.source?.subagent?.thread_spawn?.parent_thread_id ?? null,
    originator: metadata.originator ?? null,
    role,
    model: context.model ?? null,
    turnModels: [...new Set(contexts.map((entry) => entry.model ?? null))],
    effort: context.effort ?? null,
    turnEfforts: [...new Set(contexts.map((entry) => entry.effort ?? null))],
    metadataBackend: metadata.multi_agent_version ?? null,
    turnBackends: [...new Set(contexts.map((entry) => entry.multi_agent_version ?? null))],
    markerSeen,
    requestCount: exchanges.length,
    toolCallCount: exchanges.reduce((sum, entry) => sum + entry.commands, 0),
    childSpawnCount,
    rawOutputBytes: exchanges.reduce((sum, entry) => sum + entry.metrics.rawOutputBytes, 0),
    compressedBytes: exchanges.reduce((sum, entry) => sum + entry.metrics.compressedBytes, 0),
    usage: tokenEvents.at(-1)?.payload?.info?.total_token_usage ?? null,
    transport: expectedTransport,
  };
  const evidenceChecks = exchanges.flatMap((entry, index) => evidence[index] ? [
    check(`evidence-${index + 1}-response`, evidence[index].response === entry.response, entry.response, evidence[index].response),
    check(`evidence-${index + 1}-commands`, evidence[index].commands === entry.commands, entry.commands, evidence[index].commands),
  ] : []);
  const checks = [
    check('desktop-origin', actual.originator === 'Codex Desktop', actual.originator, 'Codex Desktop'),
    check('identity-marker', actual.markerSeen, actual.markerSeen, true),
    check('terminal-role', actual.role === expectedRole, actual.role, expectedRole),
    check('terminal-model', actual.model === expectedModel, actual.model, expectedModel),
    check('all-turn-models', actual.turnModels.length > 0 && actual.turnModels.every((value) => value === expectedModel), actual.turnModels, [expectedModel]),
    check('terminal-effort', actual.effort === expectedEffort, actual.effort, expectedEffort),
    check('transport', ['direct', 'mcp'].includes(expectedTransport), expectedTransport, 'direct|mcp'),
    check('all-turn-efforts', actual.turnEfforts.length > 0 && actual.turnEfforts.every((value) => value === expectedEffort), actual.turnEfforts, [expectedEffort]),
    check('metadata-v2', actual.metadataBackend === 'v2', actual.metadataBackend, 'v2'),
    check('turns-v2', actual.turnBackends.length > 0 && actual.turnBackends.every((value) => value === 'v2'), actual.turnBackends, ['v2']),
    check('parent-present', typeof actual.parentThreadId === 'string' && actual.parentThreadId.length > 0, actual.parentThreadId, 'non-empty'),
    ...(expectedParent ? [check('expected-parent', actual.parentThreadId === expectedParent, actual.parentThreadId, expectedParent)] : []),
    check('request-count-minimum', actual.requestCount >= minimumRequests, actual.requestCount, `>=${minimumRequests}`),
    check('request-count-budget', actual.requestCount <= HELIOTERM_LIMITS.maxRequests, actual.requestCount, HELIOTERM_LIMITS.maxRequests),
    check('no-child-spawn', childSpawnCount === 0, childSpawnCount, 0),
    check('all-exchanges-valid', exchanges.length > 0 && exchanges.every((entry) => entry.pass), exchanges.map((entry) => entry.pass), 'all true'),
    ...(evidence.length ? [check('evidence-count', evidence.length === exchanges.length, evidence.length, exchanges.length), ...evidenceChecks] : []),
  ];
  return { schemaVersion: 'HELIOTERM_PROOF_V1', pass: checks.every((entry) => entry.pass), actual, exchanges, checks };
}

function option(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : process.argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1); }
const rollout = option('--rollout');
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!rollout) { process.stderr.write('Usage: inspect-proof.mjs --rollout <jsonl> [--evidence <json>] [--expect-parent <id>] [--expect-role <role>] [--expect-model <model>] [--expect-effort <effort>] [--expect-transport direct|mcp]\n'); process.exitCode = 2; }
  else {
    try {
      const rows = readFileSync(resolve(rollout), 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
      const evidenceDocument = option('--evidence') ? JSON.parse(readFileSync(resolve(option('--evidence')), 'utf8')) : [];
      const evidence = Array.isArray(evidenceDocument) ? evidenceDocument : evidenceDocument.terminalEvidence ?? [];
      const result = inspectRows(rows, {
        expectedParent: option('--expect-parent') ?? null,
        minimumRequests: Number(option('--expect-min-requests') ?? 1),
        evidence,
        expectedRole: option('--expect-role') ?? binding.agentType,
        expectedModel: option('--expect-model') ?? binding.model,
        expectedEffort: option('--expect-effort') ?? binding.effort,
        expectedTransport: option('--expect-transport') ?? 'direct',
      });
      result.rolloutPath = resolve(rollout);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  }
}
