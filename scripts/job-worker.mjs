#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { cancellationRequested, readBackgroundJob, writeBackgroundJob } from './job-manager.mjs';
import { runSupervisedOperation } from './kernel.mjs';
import { runTerminalCommand } from './terminal-transport.mjs';
import { runTerminalBatch } from './terminal-batch.mjs';

export async function runBackgroundWorker(handle) {
  const state = readBackgroundJob(handle);
  if (cancellationRequested(handle)) return;
  if (state.status !== 'queued') throw new Error('background job is not queued');
  const startedAt = new Date().toISOString();
  const startedState = { ...state, status: 'running', workerPid: process.pid, startedAt, heartbeatAt: startedAt };
  writeBackgroundJob(startedState);
  if (cancellationRequested(handle)) {
    const cancelledState = { ...startedState, status: 'cancelled', finishedAt: new Date().toISOString(), error: 'cancelled by HelioTerm' };
    delete cancelledState.terminal;
    delete cancelledState.terminals;
    writeBackgroundJob(cancelledState);
    return;
  }
  const heartbeat = setInterval(() => {
    try {
      const current = readBackgroundJob(handle);
      if (current.status === 'running' && current.workerPid === process.pid) {
        writeBackgroundJob({ ...current, heartbeatAt: new Date().toISOString() });
      }
    } catch { /* collection and cancellation may remove the state */ }
  }, 1_000);
  heartbeat.unref();
  try {
    const result = state.operation === 'terminal'
      ? await runTerminalCommand({ terminal: state.terminal, cwd: state.cwd, timeoutMilliseconds: state.timeoutMilliseconds })
      : state.operation === 'terminal_batch'
        ? await runTerminalBatch({ terminals: state.terminals, cwd: state.cwd, timeoutMilliseconds: state.timeoutMilliseconds })
        : await runSupervisedOperation({
        operation: state.operation,
        argument: state.argument,
        cwd: state.cwd,
        timeoutMilliseconds: state.timeoutMilliseconds,
      });
    const completedState = { ...startedState };
    delete completedState.terminal;
    delete completedState.terminals;
    writeBackgroundJob({
      ...completedState,
      status: result.text.startsWith('FAIL|') ? 'failed' : 'completed',
      workerPid: process.pid,
      finishedAt: new Date().toISOString(),
      result: {
        text: result.text,
        savings: result.savings,
        command: state.operation.startsWith('terminal') ? { file: `helioterm:${state.operation}`, args: [] } : result.command,
        adaptiveEvidence: result.adaptiveEvidence,
        evidenceBody: result.evidenceBody,
        rawBytes: result.rawBytes,
        exitCode: result.exitCode,
        windowsShimRetry: result.windowsShimRetry === true,
        durationMilliseconds: result.durationMilliseconds,
        steps: result.steps,
        requested: state.operation === 'terminal_batch' ? state.terminals.length : 1,
        avoidedOwnerWakeups: state.operation === 'terminal_batch' ? Math.max(0, state.terminals.length - 2) : 0,
        avoidedSamplingBoundaries: state.operation === 'terminal_batch' ? Math.max(0, state.terminals.length - 2) : 0,
        modelPolls: 0,
      },
    });
  } catch (error) {
    const failedState = { ...startedState };
    delete failedState.terminal;
    delete failedState.terminals;
    writeBackgroundJob({
      ...failedState,
      status: 'failed',
      workerPid: process.pid,
      finishedAt: new Date().toISOString(),
      error: String(error.message).slice(0, 160),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = process.argv[2];
  const run = () => { runBackgroundWorker(handle).catch(() => { process.exitCode = 1; }); };
  if (process.connected) {
    let launched = false;
    process.once('message', (message) => {
      if (message?.type !== 'helioterm-background-start-v1') return;
      launched = true;
      try { process.disconnect(); } catch { /* launcher already disconnected */ }
      run();
    });
    process.once('disconnect', () => {
      if (launched) return;
      try {
        const queued = readBackgroundJob(handle);
        const failed = { ...queued, status: 'failed', finishedAt: new Date().toISOString(), error: 'background worker launcher disconnected' };
        delete failed.terminal;
        delete failed.terminals;
        writeBackgroundJob(failed);
      } catch { /* state may have been cancelled or removed */ }
      process.exitCode = 1;
    });
  } else run();
}
