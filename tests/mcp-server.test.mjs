import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createAdaptiveTicket, readAdaptiveTicket, removeAdaptiveTicket } from '../scripts/adaptive-channel.mjs';
import { JOB_DIRECTORY, readBackgroundJob, removeBackgroundJob, startBackgroundJob, waitBackgroundJob } from '../scripts/job-manager.mjs';
import {
  commandFor,
  JOB_CANCEL_TOOL,
  JOB_START_TOOL,
  JOB_WAIT_TOOL,
  LUNA_ACCEPT_TOOL,
  LUNA_CONTEXT_TOOL,
  OBSERVE_TOOL,
  parseArguments,
  runOperation,
  runSupervisedOperation,
  SAVINGS_TOOL,
  SUPERVISE_TOOL,
  TERMINAL_START_TOOL,
  TERMINAL_SUPERVISE_TOOL,
  TERMINAL_TOOL,
  TOOL,
  TOOLS,
} from '../scripts/mcp-server.mjs';

test('supervised execution streams large output without exposing it to the model', async () => {
  const outputBytes = 3 * 1024 * 1024;
  const result = await runSupervisedOperation({
    operation: 'bench',
    argument: `benchmarks/supervise-wait.mjs 10 ${outputBytes}`,
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  assert.match(result.text, /^OK\|calls=1/u);
  assert.ok(result.savings.rawBytes >= outputBytes, JSON.stringify(result.savings));
  assert.ok(result.savings.compactBytes <= 220, JSON.stringify(result.savings));
  assert.equal(result.modelPolls, 0);
});

test('supervised execution enforces its own deadline without model polling', async () => {
  const result = await runSupervisedOperation({
    operation: 'bench',
    argument: 'benchmarks/supervise-wait.mjs 2000',
    cwd: process.cwd(),
    timeoutMilliseconds: 50,
  });
  assert.match(result.text, /^FAIL\|calls=1\|exit=124/u);
  assert.match(result.text, /HelioTerm timeout/u);
  assert.equal(result.modelPolls, 0);
  assert.ok(result.durationMilliseconds < 2000, result.durationMilliseconds);
});

test('MCP tool schema is narrow and shell-free command mapping is deterministic', () => {
  assert.deepEqual(TOOL.inputSchema.required, ['operation', 'argument', 'cwd']);
  assert.deepEqual(OBSERVE_TOOL.inputSchema.properties.responseMode.enum, ['compact', 'evidence']);
  assert.equal(OBSERVE_TOOL.inputSchema.properties.maxBytes.maximum, 32768);
  assert.deepEqual(TOOL.inputSchema.properties.responseMode.enum, ['compact', 'evidence']);
  assert.ok(OBSERVE_TOOL.inputSchema.properties.operation.enum.includes('count'));
  assert.ok(OBSERVE_TOOL.inputSchema.properties.operation.enum.includes('hash'));
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
  assert.deepEqual(commandFor('files', 'tests'), { file: 'rg', args: ['--no-config', '--files', 'tests'] });
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
  assert.equal(responses.find((entry) => entry.id === 1).result.serverInfo.version, '0.2.0');
  assert.deepEqual(responses.find((entry) => entry.id === 2).result.tools.map((tool) => tool.name), [
    'observe', 'run', 'supervise', 'terminal', 'terminal_supervise', 'job_start', 'terminal_start', 'job_wait', 'job_cancel', 'savings', 'luna_context', 'luna_accept',
  ]);
  assert.match(responses.find((entry) => entry.id === 3).result.content[0].text, /^OK\|calls=1/u);
  assert.match(responses.find((entry) => entry.id === 3).result.content[0].text, /\|model=0$/u);
  const savings = responses.find((entry) => entry.id === 4).result.content[0].text;
  assert.match(savings, /^OK\|calls=0\|meter=content\|runs=1\|/u);
  assert.match(savings, /\|savedEst=\d+\|/u);
  assert.match(savings, /\|scope=content\|model=0$/u);
  assert.ok(Buffer.byteLength(savings, 'utf8') <= 256);
});

test('MCP observe can return explicitly bounded exact evidence without a model', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'observe', arguments: {
      operation: 'read', argument: 'package.json 1 5', cwd: process.cwd(), responseMode: 'evidence', maxBytes: 4096,
    } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'savings', arguments: {} } },
  ];
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const responses = run.stdout.trim().split(/\r?\n/u).map(JSON.parse);
  const evidence = responses.find((entry) => entry.id === 1).result;
  assert.match(evidence.content[0].text, /^OK\|calls=1\|evidence=1\|operation=read/u);
  assert.match(evidence.content[0].text, /\n1:\{/u);
  assert.equal(evidence.structuredContent.clipped, false);
  assert.equal(evidence.structuredContent.modelPolls, 0);
  assert.match(responses.find((entry) => entry.id === 2).result.content[0].text, /\|runs=1\|/u);
});

test('MCP run evidence returns bounded test output without a plain terminal rerun', () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run', arguments: {
    operation: 'test', argument: 'tests/firewall.test.mjs', cwd: process.cwd(), responseMode: 'evidence', maxBytes: 4096,
  } } };
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim()).result;
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /^OK\|calls=1\|evidence=1\|operation=test/u);
  assert.match(result.content[0].text, /\|model=0\n/u);
  assert.equal(result.structuredContent.operation, 'test');
  assert.equal(result.structuredContent.modelPolls, 0);
});

test('MCP universal terminal runs arbitrary programs with truthful safety metadata', () => {
  assert.equal(TERMINAL_TOOL.annotations.readOnlyHint, false);
  assert.equal(TERMINAL_TOOL.annotations.destructiveHint, true);
  assert.equal(TERMINAL_TOOL.annotations.openWorldHint, true);
  assert.equal(TERMINAL_SUPERVISE_TOOL.annotations.openWorldHint, true);
  assert.equal(TERMINAL_START_TOOL.annotations.openWorldHint, true);
  assert.equal(TERMINAL_TOOL.inputSchema.additionalProperties, false);
  assert.deepEqual(TERMINAL_TOOL.inputSchema.required, ['cwd']);
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal', arguments: {
    program: process.execPath, args: ['-e', "console.log(process.env.HELIO_MCP_VALUE)"], env: { HELIO_MCP_VALUE: 'mcp-ok' }, cwd: process.cwd(), adaptive: false,
  } } };
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim()).result;
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /^OK\|calls=1/u);
  assert.match(result.content[0].text, /\|terminal=1\|ms=\d+\|model=0$/u);
  assert.equal(result.structuredContent.terminal, true);
  assert.equal(result.structuredContent.modelPolls, 0);
});

test('MCP universal terminal evidence carries one-shot stdin without a plain terminal', () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal', arguments: {
    program: process.execPath,
    args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',v=>console.log(v.toUpperCase()))"],
    stdin: 'mcp-input', cwd: process.cwd(), responseMode: 'evidence', maxBytes: 4096,
  } } };
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim()).result;
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /^OK\|calls=1\|evidence=1\|operation=terminal/u);
  assert.match(result.content[0].text, /MCP-INPUT/u);
  assert.equal(result.structuredContent.modelPolls, 0);
});

test('MCP savings tool is read-only, deterministic, and enabled', () => {
  assert.equal(TOOLS[0], OBSERVE_TOOL);
  assert.equal(TOOLS[1], TOOL);
  assert.equal(TOOLS[2], SUPERVISE_TOOL);
  assert.equal(TOOLS[3], TERMINAL_TOOL);
  assert.equal(TOOLS[4], TERMINAL_SUPERVISE_TOOL);
  assert.equal(TOOLS[5], JOB_START_TOOL);
  assert.equal(TOOLS[6], TERMINAL_START_TOOL);
  assert.equal(TOOLS[7], JOB_WAIT_TOOL);
  assert.equal(TOOLS[8], JOB_CANCEL_TOOL);
  assert.equal(TOOLS[9], SAVINGS_TOOL);
  assert.deepEqual(SAVINGS_TOOL.inputSchema, { type: 'object', additionalProperties: false, properties: {} });
  assert.equal(SAVINGS_TOOL.annotations.readOnlyHint, true);
  assert.equal(SAVINGS_TOOL.annotations.destructiveHint, false);
  assert.equal(OBSERVE_TOOL.annotations.readOnlyHint, true);
  assert.equal(TOOL.annotations.readOnlyHint, false);
  assert.equal(TOOL.annotations.destructiveHint, true);
  assert.equal(SUPERVISE_TOOL.annotations.readOnlyHint, false);
  assert.equal(JOB_START_TOOL.annotations.idempotentHint, false);
  assert.equal(JOB_WAIT_TOOL.annotations.readOnlyHint, true);
  const config = JSON.parse(readFileSync('.mcp.json', 'utf8'));
  assert.equal(TOOLS[10], LUNA_CONTEXT_TOOL);
  assert.equal(TOOLS[11], LUNA_ACCEPT_TOOL);
  assert.equal(LUNA_CONTEXT_TOOL.annotations.readOnlyHint, true);
  assert.match(LUNA_CONTEXT_TOOL.description, /already-created temporary Desktop Luna leaf/u);
  assert.match(LUNA_CONTEXT_TOOL.description, /never create or wait for another task/u);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.readOnlyHint, false);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.destructiveHint, true);
  assert.equal(LUNA_ACCEPT_TOOL.annotations.idempotentHint, false);
  assert.equal(config.mcpServers.helioterm.default_tools_approval_mode, 'writes');
  assert.equal(config.mcpServers.helioterm.tool_timeout_sec, 43260);
  assert.deepEqual(config.mcpServers.helioterm.enabled_tools, [
    'observe', 'run', 'supervise', 'terminal', 'terminal_supervise', 'job_start', 'terminal_start', 'job_wait', 'job_cancel', 'savings', 'luna_context', 'luna_accept',
  ]);
});

test('MCP supervise waits internally once while ping remains responsive', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'supervise', arguments: { operation: 'bench', argument: 'benchmarks/supervise-wait.mjs 150', cwd: process.cwd(), timeoutSeconds: 5, adaptive: false } } },
    { jsonrpc: '2.0', id: 2, method: 'ping', params: {} },
  ];
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const responses = run.stdout.trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(responses[0].id, 2, run.stdout);
  const supervised = responses.find((entry) => entry.id === 1).result;
  assert.match(supervised.content[0].text, /^OK\|calls=1/u);
  assert.match(supervised.content[0].text, /\|wait=internal\|polls=0\|ms=\d+\|model=0$/u);
  assert.equal(supervised.structuredContent.modelPolls, 0);
  assert.ok(supervised.structuredContent.waitedMilliseconds >= 100);
  assert.ok(Buffer.byteLength(supervised.content[0].text, 'utf8') <= 256);
});

test('MCP supervise preserves an intelligent Luna ticket after wait proofs are added', () => {
  const request = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'supervise', arguments: { operation: 'read', argument: 'scripts/kernel.mjs 1 200', cwd: process.cwd(), timeoutSeconds: 5, semantic: true } },
  };
  const run = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim()).result;
  const match = /\|route=luna\|effort=high\|ticket=([A-Za-z0-9_-]{16})\|model=0$/u.exec(result.content[0].text);
  assert.ok(match, result.content[0].text);
  assert.equal(result.structuredContent.modelPolls, 0);
  try {
    const ticket = readAdaptiveTicket(match[1]);
    assert.match(ticket.canonical, /\|wait=internal\|polls=0\|ms=\d+$/u);
  } finally {
    removeAdaptiveTicket(match[1]);
  }
});

test('MCP background job lets another operation finish before one final wait', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'job_start', arguments: { operation: 'bench', argument: 'benchmarks/supervise-wait.mjs 750', cwd: process.cwd(), timeoutSeconds: 5 } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'job_wait', arguments: { job: 'PLACEHOLDER_HANDLE', timeoutSeconds: 5 } } },
  ];

  const start = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(requests[0])}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const started = JSON.parse(start.stdout.trim()).result;
  const handle = started.structuredContent.job;
  assert.match(started.content[0].text, /\|background=1\|polls=0\|model=0$/u);

  const followup = [
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'job_wait', arguments: { job: handle, timeoutSeconds: 5 } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'observe', arguments: { operation: 'read', argument: 'package.json 1 2', cwd: process.cwd(), adaptive: false } } },
  ];
  const wait = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${followup.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 10000 });
  try {
    assert.equal(wait.status, 0, wait.stderr || wait.stdout);
    const responses = wait.stdout.trim().split(/\r?\n/u).map(JSON.parse);
    assert.equal(responses[0].id, 4, wait.stdout);
    const completed = responses.find((entry) => entry.id === 3).result;
    assert.match(completed.content[0].text, /^OK\|calls=1/u);
    assert.match(completed.content[0].text, /\|background=1\|job=[A-Za-z0-9_-]{16}\|polls=0\|waitMs=\d+\|model=0$/u);
    assert.equal(completed.structuredContent.status, 'completed');
    assert.equal(completed.structuredContent.modelPolls, 0);
    assert.ok(Buffer.byteLength(completed.content[0].text, 'utf8') <= 256);
  } finally {
    removeBackgroundJob(handle);
  }
});

test('MCP arbitrary terminal background job returns retained evidence without rerunning', () => {
  const startRequest = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal_start', arguments: {
    program: process.execPath, args: ['-e', "setTimeout(()=>console.log('terminal-background-evidence'),40)"], cwd: process.cwd(), timeoutSeconds: 5,
  } } };
  const start = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(startRequest)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const started = JSON.parse(start.stdout.trim()).result;
  const handle = started.structuredContent.job;
  assert.match(started.content[0].text, /\|terminal=1\|polls=0\|model=0$/u);
  try {
    const waitRequest = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'job_wait', arguments: {
      job: handle, timeoutSeconds: 5, responseMode: 'evidence', maxBytes: 4096,
    } } };
    const wait = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(waitRequest)}\n`, encoding: 'utf8', timeout: 10000 });
    assert.equal(wait.status, 0, wait.stderr || wait.stdout);
    const completed = JSON.parse(wait.stdout.trim()).result;
    assert.equal(completed.isError, false);
    assert.match(completed.content[0].text, /^OK\|calls=1\|evidence=1\|operation=terminal/u);
    assert.match(completed.content[0].text, /\|background=1\|job=[A-Za-z0-9_-]{16}\|polls=0\|waitMs=\d+\|model=0\n/u);
    assert.match(completed.content[0].text, /terminal-background-evidence/u);
    assert.equal(completed.structuredContent.status, 'completed');
    assert.equal(completed.structuredContent.modelPolls, 0);
  } finally {
    try { unlinkSync(join(JOB_DIRECTORY, `${handle}.json`)); } catch { /* cleanup best effort */ }
  }
});

test('MCP job_cancel stops an arbitrary terminal worker without an owner kill command', () => {
  const startRequest = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal_start', arguments: {
    program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), timeoutSeconds: 10,
  } } };
  const start = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(startRequest)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const handle = JSON.parse(start.stdout.trim()).result.structuredContent.job;
  try {
    const cancelRequest = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'job_cancel', arguments: { job: handle } } };
    const cancel = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(cancelRequest)}\n`, encoding: 'utf8', timeout: 10000 });
    assert.equal(cancel.status, 0, cancel.stderr || cancel.stdout);
    const result = JSON.parse(cancel.stdout.trim()).result;
    assert.match(result.content[0].text, /^OK\|calls=0\|status=cancelled/u);
    assert.equal(result.structuredContent.cancelled, true);
    assert.equal(result.structuredContent.modelPolls, 0);
  } finally {
    removeBackgroundJob(handle);
  }
});

test('four background workers complete concurrently with unique persistent handles', async () => {
  const jobs = [100, 140, 180, 220].map((milliseconds) => startBackgroundJob({
    operation: 'bench',
    argument: `benchmarks/supervise-wait.mjs ${milliseconds}`,
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  }));
  try {
    assert.equal(new Set(jobs.map((job) => job.handle)).size, jobs.length);
    const started = Date.now();
    const completed = await Promise.all(jobs.map((job) => waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 5000 })));
    const elapsed = Date.now() - started;
    assert.ok(completed.every((entry) => entry.completed && entry.state.status === 'completed'), JSON.stringify(completed));
    assert.ok(completed.every((entry) => entry.state.result?.modelPolls === 0), JSON.stringify(completed));
    assert.ok(elapsed < 1500, `background workers appear serialized: ${elapsed}ms`);
  } finally {
    for (const job of jobs) {
      try { unlinkSync(join(JOB_DIRECTORY, `${job.handle}.json`)); } catch { /* cleanup best effort */ }
    }
  }
});

test('background deadline kills the command tree and persists exit 124', async () => {
  const job = startBackgroundJob({
    operation: 'bench',
    argument: 'benchmarks/supervise-wait.mjs 2000',
    cwd: process.cwd(),
    timeoutMilliseconds: 200,
  });
  try {
    const completed = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 5000 });
    assert.equal(completed.completed, true);
    assert.equal(completed.state.status, 'failed');
    assert.match(completed.state.result.text, /^FAIL\|calls=1\|exit=124/u);
    assert.equal(completed.state.result.modelPolls, 0);
  } finally {
    try { unlinkSync(join(JOB_DIRECTORY, `${job.handle}.json`)); } catch { /* cleanup best effort */ }
  }
});

test('running worker survives deletion of the plugin cache that launched it', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'helioterm-cache-replacement-'));
  const copiedScripts = join(cache, 'scripts');
  cpSync('scripts', copiedScripts, { recursive: true });
  const manager = await import(`${pathToFileURL(join(copiedScripts, 'job-manager.mjs')).href}?cache=${Date.now()}`);
  const job = manager.startBackgroundJob({
    operation: 'bench',
    argument: 'benchmarks/supervise-wait.mjs 500',
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  try {
    const deadline = Date.now() + 5000;
    while (readBackgroundJob(job.handle).status !== 'running' && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.equal(readBackgroundJob(job.handle).status, 'running');
    rmSync(cache, { recursive: true, force: true });
    const completed = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 5000 });
    assert.equal(completed.completed, true);
    assert.equal(completed.state.status, 'completed');
    assert.equal(completed.state.result.modelPolls, 0);
  } finally {
    rmSync(cache, { recursive: true, force: true });
    try { unlinkSync(join(JOB_DIRECTORY, `${job.handle}.json`)); } catch { /* cleanup best effort */ }
  }
});

test('failed background result routes to Luna after collection in a fresh MCP process', () => {
  const startRequest = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'job_start', arguments: { operation: 'bench', argument: 'benchmarks/supervise-failure.mjs 80', cwd: process.cwd(), timeoutSeconds: 5 } },
  };
  const start = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(startRequest)}\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const handle = JSON.parse(start.stdout.trim()).result.structuredContent.job;
  let ticket = null;
  try {
    const waitRequest = {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'job_wait', arguments: { job: handle, timeoutSeconds: 5, adaptive: true } },
    };
    const wait = spawnSync(process.execPath, ['scripts/mcp-server.mjs'], { input: `${JSON.stringify(waitRequest)}\n`, encoding: 'utf8', timeout: 10000 });
    assert.equal(wait.status, 0, wait.stderr || wait.stdout);
    const result = JSON.parse(wait.stdout.trim()).result;
    const match = /\|route=luna\|effort=high\|ticket=([A-Za-z0-9_-]{16})\|model=0$/u.exec(result.content[0].text);
    assert.ok(match, result.content[0].text);
    ticket = match[1];
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.status, 'failed');
    assert.equal(result.structuredContent.modelPolls, 0);
    const record = readAdaptiveTicket(ticket);
    assert.match(record.canonical, /^FAIL\|calls=1\|exit=7/u);
    assert.match(record.canonical, /\|background=1\|job=[A-Za-z0-9_-]{16}\|polls=0\|waitMs=\d+$/u);
    assert.match(record.evidence, /fixture-79/u);
  } finally {
    if (ticket) removeAdaptiveTicket(ticket);
    try { unlinkSync(join(JOB_DIRECTORY, `${handle}.json`)); } catch { /* cleanup best effort */ }
  }
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

test('release base metadata stays aligned at 0.2.0 with an optional Codex cachebuster', () => {
  const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
  const pluginMetadata = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
  const mcpSource = readFileSync('scripts/mcp-server.mjs', 'utf8');
  assert.equal(packageMetadata.version, '0.2.0');
  assert.equal(pluginMetadata.version.split('+')[0], packageMetadata.version);
  assert.match(pluginMetadata.version, /^0\.2\.0(?:\+codex\.[A-Za-z0-9.-]+)?$/u);
  assert.match(mcpSource, /const VERSION = '0\.2\.0';/u);
});

test('MCP role fails closed instead of falling back to a shell', () => {
  const role = readFileSync('agents/helioterm-mcp.toml', 'utf8');
  assert.match(role, /FAIL\|calls=0\|mcp-unavailable/u);
  assert.match(role, /Never substitute `exec_command`/u);
  assert.match(role, /without JSON, arrays, backticks, or explanation/u);
});
