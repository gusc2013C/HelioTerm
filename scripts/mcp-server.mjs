#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { OPERATIONS, commandFor, evidenceOutput, parseArguments, runEvidenceOperation, runOperation, runSupervisedOperation } from './kernel.mjs';
import { acceptAdaptiveLunaResponse, attachAdaptiveRoute, contextForAdaptiveTicket } from './adaptive-channel.mjs';
import { cancelBackgroundJob, startBackgroundJob, startBackgroundTerminalJob, waitBackgroundJob } from './job-manager.mjs';
import { createTokenSavingsMeter, formatTokenSavings, replaceCompactTokenSavings } from './token-savings.mjs';
import { runTerminalCommand, terminalSpecFromArguments, TERMINAL_SHELLS } from './terminal-transport.mjs';

export { commandFor, parseArguments, runEvidenceOperation, runOperation, runSupervisedOperation } from './kernel.mjs';

const VERSION = '0.2.0';
export const OBSERVATION_OPERATIONS = Object.freeze([
  'git', 'search', 'files', 'process', 'read', 'list', 'json', 'stat', 'count', 'hash', 'deps', 'version',
]);
const executionProperties = {
  operation: { type: 'string', enum: [...OPERATIONS] },
  argument: { type: 'string', minLength: 1, maxLength: 512 },
  cwd: { type: 'string', minLength: 3, maxLength: 512 },
  adaptive: { type: 'boolean', default: true },
  semantic: { type: 'boolean', default: false },
};
const executionAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false };
const evidenceProperties = {
  responseMode: { type: 'string', enum: ['compact', 'evidence'], default: 'compact' },
  maxBytes: { type: 'integer', minimum: 256, maximum: 32768, default: 8192 },
};
const terminalProperties = {
  program: { type: 'string', minLength: 1, maxLength: 1024 },
  args: { type: 'array', maxItems: 128, items: { type: 'string', maxLength: 8192 }, default: [] },
  shell: { type: 'string', enum: TERMINAL_SHELLS },
  script: { type: 'string', maxLength: 65536 },
  env: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string', maxLength: 8192 }, default: {} },
  stdin: { type: 'string', maxLength: 262144 },
  cwd: executionProperties.cwd,
  timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200, default: 240 },
  adaptive: executionProperties.adaptive,
  semantic: executionProperties.semantic,
  ...evidenceProperties,
};
function terminalInputSchema({ timeoutRequired = false, includeResponse = true } = {}) {
  const properties = includeResponse
    ? terminalProperties
    : Object.fromEntries(Object.entries(terminalProperties).filter(([name]) => !['responseMode', 'maxBytes', 'adaptive', 'semantic'].includes(name)));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['cwd', ...(timeoutRequired ? ['timeoutSeconds'] : [])],
    properties,
  };
}
const terminalAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false };

export const OBSERVE_TOOL = {
  name: 'observe',
  title: 'Observe one project fact',
  description: 'Run one allowlisted read-only, shell-free project observation. Return a compact result by default, or explicitly bounded exact evidence when responseMode=evidence.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['operation', 'argument', 'cwd'],
    properties: {
      ...executionProperties,
      operation: { type: 'string', enum: OBSERVATION_OPERATIONS },
      ...evidenceProperties,
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};
export const TOOL = {
  name: 'run',
  title: 'Run one HelioTerm operation',
  description: 'Execute one deterministic shell-free operation and return compact facts by default or bounded evidence when explicitly requested.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['operation', 'argument', 'cwd'],
    properties: { ...executionProperties, ...evidenceProperties },
  },
  annotations: executionAnnotations,
};
export const SUPERVISE_TOOL = {
  name: 'supervise',
  title: 'Supervise one long operation',
  description: 'Wait inside one MCP call for an allowlisted operation, stream and compress its output locally, and return once without model polling.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['operation', 'argument', 'cwd', 'timeoutSeconds'],
    properties: {
      ...executionProperties,
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200 },
    },
  },
  annotations: executionAnnotations,
};
export const JOB_START_TOOL = {
  name: 'job_start',
  title: 'Start one background operation',
  description: 'Start an allowlisted operation in a persistent local worker and return a handle immediately so Codex can continue other work.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['operation', 'argument', 'cwd', 'timeoutSeconds'],
    properties: {
      operation: executionProperties.operation,
      argument: executionProperties.argument,
      cwd: executionProperties.cwd,
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200 },
    },
  },
  annotations: executionAnnotations,
};
export const JOB_WAIT_TOOL = {
  name: 'job_wait',
  title: 'Collect one background result',
  description: 'Wait locally for a background handle and return its final compact result once; internal file checks use no model tokens.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['job', 'timeoutSeconds'],
    properties: {
      job: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200 },
      adaptive: { type: 'boolean', default: true },
      semantic: { type: 'boolean', default: false },
      ...evidenceProperties,
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};
export const JOB_CANCEL_TOOL = {
  name: 'job_cancel',
  title: 'Cancel one background command',
  description: 'Stop the process tree for one HelioTerm background handle and erase any persisted arbitrary command payload.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['job'],
    properties: { job: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' } },
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
};
export const TERMINAL_TOOL = {
  name: 'terminal',
  title: 'Run any terminal command',
  description: 'Run one arbitrary non-interactive command through HelioTerm. Provide either program plus args, or shell plus script. Prefer program mode; output is compressed by default.',
  inputSchema: terminalInputSchema(),
  annotations: terminalAnnotations,
};
export const TERMINAL_SUPERVISE_TOOL = {
  name: 'terminal_supervise',
  title: 'Supervise any long terminal command',
  description: 'Run one arbitrary long non-interactive command while HelioTerm waits locally and returns once without model polling.',
  inputSchema: terminalInputSchema({ timeoutRequired: true }),
  annotations: terminalAnnotations,
};
export const TERMINAL_START_TOOL = {
  name: 'terminal_start',
  title: 'Start any background terminal command',
  description: 'Start one arbitrary non-interactive command in a persistent local worker and return a handle immediately.',
  inputSchema: terminalInputSchema({ timeoutRequired: true, includeResponse: false }),
  annotations: terminalAnnotations,
};
export const SAVINGS_TOOL = {
  name: 'savings',
  title: 'Report HelioTerm token savings',
  description: 'Return deterministic cumulative raw/compact byte counts and estimated content-token savings for this MCP process. Uses no model.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};
export const LUNA_CONTEXT_TOOL = {
  name: 'luna_context',
  title: 'Read one adaptive Luna ticket',
  description: 'For an already-created temporary Desktop Luna leaf only: read canonical facts and bounded evidence for one opaque ticket. Call this directly; never create or wait for another task. Uses no model and no shell.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['ticket'],
    properties: { ticket: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' } },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};
export const LUNA_ACCEPT_TOOL = {
  name: 'luna_accept',
  title: 'Validate one adaptive Luna response',
  description: 'Deterministically validate a temporary Desktop Luna JSON note, consume its one-use ticket, and return canonical facts plus an accepted semantic note or a rule-only fallback.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['ticket', 'response'],
    properties: {
      ticket: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
      response: { type: 'string', minLength: 2, maxLength: 512 },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
};
export const TOOLS = Object.freeze([
  OBSERVE_TOOL, TOOL, SUPERVISE_TOOL, TERMINAL_TOOL, TERMINAL_SUPERVISE_TOOL,
  JOB_START_TOOL, TERMINAL_START_TOOL, JOB_WAIT_TOOL, JOB_CANCEL_TOOL,
  SAVINGS_TOOL, LUNA_CONTEXT_TOOL, LUNA_ACCEPT_TOOL,
]);
const savingsMeter = createTokenSavingsMeter();

function clipUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function appendProof(text, facts = []) {
  const base = text.replace(/\|model=0$/u, '');
  const suffix = `${facts.length ? `|${facts.join('|')}` : ''}|model=0`;
  return `${clipUtf8(base, Math.max(0, 256 - Buffer.byteLength(suffix, 'utf8')))}${suffix}`;
}

export function withModelProof(result, facts = []) {
  const text = appendProof(result.text, facts);
  return { ...result, text, savings: replaceCompactTokenSavings(result.savings, text) };
}

function routeResult(observed, args, facts = []) {
  const baseText = appendProof(observed.text, facts);
  const base = { ...observed, text: baseText, savings: replaceCompactTokenSavings(observed.savings, baseText) };
  const routed = args.adaptive === false ? base : attachAdaptiveRoute({ result: base, semantic: args.semantic === true, cwd: args.cwd });
  return withModelProof(routed);
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function contentResult(text, { isError = false, structuredContent } = {}) {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
    isError,
  };
}

async function handleExecution(message, mode) {
  const args = message.params.arguments ?? {};
  if (mode === 'observe' && !OBSERVATION_OPERATIONS.includes(args.operation)) throw new Error('observe requires a read-only operation');
  if (['observe', 'run'].includes(mode) && args.responseMode === 'evidence') {
    const observed = await runEvidenceOperation({ ...args, maxBytes: args.maxBytes ?? 8192 });
    savingsMeter.record(observed.savings);
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(observed.text, {
      isError: !observed.pass,
      structuredContent: {
        operation: observed.operation,
        rawBytes: observed.rawBytes,
        shownBytes: observed.shownBytes,
        clipped: observed.more,
        modelPolls: 0,
      },
    }) });
    return;
  }
  const supervised = mode === 'supervise';
  const observed = supervised
    ? await runSupervisedOperation({ ...args, timeoutMilliseconds: args.timeoutSeconds * 1000 })
    : await runOperation(args);
  const facts = supervised ? ['wait=internal', 'polls=0', `ms=${observed.durationMilliseconds}`] : [];
  const result = routeResult(observed, args, facts);
  savingsMeter.record(result.savings);
  send({ jsonrpc: '2.0', id: message.id, result: contentResult(result.text, {
    isError: result.text.startsWith('FAIL|'),
    structuredContent: supervised ? { waitedMilliseconds: observed.durationMilliseconds, modelPolls: 0 } : undefined,
  }) });
}

async function handleTerminalExecution(message, mode) {
  const args = message.params.arguments ?? {};
  const terminal = terminalSpecFromArguments(args);
  if (mode === 'terminal_start') {
    const started = startBackgroundTerminalJob({ terminal, cwd: args.cwd, timeoutMilliseconds: args.timeoutSeconds * 1000 });
    const text = `MORE|calls=0|status=queued|job=${started.handle}|background=1|terminal=1|polls=0|model=0`;
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
      structuredContent: { job: started.handle, status: started.status, timeoutMilliseconds: started.timeoutMilliseconds, modelPolls: 0 },
    }) });
    return;
  }
  const supervised = mode === 'terminal_supervise';
  const observed = await runTerminalCommand({
    terminal,
    cwd: args.cwd,
    timeoutMilliseconds: (args.timeoutSeconds ?? 240) * 1000,
    responseMode: args.responseMode ?? 'compact',
    maxBytes: args.maxBytes ?? 8192,
  });
  if (args.responseMode === 'evidence') {
    savingsMeter.record(observed.savings);
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(observed.text, {
      isError: !observed.pass,
      structuredContent: {
        terminal: true,
        rawBytes: observed.rawBytes,
        shownBytes: observed.shownBytes,
        clipped: observed.more,
        waitedMilliseconds: observed.durationMilliseconds,
        modelPolls: 0,
        windowsShimRetry: observed.windowsShimRetry === true,
      },
    }) });
    return;
  }
  const facts = ['terminal=1', ...(observed.windowsShimRetry ? ['shim=windows'] : []), ...(supervised ? ['wait=internal', 'polls=0'] : []), `ms=${observed.durationMilliseconds}`];
  const result = routeResult(observed, { ...args, cwd: args.cwd }, facts);
  savingsMeter.record(result.savings);
  send({ jsonrpc: '2.0', id: message.id, result: contentResult(result.text, {
    isError: result.text.startsWith('FAIL|'),
    structuredContent: { terminal: true, waitedMilliseconds: observed.durationMilliseconds, modelPolls: 0, windowsShimRetry: observed.windowsShimRetry === true },
  }) });
}

async function handle(message) {
  if (message.id == null) return;
  try {
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'helioterm', version: VERSION } } });
    else if (message.method === 'ping') send({ jsonrpc: '2.0', id: message.id, result: {} });
    else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    else if (message.method === 'tools/call' && ['terminal', 'terminal_supervise', 'terminal_start'].includes(message.params?.name)) {
      await handleTerminalExecution(message, message.params.name);
    }
    else if (message.method === 'tools/call' && ['observe', 'run', 'supervise'].includes(message.params?.name)) {
      await handleExecution(message, message.params.name);
    } else if (message.method === 'tools/call' && message.params?.name === 'job_start') {
      const args = message.params.arguments ?? {};
      const started = startBackgroundJob({ ...args, timeoutMilliseconds: args.timeoutSeconds * 1000 });
      const text = `MORE|calls=0|status=queued|job=${started.handle}|background=1|polls=0|model=0`;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        structuredContent: { job: started.handle, status: started.status, timeoutMilliseconds: started.timeoutMilliseconds, modelPolls: 0 },
      }) });
    } else if (message.method === 'tools/call' && message.params?.name === 'job_wait') {
      const args = message.params.arguments ?? {};
      const waited = await waitBackgroundJob({ handle: args.job, timeoutMilliseconds: args.timeoutSeconds * 1000 });
      if (!waited.completed) {
        const text = `MORE|calls=0|status=${waited.state.status}|job=${args.job}|background=1|waitMs=${waited.waitedMilliseconds}|polls=0|model=0`;
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
          structuredContent: { job: args.job, status: waited.state.status, waitedMilliseconds: waited.waitedMilliseconds, modelPolls: 0 },
        }) });
      } else if (waited.state.result) {
        const stored = waited.state.result;
        if (args.responseMode === 'evidence') {
          const evidence = evidenceOutput({
            exitCode: stored.exitCode ?? (stored.text?.startsWith('FAIL|') ? 1 : 0),
            stdout: stored.evidenceBody ?? stored.adaptiveEvidence ?? '',
            operation: waited.state.operation,
            command: stored.command,
            maxBytes: args.maxBytes ?? 8192,
            rawBytesOverride: stored.rawBytes ?? stored.savings?.rawBytes ?? null,
            facts: ['background=1', `job=${args.job}`, 'polls=0', `waitMs=${waited.waitedMilliseconds}`],
          });
          savingsMeter.record(evidence.savings);
          send({ jsonrpc: '2.0', id: message.id, result: contentResult(evidence.text, {
            isError: !evidence.pass,
            structuredContent: {
              job: args.job,
              status: waited.state.status,
              commandMilliseconds: stored.durationMilliseconds,
              waitedMilliseconds: waited.waitedMilliseconds,
              modelPolls: 0,
              rawBytes: evidence.rawBytes,
              shownBytes: evidence.shownBytes,
              clipped: evidence.more,
            },
          }) });
          return;
        }
        const routed = routeResult({
          ...stored,
          operation: waited.state.operation,
          command: stored.command,
          adaptiveEvidence: stored.adaptiveEvidence,
        }, { ...args, cwd: waited.state.cwd }, ['background=1', `job=${args.job}`, 'polls=0', `waitMs=${waited.waitedMilliseconds}`]);
        savingsMeter.record(routed.savings);
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(routed.text, {
          isError: routed.text.startsWith('FAIL|'),
          structuredContent: {
            job: args.job,
            status: waited.state.status,
            commandMilliseconds: stored.durationMilliseconds,
            waitedMilliseconds: waited.waitedMilliseconds,
            modelPolls: 0,
          },
        }) });
      } else {
        const error = String(waited.state.error ?? 'background worker failed').replace(/\|/gu, '/');
        const text = appendProof(`FAIL|calls=0|job=${args.job}|background=1|error=${error}`, ['polls=0', `waitMs=${waited.waitedMilliseconds}`]);
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
          isError: true,
          structuredContent: { job: args.job, status: 'failed', waitedMilliseconds: waited.waitedMilliseconds, modelPolls: 0 },
        }) });
      }
    } else if (message.method === 'tools/call' && message.params?.name === 'job_cancel') {
      const args = message.params.arguments ?? {};
      const cancelled = cancelBackgroundJob(args.job);
      const text = `OK|calls=0|status=${cancelled.state.status}|job=${args.job}|cancelled=${cancelled.cancelled ? 1 : 0}|background=1|model=0`;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        structuredContent: { job: args.job, status: cancelled.state.status, cancelled: cancelled.cancelled, modelPolls: 0 },
      }) });
    } else if (message.method === 'tools/call' && message.params?.name === 'savings') {
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(formatTokenSavings(savingsMeter.snapshot())) });
    } else if (message.method === 'tools/call' && message.params?.name === 'luna_context') {
      const context = contextForAdaptiveTicket(message.params.arguments?.ticket);
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(context.prompt, {
        structuredContent: { ticket: context.record.handle, effort: context.record.effort, contextBytes: context.contextBytes },
      }) });
    } else if (message.method === 'tools/call' && message.params?.name === 'luna_accept') {
      const accepted = acceptAdaptiveLunaResponse({ ticket: message.params.arguments?.ticket, response: message.params.arguments?.response });
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(accepted.text, {
        structuredContent: { accepted: accepted.accepted, reason: accepted.reason, effort: accepted.effort, metrics: accepted.metrics },
      }) });
    } else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(`FAIL|calls=0|error=${String(error.message).slice(0, 160)}`, { isError: true }) });
  }
}

function isLongRequest(message) {
  return message.method === 'tools/call' && ['supervise', 'terminal_supervise', 'job_wait'].includes(message.params?.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let queue = Promise.resolve();
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      if (message.method === 'ping') void handle(message);
      else if (isLongRequest(message)) void queue.then(() => handle(message));
      else queue = queue.then(() => handle(message));
    } catch { /* ignore malformed transport lines */ }
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
