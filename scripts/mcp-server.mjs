#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { OPERATIONS, commandFor, parseArguments, runOperation } from './kernel.mjs';

export { commandFor, parseArguments, runOperation } from './kernel.mjs';

const VERSION = '0.1.0';
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
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
};

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (message.id == null) return;
  try {
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'helioterm', version: VERSION } } });
    else if (message.method === 'ping') send({ jsonrpc: '2.0', id: message.id, result: {} });
    else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [TOOL] } });
    else if (message.method === 'tools/call' && message.params?.name === 'run') {
      const result = await runOperation(message.params.arguments ?? {});
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: result.text }], isError: result.text.startsWith('FAIL|') } });
    } else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `FAIL|calls=0|error=${String(error.message).slice(0, 160)}` }], isError: true } });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    try { void handle(JSON.parse(line)); } catch { /* ignore malformed transport lines */ }
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
