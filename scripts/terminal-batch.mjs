import { aggregateTokenSavings } from './token-savings.mjs';
import { runTerminalCommand, terminalCommandFor, terminalSpecFromArguments } from './terminal-transport.mjs';

export const TERMINAL_BATCH_MIN_COMMANDS = 2;
export const TERMINAL_BATCH_MAX_COMMANDS = 4;
const STEP_EVIDENCE_BYTES = 4096;

function clipUtf8(value, maxBytes) {
  let result = '';
  let size = 0;
  for (const character of String(value ?? '')) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (size + bytes > maxBytes) break;
    result += character;
    size += bytes;
  }
  return result;
}

export function validateTerminalBatchCommands(commands, allowedKeys = null) {
  if (!Array.isArray(commands) || commands.length < TERMINAL_BATCH_MIN_COMMANDS || commands.length > TERMINAL_BATCH_MAX_COMMANDS) {
    throw new Error('terminal-batch-requires-2..4-commands');
  }
  const terminals = commands.map((command) => {
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('terminal-batch-invalid-command');
    if (allowedKeys && Object.keys(command).some((key) => !allowedKeys.has(key))) throw new Error('terminal-batch-invalid-command');
    const terminal = terminalSpecFromArguments(command);
    terminalCommandFor(terminal);
    return terminal;
  });
  return Object.freeze(terminals);
}

export async function runTerminalBatch({ terminals, cwd, timeoutMilliseconds }) {
  if (!Array.isArray(terminals) || terminals.length < TERMINAL_BATCH_MIN_COMMANDS || terminals.length > TERMINAL_BATCH_MAX_COMMANDS) {
    throw new Error('terminal-batch-requires-2..4-commands');
  }
  terminals.forEach(terminalCommandFor);
  const started = performance.now();
  const deadline = Date.now() + timeoutMilliseconds;
  const results = [];
  for (const terminal of terminals) {
    const observed = await runTerminalCommand({
      terminal,
      cwd,
      timeoutMilliseconds: Math.max(1, deadline - Date.now()),
    });
    results.push(observed);
    if (!observed.text.startsWith('OK|')) break;
  }
  const durationMilliseconds = Math.max(0, Math.round(performance.now() - started));
  const pass = results.length === terminals.length && results.every((result) => result.text.startsWith('OK|'));
  const steps = results.map((result, index) => Object.freeze({
    index: index + 1,
    exitCode: result.exitCode ?? (result.text.startsWith('OK|') ? 0 : 1),
    durationMilliseconds: result.durationMilliseconds ?? 0,
    rawBytes: result.savings?.rawBytes ?? result.rawBytes ?? 0,
    compactBytes: result.savings?.compactBytes ?? Buffer.byteLength(result.text ?? '', 'utf8'),
    evidence: clipUtf8(result.evidenceBody ?? result.adaptiveEvidence ?? '', STEP_EVIDENCE_BYTES),
    windowsShimRetry: result.windowsShimRetry === true,
  }));
  const stepSummary = steps.map((step) => `${step.index}:${step.exitCode === 0 ? 'ok' : `fail/${step.exitCode}`}`).join(',');
  const stoppedAt = !pass && results.length < terminals.length ? results.length + 1 : null;
  const failed = results.find((result) => !result.text.startsWith('OK|'));
  const failedSample = failed ? `|sample=${clipUtf8(failed.text.replace(/\|/gu, ','), 96)}` : '';
  const rawBytes = steps.reduce((sum, step) => sum + step.rawBytes, 0);
  const body = steps.map((step) => `[terminal-${step.index}|exit=${step.exitCode}|ms=${step.durationMilliseconds}]\n${step.evidence}`).join('\n');
  const text = `${pass ? 'OK' : 'FAIL'}|calls=${results.length}|requested=${terminals.length}|steps=${stepSummary}${stoppedAt ? `|stopped=${stoppedAt}` : ''}${failedSample}|raw=${rawBytes}|terminal=1|batch=1|ms=${durationMilliseconds}|model=0`;
  return Object.freeze({
    text,
    pass,
    rawBytes,
    durationMilliseconds,
    results: Object.freeze(results),
    steps: Object.freeze(steps),
    stoppedAt,
    evidenceBody: clipUtf8(body, STEP_EVIDENCE_BYTES * TERMINAL_BATCH_MAX_COMMANDS),
    adaptiveEvidence: clipUtf8(body, STEP_EVIDENCE_BYTES * TERMINAL_BATCH_MAX_COMMANDS),
    savings: aggregateTokenSavings(results.map((result) => result.savings), text),
  });
}
