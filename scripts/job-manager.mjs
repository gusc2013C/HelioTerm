import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWorkingDirectory, commandFor, MAX_COMMAND_TIMEOUT_MILLISECONDS } from './kernel.mjs';
import { terminalCommandFor } from './terminal-transport.mjs';
import { validateTerminalBatchCommands } from './terminal-batch.mjs';

const HANDLE_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const JOB_DIRECTORY = join(tmpdir(), 'helioterm-background-jobs');
const FINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const JOB_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const WORKER_START_TIMEOUT_MILLISECONDS = 5_000;
const WORKER_DEADLINE_GRACE_MILLISECONDS = 15_000;
const SAFE_WORKER_START_ERROR = 'background worker failed to start';

function ensureDirectory() {
  mkdirSync(JOB_DIRECTORY, { recursive: true, mode: 0o700 });
}

function validateHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) throw new Error('invalid background job handle');
  return handle;
}

function statePath(handle) {
  return join(JOB_DIRECTORY, `${validateHandle(handle)}.json`);
}

function cancellationPath(handle) {
  return join(JOB_DIRECTORY, `${validateHandle(handle)}.cancel`);
}

function atomicWrite(file, value) {
  ensureDirectory();
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { renameSync(temporary, file); } catch (error) {
    try { unlinkSync(file); } catch { /* first write */ }
    try { renameSync(temporary, file); } catch {
      try { unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
  }
}

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_COMMAND_TIMEOUT_MILLISECONDS) {
    throw new Error(`timeoutMilliseconds must be 1..${MAX_COMMAND_TIMEOUT_MILLISECONDS}`);
  }
  return value;
}

function cleanupOldJobs(now = Date.now()) {
  ensureDirectory();
  for (const name of readdirSync(JOB_DIRECTORY)) {
    if (!HANDLE_PATTERN.test(name.replace(/\.json$/u, '')) || !name.endsWith('.json')) continue;
    const file = join(JOB_DIRECTORY, name);
    try {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (FINAL_STATES.has(state.status) && now - Date.parse(state.updatedAt) > JOB_RETENTION_MILLISECONDS) {
        unlinkSync(file);
        try { unlinkSync(cancellationPath(state.handle)); } catch { /* no cancellation marker */ }
      }
    } catch {
      try {
        if (now - statSync(file).mtimeMs > JOB_RETENTION_MILLISECONDS) unlinkSync(file);
      } catch { /* concurrent cleanup */ }
    }
  }
}

export function readBackgroundJob(handle) {
  const state = JSON.parse(readFileSync(statePath(handle), 'utf8'));
  if (state.version !== 1 || state.handle !== handle || typeof state.status !== 'string') throw new Error('invalid background job state');
  return state;
}

export function writeBackgroundJob(state) {
  if (!state || state.version !== 1 || state.handle !== validateHandle(state.handle)) throw new Error('invalid background job state');
  atomicWrite(statePath(state.handle), { ...state, updatedAt: new Date().toISOString() });
}

function withoutTerminalPayload(state) {
  const sanitized = { ...state };
  delete sanitized.terminal;
  delete sanitized.terminals;
  return sanitized;
}

function failedWorkerState(state, error = SAFE_WORKER_START_ERROR) {
  return withoutTerminalPayload({
    ...state,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error,
  });
}

function settleActiveJob(handle, error) {
  try {
    const current = readBackgroundJob(handle);
    if (FINAL_STATES.has(current.status)) return current;
    const failed = failedWorkerState(current, error);
    writeBackgroundJob(failed);
    return readBackgroundJob(handle);
  } catch {
    return null;
  }
}

export function cancellationRequested(handle) {
  try { return statSync(cancellationPath(handle)).isFile(); } catch { return false; }
}

export function removeBackgroundJob(handle) {
  try { unlinkSync(statePath(handle)); } catch { /* already removed */ }
  try { unlinkSync(cancellationPath(handle)); } catch { /* no cancellation marker */ }
}

export function startBackgroundJob({ operation, argument, cwd, timeoutMilliseconds }) {
  cleanupOldJobs();
  assertWorkingDirectory(cwd);
  commandFor(operation, argument, cwd);
  const timeout = validateTimeout(timeoutMilliseconds);
  const handle = randomBytes(12).toString('base64url');
  const now = new Date().toISOString();
  const state = {
    version: 1,
    handle,
    status: 'queued',
    operation,
    argument,
    cwd,
    timeoutMilliseconds: timeout,
    createdAt: now,
    updatedAt: now,
  };
  return launchBackgroundWorker(state, timeout);
}

function launchBackgroundWorker(state, timeout) {
  writeBackgroundJob(state);
  const worker = spawn(process.execPath, [fileURLToPath(new URL('./job-worker.mjs', import.meta.url)), state.handle], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  worker.once('error', () => { settleActiveJob(state.handle, SAFE_WORKER_START_ERROR); });
  worker.once('exit', () => { settleActiveJob(state.handle, 'background worker exited unexpectedly'); });
  if (Number.isInteger(worker.pid) && worker.pid > 0) {
    try {
      const current = readBackgroundJob(state.handle);
      if (current.status === 'queued') writeBackgroundJob({ ...current, workerPid: worker.pid });
    } catch { /* the worker may already have completed */ }
  }
  try {
    worker.send({ type: 'helioterm-background-start-v1' }, (error) => {
      if (error) settleActiveJob(state.handle, SAFE_WORKER_START_ERROR);
      try { worker.disconnect(); } catch { /* worker already exited */ }
    });
  } catch {
    settleActiveJob(state.handle, SAFE_WORKER_START_ERROR);
    try { worker.disconnect(); } catch { /* worker already exited */ }
  }
  worker.unref();
  return { handle: state.handle, status: 'queued', timeoutMilliseconds: timeout, workerPid: worker.pid };
}

export async function confirmBackgroundJobStart({ handle, timeoutMilliseconds = WORKER_START_TIMEOUT_MILLISECONDS }) {
  validateHandle(handle);
  const timeout = Math.min(validateTimeout(timeoutMilliseconds), WORKER_START_TIMEOUT_MILLISECONDS);
  const started = Date.now();
  while (true) {
    const state = readBackgroundJob(handle);
    if (state.status !== 'queued') {
      return { state, confirmed: state.status === 'running' || state.status === 'completed', waitedMilliseconds: Date.now() - started };
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeout) {
      stopWorkerTree(state.workerPid);
      const failed = settleActiveJob(handle, 'background worker startup timed out') ?? failedWorkerState(state, 'background worker startup timed out');
      return { state: failed, confirmed: false, waitedMilliseconds: elapsed };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(25, timeout - elapsed)));
  }
}

export function startBackgroundTerminalJob({ terminal, cwd, timeoutMilliseconds }) {
  cleanupOldJobs();
  assertWorkingDirectory(cwd);
  terminalCommandFor(terminal);
  const timeout = validateTimeout(timeoutMilliseconds);
  const handle = randomBytes(12).toString('base64url');
  const now = new Date().toISOString();
  const state = {
    version: 1,
    handle,
    status: 'queued',
    operation: 'terminal',
    terminal,
    cwd,
    timeoutMilliseconds: timeout,
    createdAt: now,
    updatedAt: now,
  };
  return launchBackgroundWorker(state, timeout);
}

export function startBackgroundTerminalBatchJob({ commands, allowedKeys, cwd, timeoutMilliseconds }) {
  cleanupOldJobs();
  assertWorkingDirectory(cwd);
  const terminals = validateTerminalBatchCommands(commands, allowedKeys);
  const timeout = validateTimeout(timeoutMilliseconds);
  const handle = randomBytes(12).toString('base64url');
  const now = new Date().toISOString();
  const state = {
    version: 1,
    handle,
    status: 'queued',
    operation: 'terminal_batch',
    terminals,
    cwd,
    timeoutMilliseconds: timeout,
    createdAt: now,
    updatedAt: now,
  };
  return launchBackgroundWorker(state, timeout);
}

function stopWorkerTree(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* worker already exited */ }
  }
}

export function cancelBackgroundJob(handle) {
  let state = readBackgroundJob(handle);
  if (FINAL_STATES.has(state.status)) return { state, cancelled: false };
  writeFileSync(cancellationPath(handle), 'cancelled\n', { encoding: 'utf8', mode: 0o600 });
  state = readBackgroundJob(handle);
  if (FINAL_STATES.has(state.status)) {
    try { unlinkSync(cancellationPath(handle)); } catch { /* completion won the race */ }
    return { state, cancelled: false };
  }
  stopWorkerTree(state.workerPid);
  const cancelled = {
    ...state,
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    error: 'cancelled by HelioTerm',
  };
  delete cancelled.terminal;
  delete cancelled.terminals;
  writeBackgroundJob(cancelled);
  return { state: readBackgroundJob(handle), cancelled: true };
}

export async function waitBackgroundJob({ handle, timeoutMilliseconds }) {
  validateHandle(handle);
  const timeout = validateTimeout(timeoutMilliseconds);
  const started = Date.now();
  while (true) {
    let state = readBackgroundJob(handle);
    if (FINAL_STATES.has(state.status)) return { state, waitedMilliseconds: Date.now() - started, completed: true };
    const queuedDeadline = Date.parse(state.createdAt) + WORKER_START_TIMEOUT_MILLISECONDS;
    if (state.status === 'queued' && Number.isFinite(queuedDeadline) && Date.now() > queuedDeadline) {
      stopWorkerTree(state.workerPid);
      state = settleActiveJob(handle, 'background worker startup timed out') ?? failedWorkerState(state, 'background worker startup timed out');
      return { state, waitedMilliseconds: Date.now() - started, completed: true };
    }
    const commandDeadline = Date.parse(state.createdAt) + state.timeoutMilliseconds + WORKER_DEADLINE_GRACE_MILLISECONDS;
    if (Number.isFinite(commandDeadline) && Date.now() > commandDeadline) {
      stopWorkerTree(state.workerPid);
      state = settleActiveJob(handle, 'background worker exceeded its command deadline') ?? failedWorkerState(state, 'background worker exceeded its command deadline');
      return { state, waitedMilliseconds: Date.now() - started, completed: true };
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeout) return { state, waitedMilliseconds: elapsed, completed: false };
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(250, timeout - elapsed)));
  }
}

export { JOB_DIRECTORY, WORKER_START_TIMEOUT_MILLISECONDS };
