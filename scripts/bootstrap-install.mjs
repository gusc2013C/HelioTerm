#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsShimSpecEnv = 'HELIOTERM_BOOTSTRAP_WINDOWS_SHIM_V1';
const windowsShimScript = [
  "$ProgressPreference='SilentlyContinue'",
  `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${windowsShimSpecEnv}))`,
  '$spec=$json|ConvertFrom-Json',
  '$program=[string]$spec.program',
  '$arguments=@($spec.args|ForEach-Object {[string]$_})',
  '& $program @arguments',
  'exit $LASTEXITCODE',
].join(';');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function validateArguments() {
  const flags = new Set(['--write', '--skip-codex', '--compact']);
  const valued = new Set(['--project', '--codex-home']);
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (flags.has(value) || [...valued].some((name) => value.startsWith(`${name}=`))) continue;
    if (valued.has(value)) {
      index += 1;
      if (index >= process.argv.length || process.argv[index].startsWith('--')) throw new Error(`${value} requires a value`);
      continue;
    }
    throw new Error(`unknown option: ${value}`);
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, process.argv.includes('--compact') ? 0 : 2)}\n`);
}

function runStep(name, file, args, cwd, env) {
  const options = { cwd, encoding: 'utf8', env, windowsHide: true };
  let result = spawnSync(file, args, options);
  if (process.platform === 'win32' && ['EPERM', 'EINVAL', 'ENOENT'].includes(result.error?.code)) {
    const encodedScript = Buffer.from(windowsShimScript, 'utf16le').toString('base64');
    const encodedSpec = Buffer.from(JSON.stringify({ program: file, args }), 'utf8').toString('base64');
    result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encodedScript], {
      ...options,
      env: { ...env, [windowsShimSpecEnv]: encodedSpec },
    });
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error || result.status !== 0) {
    const rawDetail = output || result.error?.message || '';
    const detail = rawDetail.length > 2048 ? rawDetail.slice(-2048) : rawDetail;
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
  return { name, status: 'passed' };
}

validateArguments();
const projectRoot = resolve(option('--project') ?? process.cwd());
const codexHome = option('--codex-home');
const write = process.argv.includes('--write');
const skipCodex = process.argv.includes('--skip-codex');
const commands = [
  ['marketplace', 'codex', ['plugin', 'marketplace', 'add', repositoryRoot]],
  ['plugin', 'codex', ['plugin', 'add', 'helioterm@helioterm']],
  ['project', process.execPath, [resolve(repositoryRoot, 'scripts', 'install-project.mjs'), '--project', projectRoot, '--write']],
  ['preflight', process.execPath, [resolve(repositoryRoot, 'scripts', 'preflight.mjs'), '--compact']],
];

if (!write) {
  emit({ schemaVersion: 'HELIOTERM_BOOTSTRAP_INSTALL_V1', pass: true, written: false, repositoryRoot, projectRoot, codexHome: codexHome ? resolve(codexHome) : null, commands: commands.map(([name, file, args]) => ({ name, file, args })) });
} else {
  if (!existsSync(repositoryRoot)) throw new Error(`Repository root does not exist: ${repositoryRoot}`);
  if (codexHome) mkdirSync(resolve(codexHome), { recursive: true });
  const env = codexHome ? { ...process.env, CODEX_HOME: resolve(codexHome) } : process.env;
  const steps = [];
  if (skipCodex) {
    steps.push({ name: 'marketplace', status: 'skipped' }, { name: 'plugin', status: 'skipped' });
  } else {
    steps.push(runStep('marketplace', 'codex', ['plugin', 'marketplace', 'add', repositoryRoot], repositoryRoot, env));
    steps.push(runStep('plugin', 'codex', ['plugin', 'add', 'helioterm@helioterm'], repositoryRoot, env));
  }
  steps.push(runStep('project', process.execPath, [resolve(repositoryRoot, 'scripts', 'install-project.mjs'), '--project', projectRoot, '--write'], repositoryRoot, process.env));
  steps.push(runStep('preflight', process.execPath, [resolve(repositoryRoot, 'scripts', 'preflight.mjs'), '--compact'], repositoryRoot, process.env));
  emit({ schemaVersion: 'HELIOTERM_BOOTSTRAP_INSTALL_V1', pass: true, written: true, repositoryRoot, projectRoot, codexHome: codexHome ? resolve(codexHome) : null, steps });
}
