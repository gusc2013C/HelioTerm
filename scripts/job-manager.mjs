import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWorkingDirectory, commandFor, MAX_COMMAND_TIMEOUT_MILLISECONDS } from './kernel.mjs';

const HANDLE_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const JOB_DIRECTORY = join(tmpdir(), 'helioterm-background-jobs');
const FINAL_STATES = new Set(['completed', 'failed']);
const JOB_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

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
      if (FINAL_STATES.has(state.status) && now - Date.parse(state.updatedAt) > JOB_RETENTION_MILLISECONDS) unlinkSync(file);
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
  writeBackgroundJob(state);
  const worker = spawn(process.execPath, [fileURLToPath(new URL('./job-worker.mjs', import.meta.url)), handle], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  worker.on('error', (error) => {
    try {
      writeBackgroundJob({ ...state, status: 'failed', finishedAt: new Date().toISOString(), error: String(error.message).slice(0, 160) });
    } catch { /* state may already be complete */ }
  });
  worker.unref();
  return { handle, status: 'queued', timeoutMilliseconds: timeout, workerPid: worker.pid };
}

export async function waitBackgroundJob({ handle, timeoutMilliseconds }) {
  validateHandle(handle);
  const timeout = validateTimeout(timeoutMilliseconds);
  const started = Date.now();
  while (true) {
    let state = readBackgroundJob(handle);
    if (FINAL_STATES.has(state.status)) return { state, waitedMilliseconds: Date.now() - started, completed: true };
    const commandDeadline = Date.parse(state.createdAt) + state.timeoutMilliseconds + 15_000;
    if (Number.isFinite(commandDeadline) && Date.now() > commandDeadline) {
      state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: 'background worker exceeded its command deadline' };
      return { state, waitedMilliseconds: Date.now() - started, completed: true };
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeout) return { state, waitedMilliseconds: elapsed, completed: false };
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(250, timeout - elapsed)));
  }
}

export { JOB_DIRECTORY };
