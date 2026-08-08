import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const OPERATIONS = new Set(['test', 'pytest', 'build', 'git', 'search', 'files', 'bench', 'process']);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep', 'describe']);
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

export function commandFor(operation, argument) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unsupported operation: ${operation}`);
  const args = parseArguments(argument);
  if (!args.length) throw new Error('Argument is empty');
  if (operation === 'test') return { file: process.execPath, args: ['--test', ...args] };
  if (operation === 'pytest') return { file: process.platform === 'win32' ? 'py.exe' : 'python3', args: ['-m', 'pytest', '-p', 'no:cacheprovider', ...args] };
  if (operation === 'bench') return { file: process.execPath, args };
  if (operation === 'build') {
    if (process.platform !== 'win32') return { file: 'npm', args: ['run', ...args] };
    const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!existsSync(npmCli)) throw new Error('npm CLI was not found beside the active Node runtime');
    return { file: process.execPath, args: [npmCli, 'run', ...args] };
  }
  if (operation === 'git') {
    if (!READ_ONLY_GIT.has(args[0])) throw new Error('Unsupported mutating git operation');
    return { file: 'git', args };
  }
  if (operation === 'search') return { file: 'rg', args };
  if (operation === 'files') return { file: 'rg', args: ['--files', filesDirectory(argument)] };
  return { file: process.platform === 'win32' ? 'tasklist.exe' : 'ps', args };
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
  if (operation === 'files' || (operation === 'git' && ['status', 'ls-files'].includes(command.args?.[0]))) {
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
  const facts = semanticFacts(factText, operation, command);
  const completeCheck = exitCode === 0 && (facts.startsWith('check=pass')
    || (operation === 'git' && command.args?.[0] === 'diff' && command.args.includes('--check') && facts === 'issues=0'));
  const successfulTest = ['test', 'pytest'].includes(operation) && exitCode === 0;
  const suppressSample = successfulTest || completeCheck || (operation === 'process' && exitCode === 0);
  const sampleInput = exitCode === 0 ? evidenceText(text, operation, command, exitCode) : `${stderr || ''}\n${stdout || ''}`;
  const sample = suppressSample ? '' : evidenceSample(sampleInput, 104, exitCode !== 0, cwd);
  const sampledBytes = Buffer.byteLength(sample, 'utf8');
  const more = completeCheck || successfulTest ? false : rawBytes > sampledBytes;
  const exitFact = exitCode === 0 ? '' : `|exit=${exitCode}`;
  const prefix = `${exitCode === 0 ? 'OK' : 'FAIL'}|calls=1${exitFact}|${facts}${more ? '|more=1' : ''}${sample ? `|sample=${sample}` : ''}`;
  return withSuffix(prefix, `|raw=${rawBytes}`, 220);
}

export async function runCommand({ command, cwd, operation = null }) {
  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    if (operation === 'pytest') childEnvironment.PYTHONDONTWRITEBYTECODE = '1';
    const { stdout, stderr } = await execFileAsync(command.file, command.args, { cwd, env: childEnvironment, windowsHide: true, timeout: 240000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    return { text: compact({ exitCode: 0, stdout, stderr, operation, command, cwd }), command, operation };
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : 1;
    return { text: compact({ exitCode, stdout: error.stdout ?? '', stderr: error.stderr || error.message, operation, command, cwd }), command, operation };
  }
}

export async function runOperation({ operation, argument, cwd }) {
  assertWorkingDirectory(cwd);
  return runCommand({ command: commandFor(operation, argument), cwd, operation });
}
