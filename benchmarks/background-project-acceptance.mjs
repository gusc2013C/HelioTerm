#!/usr/bin/env node

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_DIRECTORY, startBackgroundJob, waitBackgroundJob } from '../scripts/job-manager.mjs';
import { runOperation } from '../scripts/kernel.mjs';

const [project, operation, encodedArgument] = process.argv.slice(2);
if (!project || !operation || !encodedArgument) throw new Error('usage: background-project-acceptance <project> <operation> <base64url-argument>');
const argument = Buffer.from(encodedArgument, 'base64url').toString('utf8');
if (!argument) throw new Error('decoded argument is empty');

const startedAt = Date.now();
const job = startBackgroundJob({
  operation,
  argument,
  cwd: project,
  timeoutMilliseconds: 120_000,
});
try {
  const before = await runOperation({ operation: 'git', argument: 'status --short', cwd: project });
  const searched = await runOperation({ operation: 'search', argument: '__helioterm_background_no_match__ README.md', cwd: project });
  const observationMilliseconds = Date.now() - startedAt;
  const completed = await waitBackgroundJob({ handle: job.handle, timeoutMilliseconds: 120_000 });
  const after = await runOperation({ operation: 'git', argument: 'status --short', cwd: project });
  const commandMilliseconds = completed.state.result?.durationMilliseconds ?? null;
  const proof = {
    pass: completed.completed
      && completed.state.status === 'completed'
      && completed.state.result?.modelPolls === 0
      && before.text === after.text
      && /^OK\|calls=1\|matches=0\|/u.test(searched.text)
      && observationMilliseconds < commandMilliseconds,
    operation,
    observationMilliseconds,
    commandMilliseconds,
    totalMilliseconds: Date.now() - startedAt,
    jobWaitCalls: 1,
    modelPolls: completed.state.result?.modelPolls ?? null,
    statusBefore: before.text,
    statusAfter: after.text,
    zeroMatchObserved: /^OK\|calls=1\|matches=0\|/u.test(searched.text),
  };
  process.stdout.write(`${JSON.stringify(proof)}\n`);
  if (!proof.pass) process.exitCode = 1;
} finally {
  try { unlinkSync(join(JOB_DIRECTORY, `${job.handle}.json`)); } catch { /* best effort */ }
}
