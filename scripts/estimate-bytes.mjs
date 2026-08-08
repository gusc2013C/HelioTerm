#!/usr/bin/env node

function byteCount(value, name) {
  if (!/^\d+$/u.test(value ?? '')) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

try {
  const rawBytes = byteCount(process.argv[2], 'raw bytes');
  const compactBytes = byteCount(process.argv[3], 'compact bytes');
  if (compactBytes > rawBytes) throw new Error('compact bytes cannot exceed raw bytes');
  const rawEst = Math.ceil(rawBytes / 4);
  const outEst = Math.ceil(compactBytes / 4);
  const result = {
    rawEst,
    outEst,
    savedEst: rawEst - outEst,
    pct: Number(((1 - (compactBytes / Math.max(1, rawBytes))) * 100).toFixed(2)),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
