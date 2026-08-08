#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bindingPath = resolve(root, 'model-binding.json');
const binding = existsSync(bindingPath) ? JSON.parse(readFileSync(bindingPath, 'utf8')) : null;
const config = existsSync(resolve(root, '.codex', 'config.toml')) ? readFileSync(resolve(root, '.codex', 'config.toml'), 'utf8') : '';
const role = existsSync(resolve(root, 'agents', 'helioterm.toml')) ? readFileSync(resolve(root, 'agents', 'helioterm.toml'), 'utf8') : '';
const mcpRole = existsSync(resolve(root, 'agents', 'helioterm-mcp.toml')) ? readFileSync(resolve(root, 'agents', 'helioterm-mcp.toml'), 'utf8') : '';
const files = ['.codex-plugin/plugin.json', '.mcp.json', 'agents/helioterm-mcp.toml', 'skills/helioterm/SKILL.md', 'scripts/direct-runner.mjs', 'scripts/firewall.mjs', 'scripts/inspect-proof.mjs', 'scripts/find-rollout.mjs', 'scripts/install-project.mjs', 'scripts/mcp-server.mjs'];
const checks = [
  ...files.map((path) => ({ name: `${path}-present`, pass: existsSync(resolve(root, path)) })),
  { name: 'binding-schema', pass: binding?.schemaVersion === 'HELIOTERM_MODEL_BINDING_V1' },
  { name: 'direct-default', pass: binding?.defaultMode === 'direct' && binding?.directRunner === 'scripts/direct-runner.mjs' },
  { name: 'binding-registered', pass: config.includes(`[agents.${binding?.agentType ?? ''}]`) && config.includes('../agents/helioterm.toml') },
  { name: 'mcp-binding-registered', pass: config.includes(`[agents.${binding?.mcpAgentType ?? ''}]`) && config.includes('../agents/helioterm-mcp.toml') },
  { name: 'binding-model', pass: typeof binding?.model === 'string' && role.includes(`model = "${binding.model}"`) },
  { name: 'binding-effort', pass: typeof binding?.effort === 'string' && role.includes(`model_reasoning_effort = "${binding.effort}"`) },
  { name: 'mcp-binding-model', pass: typeof binding?.model === 'string' && mcpRole.includes(`model = "${binding.model}"`) },
  { name: 'mcp-binding-effort', pass: typeof binding?.effort === 'string' && mcpRole.includes(`model_reasoning_effort = "${binding.effort}"`) },
  { name: 'identity-marker', pass: role.includes('HELIOTERM_ROLE_APPLIED') },
  { name: 'leaf-invariant', pass: role.includes('delegate') && role.includes('model-backed HelioTerm fallback') },
  { name: 'deterministic-map', pass: role.includes('map test=`node --test`') && role.includes('Without discovery') },
];
const result = { schemaVersion: 'HELIOTERM_PREFLIGHT_V1', pass: checks.every((entry) => entry.pass), binding, checks };
const compact = process.argv.includes('--compact');
process.stdout.write(`${JSON.stringify(compact ? { schemaVersion: result.schemaVersion, pass: result.pass, binding, failedChecks: checks.filter((entry) => !entry.pass).map((entry) => entry.name) } : result, null, compact ? 0 : 2)}\n`);
if (!result.pass) process.exitCode = 1;
