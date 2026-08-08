import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const OPERATIONS = new Set(['test', 'build', 'git', 'search', 'bench', 'process']);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep', 'describe']);

export function assertWorkingDirectory(cwd) {
  if (typeof cwd !== 'string' || !statSync(cwd).isDirectory()) throw new Error('cwd must be an existing directory');
}

export function parseArguments(value) {
  const result = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) { current += character; escaped = false; continue; }
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

export function commandFor(operation, argument) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unsupported operation: ${operation}`);
  const args = parseArguments(argument);
  if (!args.length) throw new Error('Argument is empty');
  if (operation === 'test') return { file: process.execPath, args: ['--test', ...args] };
  if (operation === 'bench') return { file: process.execPath, args };
  if (operation === 'build') return { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', ...args] };
  if (operation === 'git') {
    if (!READ_ONLY_GIT.has(args[0])) throw new Error('Unsupported mutating git operation');
    return { file: 'git', args };
  }
  if (operation === 'search') return { file: 'rg', args };
  return { file: process.platform === 'win32' ? 'tasklist.exe' : 'ps', args };
}

function compact({ exitCode, stdout, stderr }) {
  const text = `${stdout ?? ''}${stderr ?? ''}`;
  const rawBytes = Buffer.byteLength(text, 'utf8');
  const pass = /(?:^|\n)(?:#|ℹ) pass (\d+)/u.exec(text)?.[1];
  const fail = /(?:^|\n)(?:#|ℹ) fail (\d+)/u.exec(text)?.[1];
  const lines = text.split(/\r?\n/u).filter(Boolean).length;
  const facts = pass !== undefined || fail !== undefined ? `pass=${pass ?? 0}|fail=${fail ?? 0}` : `lines=${lines}`;
  return `${exitCode === 0 ? 'OK' : 'FAIL'}|calls=1|exit=${exitCode}|${facts}|raw=${rawBytes}`;
}

export async function runCommand({ command, cwd }) {
  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const { stdout, stderr } = await execFileAsync(command.file, command.args, { cwd, env: childEnvironment, windowsHide: true, timeout: 240000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    return { text: compact({ exitCode: 0, stdout, stderr }), command };
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : 1;
    return { text: compact({ exitCode, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message }), command };
  }
}

export async function runOperation({ operation, argument, cwd }) {
  assertWorkingDirectory(cwd);
  return runCommand({ command: commandFor(operation, argument), cwd });
}
