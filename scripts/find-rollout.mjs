#!/usr/bin/env node

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function filesUnder(root, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) filesUnder(path, result);
    else if (entry.endsWith('.jsonl')) result.push(path);
  }
  return result;
}

function firstJson(path) {
  const descriptor = openSync(path, 'r');
  try {
    const chunks = [];
    let total = 0;
    while (total < 1024 * 1024) {
      const buffer = Buffer.alloc(Math.min(16384, 1024 * 1024 - total));
      const bytes = readSync(descriptor, buffer, 0, buffer.length, total);
      if (bytes === 0) break;
      const chunk = buffer.subarray(0, bytes);
      const newline = chunk.indexOf(10);
      chunks.push(newline >= 0 ? chunk.subarray(0, newline) : chunk);
      total += newline >= 0 ? newline : bytes;
      if (newline >= 0) break;
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/\r$/u, ''));
  } finally {
    closeSync(descriptor);
  }
}

const codexRoot = resolve(option('--codex-root') ?? process.env.CODEX_HOME ?? resolve(homedir(), '.codex'));
const wanted = {
  sessionId: option('--session-id'),
  agentPath: option('--agent-path'),
  role: option('--role'),
  parentSessionId: option('--parent-session-id'),
};
if (!wanted.sessionId && !wanted.agentPath) throw new Error('Use --session-id or --agent-path');
const candidates = [...filesUnder(resolve(codexRoot, 'sessions')), ...filesUnder(resolve(codexRoot, 'archived_sessions'))];
const matches = [];
for (const path of candidates) {
  let row;
  try { row = firstJson(path); } catch { continue; }
  const metadata = row?.type === 'session_meta' ? row.payload ?? {} : {};
  const role = metadata.source?.subagent?.thread_spawn?.agent_role ?? metadata.agent_role ?? null;
  if (wanted.sessionId && metadata.id !== wanted.sessionId) continue;
  if (wanted.agentPath && metadata.agent_path !== wanted.agentPath) continue;
  if (wanted.role && role !== wanted.role) continue;
  if (wanted.parentSessionId && metadata.parent_thread_id !== wanted.parentSessionId) continue;
  matches.push({ path, sessionId: metadata.id ?? null, agentPath: metadata.agent_path ?? null, role, parentSessionId: metadata.parent_thread_id ?? null });
}
const result = { schemaVersion: 'HELIOTERM_ROLLOUT_LOCATOR_V1', pass: matches.length === 1, wanted, matches };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;
