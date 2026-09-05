import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { measureTokenSavings, measureTokenSavingsFromBytes } from './token-savings.mjs';
import { boundedAdaptiveEvidence } from './adaptive-channel.mjs';
import { runObserver } from './observer.mjs';

const execFileAsync = promisify(execFile);
export const INTERNAL_OBSERVER = 'helioterm:observer';
export const DEFAULT_COMMAND_TIMEOUT_MILLISECONDS = 240_000;
export const MAX_COMMAND_TIMEOUT_MILLISECONDS = 12 * 60 * 60 * 1000;
export const OPERATIONS = new Set(['test', 'pytest', 'build', 'git', 'search', 'files', 'bench', 'process', 'read', 'list', 'json', 'stat', 'count', 'hash', 'check', 'deps', 'version']);
export const EVIDENCE_OPERATIONS = new Set(['test', 'pytest', 'build', 'git', 'search', 'files', 'bench', 'read', 'list', 'json', 'stat', 'count', 'hash', 'check', 'deps', 'version']);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep', 'describe', 'branch', 'tag', 'remote', 'worktree', 'stash']);
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

function containedPathArgument(value, cwd = null) {
  relativePathArgument(value);
  if (!cwd) return value;
  const root = realpathSync(resolve(cwd));
  const candidate = resolve(root, value);
  if (!existsSync(candidate)) return value;
  const target = realpathSync(candidate);
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('path must stay inside the working directory');
  return value;
}

function filesDirectory(argument, cwd = null) {
  const args = parseArguments(argument);
  if (args.length !== 1) throw new Error('files requires exactly one directory argument');
  const [directory] = args;
  if (!directory || directory.startsWith('-')) throw new Error('files requires a repo-relative directory');
  if (ABSOLUTE_PREFIX.test(directory) || WINDOWS_DRIVE.test(directory)) throw new Error('files rejects absolute paths');
  if (directory.split(/[\\/]+/u).includes('..')) throw new Error('files rejects parent traversal');
  containedPathArgument(directory, cwd);
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

function observerArguments(operation, args, cwd = null) {
  if (operation === 'read') {
    if (args.length < 1 || args.length > 3) throw new Error('read requires path [start-line] [line-count]');
    relativePathArgument(args[0]);
    if (args.slice(1).some((value) => !/^\d+$/u.test(value))) throw new Error('read line values must be integers');
    if (args[1] !== undefined && (Number(args[1]) < 1 || Number(args[1]) > 1_000_000)) throw new Error('read start line must be 1..1000000');
    if (args[2] !== undefined && (Number(args[2]) < 1 || Number(args[2]) > 200)) throw new Error('read line count must be 1..200');
    containedPathArgument(args[0], cwd);
  } else if (operation === 'list') {
    if (args.length !== 1) throw new Error('list requires one directory');
    relativePathArgument(args[0]);
    containedPathArgument(args[0], cwd);
  } else if (operation === 'json') {
    if (args.length < 1 || args.length > 9) throw new Error('json requires path [selector ...]');
    relativePathArgument(args[0]);
    if (args.slice(1).some((value) => !/^[A-Za-z0-9_$.-]+$/u.test(value))) throw new Error('invalid JSON selector');
    containedPathArgument(args[0], cwd);
  } else if (['stat', 'count', 'hash'].includes(operation)) {
    if (args.length < 1 || args.length > 16) throw new Error(`${operation} requires 1..16 paths`);
    args.forEach(relativePathArgument);
    args.forEach((value) => containedPathArgument(value, cwd));
  }
  return { file: INTERNAL_OBSERVER, args: [operation, ...args] };
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
  if (args[0] === 'test') return args.length === 1;
  return args.length === 2
    && args[0] === 'run'
    && /^(?:test|lint|check|typecheck|build|verify|preflight|format(?::check)?)(?::[A-Za-z0-9_.-]+)*$/iu.test(args[1] ?? '');
}

function safeLifecycleGoals(args, allowed) {
  const goals = args.filter((value) => !value.startsWith('-'));
  return goals.length > 0 && goals.every((value) => allowed.has(value));
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
  else if (tool === 'mvn') pass = safeLifecycleGoals(toolArgs, new Set(['test', 'verify', 'package']));
  else if (tool === 'gradle') pass = safeLifecycleGoals(toolArgs, new Set(['test', 'check', 'build']));
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
  '-M', '--max-columns', '--max-depth', '--max-filesize', '--path-separator',
  '--replace', '--sort', '--sortr', '-t', '--type', '-T', '--type-not',
  '--type-add', '--type-clear',
]);
const RIPGREP_PATTERN_OPTIONS = new Set(['-e', '--regexp', '-f', '--file']);
const RIPGREP_SAFE_FLAGS = new Set([
  '--binary', '--case-sensitive', '--column', '--count', '--count-matches', '--crlf',
  '--files-with-matches', '--files-without-match', '--fixed-strings', '--heading', '--hidden',
  '--ignore-case', '--invert-match', '--json', '--line-number', '--line-regexp', '--multiline',
  '--multiline-dotall', '--no-heading', '--no-ignore', '--no-ignore-vcs', '--no-line-number',
  '--only-matching', '--pcre2', '--smart-case', '--stats', '--text', '--trim', '--word-regexp',
  '-a', '-c', '-F', '-i', '-L', '-l', '-n', '-o', '-P', '-s', '-S', '-U', '-v', '-w', '-x',
]);

function parseRipgrepOption(args, index, cwd) {
  const value = args[index];
  const equals = value.indexOf('=');
  const option = equals === -1 ? value : value.slice(0, equals);
  if (RIPGREP_SAFE_FLAGS.has(option) || /^-[acFiLlnoPsSUvwx]+$/u.test(option)) {
    if (equals !== -1) throw new Error(`search flag does not take a value: ${option}`);
    return { next: index + 1, pattern: false };
  }
  if (!RIPGREP_OPTIONS_WITH_VALUES.has(option) && !RIPGREP_PATTERN_OPTIONS.has(option)) {
    throw new Error(`unsupported search option: ${option}`);
  }
  const optionValue = equals === -1 ? args[index + 1] : value.slice(equals + 1);
  if (!optionValue) throw new Error(`search option requires a value: ${option}`);
  if (option === '-f' || option === '--file') containedPathArgument(optionValue, cwd);
  return { next: equals === -1 ? index + 2 : index + 1, pattern: RIPGREP_PATTERN_OPTIONS.has(option) };
}

function searchCommand(args, cwd = null) {
  let patternSeen = false;
  let pathSeen = false;
  let positionalOnly = false;

  for (let index = 0; index < args.length;) {
    const value = args[index];
    if (!positionalOnly && value === '--') { positionalOnly = true; index += 1; continue; }
    if (!positionalOnly && value.startsWith('-') && value !== '-') {
      const parsed = parseRipgrepOption(args, index, cwd);
      if (parsed.pattern) patternSeen = true;
      index = parsed.next;
      continue;
    }
    if (!patternSeen) patternSeen = true;
    else { containedPathArgument(value, cwd); pathSeen = true; }
    index += 1;
  }

  if (!patternSeen) throw new Error('search requires a pattern');
  return { file: 'rg', args: ['--no-config', ...(pathSeen ? args : [...args, '.'])] };
}

function safeBenchmark(args, cwd = null) {
  const [script, ...scriptArgs] = args;
  containedPathArgument(script, cwd);
  const normalized = script.replace(/\\/gu, '/');
  const permitted = /^benchmarks\/[A-Za-z0-9_.\/-]+\.(?:mjs|js)$/u.test(normalized)
    || ['scripts/preflight.mjs', 'scripts/estimate-bytes.mjs'].includes(normalized);
  const unsafeFlag = scriptArgs.some((value) => /^(?:-o|--(?:delete|force|in-place|output|remove|write))(?:=|$)/iu.test(value));
  if (!permitted || unsafeFlag) throw new Error('bench requires a read-only benchmark entry point');
}

function safeGitArguments(args) {
  if (!READ_ONLY_GIT.has(args[0])) throw new Error('Unsupported mutating git operation');
  const [subcommand, ...rest] = args;
  if (subcommand === 'branch') {
    const safe = rest.length === 0
      || (rest.length === 1 && ['--show-current', '--list', '-a', '-r', '-v', '-vv'].includes(rest[0]))
      || (rest.length === 2 && ['--list', '-l'].includes(rest[0]) && !rest[1].startsWith('-'));
    if (!safe) throw new Error('Unsupported mutating git branch operation');
  } else if (subcommand === 'tag') {
    const safe = rest.length === 0
      || (rest.length === 1 && ['--list', '-l'].includes(rest[0]))
      || (rest.length === 2 && ['--list', '-l'].includes(rest[0]) && !rest[1].startsWith('-'));
    if (!safe) throw new Error('Unsupported mutating git tag operation');
  } else if (subcommand === 'remote') {
    const safe = rest.length === 0 || (rest.length === 1 && rest[0] === '-v')
      || (rest.length >= 2 && rest.length <= 3 && rest[0] === 'get-url'
        && (rest.length === 2 || ['--all', '--push'].includes(rest[1]))
        && /^[A-Za-z0-9_.-]+$/u.test(rest.at(-1)));
    if (!safe) throw new Error('Unsupported mutating git remote operation');
  } else if (subcommand === 'worktree') {
    if (!(rest[0] === 'list' && rest.slice(1).every((value) => ['--porcelain', '-v'].includes(value)))) {
      throw new Error('Unsupported mutating git worktree operation');
    }
  } else if (subcommand === 'stash') {
    if (!(rest[0] === 'list' && rest.slice(1).every((value) => ['--oneline'].includes(value)))) {
      throw new Error('Unsupported mutating git stash operation');
    }
  }
  const unsafe = args.slice(1).some((value) => /^(?:-c|--(?:config|exec-path|ext-diff|no-index|output|paginate|textconv))(?:=|$)/iu.test(value)
    || /^(?:-O|--open-files-in-pager)(?:=|$)/iu.test(value));
  if (unsafe) throw new Error('Unsupported git execution or output option');
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

export function commandFor(operation, argument, cwd = null) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unsupported operation: ${operation}`);
  const args = parseArguments(argument);
  if (!args.length) throw new Error('Argument is empty');
  if (operation === 'test') return { file: process.execPath, args: ['--test', ...args] };
  if (operation === 'pytest') return { file: process.platform === 'win32' ? 'py.exe' : 'python3', args: ['-m', 'pytest', '-p', 'no:cacheprovider', ...args] };
  if (operation === 'bench') {
    safeBenchmark(args, cwd);
    return { file: process.execPath, args };
  }
  if (operation === 'build') {
    if (!safePackageScript(['run', ...args])) throw new Error('build requires one allowlisted package script');
    return npmCommand(['run', ...args]);
  }
  if (operation === 'git') {
    safeGitArguments(args);
    const normalized = ['diff', 'log', 'show'].includes(args[0])
      ? [args[0], '--no-ext-diff', '--no-textconv', ...args.slice(1)]
      : args;
    return { file: 'git', args: normalized };
  }
  if (operation === 'search') return searchCommand(args, cwd);
  if (operation === 'files') return { file: 'rg', args: ['--no-config', '--files', filesDirectory(argument, cwd)] };
  if (['read', 'list', 'json', 'stat', 'count', 'hash'].includes(operation)) return observerArguments(operation, args, cwd);
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

function structuredCheckFacts(candidate) {
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.pass !== 'boolean') return null;
    const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
    const explicitFailed = Array.isArray(parsed.failedChecks) ? parsed.failedChecks.length : null;
    const failed = explicitFailed ?? checks.filter((entry) => entry?.pass === false).length;
    return `check=${parsed.pass ? 'pass' : 'fail'}|failed=${failed}`;
  } catch { return null; }
}

export function semanticFacts(text, operation, command = { args: [] }) {
  const lines = outputLines(text);
  if (operation === 'terminal') {
    const structured = structuredCheckFacts(text.trim());
    if (structured) return structured;
  }
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
      const structured = structuredCheckFacts(candidate);
      if (structured) return structured;
    }
  }
  if (operation === 'search') return `matches=${lines.length}`;
  if (operation === 'files') return `files=${lines.length}`;
  if (operation === 'process') return `rows=${lines.length}`;
  if (operation === 'read') return `lines=${lines.length}`;
  if (operation === 'list') return `entries=${lines.length}`;
  if (operation === 'json') return `keys=${lines.length}`;
  if (operation === 'stat') return `entries=${lines.length}`;
  if (operation === 'count') {
    const totals = lines.reduce((sum, line) => {
      const [lineCount = '0', wordCount = '0', byteCount = '0'] = line.split('\t');
      return {
        lines: sum.lines + Number(lineCount),
        words: sum.words + Number(wordCount),
        bytes: sum.bytes + Number(byteCount),
      };
    }, { lines: 0, words: 0, bytes: 0 });
    return `files=${lines.length}|lines=${totals.lines}|words=${totals.words}|bytes=${totals.bytes}`;
  }
  if (operation === 'hash') return `files=${lines.length}|algorithm=sha256`;
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
  if (operation === 'terminal') {
    const executable = basename(String(command.file ?? '')).toLowerCase().replace(/\.exe$/u, '');
    if (executable === 'git') return semanticFacts(text, 'git', command);
    if (executable === 'rg') return semanticFacts(text, command.args?.includes('--files') ? 'files' : 'search', command);
    const passed = Number(/(?:^|\s)(\d+) passed\b/iu.exec(text)?.[1] ?? 0);
    const failed = Number(/(?:^|\s)(\d+) failed\b/iu.exec(text)?.[1] ?? 0);
    const errors = Number(/(?:^|\s)(\d+) errors?\b/iu.exec(text)?.[1] ?? 0);
    if (passed || failed || errors) return `pass=${passed}|fail=${failed + errors}`;
  }
  if (operation === 'git') {
    const subcommand = command.args?.[0];
    if (subcommand === 'status') return `changes=${lines.length}`;
    if (subcommand === 'ls-files') return `files=${lines.length}`;
    if (subcommand === 'grep') return `matches=${lines.length}`;
    if (subcommand === 'log') return `records=${lines.length}`;
    if (subcommand === 'diff' || subcommand === 'show') {
      if (command.args.includes('--check')) {
        const issues = lines.filter((line) => !/^warning: in the working copy of .+ (?:LF will be replaced by CRLF|CRLF will be replaced by LF)/iu.test(line));
        return `issues=${issues.length}`;
      }
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

function compact({ exitCode, stdout, stderr, operation, command, cwd, rawBytesOverride = null }) {
  const text = `${stdout ?? ''}${stderr ?? ''}`;
  const rawBytes = rawBytesOverride ?? Buffer.byteLength(text, 'utf8');
  const factText = operation === 'git' && command.args?.[0] === 'diff' && command.args.includes('--check') ? (stdout ?? '') : text;
  const semantic = semanticFacts(factText, operation, command);
  const facts = operation === 'check' ? `check=${exitCode === 0 ? 'pass' : 'fail'}|${semantic}` : semantic;
  const gitDiffCheck = command.args?.[0] === 'diff' && command.args.includes('--check')
    && (operation === 'git' || (operation === 'terminal' && /(?:^|[\\/])git(?:\.exe)?$/iu.test(String(command.file ?? ''))));
  const completeCheck = exitCode === 0 && (facts.startsWith('check=pass') || (gitDiffCheck && facts === 'issues=0'));
  const successfulTest = ['test', 'pytest'].includes(operation) && exitCode === 0;
  const successfulTerminalTest = operation === 'terminal' && exitCode === 0 && facts.startsWith('pass=') && facts.includes('|fail=0');
  const warningFreeCheck = operation === 'check' && exitCode === 0 && (semantic.startsWith('errors=0|warnings=0') || semantic.startsWith('pass='));
  const completeOutput = completeCheck && (operation !== 'check' || warningFreeCheck);
  const suppressSample = successfulTest || successfulTerminalTest || completeOutput || (operation === 'process' && exitCode === 0);
  const sampleInput = exitCode === 0 ? evidenceText(text, operation, command, exitCode) : `${stderr || ''}\n${stdout || ''}`;
  const sample = suppressSample ? '' : evidenceSample(sampleInput, 104, exitCode !== 0, cwd);
  const sampledBytes = Buffer.byteLength(sample, 'utf8');
  const more = completeOutput || successfulTest || successfulTerminalTest ? false : rawBytes > sampledBytes;
  const exitFact = exitCode === 0 ? '' : `|exit=${exitCode}`;
  const prefix = `${exitCode === 0 ? 'OK' : 'FAIL'}|calls=1${exitFact}|${facts}${more ? '|more=1' : ''}${sample ? `|sample=${sample}` : ''}`;
  const compactText = withSuffix(prefix, `|raw=${rawBytes}`, 220);
  return {
    text: compactText,
    savings: rawBytesOverride === null
      ? measureTokenSavings({ rawText: text, compactText })
      : measureTokenSavingsFromBytes({ rawBytes, compactText }),
    adaptiveEvidence: boundedAdaptiveEvidence(text, cwd),
  };
}

export function validateTimeoutMilliseconds(value) {
  const timeout = value ?? DEFAULT_COMMAND_TIMEOUT_MILLISECONDS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_COMMAND_TIMEOUT_MILLISECONDS) {
    throw new Error(`timeoutMilliseconds must be 1..${MAX_COMMAND_TIMEOUT_MILLISECONDS}`);
  }
  return timeout;
}

function commandTimeout(value) {
  return validateTimeoutMilliseconds(value);
}

function withExecutionState(result, { command, operation, exitCode }) {
  return { ...result, command, operation, exitCode, pass: exitCode === 0 };
}

export async function runCommand({ command, cwd, operation = null, timeoutMilliseconds }) {
  const requestedTimeout = timeoutMilliseconds ?? DEFAULT_COMMAND_TIMEOUT_MILLISECONDS;
  try {
    const timeout = commandTimeout(timeoutMilliseconds);
    if (command.file === INTERNAL_OBSERVER) {
      const stdout = runObserver({ operation: command.args[0], args: command.args.slice(1), cwd });
      return withExecutionState(compact({ exitCode: 0, stdout, stderr: '', operation, command, cwd }), { command, operation, exitCode: 0 });
    }
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    if (operation === 'pytest' || operation === 'check') childEnvironment.PYTHONDONTWRITEBYTECODE = '1';
    const { stdout, stderr } = await execFileAsync(command.file, command.args, { cwd, env: childEnvironment, windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    return withExecutionState(compact({ exitCode: 0, stdout, stderr, operation, command, cwd }), { command, operation, exitCode: 0 });
  } catch (error) {
    const timedOut = error?.code === 'ETIMEDOUT'
      || (error?.killed === true && error?.signal === 'SIGTERM');
    const exitCode = timedOut ? 124 : (Number.isInteger(error.code) ? error.code : 1);
    const emptyObservation = exitCode === 1
      && !String(error.stderr ?? '').trim()
      && (operation === 'search' || (operation === 'process' && command.file === 'pgrep'));
    if (emptyObservation) {
      return withExecutionState(compact({ exitCode: 0, stdout: error.stdout ?? '', stderr: '', operation, command, cwd }), { command, operation, exitCode: 0 });
    }
    const stderr = timedOut
      ? `${error.stderr || error.message || ''}\nHelioTerm timeout after ${requestedTimeout}ms`
      : (error.stderr || error.message);
    return withExecutionState(compact({ exitCode, stdout: error.stdout ?? '', stderr, operation, command, cwd }), { command, operation, exitCode });
  }
}

const SUPERVISED_CAPTURE_BYTES = 2 * 1024 * 1024;

function supervisedEnvironment(operation, overrides = {}) {
  const childEnvironment = { ...process.env, ...overrides };
  if (!Object.hasOwn(overrides, 'NODE_TEST_CONTEXT')) delete childEnvironment.NODE_TEST_CONTEXT;
  if (operation === 'pytest' || operation === 'check') childEnvironment.PYTHONDONTWRITEBYTECODE = '1';
  return childEnvironment;
}

function stopProcessTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* process already exited */ }
  }
}

export async function runSupervisedCommand({
  command,
  cwd,
  operation = 'terminal',
  timeoutMilliseconds,
  responseMode = 'compact',
  maxBytes = 8192,
}) {
  assertWorkingDirectory(cwd);
  const timeout = commandTimeout(timeoutMilliseconds);
  const started = Date.now();
  if (command.file === INTERNAL_OBSERVER) {
    const result = await runCommand({ command, cwd, operation, timeoutMilliseconds: timeout });
    return { ...result, durationMilliseconds: Date.now() - started, modelPolls: 0 };
  }

  const result = await new Promise((resolveResult) => {
    const chunks = [];
    let retainedBytes = 0;
    let rawBytes = 0;
    let timedOut = false;
    let settled = false;
    let spawnErrorCode = null;
    let timeoutTimer;
    let killFallback;

    const append = (value) => {
      let chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
      rawBytes += chunk.length;
      if (chunk.length >= SUPERVISED_CAPTURE_BYTES) {
        chunk = chunk.subarray(chunk.length - SUPERVISED_CAPTURE_BYTES);
        chunks.splice(0, chunks.length, chunk);
        retainedBytes = chunk.length;
        return;
      }
      chunks.push(chunk);
      retainedBytes += chunk.length;
      while (retainedBytes > SUPERVISED_CAPTURE_BYTES && chunks.length) {
        const excess = retainedBytes - SUPERVISED_CAPTURE_BYTES;
        const first = chunks[0];
        if (first.length <= excess) {
          chunks.shift();
          retainedBytes -= first.length;
        } else {
          chunks[0] = first.subarray(excess);
          retainedBytes -= excess;
        }
      }
    };

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killFallback);
      const captured = Buffer.concat(chunks, retainedBytes).toString('utf8');
      resolveResult({ exitCode, captured, rawBytes, spawnErrorCode });
    };

    let child;
    try {
      child = spawn(command.file, command.args, {
        cwd,
        env: supervisedEnvironment(operation, command.envOverrides),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: [command.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnErrorCode = typeof error.code === 'string' ? error.code : 'SPAWN_ERROR';
      append(`spawn ${command.file} ${error.code ?? error.message}\n`);
      finish(1);
      return;
    }
    if (command.stdin !== undefined) {
      child.stdin?.end(command.stdin);
      child.stdin?.on('error', (error) => append(`${error.message}\n`));
    }
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => {
      spawnErrorCode = typeof error.code === 'string' ? error.code : 'SPAWN_ERROR';
      append(`${error.message}\n`);
      finish(1);
    });
    child.on('close', (code) => finish(timedOut ? 124 : (Number.isInteger(code) ? code : 1)));

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      append(`HelioTerm timeout after ${timeout}ms\n`);
      stopProcessTree(child);
    }, timeout);
    timeoutTimer.unref?.();
    killFallback = setTimeout(() => {
      if (timedOut) finish(124);
    }, timeout + 10_000);
    killFallback.unref?.();
  });

  const durationMilliseconds = Date.now() - started;
  const evidenceBody = clipUtf8(result.captured.replace(/\u0000/gu, ''), 32 * 1024);
  if (responseMode === 'evidence') {
    return {
      ...evidenceOutput({
        exitCode: result.exitCode,
        stdout: result.captured,
        operation,
        command,
        maxBytes,
        rawBytesOverride: result.rawBytes,
      }),
      durationMilliseconds,
      modelPolls: 0,
      evidenceBody,
      spawnErrorCode: result.spawnErrorCode,
    };
  }
  const compacted = compact({
    exitCode: result.exitCode,
    stdout: result.captured,
    stderr: '',
    operation,
    command,
    cwd,
    rawBytesOverride: result.rawBytes,
  });
  return {
    ...compacted,
    command,
    operation,
    exitCode: result.exitCode,
    pass: result.exitCode === 0,
    rawBytes: result.rawBytes,
    evidenceBody,
    spawnErrorCode: result.spawnErrorCode,
    durationMilliseconds,
    modelPolls: 0,
  };
}

export async function runSupervisedOperation({ operation, argument, cwd, timeoutMilliseconds, responseMode, maxBytes }) {
  assertWorkingDirectory(cwd);
  return runSupervisedCommand({
    command: commandFor(operation, argument, cwd),
    cwd,
    operation,
    timeoutMilliseconds,
    responseMode,
    maxBytes,
  });
}

export async function runOperation({ operation, argument, cwd, timeoutMilliseconds }) {
  assertWorkingDirectory(cwd);
  return runCommand({ command: commandFor(operation, argument, cwd), cwd, operation, timeoutMilliseconds });
}

export function evidenceOutput({
  exitCode,
  stdout = '',
  stderr = '',
  operation,
  command,
  maxBytes,
  rawBytesOverride = null,
  facts = [],
}) {
  const rawText = `${stdout}${stderr}`;
  const rawBytes = rawBytesOverride ?? Buffer.byteLength(rawText, 'utf8');
  const body = clipUtf8(rawText.replace(/\u0000/gu, ''), maxBytes);
  const shownBytes = Buffer.byteLength(body, 'utf8');
  const more = shownBytes < rawBytes;
  const exitFact = exitCode === 0 ? '' : `|exit=${exitCode}`;
  const factText = facts.length ? `|${facts.join('|')}` : '';
  const header = `${exitCode === 0 ? 'OK' : 'FAIL'}|calls=1${exitFact}|evidence=1|operation=${operation}|raw=${rawBytes}|shown=${shownBytes}${more ? '|more=1' : ''}${factText}|model=0`;
  const text = body ? `${header}\n${body}` : header;
  return {
    text,
    pass: exitCode === 0,
    exitCode,
    rawBytes,
    shownBytes,
    more,
    command,
    operation,
    savings: rawBytesOverride === null
      ? measureTokenSavings({ rawText, compactText: text })
      : measureTokenSavingsFromBytes({ rawBytes, compactText: text }),
  };
}

export async function runEvidenceOperation({ operation, argument, cwd, maxBytes = 8192, timeoutMilliseconds }) {
  assertWorkingDirectory(cwd);
  if (!EVIDENCE_OPERATIONS.has(operation)) throw new Error('evidence mode requires an allowlisted evidence operation');
  if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 32 * 1024) throw new Error('maxBytes must be 256..32768');
  const command = commandFor(operation, argument, cwd);
  const timeout = commandTimeout(timeoutMilliseconds);
  try {
    if (command.file === INTERNAL_OBSERVER) {
      const stdout = runObserver({ operation: command.args[0], args: command.args.slice(1), cwd });
      return evidenceOutput({ exitCode: 0, stdout, operation, command, maxBytes });
    }
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      cwd,
      env: supervisedEnvironment(operation),
      windowsHide: true,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    return evidenceOutput({ exitCode: 0, stdout, stderr, operation, command, maxBytes });
  } catch (error) {
    const timedOut = error?.code === 'ETIMEDOUT'
      || (error?.killed === true && error?.signal === 'SIGTERM');
    const exitCode = timedOut ? 124 : (Number.isInteger(error.code) ? error.code : 1);
    const emptyObservation = exitCode === 1 && !String(error.stderr ?? '').trim() && operation === 'search';
    if (emptyObservation) return evidenceOutput({ exitCode: 0, stdout: error.stdout ?? '', operation, command, maxBytes });
    return evidenceOutput({
      exitCode,
      stdout: error.stdout ?? '',
      stderr: timedOut
        ? `${error.stderr || error.message || ''}\nHelioTerm timeout after ${timeout}ms`
        : (error.stderr || error.message),
      operation,
      command,
      maxBytes,
    });
  }
}
