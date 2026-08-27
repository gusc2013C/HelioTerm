import { assertWorkingDirectory, runSupervisedCommand } from './kernel.mjs';

export const TERMINAL_SHELLS = Object.freeze(['default', 'powershell', 'cmd', 'sh', 'bash']);
export const TERMINAL_LIMITS = Object.freeze({
  maxArguments: 128,
  maxArgumentBytes: 8192,
  maxTotalArgumentBytes: 64 * 1024,
  maxScriptBytes: 64 * 1024,
  maxStdinBytes: 256 * 1024,
  maxEnvironmentEntries: 64,
  maxEnvironmentValueBytes: 8192,
});
const WINDOWS_SHIM_SPEC_ENV = 'HELIOTERM_WINDOWS_SHIM_SPEC_V1';
const WINDOWS_SHIM_SCRIPT = [
  "$ProgressPreference='SilentlyContinue'",
  "$ErrorActionPreference='Stop'",
  `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${WINDOWS_SHIM_SPEC_ENV}))`,
  '$spec=$json|ConvertFrom-Json',
  '$program=[string]$spec.program',
  '$arguments=@($spec.args|ForEach-Object {[string]$_})',
  'try { & $program @arguments; exit ([int]$LASTEXITCODE) } catch { Write-Error $_; exit 1 }',
].join(';');

function byteLength(value) { return Buffer.byteLength(value, 'utf8'); }

function terminalString(value, name, maxBytes, { allowEmpty = false, allowNewline = true } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.includes('\u0000')) {
    throw new Error(`${name} must be a ${allowEmpty ? '' : 'non-empty '}string without NUL bytes`);
  }
  if (!allowNewline && /[\r\n]/u.test(value)) throw new Error(`${name} must be one line`);
  if (byteLength(value) > maxBytes) throw new Error(`${name} exceeds ${maxBytes} UTF-8 bytes`);
  return value;
}

function terminalArguments(values = []) {
  if (!Array.isArray(values) || values.length > TERMINAL_LIMITS.maxArguments) {
    throw new Error(`args must contain at most ${TERMINAL_LIMITS.maxArguments} strings`);
  }
  const args = values.map((value, index) => terminalString(
    value,
    `args[${index}]`,
    TERMINAL_LIMITS.maxArgumentBytes,
    { allowEmpty: true },
  ));
  if (args.reduce((sum, value) => sum + byteLength(value), 0) > TERMINAL_LIMITS.maxTotalArgumentBytes) {
    throw new Error(`args exceed ${TERMINAL_LIMITS.maxTotalArgumentBytes} total UTF-8 bytes`);
  }
  return args;
}

function terminalEnvironment(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('env must be an object');
  const entries = Object.entries(value);
  if (entries.length > TERMINAL_LIMITS.maxEnvironmentEntries) {
    throw new Error(`env must contain at most ${TERMINAL_LIMITS.maxEnvironmentEntries} entries`);
  }
  return Object.fromEntries(entries.map(([key, entry]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) throw new Error(`invalid environment name: ${key}`);
    if (key.toUpperCase() === WINDOWS_SHIM_SPEC_ENV) throw new Error(`${WINDOWS_SHIM_SPEC_ENV} is reserved`);
    return [key, terminalString(entry, `env.${key}`, TERMINAL_LIMITS.maxEnvironmentValueBytes, { allowEmpty: true })];
  }));
}

function windowsShimCommand(spec, command) {
  const encodedScript = Buffer.from(WINDOWS_SHIM_SCRIPT, 'utf16le').toString('base64');
  const encodedSpec = Buffer.from(JSON.stringify({ program: spec.program, args: spec.args ?? [] }), 'utf8').toString('base64');
  return Object.freeze({
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encodedScript],
    terminalKind: 'direct:windows-shim',
    envOverrides: Object.freeze({ ...command.envOverrides, [WINDOWS_SHIM_SPEC_ENV]: encodedSpec }),
    ...(command.stdin !== undefined ? { stdin: command.stdin } : {}),
  });
}

function needsWindowsShim(result, command) {
  if (process.platform !== 'win32' || command.terminalKind !== 'direct' || result.exitCode === 0) return false;
  return ['EPERM', 'EINVAL', 'ENOENT'].includes(result.spawnErrorCode);
}

function shellCommand(shell, script) {
  if (!TERMINAL_SHELLS.includes(shell)) throw new Error(`shell must be one of: ${TERMINAL_SHELLS.join(', ')}`);
  if (shell === 'default') {
    return process.platform === 'win32'
      ? { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script] }
      : { file: '/bin/sh', args: ['-c', script] };
  }
  if (shell === 'powershell') {
    return { file: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script] };
  }
  if (shell === 'cmd') {
    if (process.platform !== 'win32') throw new Error('cmd shell is available only on Windows');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', script] };
  }
  if (shell === 'bash') return { file: 'bash', args: ['--noprofile', '--norc', '-c', script] };
  return { file: process.platform === 'win32' ? 'sh' : '/bin/sh', args: ['-c', script] };
}

export function terminalSpecFromArguments(value = {}) {
  return {
    ...(value.program !== undefined ? { program: value.program } : {}),
    ...(value.args !== undefined ? { args: value.args } : {}),
    ...(value.shell !== undefined ? { shell: value.shell } : {}),
    ...(value.script !== undefined ? { script: value.script } : {}),
    ...(value.env !== undefined ? { env: value.env } : {}),
    ...(value.stdin !== undefined ? { stdin: value.stdin } : {}),
  };
}

export function terminalCommandFor(spec = {}) {
  const direct = spec.program !== undefined;
  const scripted = spec.shell !== undefined || spec.script !== undefined;
  if (direct === scripted) throw new Error('provide either program with args or shell with script');
  const envOverrides = terminalEnvironment(spec.env);
  const stdin = spec.stdin === undefined
    ? undefined
    : terminalString(spec.stdin, 'stdin', TERMINAL_LIMITS.maxStdinBytes, { allowEmpty: true });
  const base = direct
    ? {
      file: terminalString(spec.program, 'program', 1024, { allowNewline: false }),
      args: terminalArguments(spec.args),
      terminalKind: 'direct',
    }
    : {
      ...shellCommand(
        spec.shell,
        terminalString(spec.script, 'script', TERMINAL_LIMITS.maxScriptBytes, { allowEmpty: true }),
      ),
      terminalKind: `shell:${spec.shell}`,
    };
  return Object.freeze({
    ...base,
    envOverrides: Object.freeze(envOverrides),
    ...(stdin !== undefined ? { stdin } : {}),
  });
}

export async function runTerminalCommand({
  terminal,
  cwd,
  timeoutMilliseconds,
  responseMode = 'compact',
  maxBytes = 8192,
}) {
  assertWorkingDirectory(cwd);
  const command = terminalCommandFor(terminal);
  const first = await runSupervisedCommand({
    command,
    cwd,
    operation: 'terminal',
    timeoutMilliseconds,
    responseMode,
    maxBytes,
  });
  if (!needsWindowsShim(first, command)) return first;
  const retry = await runSupervisedCommand({
    command: windowsShimCommand(terminal, command),
    cwd,
    operation: 'terminal',
    timeoutMilliseconds: Math.max(1, timeoutMilliseconds - first.durationMilliseconds),
    responseMode,
    maxBytes,
  });
  return { ...retry, durationMilliseconds: first.durationMilliseconds + retry.durationMilliseconds, windowsShimRetry: true };
}
