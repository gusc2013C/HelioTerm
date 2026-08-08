#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function option(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const projectRoot = resolve(option('--project') ?? process.cwd());
const codexDirectory = resolve(projectRoot, '.codex');
const configPath = resolve(codexDirectory, 'config.toml');
const targetRolePath = resolve(codexDirectory, 'agents', 'helioterm.toml');
const targetMcpRolePath = resolve(codexDirectory, 'agents', 'helioterm-mcp.toml');
const sourceRolePath = resolve(root, 'agents', 'helioterm.toml');
const sourceMcpRolePath = resolve(root, 'agents', 'helioterm-mcp.toml');
const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
const section = '[agents.helioterm]';
const mcpSection = '[agents.helioterm_mcp]';
const alreadyRegistered = existing.includes(section);
const mcpAlreadyRegistered = existing.includes(mcpSection);
const write = process.argv.includes('--write');

if (alreadyRegistered && !existing.includes('config_file = "agents/helioterm.toml"')) {
  throw new Error('Existing [agents.helioterm] uses another config_file; refusing to overwrite it');
}
if (mcpAlreadyRegistered && !existing.includes('config_file = "agents/helioterm-mcp.toml"')) {
  throw new Error('Existing [agents.helioterm_mcp] uses another config_file; refusing to overwrite it');
}

if (write) {
  mkdirSync(resolve(codexDirectory, 'agents'), { recursive: true });
  copyFileSync(sourceRolePath, targetRolePath);
  copyFileSync(sourceMcpRolePath, targetMcpRolePath);
  let next = existing;
  if (!next.includes('[agents]')) next = `${next}${next && !next.endsWith('\n') ? '\n' : ''}[agents]\nenabled = true\n`;
  if (!alreadyRegistered) {
    next = `${next}${next.endsWith('\n') ? '' : '\n'}\n[agents.helioterm]\ndescription = "Independent model-bound HelioTerm semantic terminal."\nconfig_file = "agents/helioterm.toml"\n`;
  }
  if (!mcpAlreadyRegistered) {
    next = `${next}${next.endsWith('\n') ? '' : '\n'}\n[agents.helioterm_mcp]\ndescription = "Experimental HelioTerm MCP transport."\nconfig_file = "agents/helioterm-mcp.toml"\n`;
  }
  writeFileSync(configPath, next, 'utf8');
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 'HELIOTERM_PROJECT_INSTALL_V1',
  projectRoot,
  written: write,
  alreadyRegistered,
  configPath,
  rolePath: targetRolePath,
  ready: write || alreadyRegistered && mcpAlreadyRegistered && existsSync(targetRolePath) && existsSync(targetMcpRolePath),
}, null, 2)}\n`);
