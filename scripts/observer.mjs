#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const root = realpathSync(resolve(process.cwd()));
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function repoPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || isAbsolute(value)) throw new Error('path must be repository-relative');
  const target = realpathSync(resolve(root, value));
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('path must stay inside the working directory');
  return target;
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error('line values must be positive integers');
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new Error(`line value must be 1..${maximum}`);
  return parsed;
}

function readText(args) {
  if (args.length < 1 || args.length > 3) throw new Error('read requires path [start-line] [line-count]');
  const file = repoPath(args[0]);
  const stats = statSync(file);
  if (!stats.isFile()) throw new Error('read target must be a file');
  if (stats.size > MAX_FILE_BYTES) throw new Error('read target exceeds 2 MiB');
  const start = positiveInteger(args[1], 1, 1_000_000);
  const count = positiveInteger(args[2], 80, 200);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  const selected = lines.slice(start - 1, start - 1 + count);
  process.stdout.write(selected.map((line, index) => `${start + index}:${line}`).join('\n'));
  if (selected.length) process.stdout.write('\n');
}

function listDirectory(args) {
  if (args.length !== 1) throw new Error('list requires one directory');
  const directory = repoPath(args[0]);
  if (!statSync(directory).isDirectory()) throw new Error('list target must be a directory');
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other';
    const bytes = entry.isFile() ? statSync(resolve(directory, entry.name)).size : 0;
    process.stdout.write(`${kind}\t${bytes}\t${entry.name}\n`);
  }
}

function valueAt(rootValue, selector) {
  return selector.split('.').filter(Boolean).reduce((value, key) => value?.[key], rootValue);
}

function summarizeValue(key, value) {
  if (Array.isArray(value)) return `${key}=[${value.length}]`;
  if (value && typeof value === 'object') return `${key}={${Object.keys(value).length}}`;
  return `${key}=${JSON.stringify(value)}`;
}

function inspectJson(args) {
  if (args.length < 1 || args.length > 9) throw new Error('json requires path [selector ...]');
  const file = repoPath(args[0]);
  const stats = statSync(file);
  if (!stats.isFile()) throw new Error('json target must be a file');
  if (stats.size > MAX_FILE_BYTES) throw new Error('json target exceeds 2 MiB');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const selectors = args.slice(1);
  if (selectors.length) {
    for (const selector of selectors) process.stdout.write(`${summarizeValue(selector, valueAt(parsed, selector))}\n`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stdout.write(`${summarizeValue('$', parsed)}\n`);
    return;
  }
  for (const key of Object.keys(parsed).sort()) process.stdout.write(`${summarizeValue(key, parsed[key])}\n`);
}

function inspectStat(args) {
  if (args.length < 1 || args.length > 16) throw new Error('stat requires 1..16 paths');
  for (const value of args) {
    const target = repoPath(value);
    const stats = statSync(target);
    const kind = stats.isDirectory() ? 'dir' : stats.isFile() ? 'file' : 'other';
    process.stdout.write(`${kind}\t${stats.size}\t${stats.mtime.toISOString()}\t${value}\n`);
  }
}

const handlers = new Map([
  ['read', readText],
  ['list', listDirectory],
  ['json', inspectJson],
  ['stat', inspectStat],
]);

try {
  const [operation, ...args] = process.argv.slice(2);
  const handler = handlers.get(operation);
  if (!handler) throw new Error('unsupported observer operation');
  handler(args);
} catch (error) {
  fail(error.message);
}
