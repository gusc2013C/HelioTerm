#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bindingPath = resolve(root, 'model-binding.json');
const rolePaths = [resolve(root, 'agents', 'helioterm.toml'), resolve(root, 'agents', 'helioterm-mcp.toml')];
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : process.argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1); };
const model = option('--model');
const effort = option('--effort');
if (model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(model)) throw new Error('--model requires a valid Codex model id');
if (effort !== undefined && !efforts.has(effort)) throw new Error(`--effort requires one of ${[...efforts].join(', ')}`);
const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
if (model !== undefined) binding.model = model;
if (effort !== undefined) binding.effort = effort;
const changed = model !== undefined || effort !== undefined;
if (changed && !process.argv.includes('--write')) throw new Error('Model changes require --write');
if (process.argv.includes('--write')) {
  for (const rolePath of rolePaths) {
    const role = readFileSync(rolePath, 'utf8')
      .replace(/^model = ".*"$/mu, `model = "${binding.model}"`)
      .replace(/^model_reasoning_effort = ".*"$/mu, `model_reasoning_effort = "${binding.effort}"`);
    writeFileSync(rolePath, role, 'utf8');
  }
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify({ written: process.argv.includes('--write'), binding }, null, 2)}\n`);
