#!/usr/bin/env node

const lines = Number(process.argv[2] ?? 80);
if (!Number.isInteger(lines) || lines < 1 || lines > 500) throw new Error('lines must be 1..500');
for (let index = 0; index < lines; index += 1) {
  process.stderr.write(`ERROR fixture-${index}: assertion mismatch in src/module-${index % 8}/case-${index}.mjs\n`);
}
process.exitCode = 7;
