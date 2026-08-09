#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBackgroundJob, writeBackgroundJob } from './job-manager.mjs';
import { runSupervisedOperation } from './kernel.mjs';

export async function runBackgroundWorker(handle) {
  const state = readBackgroundJob(handle);
  if (state.status !== 'queued') throw new Error('background job is not queued');
  const startedState = { ...state, status: 'running', workerPid: process.pid, startedAt: new Date().toISOString() };
  writeBackgroundJob(startedState);
  try {
    const result = await runSupervisedOperation({
      operation: state.operation,
      argument: state.argument,
      cwd: state.cwd,
      timeoutMilliseconds: state.timeoutMilliseconds,
    });
    writeBackgroundJob({
      ...startedState,
      status: result.text.startsWith('FAIL|') ? 'failed' : 'completed',
      workerPid: process.pid,
      finishedAt: new Date().toISOString(),
      result: {
        text: result.text,
        savings: result.savings,
        command: result.command,
        adaptiveEvidence: result.adaptiveEvidence,
        durationMilliseconds: result.durationMilliseconds,
        modelPolls: 0,
      },
    });
  } catch (error) {
    writeBackgroundJob({
      ...startedState,
      status: 'failed',
      workerPid: process.pid,
      finishedAt: new Date().toISOString(),
      error: String(error.message).slice(0, 160),
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackgroundWorker(process.argv[2]).catch(() => { process.exitCode = 1; });
}
