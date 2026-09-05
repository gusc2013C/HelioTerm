#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { OPERATIONS, commandFor, evidenceOutput, parseArguments, runEvidenceOperation, runOperation, runSupervisedOperation } from './kernel.mjs';
import { acceptAdaptiveLunaResponse, attachAdaptiveRoute, contextForAdaptiveTicket } from './adaptive-channel.mjs';
import { cancelBackgroundJob, confirmBackgroundJobStart, startBackgroundJob, startBackgroundTerminalBatchJob, startBackgroundTerminalJob, waitBackgroundJob } from './job-manager.mjs';
import { createTokenSavingsMeter, formatTokenSavings, measureTokenSavingsFromBytes, replaceCompactTokenSavings } from './token-savings.mjs';
import { runTerminalCommand, terminalSpecFromArguments, TERMINAL_SHELLS } from './terminal-transport.mjs';
import { runTerminalBatch, validateTerminalBatchCommands } from './terminal-batch.mjs';
import { runDirectBatch } from './direct-runner.mjs';
import { aggregateRolloutMetrics, analyzeRollout } from './rollout-metrics.mjs';
import { loadSettings } from './settings.mjs';
import { CONTENT_HANDLE_PATTERN, ContentCompressionService } from './content-compression.mjs';

export { commandFor, parseArguments, runEvidenceOperation, runOperation, runSupervisedOperation } from './kernel.mjs';

const VERSION = '0.4.1';
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
  responseMode: { type: 'string', enum: ['compact', 'evidence', 'compressed'], default: 'compact' },
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
export const BATCH_TOOL = {
  name: 'batch',
  title: 'Observe up to four project facts',
  description: 'Run two to four independent read-only observations in one MCP call. Use this when the operations are known up front to avoid repeated model/tool round trips.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['cwd', 'requests'],
    properties: {
      cwd: executionProperties.cwd,
      requests: {
        type: 'array', minItems: 2, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['operation', 'argument'],
          properties: {
            operation: { type: 'string', enum: OBSERVATION_OPERATIONS },
            argument: executionProperties.argument,
          },
        },
      },
      adaptive: executionProperties.adaptive,
      semantic: executionProperties.semantic,
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
const terminalBatchCommandProperties = Object.fromEntries(Object.entries(terminalProperties).filter(([name]) => ![
  'cwd', 'timeoutSeconds', 'adaptive', 'semantic', 'responseMode', 'maxBytes',
].includes(name)));
const terminalBatchCommandKeys = new Set(Object.keys(terminalBatchCommandProperties));
export const TERMINAL_BATCH_TOOL = {
  name: 'terminal_batch',
  title: 'Run two to four planned commands',
  description: 'Run two to four arbitrary non-interactive commands sequentially in one tool call. Validate the whole batch first and stop at the first failure. Use only when every command is known up front.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['cwd', 'commands'],
    properties: {
      cwd: executionProperties.cwd,
      commands: {
        type: 'array', minItems: 2, maxItems: 4,
        items: { type: 'object', additionalProperties: false, properties: terminalBatchCommandProperties },
      },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200, default: 240 },
      adaptive: executionProperties.adaptive,
      semantic: executionProperties.semantic,
    },
  },
  annotations: terminalAnnotations,
};
export const TERMINAL_BATCH_START_TOOL = {
  name: 'terminal_batch_start',
  title: 'Start two to four planned commands in one background job',
  description: 'Atomically validate two to four preplanned arbitrary commands, then run them sequentially in one persistent background job. Stops on the first failure; collect once with job_wait.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['cwd', 'commands', 'timeoutSeconds'],
    properties: {
      cwd: executionProperties.cwd,
      commands: TERMINAL_BATCH_TOOL.inputSchema.properties.commands,
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 43200 },
    },
  },
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
export const COMPRESSION_RETRIEVE_TOOL = {
  name: 'compression_retrieve',
  title: 'Retrieve compressed evidence',
  description: 'Retrieve or query the retained evidence behind one opaque HelioTerm compression handle. Native and Headroom MCP backends share this interface.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['handle'],
    properties: {
      handle: { type: 'string', pattern: CONTENT_HANDLE_PATTERN },
      query: { type: 'string', minLength: 1, maxLength: 512 },
      maxBytes: { type: 'integer', minimum: 256, maximum: 32768, default: 8192 },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
};
export const ROLLOUT_AUDIT_TOOL = {
  name: 'rollout_audit',
  title: 'Audit rollout sampling pressure',
  description: 'Deterministically audit one to eight rollout files without AI or prompt/output retention. Applies configured migration thresholds and returns a Desktop owner migration decision; the MCP server itself cannot create or archive tasks.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['rollouts'],
    properties: {
      rollouts: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 3, maxLength: 1024 } },
      sinceMs: { type: 'integer', minimum: 0, default: 0 },
    },
  },
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
  OBSERVE_TOOL, BATCH_TOOL, TOOL, SUPERVISE_TOOL, TERMINAL_TOOL, TERMINAL_BATCH_TOOL, TERMINAL_BATCH_START_TOOL, TERMINAL_SUPERVISE_TOOL,
  JOB_START_TOOL, TERMINAL_START_TOOL, JOB_WAIT_TOOL, JOB_CANCEL_TOOL,
  SAVINGS_TOOL, COMPRESSION_RETRIEVE_TOOL, ROLLOUT_AUDIT_TOOL, LUNA_CONTEXT_TOOL, LUNA_ACCEPT_TOOL,
]);
const savingsMeter = createTokenSavingsMeter();
let compressionService = null;
let compressionSignature = null;

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

function executionPassed(result, status = null) {
  if (typeof result?.pass === 'boolean') return result.pass;
  if (Number.isInteger(result?.exitCode)) return result.exitCode === 0;
  if (status === 'failed' || status === 'cancelled') return false;
  const text = String(result?.text ?? '');
  if (text.startsWith('FAIL|') || /(?:^|\|)status=fail(?:\||$)/u.test(text)) return false;
  return text.startsWith('OK|') || status === 'completed';
}

function executionExitCode(result, status = null) {
  if (Number.isInteger(result?.exitCode)) return result.exitCode;
  return executionPassed(result, status) ? 0 : 1;
}

function configuredCompressionService() {
  const settings = loadSettings().compression;
  const signature = JSON.stringify(settings);
  if (!compressionService || compressionSignature !== signature) {
    compressionService?.close();
    compressionService = new ContentCompressionService({ settings });
    compressionSignature = signature;
  }
  return compressionService;
}

async function compressedEvidence(content, {
  maxBytes = 8192,
  operation = 'terminal',
  commandRawBytes = null,
  allowHeadroom = false,
  cwd = null,
  pass,
  exitCode = null,
  status = null,
} = {}) {
  const compressed = await configuredCompressionService().compress(content, { maxBytes, allowHeadroom });
  const succeeded = typeof pass === 'boolean' ? pass : (Number.isInteger(exitCode) ? exitCode === 0 : status !== 'failed' && status !== 'cancelled');
  const effectiveExitCode = Number.isInteger(exitCode) ? exitCode : (succeeded ? 0 : 1);
  const savedBytes = compressed.rawBytes - compressed.compressedBytes;
  const facts = [
    `compressed=${compressed.compressed ? 1 : 0}`,
    `backend=${compressed.backend}`,
    `format=${compressed.format}`,
    `raw=${compressed.rawBytes}`,
    `shown=${compressed.compressedBytes}`,
    `savedB=${savedBytes}`,
    `retrievable=${compressed.retrievable ? 1 : 0}`,
    ...(compressed.handle ? [`handle=${compressed.handle}`] : []),
    ...(compressed.fallback ? ['fallback=1'] : []),
    ...(commandRawBytes !== null ? [`commandRaw=${commandRawBytes}`] : []),
    'model=0',
  ];
  const complete = compressed.compressed || compressed.compressedBytes >= compressed.rawBytes;
  const canonical = `${succeeded ? (complete ? 'OK' : 'MORE') : 'FAIL'}|calls=1${succeeded ? '' : `|exit=${effectiveExitCode}`}|operation=${operation}|${facts.join('|')}`;
  let adaptive = null;
  if (compressed.format === 'text' && compressed.compressed) {
    const routeText = succeeded ? canonical.replace('|calls=1|', '|calls=1|more=1|') : canonical;
    adaptive = attachAdaptiveRoute({
      result: {
        text: routeText,
        operation,
        adaptiveEvidence: content,
        savings: { rawBytes: compressed.rawBytes },
        pass: succeeded,
        exitCode: effectiveExitCode,
      },
      semantic: true,
      cwd,
    });
  }
  const lunaRouted = adaptive?.adaptive?.routed === true;
  const text = lunaRouted
    ? `${adaptive.text}|model=0`
    : `${canonical}${compressed.content ? `\n${compressed.content}` : ''}`;
  return {
    text,
    compressed,
    pass: succeeded,
    exitCode: effectiveExitCode,
    adaptive: adaptive?.adaptive ?? null,
    savings: measureTokenSavingsFromBytes({ rawBytes: compressed.rawBytes, compactText: text }),
  };
}

function compressedStructuredContent(envelope, extra = {}) {
  const value = envelope.compressed;
  const compression = {
    backend: value.backend,
    format: value.format,
    compressed: value.compressed,
    rawBytes: value.rawBytes,
    compressedBytes: value.compressedBytes,
    savedBytes: value.rawBytes - value.compressedBytes,
    ...(value.retrievable ? { retrievable: true } : {}),
    ...(value.handle ? { handle: value.handle } : {}),
    ...(Array.isArray(value.transforms) && value.transforms.length ? { transforms: value.transforms } : {}),
    ...(value.fallback === true ? { fallback: true } : {}),
  };
  const result = {
    ...extra,
    pass: envelope.pass,
    exitCode: envelope.exitCode,
    compression,
  };
  if (envelope.adaptive?.routed) result.semanticCompression = {
      backend: 'luna',
      routed: true,
      ticket: envelope.adaptive.ticket.handle,
      effort: envelope.adaptive.ticket.effort,
      reason: envelope.adaptive.decision.reason,
    };
  return result;
}

async function handleExecution(message, mode) {
  const args = message.params.arguments ?? {};
  if (mode === 'observe' && !OBSERVATION_OPERATIONS.includes(args.operation)) throw new Error('observe requires a read-only operation');
  if (['observe', 'run'].includes(mode) && args.responseMode === 'compressed') {
    const observed = await runOperation(args);
    const envelope = await compressedEvidence(observed.adaptiveEvidence ?? '', {
      maxBytes: args.maxBytes ?? 8192,
      operation: observed.operation,
      commandRawBytes: observed.savings?.rawBytes ?? null,
      cwd: args.cwd,
      pass: executionPassed(observed),
      exitCode: executionExitCode(observed),
    });
    savingsMeter.record(envelope.savings);
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(envelope.text, {
      isError: !executionPassed(observed),
      structuredContent: compressedStructuredContent(envelope, { operation: observed.operation, commandRawBytes: observed.savings?.rawBytes ?? null }),
    }) });
    return;
  }
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
    isError: !executionPassed(observed),
    structuredContent: supervised ? { waitedMilliseconds: observed.durationMilliseconds, modelPolls: 0 } : undefined,
  }) });
}

async function handleBatchExecution(message) {
  const args = message.params.arguments ?? {};
  const requests = Array.isArray(args.requests) ? args.requests : [];
  if (requests.length < 2 || requests.length > 4 || requests.some((entry) => !OBSERVATION_OPERATIONS.includes(entry?.operation))) {
    const text = 'FAIL|calls=0|error=batch-requires-2..4-read-only-observations|model=0';
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
      isError: true,
      structuredContent: { calls: 0, requested: requests.length, waitedMilliseconds: 0, modelPolls: 0 },
    }) });
    return;
  }
  const result = await runDirectBatch({
    requests: requests.map((entry) => `T|${entry.operation}|${entry.argument}`),
    cwd: args.cwd,
    adaptive: args.adaptive !== false,
    semantic: args.semantic === true,
  });
  if (result.savings) savingsMeter.record(result.savings);
  send({ jsonrpc: '2.0', id: message.id, result: contentResult(result.text, {
    isError: !result.pass,
    structuredContent: {
      calls: result.commands?.length ?? 0,
      requested: requests.length,
      waitedMilliseconds: result.elapsedMs ?? 0,
      modelPolls: 0,
    },
  }) });
}

async function handleTerminalExecution(message, mode) {
  const args = message.params.arguments ?? {};
  const terminal = terminalSpecFromArguments(args);
  if (mode === 'terminal_start') {
    const started = startBackgroundTerminalJob({ terminal, cwd: args.cwd, timeoutMilliseconds: args.timeoutSeconds * 1000 });
    const confirmed = await confirmBackgroundJobStart({ handle: started.handle });
    const status = confirmed.state.status;
    const failed = status === 'failed';
    const text = `${failed ? 'FAIL' : 'MORE'}|calls=0|status=${status}|job=${started.handle}|background=1|terminal=1|startupMs=${confirmed.waitedMilliseconds}|polls=0|model=0`;
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
      isError: failed,
      structuredContent: { job: started.handle, status, timeoutMilliseconds: started.timeoutMilliseconds, startupConfirmed: confirmed.confirmed, modelPolls: 0 },
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
  if (args.responseMode === 'compressed') {
    const envelope = await compressedEvidence(observed.evidenceBody ?? observed.adaptiveEvidence ?? '', {
      maxBytes: args.maxBytes ?? 8192,
      operation: 'terminal',
      commandRawBytes: observed.rawBytes ?? observed.savings?.rawBytes ?? null,
      allowHeadroom: true,
      cwd: args.cwd,
      pass: executionPassed(observed),
      exitCode: executionExitCode(observed),
    });
    savingsMeter.record(envelope.savings);
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(envelope.text, {
      isError: !executionPassed(observed),
      structuredContent: compressedStructuredContent(envelope, {
        terminal: true,
        commandRawBytes: observed.rawBytes ?? observed.savings?.rawBytes ?? null,
        waitedMilliseconds: observed.durationMilliseconds,
        windowsShimRetry: observed.windowsShimRetry === true,
      }),
    }) });
    return;
  }
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
    isError: !executionPassed(observed),
    structuredContent: { terminal: true, waitedMilliseconds: observed.durationMilliseconds, modelPolls: 0, windowsShimRetry: observed.windowsShimRetry === true },
  }) });
}

async function handleTerminalBatchExecution(message) {
  const args = message.params.arguments ?? {};
  const commands = Array.isArray(args.commands) ? args.commands : [];
  const failure = (error) => {
    const text = `FAIL|calls=0|error=${error}|terminal=1|model=0`;
    send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
      isError: true,
      structuredContent: { terminal: true, calls: 0, requested: commands.length, failedAt: null, stoppedAt: 0, waitedMilliseconds: 0, modelPolls: 0 },
    }) });
  };
  if (commands.length < 2 || commands.length > 4) { failure('terminal-batch-requires-2..4-commands'); return; }
  let terminals;
  try {
    terminals = validateTerminalBatchCommands(commands, terminalBatchCommandKeys);
  } catch { failure('terminal-batch-invalid-command'); return; }
  const batch = await runTerminalBatch({ terminals, cwd: args.cwd, timeoutMilliseconds: (args.timeoutSeconds ?? 240) * 1000 });
  const routed = routeResult(batch, { ...args, cwd: args.cwd }, [`wakeupsAvoided=${Math.max(0, terminals.length - 1)}`, `boundariesAvoided=${Math.max(0, terminals.length - 1)}`]);
  savingsMeter.record(routed.savings, { ownerWakeupsAvoided: Math.max(0, terminals.length - 1), samplingBoundariesAvoided: Math.max(0, terminals.length - 1) });
  send({ jsonrpc: '2.0', id: message.id, result: contentResult(routed.text, {
    isError: !batch.pass,
    structuredContent: {
      terminal: true,
      batch: true,
      calls: batch.results.length,
      requested: terminals.length,
      failedAt: batch.pass ? null : batch.results.length,
      stoppedAt: batch.stoppedAt,
      steps: publicStepFacts(batch.steps),
      waitedMilliseconds: batch.durationMilliseconds,
      modelPolls: 0,
      ownerWakeupsAvoided: Math.max(0, terminals.length - 1),
      samplingBoundariesAvoided: Math.max(0, terminals.length - 1),
    },
  }) });
}
function publicStepFacts(steps) {
  return steps?.map((step) => Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'evidence')));
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
    else if (message.method === 'tools/call' && message.params?.name === 'terminal_batch') {
      await handleTerminalBatchExecution(message);
    }
    else if (message.method === 'tools/call' && message.params?.name === 'terminal_batch_start') {
      const args = message.params.arguments ?? {};
      let started;
      try {
        started = startBackgroundTerminalBatchJob({
          commands: args.commands,
          allowedKeys: terminalBatchCommandKeys,
          cwd: args.cwd,
          timeoutMilliseconds: args.timeoutSeconds * 1000,
        });
      } catch {
        const text = 'FAIL|calls=0|error=terminal-batch-invalid-command|terminal=1|batch=1|background=1|model=0';
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, { isError: true, structuredContent: { calls: 0, requested: Array.isArray(args.commands) ? args.commands.length : 0, modelPolls: 0 } }) });
        return;
      }
      const confirmed = await confirmBackgroundJobStart({ handle: started.handle });
      const status = confirmed.state.status;
      const failed = status === 'failed';
      const text = `${failed ? 'FAIL' : 'MORE'}|calls=0|requested=${args.commands.length}|status=${status}|job=${started.handle}|background=1|terminal=1|batch=1|startupMs=${confirmed.waitedMilliseconds}|polls=0|model=0`;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        isError: failed,
        structuredContent: { job: started.handle, status, requested: args.commands.length, timeoutMilliseconds: started.timeoutMilliseconds, startupConfirmed: confirmed.confirmed, modelPolls: 0 },
      }) });
    }
    else if (message.method === 'tools/call' && ['observe', 'run', 'supervise'].includes(message.params?.name)) {
      await handleExecution(message, message.params.name);
    } else if (message.method === 'tools/call' && message.params?.name === 'batch') {
      await handleBatchExecution(message);
    } else if (message.method === 'tools/call' && message.params?.name === 'job_start') {
      const args = message.params.arguments ?? {};
      const started = startBackgroundJob({ ...args, timeoutMilliseconds: args.timeoutSeconds * 1000 });
      const confirmed = await confirmBackgroundJobStart({ handle: started.handle });
      const status = confirmed.state.status;
      const failed = status === 'failed';
      const text = `${failed ? 'FAIL' : 'MORE'}|calls=0|status=${status}|job=${started.handle}|background=1|startupMs=${confirmed.waitedMilliseconds}|polls=0|model=0`;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        isError: failed,
        structuredContent: { job: started.handle, status, timeoutMilliseconds: started.timeoutMilliseconds, startupConfirmed: confirmed.confirmed, modelPolls: 0 },
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
        if (args.responseMode === 'compressed') {
          const envelope = await compressedEvidence(stored.evidenceBody ?? stored.adaptiveEvidence ?? '', {
            maxBytes: args.maxBytes ?? 8192,
            operation: waited.state.operation,
            commandRawBytes: stored.rawBytes ?? stored.savings?.rawBytes ?? null,
            cwd: waited.state.cwd,
            pass: executionPassed(stored, waited.state.status),
            exitCode: executionExitCode(stored, waited.state.status),
          });
          savingsMeter.record(envelope.savings, {
            ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0,
            samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0,
          });
          send({ jsonrpc: '2.0', id: message.id, result: contentResult(envelope.text, {
            isError: !executionPassed(stored, waited.state.status),
            structuredContent: compressedStructuredContent(envelope, {
              job: args.job,
              status: waited.state.status,
              commandRawBytes: stored.rawBytes ?? stored.savings?.rawBytes ?? null,
              commandMilliseconds: stored.durationMilliseconds,
              waitedMilliseconds: waited.waitedMilliseconds,
              steps: publicStepFacts(stored.steps),
              ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0,
              samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0,
            }),
          }) });
          return;
        }
        if (args.responseMode === 'evidence') {
          const evidence = evidenceOutput({
            exitCode: stored.exitCode ?? (stored.text?.startsWith('FAIL|') ? 1 : 0),
            stdout: stored.evidenceBody ?? stored.adaptiveEvidence ?? '',
            operation: waited.state.operation,
            command: stored.command,
            maxBytes: args.maxBytes ?? 8192,
            rawBytesOverride: stored.rawBytes ?? stored.savings?.rawBytes ?? null,
            facts: ['background=1', `job=${args.job}`, 'polls=0', `waitMs=${waited.waitedMilliseconds}`, ...(stored.requested > 1 ? [`wakeupsAvoided=${stored.avoidedOwnerWakeups}`, `boundariesAvoided=${stored.avoidedSamplingBoundaries}`] : [])],
          });
          savingsMeter.record(evidence.savings, { ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0, samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0 });
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
              steps: publicStepFacts(stored.steps),
              ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0,
              samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0,
            },
          }) });
          return;
        }
        const routed = routeResult({
          ...stored,
          operation: waited.state.operation,
          command: stored.command,
          adaptiveEvidence: stored.adaptiveEvidence,
        }, { ...args, cwd: waited.state.cwd }, ['background=1', `job=${args.job}`, 'polls=0', `waitMs=${waited.waitedMilliseconds}`, ...(stored.requested > 1 ? [`wakeupsAvoided=${stored.avoidedOwnerWakeups}`, `boundariesAvoided=${stored.avoidedSamplingBoundaries}`] : [])]);
        savingsMeter.record(routed.savings, {
          ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0,
          samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0,
        });
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(routed.text, {
          isError: !executionPassed(stored, waited.state.status),
          structuredContent: {
            job: args.job,
            status: waited.state.status,
            commandMilliseconds: stored.durationMilliseconds,
            waitedMilliseconds: waited.waitedMilliseconds,
            modelPolls: 0,
            steps: publicStepFacts(stored.steps),
            ownerWakeupsAvoided: stored.avoidedOwnerWakeups ?? 0,
            samplingBoundariesAvoided: stored.avoidedSamplingBoundaries ?? 0,
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
    } else if (message.method === 'tools/call' && message.params?.name === 'compression_retrieve') {
      const args = message.params.arguments ?? {};
      let retrieved;
      try { retrieved = await configuredCompressionService().retrieve(args.handle, { query: args.query ?? null, maxBytes: args.maxBytes ?? 8192 }); } catch {
        const text = 'FAIL|calls=0|error=compression-handle-unavailable|model=0';
        send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, { isError: true, structuredContent: { modelPolls: 0 } }) });
        return;
      }
      const header = `OK|calls=1|retrieve=1|backend=${retrieved.backend}|raw=${retrieved.rawBytes}|shown=${retrieved.shownBytes}${retrieved.clipped ? '|more=1' : ''}|handle=${args.handle}|model=0`;
      const text = retrieved.content ? `${header}\n${retrieved.content}` : header;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        structuredContent: { backend: retrieved.backend, rawBytes: retrieved.rawBytes, shownBytes: retrieved.shownBytes, clipped: retrieved.clipped, modelPolls: 0 },
      }) });
    } else if (message.method === 'tools/call' && message.params?.name === 'rollout_audit') {
      const args = message.params.arguments ?? {};
      if (!Array.isArray(args.rollouts) || args.rollouts.length < 1 || args.rollouts.length > 8) throw new Error('rollout_audit requires 1..8 rollout paths');
      const reports = [];
      for (const path of args.rollouts) reports.push(await analyzeRollout(path, { sinceMs: args.sinceMs ?? 0 }));
      const report = reports.length === 1 ? reports[0] : aggregateRolloutMetrics(reports);
      const groups = reports.flatMap((entry) => entry.date_groups ?? []);
      const settings = loadSettings();
      const triggered = groups.flatMap((group) => [
        ...(group.samples_per_user !== null && group.samples_per_user > settings.migration.samplesPerUserThreshold ? [{ task_id: group.task_id, date: group.date, code: 'samples-per-user-high', value: group.samples_per_user, threshold: settings.migration.samplesPerUserThreshold }] : []),
        ...(group.estimated_context_tokens > settings.migration.contextTokensThreshold ? [{ task_id: group.task_id, date: group.date, code: 'estimated-context-high', value: group.estimated_context_tokens, threshold: settings.migration.contextTokensThreshold }] : []),
      ]);
      const migrationRequested = settings.migration.autoMigrate && triggered.length > 0;
      const samples = reports.reduce((sum, entry) => sum + entry.sampling.samples, 0);
      const userTurns = reports.reduce((sum, entry) => sum + entry.sampling.user_messages, 0);
      const averageContext = samples ? Math.round(reports.reduce((sum, entry) => sum + entry.sampling.observed_input_tokens, 0) / samples) : 0;
      const prefix = migrationRequested ? 'MORE' : triggered.length ? 'MORE' : 'OK';
      const text = `${prefix}|calls=${reports.length}|audit=rollout|samples=${samples}|turns=${userTurns}|spu=${userTurns ? Number((samples / userTurns).toFixed(2)) : 0}|ctx=${averageContext}|warnings=${triggered.length}|migrate=${migrationRequested ? 1 : 0}|archive=${migrationRequested && settings.migration.archiveOldSession ? 1 : 0}|rawLogged=1|billing=0|model=0`;
      send({ jsonrpc: '2.0', id: message.id, result: contentResult(text, {
        structuredContent: {
          schema: 'helioterm-rollout-migration-decision-v1',
          groups,
          warnings: triggered,
          migration: {
            enabled: settings.migration.autoMigrate,
            requested: migrationRequested,
            archiveOldSession: migrationRequested && settings.migration.archiveOldSession,
            protocol: 'desktop-owner-compact-handoff-v1',
          },
          accountingNotice: report.accounting_notice,
          privacy: 'prompt, command, environment, stdin, secret, and tool-output content omitted',
          modelPolls: 0,
        },
      }) });
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
  const transport = readline.createInterface({ input: process.stdin });
  transport.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      if (message.method === 'ping') void handle(message);
      else if (isLongRequest(message)) void queue.then(() => handle(message));
      else queue = queue.then(() => handle(message));
    } catch { /* ignore malformed transport lines */ }
  });
  transport.on('close', () => void queue.finally(() => compressionService?.close()));
  process.on('SIGINT', () => { compressionService?.close(); process.exit(0); });
  process.on('SIGTERM', () => { compressionService?.close(); process.exit(0); });
}
