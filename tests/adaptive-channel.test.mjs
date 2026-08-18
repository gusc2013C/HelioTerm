import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acceptAdaptiveLunaResponse,
  ADAPTIVE_EVIDENCE_LIMIT_BYTES,
  attachAdaptiveRoute,
  boundedAdaptiveEvidence,
  classifyAdaptiveCompression,
  contextForAdaptiveTicket,
  createAdaptiveTicket,
  readAdaptiveTicket,
  sanitizeAdaptiveEvidence,
} from '../scripts/adaptive-channel.mjs';
import { desktopLunaTicketPrompt } from '../scripts/luna-compressor.mjs';
import { measureTokenSavings } from '../scripts/token-savings.mjs';

function observed({
  text = 'FAIL|calls=1|exit=1|lines=120|more=1|raw=4096',
  raw = `${'failure detail\n'.repeat(300)}`,
  operation = 'test',
  args = ['tests/example.test.mjs'],
} = {}) {
  return {
    text,
    operation,
    command: { file: process.execPath, args },
    adaptiveEvidence: raw,
    savings: measureTokenSavings({ rawText: raw, compactText: text }),
  };
}

function withTicketRoot(run) {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-adaptive-test-'));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('adaptive routing uses semantic value instead of one coarse size gate', () => {
  assert.equal(classifyAdaptiveCompression({ results: [observed({ raw: 'small' })] }).useLuna, false);
  assert.equal(classifyAdaptiveCompression({ results: [observed()] }).useLuna, true);
  const truncatedRead = observed({
    text: 'OK|calls=1|lines=200|more=1|raw=4096',
    raw: 'source line\n'.repeat(400),
    operation: 'read',
    args: ['scripts/example.mjs', '1', '200'],
  });
  assert.equal(classifyAdaptiveCompression({ results: [truncatedRead] }).useLuna, false);
  assert.equal(classifyAdaptiveCompression({ results: [truncatedRead], semantic: true }).useLuna, true);
  const diverseRead = observed({
    text: 'OK|calls=1|lines=200|more=1|raw=4096',
    raw: Array.from({ length: 120 }, (_, index) => `src/module-${index % 8}/file.mjs:${index}: branch ${index}`).join('\n'),
    operation: 'read',
    args: ['scripts/example.mjs', '1', '200'],
  });
  const automatic = classifyAdaptiveCompression({ results: [diverseRead] });
  assert.equal(automatic.useLuna, false);
  const requested = classifyAdaptiveCompression({ results: [diverseRead], semantic: true });
  assert.equal(requested.useLuna, true);
  assert.equal(requested.semanticScore, 3);
  assert.equal(requested.reason, 'requested');
});

test('ordinary command failures stay deterministic while semantic diagnostics still route', () => {
  const commandFailure = observed({
    text: 'FAIL|calls=1|exit=2|more=1|raw=8800',
    raw: `usage: tool --required <value>\n${'parameter value is invalid\n'.repeat(320)}`,
    operation: 'terminal',
    args: ['tool', '--invalid'],
  });
  const missingPath = observed({
    text: 'FAIL|calls=1|exit=2|more=1|raw=6700',
    raw: `rg: missing path: No such file or directory\n${'No such file or directory\n'.repeat(240)}`,
    operation: 'files',
    args: ['missing-path'],
  });
  const batchFailure = classifyAdaptiveCompression({ results: [commandFailure, missingPath] });
  assert.equal(batchFailure.useLuna, false);
  assert.equal(batchFailure.semanticScore, 0);

  const requested = classifyAdaptiveCompression({ results: [commandFailure], semantic: true });
  assert.equal(requested.useLuna, true);
  assert.equal(requested.semanticScore, 3);

  const diagnostic = observed({
    text: 'FAIL|calls=1|exit=1|more=1|raw=4096',
    raw: Array.from({ length: 80 }, (_, index) => `AssertionError: expected ${index} in src/module-${index % 4}/case-${index}.mjs`).join('\n'),
    operation: 'test',
    args: ['tests/diagnostic.test.mjs'],
  });
  const diagnosticDecision = classifyAdaptiveCompression({ results: [diagnostic] });
  assert.equal(diagnosticDecision.useLuna, true);
  assert.equal(diagnosticDecision.semanticScore, 3);
});

test('large multi-failure evidence deterministically selects xhigh', () => {
  const first = observed({ raw: `src/a/one.mjs:1\n${'x'.repeat(20_000)}` });
  const second = observed({ raw: `src/b/two.mjs:2\n${'y'.repeat(20_000)}` });
  const decision = classifyAdaptiveCompression({ results: [first, second] });
  assert.equal(decision.useLuna, true);
  assert.equal(decision.complexFailure, true);
  assert.equal(decision.crossModule, true);
  assert.equal(decision.effort, 'xhigh');
});

test('one repeated diagnostic pattern across modules stays on high', () => {
  const failure = observed({
    raw: Array.from({ length: 80 }, (_, index) => `ERROR fixture-${index}: assertion mismatch in src/module-${index % 8}/case-${index}.mjs`).join('\n'),
  });
  const decision = classifyAdaptiveCompression({ results: [failure] });
  assert.equal(decision.useLuna, true);
  assert.equal(decision.crossModule, true);
  assert.equal(decision.complexFailure, false);
  assert.equal(decision.effort, 'high');
});

test('status-only changes stay deterministic while real patches route to Luna', () => {
  const change = observed({
    text: 'OK|calls=1|changes=2|more=1|raw=4096',
    raw: ' M src/a/one.mjs\n M src/b/two.mjs\n'.repeat(100),
    operation: 'git',
    args: ['status', '--short'],
  });
  const statusDecision = classifyAdaptiveCompression({ results: [change] });
  assert.equal(statusDecision.useLuna, false);
  assert.equal(statusDecision.crossModule, true);
  assert.equal(statusDecision.materialFailure, false);

  const patch = observed({
    text: 'OK|calls=1|files=2|hunks=3|add=12|del=4|more=1|raw=4096',
    raw: 'diff --git a/src/a/one.mjs b/src/a/one.mjs\n@@ change a\n+new a\ndiff --git a/src/b/two.mjs b/src/b/two.mjs\n@@ change b\n-old b\n'.repeat(40),
    operation: 'git',
    args: ['diff'],
  });
  const patchDecision = classifyAdaptiveCompression({ results: [patch] });
  assert.equal(patchDecision.useLuna, true);
  assert.equal(patchDecision.reason, 'patch');
  assert.equal(patchDecision.effort, 'high');
});

test('evidence is bounded, workspace-normalized, and secret-redacted before Luna', () => {
  const cwd = process.platform === 'win32' ? String.raw`D:\work\private` : '/work/private';
  const sanitized = sanitizeAdaptiveEvidence(`${cwd}/src/a.mjs\nTOKEN=secret-value\nBearer abc.def`, cwd);
  assert.doesNotMatch(sanitized, /private|secret-value|abc\.def/u);
  assert.match(sanitized, /\[REDACTED\]/u);
  const bounded = boundedAdaptiveEvidence('测'.repeat(100_000), cwd);
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= ADAPTIVE_EVIDENCE_LIMIT_BYTES);
  assert.match(bounded, /deterministically clipped/u);
});

test('repeated evidence is collapsed before building Luna context', () => {
  const repeated = `${'same failure detail\n'.repeat(200)}final assertion`;
  const bounded = boundedAdaptiveEvidence(repeated);
  assert.match(bounded, /^same failure detail\n\.\.\.\[same line repeated 199 more times\]\.\.\./u);
  assert.match(bounded, /final assertion$/u);
  assert.ok(Buffer.byteLength(bounded, 'utf8') < 128);
});

test('opaque ticket keeps raw evidence out of the owner route and Luna reads it separately', () => withTicketRoot((root) => {
  const result = observed({ raw: `TOKEN=secret-value\n${'failure detail\n'.repeat(300)}` });
  const routed = attachAdaptiveRoute({ result, cwd: process.cwd(), root, now: 1000 });
  assert.equal(routed.adaptive.routed, true);
  assert.match(routed.text, /^MORE\|/u);
  assert.match(routed.text, /\|route=luna\|effort=high\|ticket=[A-Za-z0-9_-]{16}$/u);
  assert.doesNotMatch(routed.text, /failure detail|secret-value/u);
  assert.ok(Buffer.byteLength(routed.text, 'utf8') <= 248);
  const ticket = readAdaptiveTicket(routed.adaptive.ticket.handle, { root, now: 1001 });
  assert.equal(ticket.canonical, result.text);
  assert.doesNotMatch(ticket.evidence, /secret-value/u);
  const context = contextForAdaptiveTicket(ticket.handle, { root, now: 1002 });
  assert.match(context.prompt, /CANONICAL=FAIL\|calls=1/u);
  assert.match(context.prompt, /failure detail/u);
}));

test('deterministic acceptance preserves facts, bounds output, and measures content bytes', () => withTicketRoot((root) => {
  const decision = classifyAdaptiveCompression({ results: [observed()] });
  const ticket = createAdaptiveTicket({ canonical: observed().text, decision, root, now: 2000 });
  const response = '{"note":"test harness cannot locate the requested fixture"}';
  const accepted = acceptAdaptiveLunaResponse({ ticket: ticket.handle, response, root, now: 2001 });
  assert.equal(accepted.accepted, true);
  assert.match(accepted.text, /^FAIL\|calls=1\|exit=1\|lines=120\|more=1\|raw=4096\|note=/u);
  assert.match(accepted.text, /\|model=luna$/u);
  assert.ok(Buffer.byteLength(accepted.text, 'utf8') <= 256);
  assert.equal(accepted.metrics.responseBytes, Buffer.byteLength(response, 'utf8'));
  assert.equal(accepted.metrics.finalBytes, Buffer.byteLength(accepted.text, 'utf8'));
  assert.throws(() => readAdaptiveTicket(ticket.handle, { root, now: 2002 }), /ENOENT/u);

  const rejectedTicket = createAdaptiveTicket({ canonical: observed().text, decision, root, now: 2002 });
  const rejected = acceptAdaptiveLunaResponse({ ticket: rejectedTicket.handle, response: '{}', root, now: 2003 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'invalid-shape');
  assert.equal(rejected.text, `${rejectedTicket.canonical}|model=0`);
  assert.throws(() => readAdaptiveTicket(rejectedTicket.handle, { root, now: 2004 }), /ENOENT/u);

  const transportTicket = createAdaptiveTicket({ canonical: observed().text, decision, root, now: 2004 });
  const transport = acceptAdaptiveLunaResponse({
    ticket: transportTicket.handle,
    response: '{"note":"luna_context unavailable in this environment"}',
    root,
    now: 2005,
  });
  assert.equal(transport.accepted, false);
  assert.equal(transport.reason, 'transport-note');
  assert.equal(transport.text, `${transportTicket.canonical}|model=0`);
  assert.throws(() => readAdaptiveTicket(transportTicket.handle, { root, now: 2006 }), /ENOENT/u);
}));

test('an accepted semantic note replaces a long rule sample instead of being clipped away', () => withTicketRoot((root) => {
  const result = observed({
    text: `FAIL|calls=4|ok=3|opfail=1|pass=68|testfail=1|more=1|sample=${'diagnostic '.repeat(10).trim()}|raw=8902|ms=1999`,
    raw: 'failure detail\n'.repeat(700),
  });
  const decision = classifyAdaptiveCompression({ results: [result] });
  const ticket = createAdaptiveTicket({ canonical: result.text, decision, root, now: 2500 });
  const accepted = acceptAdaptiveLunaResponse({
    ticket: ticket.handle,
    response: '{"note":"files listing omits the expected fixture from bounded evidence"}',
    root,
    now: 2501,
  });
  assert.equal(accepted.accepted, true);
  assert.doesNotMatch(accepted.text, /\|sample=/u);
  assert.match(accepted.text, /note=files listing omits the expected fixture from bounded evidence/u);
  assert.ok(Buffer.byteLength(accepted.text, 'utf8') <= 256);
}));

test('expired tickets fail closed and session prompts carry only the opaque handle', () => withTicketRoot((root) => {
  const decision = classifyAdaptiveCompression({ results: [observed()] });
  const ticket = createAdaptiveTicket({ canonical: observed().text, decision, root, now: 3000 });
  assert.throws(() => readAdaptiveTicket(ticket.handle, { root, now: ticket.expiresAt }), /expired/u);
  const prompt = desktopLunaTicketPrompt({ ticket: ticket.handle, readerPath: 'D:/code/HelioTerm/scripts/luna-ticket-reader.mjs' });
  assert.match(prompt, new RegExp(ticket.handle, 'u'));
  assert.match(prompt, /luna_context exactly once/u);
  assert.match(prompt, /already the temporary HelioTerm Luna leaf/u);
  assert.match(prompt, /never create, fork, list, read, send to, wait for, or archive any Codex task/u);
  assert.match(prompt, /If evidence access fails, return \{"note":""\}/u);
  assert.match(prompt, /integrated-terminal call/u);
  assert.match(prompt, /not Codex CLI/u);
  assert.doesNotMatch(prompt, /failure detail/u);
}));
