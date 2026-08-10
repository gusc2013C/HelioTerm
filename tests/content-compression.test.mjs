import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ContentCompressionService,
  nativeCompressContent,
  pruneCompressedContent,
  selectImportantLineIndexes,
} from '../scripts/content-compression.mjs';
import { HeadroomMcpClient } from '../scripts/headroom-mcp-client.mjs';

function settings(overrides = {}) {
  return {
    backend: 'native',
    minimumBytes: 64,
    headroomCommand: process.execPath,
    headroomArgs: ['tests/fixtures/fake-headroom-mcp.mjs'],
    headroomTimeoutMilliseconds: 3000,
    storeTtlSeconds: 3600,
    ...overrides,
  };
}

test('Headroom-inspired line selection retains failures, numeric outliers, change points, and boundaries', () => {
  const lines = [
    'INFO value=10', 'INFO value=11', 'INFO value=9', 'INFO value=10', 'WARN value=10',
    'ERROR request failed value=11', 'INFO value=10', 'INFO value=5000', 'INFO value=10', 'INFO value=9',
  ];
  const selected = selectImportantLineIndexes(lines, { limit: 8 });
  assert.ok(selected.includes(0));
  assert.ok(selected.includes(4));
  assert.ok(selected.includes(5));
  assert.ok(selected.includes(7));
  assert.ok(selected.includes(9));
});

test('native content router compresses JSON arrays while preserving errors, outliers, and endpoints', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({ index, status: 'ok', value: index === 50 ? 99999 : 10, padding: 'x'.repeat(80) }));
  items[31] = { ...items[31], status: 'failed', error: 'boom' };
  const raw = JSON.stringify(items, null, 2);
  const result = nativeCompressContent(raw, { minimumBytes: 64, maxBytes: 4096 });
  assert.equal(result.compressed, true);
  assert.equal(result.format, 'json-array');
  assert.match(result.content, /"index":0/u);
  assert.match(result.content, /"index":31/u);
  assert.match(result.content, /"index":50/u);
  assert.match(result.content, /"index":79/u);
  assert.ok(Buffer.byteLength(result.content) < Buffer.byteLength(raw));
});

test('native router protects source and diff content from semantic rewriting', () => {
  const source = Array.from({ length: 20 }, (_, index) => `export function value${index}() { return ${index}; }`).join('\n');
  const result = nativeCompressContent(source, { minimumBytes: 64, maxBytes: 4096 });
  assert.equal(result.compressed, false);
  assert.equal(result.format, 'code');
  assert.deepEqual(result.transforms, ['protected-pass-through']);
});

test('native router does not classify prose as logs from one incidental severity word', () => {
  const prose = Array.from({ length: 80 }, (_, index) => index === 20
    ? 'This documentation explains how an error is reported to callers.'
    : `Documentation paragraph ${index} describes deterministic behavior in ordinary language.`).join('\n');
  const result = nativeCompressContent(prose, { minimumBytes: 64, maxBytes: 2048 });
  assert.equal(result.format, 'text');
});

test('native CCR-style store retrieves retained evidence by opaque handle without command payload fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-compression-test-'));
  const environment = { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: root };
  const service = new ContentCompressionService({ settings: settings(), environment });
  const raw = Array.from({ length: 120 }, (_, index) => `${index === 73 ? 'ERROR needle' : 'INFO value'} ${index} ${'x'.repeat(40)}`).join('\n');
  try {
    const compressed = await service.compress(raw, { maxBytes: 2048 });
    assert.equal(compressed.backend, 'native');
    assert.match(compressed.handle, /^[A-Za-z0-9_-]{16}$/u);
    const record = JSON.parse(readFileSync(join(root, readdirSync(root)[0]), 'utf8'));
    assert.equal(record.kind, 'native');
    assert.equal(Object.hasOwn(record, 'command'), false);
    assert.equal(Object.hasOwn(record, 'env'), false);
    assert.equal(Object.hasOwn(record, 'stdin'), false);
    const retrieved = await service.retrieve(compressed.handle, { query: 'needle', maxBytes: 1024 });
    assert.match(retrieved.content, /ERROR needle 73/u);
    assert.equal(pruneCompressedContent({ environment, now: Date.now() + 3_700_000 }), 1);
    assert.equal(readdirSync(root).length, 0);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Headroom MCP stdio adapter handshakes, compresses, retrieves, and reads optional stats', async () => {
  const client = new HeadroomMcpClient({
    command: process.execPath,
    args: ['tests/fixtures/fake-headroom-mcp.mjs'],
    timeoutMilliseconds: 3000,
  });
  try {
    const compressed = await client.compress('alpha\nneedle line\nomega');
    assert.match(compressed.content, /^HEADROOM:/u);
    assert.match(compressed.hash, /^[a-f0-9]{64}$/u);
    assert.equal(await client.retrieve(compressed.hash, 'needle'), 'needle line');
    assert.equal((await client.stats()).compressions, 1);
  } finally { client.close(); }
});

test('auto backend complements native terminal routing with Headroom and fails open to native', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-headroom-auto-'));
  const environment = { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: root };
  const raw = JSON.stringify({
    service: 'helioterm',
    policy: { retention: { days: 7, marker: 'needle' } },
    regions: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`region-${index}`, { healthy: true, detail: 'z'.repeat(80) }])),
  }, null, 2);
  const calls = [];
  const headroom = {
    async compress(content) { calls.push(content); return { content: 'remote compact', hash: 'remote-hash', transforms: ['remote'] }; },
    async retrieve(hash, query) { return `${hash}:${query}`; },
    close() {},
  };
  const service = new ContentCompressionService({ settings: settings({ backend: 'auto' }), environment, headroomClient: headroom });
  try {
    const closedWorld = await service.compress(raw, { maxBytes: 2048, allowHeadroom: false });
    assert.equal(closedWorld.backend, 'native');
    assert.equal(calls.length, 0);
    const compressed = await service.compress(raw, { maxBytes: 2048 });
    assert.equal(compressed.backend, 'headroom');
    assert.equal(calls.length, 1);
    const record = readdirSync(root)
      .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')))
      .find((entry) => entry.kind === 'headroom');
    assert.ok(record);
    assert.equal(record.kind, 'headroom');
    assert.equal(Object.hasOwn(record, 'content'), false);
    assert.equal((await service.retrieve(compressed.handle, { query: 'needle' })).content, 'remote-hash:needle');
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }

  const fallback = new ContentCompressionService({
    settings: settings({ backend: 'headroom' }),
    environment,
    headroomClient: { async compress() { throw new Error('offline'); }, close() {} },
  });
  try {
    const compressed = await fallback.compress(raw, { maxBytes: 2048 });
    assert.equal(compressed.backend, 'native');
    assert.equal(compressed.fallback, true);
  } finally {
    fallback.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('auto backend avoids Headroom latency for non-nested content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-headroom-native-route-'));
  const calls = [];
  const service = new ContentCompressionService({
    settings: settings({ backend: 'auto' }),
    environment: { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: root },
    headroomClient: { async compress(content) { calls.push(content); return { content: 'remote compact', hash: 'hash', transforms: [] }; }, close() {} },
  });
  const prose = Array.from({ length: 100 }, (_, index) => `generic prose row ${index} ${'z'.repeat(80)}`).join('\n');
  const flatJson = JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key-${index}`, 'z'.repeat(80)])), null, 2);
  try {
    assert.equal((await service.compress(prose, { maxBytes: 2048 })).backend, 'native');
    assert.equal((await service.compress(flatJson, { maxBytes: 2048 })).backend, 'native');
    assert.equal(calls.length, 0);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('auto backend keeps code and diffs exact without invoking Headroom', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-headroom-protected-'));
  const calls = [];
  const service = new ContentCompressionService({
    settings: settings({ backend: 'auto' }),
    environment: { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: root },
    headroomClient: { async compress(content) { calls.push(content); return { content: 'unsafe rewrite', hash: 'hash', transforms: [] }; }, close() {} },
  });
  const code = Array.from({ length: 80 }, (_, index) => `export function value${index}() { return ${index}; }`).join('\n');
  const diff = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1 +1 @@', '-const value = 1;', '+const value = 2;', ...Array.from({ length: 30 }, (_, index) => ` context ${index}`)].join('\n');
  try {
    const codeResult = await service.compress(code, { maxBytes: 32768 });
    const diffResult = await service.compress(diff, { maxBytes: 32768 });
    assert.equal(codeResult.format, 'code');
    assert.equal(diffResult.format, 'diff');
    assert.equal(codeResult.compressed, false);
    assert.equal(diffResult.compressed, false);
    assert.equal(calls.length, 0);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('compression fails open when reversible storage is unavailable or Headroom omits its retrieval hash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helioterm-compression-fail-open-'));
  const blockedRoot = join(root, 'not-a-directory');
  writeFileSync(blockedRoot, 'blocked');
  const raw = Array.from({ length: 100 }, (_, index) => `INFO row ${index} ${'q'.repeat(40)}`).join('\n');
  const blocked = new ContentCompressionService({
    settings: settings(),
    environment: { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: blockedRoot },
  });
  try {
    const result = await blocked.compress(raw, { maxBytes: 2048 });
    assert.equal(result.backend, 'native-fallback');
    assert.equal(result.compressed, false);
    assert.equal(result.retrievable, false);
  } finally { blocked.close(); }

  const service = new ContentCompressionService({
    settings: settings({ backend: 'headroom' }),
    environment: { ...process.env, HELIOTERM_CONTENT_STORE_ROOT: join(root, 'store') },
    headroomClient: { async compress() { return { content: 'short without hash', hash: null, transforms: [] }; }, close() {} },
  });
  try {
    const result = await service.compress(raw, { maxBytes: 2048 });
    assert.equal(result.backend, 'native');
    assert.equal(result.fallback, true);
    assert.equal(result.retrievable, true);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
