#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { OPERATIONS, commandFor, parseArguments, runOperation } from './kernel.mjs';
import { acceptAdaptiveLunaResponse, attachAdaptiveRoute, contextForAdaptiveTicket } from './adaptive-channel.mjs';
import { createTokenSavingsMeter, formatTokenSavings, replaceCompactTokenSavings } from './token-savings.mjs';

export { commandFor, parseArguments, runOperation } from './kernel.mjs';

const VERSION = '0.1.1';
export const TOOL = {
  name: 'run',
  title: 'Run one HelioTerm operation',
  description: 'Execute one deterministic shell-free operation and return one compact result line.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['operation', 'argument', 'cwd'],
    properties: {
      operation: { type: 'string', enum: [...OPERATIONS] },
      argument: { type: 'string', minLength: 1, maxLength: 512 },
      cwd: { type: 'string', minLength: 3, maxLength: 512 },
      adaptive: { type: 'boolean', default: true },
      semantic: { type: 'boolean', default: false },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
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
  description: 'For a temporary Desktop Luna task only: read canonical facts and bounded evidence for one opaque ticket. Uses no model and no shell.',
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
export const TOOLS = Object.freeze([TOOL, SAVINGS_TOOL, LUNA_CONTEXT_TOOL, LUNA_ACCEPT_TOOL]);
const savingsMeter = createTokenSavingsMeter();

export function withModelProof(result) {
  const text = result.text.endsWith('|model=0') ? result.text : `${result.text}|model=0`;
  return { ...result, text, savings: replaceCompactTokenSavings(result.savings, text) };
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (message.id == null) return;
  try {
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'helioterm', version: VERSION } } });
    else if (message.method === 'ping') send({ jsonrpc: '2.0', id: message.id, result: {} });
    else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    else if (message.method === 'tools/call' && message.params?.name === 'run') {
      const args = message.params.arguments ?? {};
      const observed = await runOperation(args);
      const routed = args.adaptive === false ? observed : attachAdaptiveRoute({ result: observed, semantic: args.semantic === true, cwd: args.cwd });
      const result = withModelProof(routed);
      savingsMeter.record(result.savings);
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: result.text }], isError: result.text.startsWith('FAIL|') } });
    } else if (message.method === 'tools/call' && message.params?.name === 'savings') {
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: formatTokenSavings(savingsMeter.snapshot()) }], isError: false } });
    } else if (message.method === 'tools/call' && message.params?.name === 'luna_context') {
      const context = contextForAdaptiveTicket(message.params.arguments?.ticket);
      send({ jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: context.prompt }],
        structuredContent: { ticket: context.record.handle, effort: context.record.effort, contextBytes: context.contextBytes },
        isError: false,
      } });
    } else if (message.method === 'tools/call' && message.params?.name === 'luna_accept') {
      const accepted = acceptAdaptiveLunaResponse({ ticket: message.params.arguments?.ticket, response: message.params.arguments?.response });
      send({ jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: accepted.text }],
        structuredContent: { accepted: accepted.accepted, reason: accepted.reason, effort: accepted.effort, metrics: accepted.metrics },
        isError: false,
      } });
    } else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `FAIL|calls=0|error=${String(error.message).slice(0, 160)}` }], isError: true } });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let queue = Promise.resolve();
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    try { const message = JSON.parse(line); queue = queue.then(() => handle(message)); } catch { /* ignore malformed transport lines */ }
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
