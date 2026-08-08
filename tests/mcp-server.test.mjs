import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { commandFor, parseArguments, runOperation, TOOL } from '../scripts/mcp-server.mjs';

test('MCP tool schema is narrow and shell-free command mapping is deterministic', () => {
  assert.deepEqual(TOOL.inputSchema.required, ['operation', 'argument', 'cwd']);
  const command = commandFor('test', 'tests/firewall.test.mjs');
  assert.equal(command.file, process.execPath);
  assert.deepEqual(command.args, ['--test', 'tests/firewall.test.mjs']);
  assert.deepEqual(parseArguments('file "two words" & whoami'), ['file', 'two words', '&', 'whoami']);
});

test('MCP run executes one test without a shell and returns compact evidence', async () => {
  const result = await runOperation({ operation: 'test', argument: 'tests/firewall.test.mjs', cwd: process.cwd() });
  assert.match(result.text, /^OK\|calls=1\|exit=0\|(?:pass=\d+\|fail=\d+|lines=\d+)\|raw=\d+$/u);
  assert.equal(result.command.file, process.execPath);
});

test('MCP stdio implements initialize, tool listing, and compact tool call', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run', arguments: { operation: 'test', argument: 'tests/firewall.test.mjs', cwd: process.cwd() } } },
  ];
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const responses = run.stdout.trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(responses.find((entry) => entry.id === 1).result.serverInfo.name, 'helioterm');
  assert.equal(responses.find((entry) => entry.id === 2).result.tools[0].name, 'run');
  assert.match(responses.find((entry) => entry.id === 3).result.content[0].text, /^OK\|calls=1/u);
});

test('MCP role fails closed instead of falling back to a shell', () => {
  const role = readFileSync('agents/helioterm-mcp.toml', 'utf8');
  assert.match(role, /FAIL\|calls=0\|mcp-unavailable/u);
  assert.match(role, /Never substitute `exec_command`/u);
  assert.match(role, /without JSON, arrays, backticks, or explanation/u);
});
