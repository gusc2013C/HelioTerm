import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  confirmBackgroundJobStart,
  JOB_DIRECTORY,
  readBackgroundJob,
  removeBackgroundJob,
  startBackgroundJob,
  waitBackgroundJob,
  writeBackgroundJob,
} from '../scripts/job-manager.mjs';

test('legacy synchronous start API stays queued while confirmation proves running and heartbeat', async () => {
  const job = startBackgroundJob({
    operation: 'bench',
    argument: 'benchmarks/supervise-wait.mjs 1400',
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  try {
    assert.equal(job.status, 'queued');
    const confirmed = await confirmBackgroundJobStart({ handle: job.handle });
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.state.status, 'running');
    assert.equal(Number.isInteger(confirmed.state.workerPid), true);
    assert.equal(typeof confirmed.state.heartbeatAt, 'string');
    const firstHeartbeat = confirmed.state.heartbeatAt;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1100));
    const heartbeat = readBackgroundJob(job.handle);
    assert.equal(heartbeat.status, 'running');
    assert.ok(Date.parse(heartbeat.heartbeatAt) > Date.parse(firstHeartbeat));
    const completed = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 5000 });
    assert.equal(completed.state.status, 'completed');
  } finally {
    removeBackgroundJob(job.handle);
  }
});

test('worker process exit before startup confirmation persists a safe failed state', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'helioterm-worker-start-failure-'));
  const copiedScripts = join(cache, 'scripts');
  cpSync('scripts', copiedScripts, { recursive: true });
  const manager = await import(`${pathToFileURL(join(copiedScripts, 'job-manager.mjs')).href}?failure=${Date.now()}`);
  unlinkSync(join(copiedScripts, 'job-worker.mjs'));
  const secret = 'worker-start-secret-must-not-persist';
  const job = manager.startBackgroundTerminalJob({
    terminal: { program: process.execPath, args: ['-e', 'process.exit(0)'], env: { HELIOTERM_SECRET: secret }, stdin: secret },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
  });
  try {
    const confirmed = await manager.confirmBackgroundJobStart({ handle: job.handle, timeoutMilliseconds: 2000 });
    assert.equal(confirmed.confirmed, false);
    assert.equal(confirmed.state.status, 'failed');
    assert.equal(confirmed.state.error, 'background worker exited unexpectedly');
    assert.equal(Object.hasOwn(confirmed.state, 'terminal'), false);
    assert.doesNotMatch(JSON.stringify(confirmed.state), /worker-start-secret-must-not-persist/u);
  } finally {
    manager.removeBackgroundJob(job.handle);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('a queued job recovered within seven days times out to a persisted sanitized failure', async () => {
  const handle = 'queuedRecovery01';
  const createdAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const secret = 'queued-recovery-secret';
  writeBackgroundJob({
    version: 1,
    handle,
    status: 'queued',
    operation: 'terminal',
    terminal: { program: process.execPath, args: ['-e', 'process.exit(0)'], env: { HELIOTERM_SECRET: secret }, stdin: secret },
    cwd: process.cwd(),
    timeoutMilliseconds: 5000,
    createdAt,
    updatedAt: createdAt,
  });
  try {
    const collected = await waitBackgroundJob({ handle, timeoutMilliseconds: 1000 });
    assert.equal(collected.completed, true);
    assert.equal(collected.state.status, 'failed');
    assert.equal(collected.state.error, 'background worker startup timed out');
    assert.equal(existsSync(join(JOB_DIRECTORY, `${handle}.json`)), true);
    const persisted = readBackgroundJob(handle);
    assert.equal(persisted.status, 'failed');
    assert.equal(Object.hasOwn(persisted, 'terminal'), false);
    assert.doesNotMatch(JSON.stringify(persisted), /queued-recovery-secret/u);
  } finally {
    removeBackgroundJob(handle);
  }
});
