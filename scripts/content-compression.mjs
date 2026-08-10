import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HeadroomMcpClient } from './headroom-mcp-client.mjs';

// Independently implemented from the public Headroom architecture documentation.
// Attribution: Headroom Contributors, ContentRouter/CCR/live-zone concepts, Apache-2.0.
// https://github.com/headroomlabs-ai/headroom
export const HEADROOM_INSPIRATION = 'Headroom Contributors (ContentRouter, CCR, live-zone compression; Apache-2.0)';
export const CONTENT_HANDLE_PATTERN = '^[A-Za-z0-9_-]{16}$';
const CONTENT_HANDLE_REGEX = new RegExp(CONTENT_HANDLE_PATTERN, 'u');
const STORE_SCHEMA = 'HELIOTERM_COMPRESSED_CONTENT_V1';
const DEFAULT_STORE_ROOT = join(tmpdir(), 'helioterm-compressed-content');

function clipUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of String(value ?? '')) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function importantLine(line) {
  return /(?:^|\b)(?:error|err_|fail(?:ed|ure)?|fatal|exception|assertion|panic|timeout|warning)(?:\b|:)/iu.test(line)
    || /^\s*[✖×]/u.test(line);
}

function numericValue(line) {
  const values = [...line.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match) => Number(match[0])).filter(Number.isFinite);
  return values.length ? values[values.length - 1] : null;
}

function level(line) {
  return /(?:^|[\s[(])((?:trace|debug|info|warn(?:ing)?|error|fatal))(?:[\s\]):]|$)/iu.exec(line)?.[1]?.toLowerCase() ?? null;
}

function looksLikeLog(lines) {
  if (lines.length < 3) return false;
  const candidates = lines.filter((line) => level(line));
  return candidates.length >= 3 && candidates.length / lines.length >= 0.2;
}

function outlierIndexes(lines) {
  const values = lines.map(numericValue);
  const present = values.filter(Number.isFinite);
  if (present.length < 5) return [];
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const variance = present.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / present.length;
  const deviation = Math.sqrt(variance);
  if (!deviation) return [];
  return values.flatMap((value, index) => Number.isFinite(value) && Math.abs(value - mean) > 2 * deviation ? [index] : []);
}

/** Headroom-inspired deterministic importance ordering: failures, outliers, change points, head/tail. */
export function selectImportantLineIndexes(lines, { preferFailure = false, limit = 8 } = {}) {
  if (!Array.isArray(lines) || !lines.length || limit < 1) return [];
  const priority = [];
  const push = (index) => {
    if (index >= 0 && index < lines.length && !priority.includes(index)) priority.push(index);
  };
  lines.forEach((line, index) => { if (importantLine(line)) push(index); });
  for (const index of outlierIndexes(lines)) push(index);
  let previousLevel = level(lines[0]);
  for (let index = 1; index < lines.length; index += 1) {
    const current = level(lines[index]);
    if (current && previousLevel && current !== previousLevel) push(index);
    if (current) previousLevel = current;
  }
  if (!preferFailure || priority.length < limit) {
    push(0);
    push(1);
    push(lines.length - 2);
    push(lines.length - 1);
  }
  const remaining = Math.max(0, limit - priority.length);
  for (let slot = 1; slot <= remaining; slot += 1) push(Math.floor((slot * (lines.length - 1)) / (remaining + 1)));
  return priority.slice(0, limit).sort((left, right) => left - right);
}

function renderSelectedLines(lines, indexes, maxBytes) {
  const output = [];
  let previous = -1;
  for (const index of indexes) {
    if (previous >= 0 && index > previous + 1) output.push(`[… ${index - previous - 1} lines omitted …]`);
    output.push(lines[index]);
    previous = index;
  }
  if (previous >= 0 && previous < lines.length - 1) output.push(`[… ${lines.length - previous - 1} lines omitted …]`);
  return clipUtf8(output.join('\n'), maxBytes);
}

function failureObject(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => {
    const name = key.toLowerCase();
    if (/(?:error|exception|failure|failed|fatal)/u.test(name) && entry) return true;
    return /(?:status|level|severity|result)/u.test(name) && /(?:error|fail|fatal|panic)/iu.test(String(entry));
  });
}

function categoricalSignature(value) {
  if (!value || typeof value !== 'object') return '';
  return ['status', 'level', 'severity', 'type', 'kind']
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => `${key}:${String(value[key])}`)
    .join('|');
}

function numericObjectOutliers(items) {
  const fields = new Map();
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const [key, value] of Object.entries(item)) {
      if (!Number.isFinite(value)) continue;
      if (!fields.has(key)) fields.set(key, []);
      fields.get(key).push({ index, value });
    }
  });
  const indexes = new Set();
  for (const values of fields.values()) {
    if (values.length < 5) continue;
    const mean = values.reduce((sum, entry) => sum + entry.value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, entry) => sum + ((entry.value - mean) ** 2), 0) / values.length);
    if (!deviation) continue;
    for (const entry of values) if (Math.abs(entry.value - mean) > 2 * deviation) indexes.add(entry.index);
  }
  return [...indexes];
}

function selectArrayIndexes(items, limit = 24) {
  const selected = [];
  const push = (index) => {
    if (index >= 0 && index < items.length && !selected.includes(index)) selected.push(index);
  };
  items.forEach((item, index) => { if (failureObject(item)) push(index); });
  for (const index of numericObjectOutliers(items)) push(index);
  let previous = categoricalSignature(items[0]);
  for (let index = 1; index < items.length; index += 1) {
    const current = categoricalSignature(items[index]);
    if (current && previous && current !== previous) push(index);
    if (current) previous = current;
  }
  push(0);
  push(items.length - 1);
  const remaining = Math.max(0, limit - selected.length);
  for (let slot = 1; slot <= remaining; slot += 1) push(Math.floor((slot * (items.length - 1)) / (remaining + 1)));
  return selected.slice(0, limit).sort((left, right) => left - right);
}

function jsonCandidate(parsed, maxBytes) {
  if (!Array.isArray(parsed)) return { content: clipUtf8(JSON.stringify(parsed), maxBytes), format: 'json', transforms: ['json-minify'] };
  if (parsed.length < 5) return { content: clipUtf8(JSON.stringify(parsed), maxBytes), format: 'json-array', transforms: ['json-minify'] };
  let limit = Math.min(24, parsed.length);
  let content = '';
  let indexes = [];
  while (limit >= 2) {
    indexes = selectArrayIndexes(parsed, limit);
    content = JSON.stringify({
      __helioterm: { originalItems: parsed.length, retainedItems: indexes.length, omittedItems: parsed.length - indexes.length },
      items: indexes.map((index) => parsed[index]),
    });
    if (Buffer.byteLength(content, 'utf8') <= maxBytes) break;
    limit = Math.floor(limit / 2);
  }
  return { content: clipUtf8(content, maxBytes), format: 'json-array', transforms: ['json-minify', 'importance-sample'] };
}

function jsonLinesCandidate(lines, maxBytes) {
  const parsed = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)); } catch { return null; }
  }
  if (parsed.length < 5) return null;
  const candidate = jsonCandidate(parsed, maxBytes);
  return { ...candidate, format: 'jsonl', transforms: [...candidate.transforms, 'jsonl-route'] };
}

function protectedContent(text) {
  const lines = text.split(/\r?\n/u).filter(Boolean);
  if (lines.some((line) => /^(?:diff --git |@@ |\+\+\+ |--- )/u.test(line))) return 'diff';
  const codeLines = lines.filter((line) => /(?:^\s*(?:import|export|class|function|def|fn|const|let|var)\b|[{};]\s*$)/u.test(line)).length;
  return lines.length >= 4 && codeLines / lines.length > 0.45 ? 'code' : null;
}

function nestedObjectDepth(value, limit = 4) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || limit < 1) return 0;
  let depth = 1;
  for (const entry of Object.values(value)) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 32)) depth = Math.max(depth, 1 + nestedObjectDepth(item, limit - 1));
    } else {
      depth = Math.max(depth, 1 + nestedObjectDepth(entry, limit - 1));
    }
    if (depth >= limit) break;
  }
  return depth;
}

function autoHeadroomCandidate(raw, native) {
  // The real Headroom 0.34 benchmark only beat the deterministic route for
  // large nested JSON objects. Keep text, logs, arrays, code, and diffs local.
  if (native.format !== 'json') return false;
  try {
    const parsed = JSON.parse(raw);
    return nestedObjectDepth(parsed) >= 3;
  } catch {
    return false;
  }
}

export function nativeCompressContent(content, { maxBytes = 8192, minimumBytes = 1024 } = {}) {
  const original = String(content ?? '').replace(/\u0000/gu, '');
  const rawBytes = Buffer.byteLength(original, 'utf8');
  const protectedFormat = protectedContent(original);
  if (rawBytes < minimumBytes || protectedFormat) {
    return { content: clipUtf8(original, maxBytes), compressed: false, format: protectedFormat ?? 'small', transforms: protectedFormat ? ['protected-pass-through'] : [] };
  }
  let candidate = null;
  try { candidate = jsonCandidate(JSON.parse(original), maxBytes); } catch { /* not a JSON document */ }
  const lines = original.split(/\r?\n/u).filter(Boolean);
  if (!candidate) candidate = jsonLinesCandidate(lines, maxBytes);
  if (!candidate) {
    const indexes = selectImportantLineIndexes(lines, { limit: 24 });
    candidate = {
      content: renderSelectedLines(lines, indexes, maxBytes),
      format: looksLikeLog(lines) ? 'log' : 'text',
      transforms: ['importance-sample', 'head-tail'],
    };
  }
  const outputBytes = Buffer.byteLength(candidate.content, 'utf8');
  if (!candidate.content || outputBytes >= rawBytes) {
    return { content: clipUtf8(original, maxBytes), compressed: false, format: candidate.format, transforms: [] };
  }
  return { ...candidate, compressed: true };
}

function storeRoot(environment = process.env) {
  return resolve(environment.HELIOTERM_CONTENT_STORE_ROOT ?? DEFAULT_STORE_ROOT);
}

function recordPath(handle, environment = process.env) {
  if (!CONTENT_HANDLE_REGEX.test(String(handle ?? ''))) throw new Error('invalid compressed content handle');
  return join(storeRoot(environment), `${handle}.json`);
}

export function pruneCompressedContent({ environment = process.env, now = Date.now() } = {}) {
  const root = storeRoot(environment);
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!/^[A-Za-z0-9_-]{16}\.json$/u.test(name)) continue;
    const path = join(root, name);
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record.schema !== STORE_SCHEMA || record.expiresAt <= now) { rmSync(path, { force: true }); removed += 1; }
    } catch { rmSync(path, { force: true }); removed += 1; }
  }
  return removed;
}

function storeRecord(record, { environment = process.env, now = Date.now(), ttlSeconds = 3600 } = {}) {
  pruneCompressedContent({ environment, now });
  const handle = randomBytes(12).toString('base64url');
  const root = storeRoot(environment);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(recordPath(handle, environment), JSON.stringify({
    schema: STORE_SCHEMA,
    handle,
    createdAt: now,
    expiresAt: now + (ttlSeconds * 1000),
    ...record,
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return handle;
}

function readRecord(handle, { environment = process.env, now = Date.now() } = {}) {
  const path = recordPath(handle, environment);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.schema !== STORE_SCHEMA || record.handle !== handle) throw new Error('invalid compressed content record');
  if (record.expiresAt <= now) { rmSync(path, { force: true }); throw new Error('compressed content handle expired'); }
  return record;
}

function queryContent(content, query, maxBytes) {
  if (!query) return clipUtf8(content, maxBytes);
  const needle = String(query).toLowerCase();
  const matches = String(content).split(/\r?\n/u).filter((line) => line.toLowerCase().includes(needle));
  return clipUtf8(matches.join('\n'), maxBytes);
}

export class ContentCompressionService {
  constructor({ settings, environment = process.env, headroomClient = null } = {}) {
    this.settings = settings;
    this.environment = environment;
    this.headroomClient = headroomClient;
  }

  #client() {
    if (!this.headroomClient) {
      this.headroomClient = new HeadroomMcpClient({
        command: this.settings.headroomCommand,
        args: this.settings.headroomArgs,
        timeoutMilliseconds: this.settings.headroomTimeoutMilliseconds,
        environment: this.environment,
      });
    }
    return this.headroomClient;
  }

  async compress(content, { maxBytes = 8192, allowHeadroom = true } = {}) {
    const raw = String(content ?? '');
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const backend = allowHeadroom || this.settings.backend === 'off' ? this.settings.backend : 'native';
    if (backend === 'off' || rawBytes < this.settings.minimumBytes) {
      const shown = clipUtf8(raw, maxBytes);
      return { backend: backend === 'off' ? 'off' : 'pass', content: shown, rawBytes, compressedBytes: Buffer.byteLength(shown, 'utf8'), compressed: false, retrievable: false, handle: null, format: 'pass', transforms: [] };
    }

    const native = nativeCompressContent(raw, { maxBytes, minimumBytes: this.settings.minimumBytes });
    let headroom = null;
    let headroomError = null;
    let headroomHandle = null;
    const nativeOnly = ['code', 'diff'].includes(native.format);
    if ((backend === 'headroom' && !nativeOnly) || (backend === 'auto' && autoHeadroomCandidate(raw, native))) {
      try {
        const result = await this.#client().compress(raw);
        const clipped = clipUtf8(result.content, maxBytes);
        if (result.hash && clipped && Buffer.byteLength(clipped, 'utf8') < rawBytes) headroom = { ...result, content: clipped };
      } catch (error) { headroomError = error; }
    }

    if (headroom) {
      try {
        headroomHandle = storeRecord({ kind: 'headroom', remoteHash: headroom.hash }, {
          environment: this.environment, ttlSeconds: this.settings.storeTtlSeconds,
        });
      } catch { headroomError = new Error('compressed content store unavailable'); }
      if (!headroomHandle) headroom = null;
    }

    if (headroom) {
      return {
        backend: 'headroom', content: headroom.content, rawBytes,
        compressedBytes: Buffer.byteLength(headroom.content, 'utf8'), compressed: true,
        retrievable: true, handle: headroomHandle, format: 'headroom', transforms: headroom.transforms,
        fallback: false,
      };
    }

    if (native.compressed) {
      let handle;
      try {
        handle = storeRecord({ kind: 'native', content: raw }, {
          environment: this.environment, ttlSeconds: this.settings.storeTtlSeconds,
        });
      } catch {
        const shown = clipUtf8(raw, maxBytes);
        return {
          backend: 'native-fallback', content: shown, rawBytes,
          compressedBytes: Buffer.byteLength(shown, 'utf8'), compressed: false, retrievable: false,
          handle: null, format: native.format, transforms: [], fallback: true,
        };
      }
      return {
        backend: 'native', content: native.content, rawBytes,
        compressedBytes: Buffer.byteLength(native.content, 'utf8'), compressed: true,
        retrievable: true, handle, format: native.format, transforms: native.transforms,
        fallback: backend === 'headroom' || Boolean(headroomError),
      };
    }

    const shown = clipUtf8(raw, maxBytes);
    return {
      backend: backend === 'headroom' && headroomError ? 'native-fallback' : 'pass', content: shown, rawBytes,
      compressedBytes: Buffer.byteLength(shown, 'utf8'), compressed: false, retrievable: false, handle: null,
      format: native.format, transforms: native.transforms, fallback: Boolean(headroomError),
    };
  }

  async retrieve(handle, { query = null, maxBytes = 8192 } = {}) {
    const record = readRecord(handle, { environment: this.environment });
    let content;
    if (record.kind === 'headroom') content = await this.#client().retrieve(record.remoteHash, query);
    else if (record.kind === 'native') content = queryContent(record.content, query, maxBytes);
    else throw new Error('unknown compressed content backend');
    const rawBytes = Buffer.byteLength(content, 'utf8');
    const shown = clipUtf8(content, maxBytes);
    return { content: shown, rawBytes, shownBytes: Buffer.byteLength(shown, 'utf8'), clipped: Buffer.byteLength(shown, 'utf8') < rawBytes, backend: record.kind };
  }

  close() { this.headroomClient?.close?.(); }
}
