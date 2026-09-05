#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRECT_OPERATIONS = new Set([
  'test', 'pytest', 'build', 'git', 'search', 'files', 'bench', 'process',
  'read', 'list', 'json', 'stat', 'count', 'hash', 'check', 'deps', 'version',
]);
const READ_ONLY_BATCH_OPERATIONS = new Set([
  'git', 'search', 'files', 'process', 'read', 'list', 'json', 'stat', 'count', 'hash', 'deps', 'version',
]);

const USAGE = `Usage:
  ht [-C <cwd>] [-e [bytes]] [-s] [-n] <operation> [argument ...]
  ht [-C <cwd>] [-t <seconds>] batch "<operation> <args>" "<operation> <args>" [...]
  ht [-C <cwd>] [-t <seconds>] [-e [bytes]] [-s] [-n] <program> [args ...]
  ht [-C <cwd>] [-t <seconds>] exec <program> [args ...]
  ht [-C <cwd>] [-t <seconds>] [-E NAME=VALUE] [-i <stdin>] bg <program> [args ...]
  ht [-C <cwd>] [-t <seconds>] batch-bg <base64url-json-command-array>
  ht [-C <cwd>] [-t <seconds>] [-e [bytes]] [-s] [-n] wait <job>
  ht [-C <cwd>] cancel <job>
  ht config show
  ht config set migration.<name> <value>
  ht config set compression.<name> <value>
  ht [-C <cwd>] [-t <seconds>] shell <powershell|cmd|sh|bash> <script>

Use exec before a program whose name collides with a deterministic operation.
`;

function packageVersion() {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return metadata.version;
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function parse(argv) {
  const state = {
    cwd: null,
    timeout: null,
    evidence: false,
    evidenceBytes: null,
    semantic: false,
    adaptive: true,
    env: [],
    stdin: null,
    forcedUniversal: false,
    command: [],
  };
  let index = 0;
  while (index < argv.length) {
    const value = argv[index];
    if (value === '--') {
      state.forcedUniversal = true;
      state.command = argv.slice(index + 1);
      break;
    }
    if (!value.startsWith('-') || value === '-') {
      state.command = argv.slice(index);
      break;
    }
    if (value === '-h' || value === '--help') return { ...state, help: true };
    if (value === '-v' || value === '--version') return { ...state, version: true };
    if (value === '-C' || value === '--cwd') {
      state.cwd = requireValue(argv, index, value);
      index += 2;
      continue;
    }
    if (value === '-t' || value === '--timeout') {
      state.timeout = requireValue(argv, index, value);
      index += 2;
      continue;
    }
    if (value === '-E' || value === '--env') {
      state.env.push(requireValue(argv, index, value));
      index += 2;
      continue;
    }
    if (value === '-i' || value === '--stdin') {
      state.stdin = requireValue(argv, index, value);
      index += 2;
      continue;
    }
    if (value === '-e' || value === '--evidence') {
      state.evidence = true;
      const possibleBytes = argv[index + 1];
      if (possibleBytes !== undefined && /^\d+$/u.test(possibleBytes)) {
        state.evidenceBytes = possibleBytes;
        index += 2;
      } else index += 1;
      continue;
    }
    if (value === '-s' || value === '--semantic') {
      state.semantic = true;
      index += 1;
      continue;
    }
    if (value === '-n' || value === '--no-adaptive') {
      state.adaptive = false;
      index += 1;
      continue;
    }
    throw new Error(`unknown HelioTerm option: ${value}`);
  }
  return state;
}

function commonRunnerArguments(state) {
  return [
    ...(state.cwd === null ? [] : ['--cwd', state.cwd]),
    ...(state.timeout === null ? [] : ['--timeout-seconds', state.timeout]),
    ...(state.evidence ? ['--evidence'] : []),
    ...(state.evidenceBytes === null ? [] : ['--evidence-bytes', state.evidenceBytes]),
    ...(state.semantic ? ['--semantic'] : []),
    ...(!state.adaptive ? ['--no-adaptive'] : []),
    ...state.env.flatMap((entry) => ['--env', entry]),
    ...(state.stdin === null ? [] : ['--stdin', state.stdin]),
  ];
}

function protocolArgument(values) {
  return values.map((value) => `"${String(value).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`).join(' ');
}

async function runTerminalCli(argv) {
  const { runCli } = await import('./terminal-runner.mjs');
  await runCli(argv);
}

async function runTerminal(state, command, extra = []) {
  if (!command.length) throw new Error('program is required');
  await runTerminalCli([
    ...commonRunnerArguments(state),
    ...extra,
    '--program', command[0], '--', ...command.slice(1),
  ]);
}

async function runDirectCli(state, requests) {
  const { runCli } = await import('./direct-runner.mjs');
  await runCli([
    ...(state.cwd === null ? [] : ['--cwd', state.cwd]),
    ...(state.timeout === null ? [] : ['--timeout-seconds', state.timeout]),
    ...requests.flatMap((request) => ['--request', request]),
    ...(state.evidence ? ['--evidence'] : []),
    ...(state.evidenceBytes === null ? [] : ['--evidence-bytes', state.evidenceBytes]),
    ...(state.semantic ? ['--semantic'] : []),
    ...(!state.adaptive ? ['--no-adaptive'] : []),
  ]);
}

export async function runShortCli(argv = process.argv.slice(2)) {
  try {
    const state = parse(argv);
    if (state.help) {
      process.stdout.write(USAGE);
      return;
    }
    if (state.version) {
      process.stdout.write(`${packageVersion()}\n`);
      return;
    }
    if (!state.command.length) throw new Error('command is required');

    const [verb, ...rest] = state.command;
    if (!state.forcedUniversal && verb === 'batch') {
      if (rest.length < 2 || rest.length > 4) throw new Error('batch requires 2..4 quoted read-only observations');
      if (state.evidence) throw new Error('batch is compact; request evidence for one operation');
      if (state.env.length || state.stdin !== null) throw new Error('batch does not accept environment or stdin overrides');
      const { parseArguments } = await import('./kernel.mjs');
      const requests = rest.map((request, index) => {
        const [operation, ...args] = parseArguments(request);
        if (!READ_ONLY_BATCH_OPERATIONS.has(operation)) throw new Error(`batch item ${index + 1} must be a read-only operation`);
        return `T|${operation}|${protocolArgument(args)}`;
      });
      await runDirectCli(state, requests);
      return;
    }
    if (verb === 'config') {
      const { runSettingsCli } = await import('./settings.mjs');
      await runSettingsCli(rest);
      return;
    }
    if (verb === 'wait') {
      if (rest.length !== 1) throw new Error('wait requires one job handle');
      await runTerminalCli([...commonRunnerArguments(state), '--wait-job', rest[0]]);
      return;
    }
    if (verb === 'cancel') {
      if (rest.length !== 1) throw new Error('cancel requires one job handle');
      await runTerminalCli([...commonRunnerArguments(state), '--cancel-job', rest[0]]);
      return;
    }
    if (verb === 'bg') {
      await runTerminal(state, rest, ['--background']);
      return;
    }
    if (verb === 'batch-bg') {
      if (rest.length !== 1) throw new Error('batch-bg requires one base64url JSON command array');
      await runTerminalCli([...commonRunnerArguments(state), '--background-batch-base64url', rest[0]]);
      return;
    }
    if (verb === 'exec') {
      await runTerminal(state, rest);
      return;
    }
    if (verb === 'shell') {
      const [shell, ...script] = rest;
      if (!shell || !script.length) throw new Error('shell requires a shell name and script');
      await runTerminalCli([...commonRunnerArguments(state), '--shell', shell, '--script', script.join(' ')]);
      return;
    }
    if (!state.forcedUniversal && DIRECT_OPERATIONS.has(verb)) {
      await runDirectCli(state, [`T|${verb}|${protocolArgument(rest)}`]);
      return;
    }
    await runTerminal(state, state.command);
  } catch (error) {
    process.stdout.write(`FAIL|calls=0|short-cli-error=${String(error.message).replace(/\|/gu, '/').slice(0, 180)}|model=0\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  await runShortCli();
}
