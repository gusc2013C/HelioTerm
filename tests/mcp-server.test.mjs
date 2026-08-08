import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAdaptiveTicket, readAdaptiveTicket, removeAdaptiveTicket } from '../scripts/adaptive-channel.mjs';
import {
  commandFor,
  LUNA_ACCEPT_TOOL,
  LUNA_CONTEXT_TOOL,
  parseArguments,
  runOperation,
  SAVINGS_TOOL,
  TOOL,
  TOOLS,
} from '../scripts/mcp-server.mjs';

test('MCP tool schema is narrow and shell-free command mapping is deterministic', () => {
  assert.deepEqual(TOOL.inputSchema.required, ['operation', 'argument', 'cwd']);
  const command = commandFor('test', 'tests/firewall.test.mjs');
  assert.equal(command.file, process.execPath);
  assert.deepEqual(command.args, ['--test', 'tests/firewall.test.mjs']);
  assert.deepEqual(parseArguments('file "two words" & whoami'), ['file', 'two words', '&', 'whoami']);
  assert.deepEqual(commandFor('git', 'status --short'), { file: 'git', args: ['status', '--short'] });
  assert.deepEqual(commandFor('pytest', 'tests -q'), { file: process.platform === 'win32' ? 'py.exe' : 'python3', args: ['-m', 'pytest', '-p', 'no:cacheprovider', 'tests', '-q'] });
  const build = commandFor('build', 'preflight');
  if (process.platform === 'win32') {
    assert.equal(build.file, process.execPath);
    assert.match(build.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/u);
    assert.deepEqual(build.args.slice(1), ['run', 'preflight']);
  } else assert.deepEqual(build, { file: 'npm', args: ['run', 'preflight'] });
  assert.deepEqual(commandFor('files', 'tests'), { file: 'rg', args: ['--files', 'tests'] });
  assert.deepEqual(parseArguments(String.raw`src\lib`), [String.raw`src\lib`]);
  for (const argument of ['/tmp', String.raw`\\server\share`, String.raw`C:\repo`, 'src/../other', 'src other', '-hidden']) {
    assert.throws(() => commandFor('files', argument), /files/u);
  }
  assert.throws(() => commandFor('git', 'reset --hard'), /mutating git/u);
});

test('MCP run executes one test without a shell and returns compact evidence', async () => {
  const result = await runOperation({ operation: 'test', argument: 'tests/firewall.test.mjs', cwd: process.cwd() });
  assert.match(result.text, /^OK\|calls=1\|(?:pass=\d+\|fail=\d+|lines=\d+)\|raw=\d+$/u);
  assert.equal(result.command.file, process.execPath);
  assert.ok(result.savings.rawBytes > result.savings.compactBytes, JSON.stringify(result.savings));
  assert.ok(result.savings.savedEstimatedTokens > 0, JSON.stringify(result.savings));
});

test('MCP stdio implements initialize, tool listing, and compact tool call', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run', arguments: { operation: 'test', argument: 'tests/firewall.test.mjs', cwd: process.cwd() } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'savings', arguments: {} } },
  ];
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const responses = run.stdout.trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(responses.find((entry) => entry.id === 1).result.serverInfo.name, 'helioterm');
  assert.equal(responses.find((entry) => entry.id === 1).result.serverInfo.version, '0.1.1');
  assert.deepEqual(responses.find((entry) => entry.id === 2).result.tools.map((tool) => tool.name), ['run', 'savings', 'luna_context', 'luna_accept']);
  assert.match(responses.find((entry) => entry.id === 3).result.content[0].text, /^OK\|calls=1/u);
  assert.match(responses.find((entry) => entry.id === 3).result.content[0].text, /\|model=0$/u);
  const savings = responses.find((entry) => entry.id === 4).result.content[0].text;
  assert.match(savings, /^OK\|calls=0\|meter=content\|runs=1\|/u);
  assert.match(savings, /\|savedEst=\d+\|/u);
  assert.match(savings, /\|scope=content\|model=0$/u);
  assert.ok(Buffer.byteLength(savings, 'utf8') <= 256);
});

test('MCP savings tool is read-only, deterministic, and enabled', () => {
  assert.equal(TOOLS[0], TOOL);
  assert.equal(TOOLS[1], SAVINGS_TOOL);
  assert.deepEqual(SAVINGS_TOOL.inputSchema, { type: 'object', additionalProperties: false, properties: {} });
  assert.equal(SAVINGS_TOOL.annotations.readOnlyHint, true);
  assert.equal(SAVINGS_TOOL.annotations.destructiveHint, false);
  const config = JSON.parse(readFileSync('.mcp.json', 'utf8'));
  assert.equal(TOOLS[2], LUNA_CONTEXT_TOOL);
  assert.equal(TOOLS[3], LUNA_ACCEPT_TOOL);
  assert.equal(LUNA_CONTEXT_TOOL.annotations.readOnlyHint, true);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.readOnlyHint, false);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.destructiveHint, true);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.idempotentHint, false);
  assert.deepEqual(config.mcpServers.helioterm.enabled_tools, ['run', 'savings', 'luna_context', 'luna_accept']);
});

test('MCP adaptive context and acceptance bridge one Desktop Luna ticket', () => {
  const ticket = createAdaptiveTicket({
    canonical: 'FAIL|calls=1|exit=7|lines=100|more=1|raw=3000',
    decision: {
      useLuna: true,
      materialFailure: true,
      materialChange: false,
      truncated: true,
      effort: 'high',
      reason: 'failure',
      rawBytes: 3000,
      evidence: 'fixture loader cannot find the requested module\n'.repeat(80),
    },
  });
  try {
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'luna_context', arguments: { ticket: ticket.handle } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'luna_accept', arguments: { ticket: ticket.handle, response: '{"note":"fixture loader cannot find the requested module"}' } } },
    ];
    const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const responses = run.stdout.trim().split(/\r?\n/u).map(JSON.parse);
    assert.match(responses[0].result.content[0].text, /CANONICAL=FAIL\|calls=1/u);
    assert.equal(responses[0].result.structuredContent.effort, 'high');
    assert.equal(responses[1].result.structuredContent.accepted, true);
    assert.match(responses[1].result.content[0].text, /\|model=luna$/u);
    assert.throws(() => readAdaptiveTicket(ticket.handle), /ENOENT/u);
  } finally {
    removeAdaptiveTicket(ticket.handle);
  }
});

test('release base metadata stays aligned at 0.1.1 with an optional Codex cachebuster', () => {
  const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
  const pluginMetadata = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
  const mcpSource = readFileSync('scripts/mcp-server.mjs', 'utf8');
  assert.equal(packageMetadata.version, '0.1.1');
  assert.equal(pluginMetadata.version.split('+')[0], packageMetadata.version);
  assert.match(pluginMetadata.version, /^0\.1\.1(?:\+codex\.[A-Za-z0-9.-]+)?$/u);
  assert.match(mcpSource, /const VERSION = '0\.1\.1';/u);
});

test('MCP role fails closed instead of falling back to a shell', () => {
  const role = readFileSync('agents/helioterm-mcp.toml', 'utf8');
  assert.match(role, /FAIL\|calls=0\|mcp-unavailable/u);
  assert.match(role, /Never substitute `exec_command`/u);
  assert.match(role, /without JSON, arrays, backticks, or explanation/u);
});
