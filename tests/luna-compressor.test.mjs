import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeLunaCompression,
  desktopLunaPrompt,
  parseDesktopLunaResponse,
} from '../scripts/luna-compressor.mjs';

test('code owns canonical facts and accepts a semantic-only Luna note', () => {
  const result = composeLunaCompression({
    canonical: 'OK|pass=34|fail=0|changes=30',
    note: 'GUI and project-map files are untracked',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.text, 'OK|pass=34|fail=0|changes=30|note=GUI and project-map files are untracked');
});

test('generic, missing, and recounted Luna notes fail closed to canonical facts', () => {
  for (const [note, reason] of [
    ['', 'missing-note'],
    ['working tree has many changes', 'generic-note'],
    ['GUI has 30 changed files', 'recounted-fact'],
    ['scripts, docs, and', 'incomplete-note'],
  ]) {
    const result = composeLunaCompression({ canonical: 'OK|changes=30', note });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, reason);
    assert.equal(result.text, 'OK|changes=30');
  }
});

test('a clean canonical result rejects an unexpected model note', () => {
  const result = composeLunaCompression({ canonical: 'OK|changes=0', note: 'source files changed', material: false });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'unexpected-note');
  assert.equal(result.text, 'OK|changes=0');
});

test('Luna notes are single-line, pipe-safe, and byte bounded', () => {
  const result = composeLunaCompression({ canonical: 'FAIL|exit=1', note: `failure|area\n${'测'.repeat(200)}` });
  assert.equal(result.accepted, true);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= 256);
  assert.doesNotMatch(result.note, /[\r\n|]/u);
  assert.doesNotMatch(result.note, /[,:;/—-]$/u);
});

test('Desktop prompt forbids tools and model-owned counting', () => {
  const prompt = desktopLunaPrompt({ canonical: 'OK|changes=3', evidence: ' M scripts/a.mjs' });
  assert.match(prompt, /inside Codex Desktop/u);
  assert.match(prompt, /Do not use tools/u);
  assert.match(prompt, /Do not repeat status, counts, numbers/u);
  assert.match(prompt, /CANONICAL=OK\|changes=3/u);
});

test('Desktop response parsing is strict and fail-closed', () => {
  assert.equal(parseDesktopLunaResponse({
    canonical: 'OK|changes=3',
    response: '{"note":"MCP and runtime scripts changed"}',
  }).accepted, true);
  for (const response of ['not json', '{}', '{"note":"good","extra":true}', '["note"]']) {
    const result = parseDesktopLunaResponse({ canonical: 'OK|changes=3', response });
    assert.equal(result.accepted, false);
    assert.equal(result.text, 'OK|changes=3');
  }
});
