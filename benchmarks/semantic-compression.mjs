#!/usr/bin/env node

import { evidenceSample } from '../scripts/kernel.mjs';

const cwd = process.cwd();
const separator = process.platform === 'win32' ? '\\' : '/';
const path = (name) => `${cwd}${separator}${name}`;
const raw = [
  `ERROR: ${path('a.js')}:10 mismatch`,
  `ERROR: ${path('a.js')}:10 mismatch`,
  `ERROR: ${path('a.js')}:10 mismatch`,
  `ERROR: ${path('b.js')}:20 invalid value`,
  'AssertionError: expected true',
].join('\n');

function clipUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function legacySample(text, maxBytes) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return clipUtf8(lines.slice(0, 3).join(';'), maxBytes);
}

const maxBytes = 104;
const legacy = legacySample(raw, maxBytes);
const current = evidenceSample(raw, maxBytes, true, cwd);
const normalizedMarker = process.platform === 'win32' ? String.raw`.\a.js` : './a.js';
const diagnosticKinds = (sample) => ['a.js', 'b.js', 'AssertionError'].filter((kind) => sample.includes(kind)).length;
const report = {
  schemaVersion: 'HELIOTERM_SEMANTIC_COMPRESSION_V1',
  pass: current.includes(normalizedMarker)
    && current.split('a.js').length - 1 === 1
    && current.includes('b.js')
    && !current.includes(cwd),
  methods: ['default-field elision', 'duplicate diagnostic removal', 'workspace path normalization'],
  diagnosticCorpus: {
    rawBytes: Buffer.byteLength(raw, 'utf8'),
    sampleBudgetBytes: maxBytes,
    legacySampleBytes: Buffer.byteLength(legacy, 'utf8'),
    currentSampleBytes: Buffer.byteLength(current, 'utf8'),
    legacySample: legacy,
    currentSample: current,
    distinctUsefulDiagnosticsBefore: diagnosticKinds(legacy),
    distinctUsefulDiagnosticsAfter: diagnosticKinds(current),
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
