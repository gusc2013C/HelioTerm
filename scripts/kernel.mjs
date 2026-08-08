import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { measureTokenSavings } from './token-savings.mjs';
import { boundedAdaptiveEvidence } from './adaptive-channel.mjs';

const execFileAsync = promisify(execFile);
const observer = fileURLToPath(new URL('./observer.mjs', import.meta.url));
export const OPERATIONS = new Set(['test', 'pytest', 'build', 'git', 'search', 'files', 'bench', 'process', 'read', 'list', 'json', 'stat', 'check', 'deps', 'version']);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep', 'describe']);
const PYTHON_CHECK_MODULES = new Set(['pytest', 'unittest', 'mypy', 'ruff', 'pyright']);
const VERSION_TOOLS = new Map([
  ['node', ['--version']], ['npm', ['--version']], ['git', ['--version']], ['rg', ['--version']],
  ['py', ['--version']], ['python', ['--version']], ['pytest', ['--version']], ['ruff', ['--version']],
  ['eslint', ['--version']], ['tsc', ['--version']], ['cargo', ['--version']], ['go', ['version']],
  ['dotnet', ['--info']], ['java', ['--version']], ['cmake', ['--version']],
]);
const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const ABSOLUTE_PREFIX = /^[\\/]/u;

export function assertWorkingDirectory(cwd) {
  if (typeof cwd !== 'string' || !statSync(cwd).isDirectory()) throw new Error('cwd must be an existing directory');
}

export function parseArguments(value) {
  const result = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      if (character === '\\' || character === '"' || character === "'" || /\s/u.test(character)) current += character;
      else current += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; else current += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/u.test(character)) { if (current) { result.push(current); current = ''; } } else current += character;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error('Unclosed quote in argument');
  if (current) result.push(current);
  return result;
}

function filesDirectory(argument) {
  const args = parseArguments(argument);
  if (args.length !== 1) throw new Error('files requires exactly one directory argument');
  const [directory] = args;
  if (!directory || directory.startsWith('-')) throw new Error('files requires a repo-relative directory');
  if (ABSOLUTE_PREFIX.test(directory) || WINDOWS_DRIVE.test(directory)) throw new Error('files rejects absolute paths');
  if (directory.split(/[\\/]+/u).includes('..')) throw new Error('files rejects parent traversal');
  return directory;
}

export function isValidFilesArgument(argument) {
  try { filesDirectory(argument); return true; } catch { return false; }
}

function relativePathArgument(value) {
  if (!value || value.startsWith('-') || ABSOLUTE_PREFIX.test(value) || WINDOWS_DRIVE.test(value)) throw new Error('path must be repository-relative');
  if (value.split(/[\\/]+/u).includes('..')) throw new Error('path rejects parent traversal');
  return value;
}

function observerArguments(operation, args) {
  if (operation === 'read') {
    if (args.length < 1 || args.length > 3) throw new Error('read requires path [start-line] [line-count]');
    relativePathArgument(args[0]);
    if (args.slice(1).some((value) => !/^\d+$/u.test(value))) throw new Error('read line values must be integers');
    if (args[1] !== undefined && (Number(args[1]) < 1 || Number(args[1]) > 1_000_000)) throw new Error('read start line must be 1..1000000');
    if (args[2] !== undefined && (Number(args[2]) < 1 || Number(args[2]) > 200)) throw new Error('read line count must be 1..200');
  } else if (operation === 'list') {
    if (args.length !== 1) throw new Error('list requires one directory');
    relativePathArgument(args[0]);
  } else if (operation === 'json') {
    if (args.length < 1 || args.length > 9) throw new Error('json requires path [selector ...]');
    relativePathArgument(args[0]);
    if (args.slice(1).some((value) => !/^[A-Za-z0-9_$.-]+$/u.test(value))) throw new Error('invalid JSON selector');
  } else if (operation === 'stat') {
    if (args.length < 1 || args.length > 16) throw new Error('stat requires 1..16 paths');
    args.forEach(relativePathArgument);
  }
  return { file: process.execPath, args: [observer, operation, ...args] };
}

function npmCommand(args) {
  if (process.platform !== 'win32') return { file: 'npm', args };
  const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw new Error('npm CLI was not found beside the active Node runtime');
  return { file: process.execPath, args: [npmCli, ...args] };
}

function executableCommand(tool, args) {
  if (tool === 'node') return { file: process.execPath, args };
  if (tool === 'npm') return npmCommand(args);
  if (process.platform === 'win32' && ['py', 'python'].includes(tool)) return { file: 'py.exe', args };
  return { file: tool, args };
}

function safePackageScript(args) {
  if (args[0] === 'test') return true;
  return args[0] === 'run' && /^(?:test|lint|check|typecheck|build|verify|preflight|format(?::check)?)(?::[A-Za-z0-9_.-]+)*$/iu.test(args[1] ?? '');
}

function safePythonCheck(args) {
  if (args[0] === '-m') return PYTHON_CHECK_MODULES.has(args[1]);
  try { relativePathArgument(args[0]); } catch { return false; }
  const name = basename(args[0]).toLowerCase();
  return name.endsWith('.py') && /(?:^|[_-])(?:check|validate|lint|test)(?:[_-]|\.)/u.test(name);
}

function checkCommand(args) {
  const [tool, ...toolArgs] = args;
  if (!toolArgs.length) throw new Error('check requires a tool and arguments');
  let pass = false;
  if (tool === 'node') pass = ['--check', '--test'].includes(toolArgs[0]);
  else if (tool === 'npm') pass = safePackageScript(toolArgs);
  else if (['py', 'python'].includes(tool)) pass = safePythonCheck(toolArgs);
  else if (tool === 'pytest' || tool === 'eslint') pass = true;
  else if (tool === 'ruff') pass = toolArgs[0] === 'check' || (toolArgs[0] === 'format' && toolArgs.includes('--check'));
  else if (tool === 'tsc') pass = toolArgs.includes('--noEmit');
  else if (tool === 'cargo') pass = ['test', 'check', 'clippy', 'metadata', 'tree'].includes(toolArgs[0]) || (toolArgs[0] === 'fmt' && toolArgs.includes('--check'));
  else if (tool === 'go') pass = ['test', 'vet', 'list'].includes(toolArgs[0]);
  else if (tool === 'dotnet') pass = ['test', 'build'].includes(toolArgs[0]) || (toolArgs[0] === 'format' && toolArgs.includes('--verify-no-changes'));
  else if (tool === 'mvn') pass = toolArgs.some((value) => ['test', 'verify', 'package'].includes(value));
  else if (tool === 'gradle') pass = toolArgs.some((value) => ['test', 'check', 'build'].includes(value));
  else if (tool === 'cmake') pass = toolArgs[0] === '--build';
  if (!pass) throw new Error('unsupported check command');
  const normalized = [...toolArgs];
  const pytestModule = ['py', 'python'].includes(tool) && normalized[0] === '-m' && normalized[1] === 'pytest';
  if ((tool === 'pytest' || pytestModule) && !normalized.includes('no:cacheprovider')) {
    const index = pytestModule ? 2 : 0;
    normalized.splice(index, 0, '-p', 'no:cacheprovider');
  }
  return executableCommand(tool, normalized);
}

function dependencyCommand(args) {
  const [tool, ...toolArgs] = args;
  let pass = false;
  if (tool === 'npm') pass = ['ls', 'list', 'outdated'].includes(toolArgs[0]);
  else if (['py', 'python'].includes(tool)) pass = toolArgs[0] === '-m' && toolArgs[1] === 'pip' && ['list', 'show', 'check', 'freeze'].includes(toolArgs[2]);
  else if (tool === 'pip') pass = ['list', 'show', 'check', 'freeze'].includes(toolArgs[0]);
  else if (tool === 'cargo') pass = ['tree', 'metadata'].includes(toolArgs[0]);
  else if (tool === 'go') pass = toolArgs[0] === 'list';
  else if (tool === 'dotnet') pass = toolArgs[0] === 'list' && toolArgs.includes('package');
  if (!pass) throw new Error('unsupported dependency command');
  return executableCommand(tool, toolArgs);
}

function versionCommand(args) {
  if (args.length !== 1 || !VERSION_TOOLS.has(args[0])) throw new Error('version requires one supported tool name');
  const tool = args[0];
  return executableCommand(tool, VERSION_TOOLS.get(tool));
}

const RIPGREP_OPTIONS_WITH_VALUES = new Set([
  '-A', '--after-context', '-B', '--before-context', '-C', '--context', '-E', '--encoding',
  '-f', '--file', '-g', '--glob', '--iglob', '-j', '--threads', '-m', '--max-count',
  '-M', '--max-columns', '--max-depth', '--max-filesize', '--path-separator', '--pre',
  '--pre-glob', '--replace', '--sort', '--sortr', '-t', '--type', '-T', '--type-not',
  '--type-add', '--type-clear',
]);

function searchCommand(args) {
  let patternSeen = false;
  let pathSeen = false;
  let optionValue = false;
  let positionalOnly = false;

  for (const value of args) {
    if (optionValue) { optionValue = false; continue; }
    if (!positionalOnly && value === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && value.startsWith('-') && value !== '-') {
      const [option] = value.split('=', 1);
      if (!value.includes('=') && RIPGREP_OPTIONS_WITH_VALUES.has(option)) optionValue = true;
      if (option === '-e' || option === '--regexp' || option === '-f' || option === '--file') patternSeen = true;
      continue;
    }
    if (!patternSeen) patternSeen = true;
    else pathSeen = true;
  }

  if (!patternSeen) throw new Error('search requires a pattern');
  return { file: 'rg', args: pathSeen ? args : [...args, '.'] };
}

function processCommand(args) {
  if (args.length !== 1) throw new Error('process requires one name, pid, or all');
  const [query] = args;
  if (query === 'all') {
    return process.platform === 'win32'
      ? { file: 'tasklist.exe', args: [] }
      : { file: 'ps', args: ['-eo', 'pid=,comm=,args='] };
  }
  if (/^\d{1,10}$/u.test(query)) {
    return process.platform === 'win32'
      ? { file: 'tasklist.exe', args: ['/FI', `PID eq ${query}`] }
      : { file: 'ps', args: ['-p', query, '-o', 'pid=,comm=,args='] };
  }
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(query)) throw new Error('invalid process query');
  if (process.platform === 'win32') {
    const imageName = query.toLowerCase().endsWith('.exe') ? query : `${query}.exe`;
    return { file: 'tasklist.exe', args: ['/FI', `IMAGENAME eq ${imageName}`] };
  }
  return { file: 'pgrep', args: ['-a', '-x', query] };
}

export function commandFor(operation, argument) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unsupported operation: ${operation}`);
  const args = parseArguments(argument);
  if (!args.length) throw new Error('Argument is empty');
  if (operation === 'test') return { file: process.execPath, args: ['--test', ...args] };
  if (operation === 'pytest') return { file: process.platform === 'win32' ? 'py.exe' : 'python3', args: ['-m', 'pytest', '-p', 'no:cacheprovider', ...args] };
  if (operation === 'bench') return { file: process.execPath, args };
  if (operation === 'build') {
    return npmCommand(['run', ...args]);
  }
  if (operation === 'git') {
    if (!READ_ONLY_GIT.has(args[0])) throw new Error('Unsupported mutating git operation');
    return { file: 'git', args };
  }
  if (operation === 'search') return searchCommand(args);
  if (operation === 'files') return { file: 'rg', args: ['--files', filesDirectory(argument)] };
  if (['read', 'list', 'json', 'stat'].includes(operation)) return observerArguments(operation, args);
  if (operation === 'check') return checkCommand(args);
  if (operation === 'deps') return dependencyCommand(args);
  if (operation === 'version') return versionCommand(args);
  return processCommand(args);
}

export function isValidOperationArgument(operation, argument) {
  try { commandFor(operation, argument); return true; } catch { return false; }
}

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

function withSuffix(prefix, suffix, maxBytes) {
  const budget = maxBytes - Buffer.byteLength(suffix, 'utf8');
  return `${clipUtf8(prefix, Math.max(0, budget))}${suffix}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeWorkspacePath(line, cwd) {
  if (!cwd) return line;
  const variants = [...new Set([cwd, cwd.replace(/\\/gu, '/'), cwd.replace(/\//gu, '\\')])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return variants.reduce((value, variant) => value.replace(new RegExp(escapeRegex(variant), 'giu'), '.'), line);
}

export function evidenceSample(text, maxBytes = 104, preferFailure = false, cwd = null) {
  const seen = new Set();
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '').trim().replace(/\s+/gu, ' ').replace(/\|/gu, '/'))
    .map((line) => normalizeWorkspacePath(line, cwd))
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  const failures = preferFailure
    ? lines.filter((line) => {
      const lower = line.toLowerCase();
      return line.startsWith('✖')
        || lower.startsWith('not ok')
        || lower.startsWith('failed ')
        || lower.startsWith('error ')
        || lower.startsWith('failuretype:')
        || lower.startsWith('error:')
        || line.includes('ERR_')
        || line.includes('AssertionError')
        || /^(?:#|ℹ) fail [1-9]\d*/u.test(line);
    })
    : [];
  const selected = failures.length ? failures.slice(0, 3) : (preferFailure ? lines.slice(-3) : lines.slice(0, 3));
  const sample = selected
    .join(';');
  return clipUtf8(sample, maxBytes);
}

function outputLines(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

export function semanticFacts(text, operation, command = { args: [] }) {
  const lines = outputLines(text);
  const pass = /(?:^|\n)(?:#|ℹ) pass (\d+)/u.exec(text)?.[1];
  const fail = /(?:^|\n)(?:#|ℹ) fail (\d+)/u.exec(text)?.[1];
  if (pass !== undefined || fail !== undefined) return `pass=${pass ?? 0}|fail=${fail ?? 0}`;
  if (operation === 'pytest') {
    const passed = Number(/(?:^|\s)(\d+) passed\b/iu.exec(text)?.[1] ?? 0);
    const failed = Number(/(?:^|\s)(\d+) failed\b/iu.exec(text)?.[1] ?? 0);
    const errors = Number(/(?:^|\s)(\d+) errors?\b/iu.exec(text)?.[1] ?? 0);
    return `pass=${passed}|fail=${failed + errors}`;
  }
  if (operation === 'build' || operation === 'bench') {
    for (const candidate of [text.trim(), ...[...lines].reverse()]) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && typeof parsed.pass === 'boolean') {
          const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
          const explicitFailed = Array.isArray(parsed.failedChecks) ? parsed.failedChecks.length : null;
          const failed = explicitFailed ?? checks.filter((entry) => entry?.pass === false).length;
          return `check=${parsed.pass ? 'pass' : 'fail'}|failed=${failed}`;
        }
      } catch { /* try the next line */ }
    }
  }
  if (operation === 'search') return `matches=${lines.length}`;
  if (operation === 'files') return `files=${lines.length}`;
  if (operation === 'process') return `rows=${lines.length}`;
  if (operation === 'read') return `lines=${lines.length}`;
  if (operation === 'list') return `entries=${lines.length}`;
  if (operation === 'json') return `keys=${lines.length}`;
  if (operation === 'stat') return `entries=${lines.length}`;
  if (operation === 'deps') return `packages=${lines.length}`;
  if (operation === 'version') return `lines=${lines.length}`;
  if (operation === 'check') {
    if (command.args?.includes('pytest')) {
      const passed = Number(/(?:^|\s)(\d+) passed\b/iu.exec(text)?.[1] ?? 0);
      const failed = Number(/(?:^|\s)(\d+) failed\b/iu.exec(text)?.[1] ?? 0);
      const errors = Number(/(?:^|\s)(\d+) errors?\b/iu.exec(text)?.[1] ?? 0);
      return `pass=${passed}|fail=${failed + errors}`;
    }
    const errors = lines.filter((line) => /(?:^|\s)(?:error|errors|failed|failure)(?:\s|:|$)/iu.test(line)).length;
    const warnings = lines.filter((line) => /(?:^|\s)warnings?(?:\s|:|$)/iu.test(line)).length;
    return `errors=${errors}|warnings=${warnings}|lines=${lines.length}`;
  }
  if (operation === 'git') {
    const subcommand = command.args?.[0];
    if (subcommand === 'status') return `changes=${lines.length}`;
    if (subcommand === 'ls-files') return `files=${lines.length}`;
    if (subcommand === 'grep') return `matches=${lines.length}`;
    if (subcommand === 'log') return `records=${lines.length}`;
    if (subcommand === 'diff' || subcommand === 'show') {
      if (command.args.includes('--check')) return `issues=${lines.length}`;
      const files = lines.filter((line) => line.startsWith('diff --git ')).length;
      if (files === 0) return `lines=${lines.length}`;
      const hunks = lines.filter((line) => line.startsWith('@@')).length;
      const additions = lines.filter((line) => /^\+(?!\+\+)/u.test(line)).length;
      const deletions = lines.filter((line) => /^-(?!--)/u.test(line)).length;
      return `files=${files}|hunks=${hunks}|add=${additions}|del=${deletions}`;
    }
  }
  return `lines=${lines.length}`;
}

function evidenceText(text, operation, command, exitCode) {
  const lines = outputLines(text);
  if (exitCode !== 0) return text;
  if (operation === 'process') return '';
  if (operation === 'files' || operation === 'list' || (operation === 'git' && ['status', 'ls-files'].includes(command.args?.[0]))) {
    return lines.sort().join('\n');
  }
  if (operation === 'git' && ['diff', 'show'].includes(command.args?.[0])) {
    if (!lines.some((line) => line.startsWith('diff --git '))) return text;
    const changes = lines.filter((line) => /^[+-](?!\+\+|--)/u.test(line));
    return (changes.length ? changes : lines.filter((line) => line.startsWith('diff --git ') || line.startsWith('@@'))).join('\n');
  }
  if (operation === 'build' || operation === 'bench') return lines.slice(-3).join('\n');
  return text;
}

function compact({ exitCode, stdout, stderr, operation, command, cwd }) {
  const text = `${stdout ?? ''}${stderr ?? ''}`;
  const rawBytes = Buffer.byteLength(text, 'utf8');
  const factText = operation === 'git' && command.args?.[0] === 'diff' && command.args.includes('--check') ? (stdout ?? '') : text;
  const semantic = semanticFacts(factText, operation, command);
  const facts = operation === 'check' ? `check=${exitCode === 0 ? 'pass' : 'fail'}|${semantic}` : semantic;
  const completeCheck = exitCode === 0 && (facts.startsWith('check=pass')
    || (operation === 'git' && command.args?.[0] === 'diff' && command.args.includes('--check') && facts === 'issues=0'));
  const successfulTest = ['test', 'pytest'].includes(operation) && exitCode === 0;
  const warningFreeCheck = operation === 'check' && exitCode === 0 && (semantic.startsWith('errors=0|warnings=0') || semantic.startsWith('pass='));
  const completeOutput = completeCheck && (operation !== 'check' || warningFreeCheck);
  const suppressSample = successfulTest || completeOutput || (operation === 'process' && exitCode === 0);
  const sampleInput = exitCode === 0 ? evidenceText(text, operation, command, exitCode) : `${stderr || ''}\n${stdout || ''}`;
  const sample = suppressSample ? '' : evidenceSample(sampleInput, 104, exitCode !== 0, cwd);
  const sampledBytes = Buffer.byteLength(sample, 'utf8');
  const more = completeOutput || successfulTest ? false : rawBytes > sampledBytes;
  const exitFact = exitCode === 0 ? '' : `|exit=${exitCode}`;
  const prefix = `${exitCode === 0 ? 'OK' : 'FAIL'}|calls=1${exitFact}|${facts}${more ? '|more=1' : ''}${sample ? `|sample=${sample}` : ''}`;
  const compactText = withSuffix(prefix, `|raw=${rawBytes}`, 220);
  return {
    text: compactText,
    savings: measureTokenSavings({ rawText: text, compactText }),
    adaptiveEvidence: boundedAdaptiveEvidence(text, cwd),
  };
}

export async function runCommand({ command, cwd, operation = null }) {
  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    if (operation === 'pytest' || operation === 'check') childEnvironment.PYTHONDONTWRITEBYTECODE = '1';
    const { stdout, stderr } = await execFileAsync(command.file, command.args, { cwd, env: childEnvironment, windowsHide: true, timeout: 240000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    return { ...compact({ exitCode: 0, stdout, stderr, operation, command, cwd }), command, operation };
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : 1;
    const emptyObservation = exitCode === 1
      && !String(error.stderr ?? '').trim()
      && (operation === 'search' || (operation === 'process' && command.file === 'pgrep'));
    if (emptyObservation) {
      return { ...compact({ exitCode: 0, stdout: error.stdout ?? '', stderr: '', operation, command, cwd }), command, operation };
    }
    return { ...compact({ exitCode, stdout: error.stdout ?? '', stderr: error.stderr || error.message, operation, command, cwd }), command, operation };
  }
}

export async function runOperation({ operation, argument, cwd }) {
  assertWorkingDirectory(cwd);
  return runCommand({ command: commandFor(operation, argument), cwd, operation });
}
