#!/usr/bin/env node

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  migration: Object.freeze({
    autoMigrate: false,
    archiveOldSession: false,
    samplesPerUserThreshold: 40,
    contextTokensThreshold: 120000,
  }),
  compression: Object.freeze({
    backend: 'native',
    minimumBytes: 8192,
    headroomCommand: 'headroom',
    headroomArgs: Object.freeze(['mcp', 'serve']),
    headroomTimeoutMilliseconds: 5000,
    storeTtlSeconds: 3600,
  }),
});
const SETTING_TYPES = Object.freeze({
  'migration.autoMigrate': 'boolean',
  'migration.archiveOldSession': 'boolean',
  'migration.samplesPerUserThreshold': 'positive-integer',
  'migration.contextTokensThreshold': 'positive-integer',
  'compression.backend': Object.freeze({ type: 'enum', values: Object.freeze(['native', 'auto', 'headroom', 'off']) }),
  'compression.minimumBytes': 'positive-integer',
  'compression.headroomCommand': 'non-empty-string',
  'compression.headroomArgs': 'string-array',
  'compression.headroomTimeoutMilliseconds': Object.freeze({ type: 'integer-range', minimum: 100, maximum: 120000 }),
  'compression.storeTtlSeconds': Object.freeze({ type: 'integer-range', minimum: 60, maximum: 86400 }),
});

export function settingsPath(environment = process.env) {
  return resolve(environment.HELIOTERM_SETTINGS_PATH ?? join(homedir(), '.codex', 'helioterm', 'settings.json'));
}
function validateValue(key, value) {
  const descriptor = SETTING_TYPES[key];
  if (!descriptor) throw new Error(`unknown setting: ${key}`);
  const type = typeof descriptor === 'string' ? descriptor : descriptor.type;
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
  if (type === 'positive-integer' && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`${key} must be a positive integer`);
  if (type === 'non-empty-string' && (typeof value !== 'string' || !value.trim())) throw new Error(`${key} must be a non-empty string`);
  if (type === 'string-array' && (!Array.isArray(value) || value.length > 32 || value.some((entry) => typeof entry !== 'string' || entry.length > 8192))) {
    throw new Error(`${key} must be a JSON array of strings`);
  }
  if (type === 'enum' && !descriptor.values.includes(value)) throw new Error(`${key} must be one of ${descriptor.values.join(', ')}`);
  if (type === 'integer-range' && (!Number.isSafeInteger(value) || value < descriptor.minimum || value > descriptor.maximum)) {
    throw new Error(`${key} must be an integer from ${descriptor.minimum} through ${descriptor.maximum}`);
  }
  return value;
}
export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) throw new Error('invalid HelioTerm settings');
  const migration = value.migration;
  if (!migration || typeof migration !== 'object' || Array.isArray(migration)) throw new Error('invalid migration settings');
  const compression = value.compression ?? DEFAULT_SETTINGS.compression;
  if (!compression || typeof compression !== 'object' || Array.isArray(compression)) throw new Error('invalid compression settings');
  const result = { version: 1, migration: {}, compression: {} };
  for (const key of Object.keys(SETTING_TYPES)) {
    const [section, name] = key.split('.');
    const candidate = value[section]?.[name] ?? DEFAULT_SETTINGS[section][name];
    result[section][name] = validateValue(key, candidate);
  }
  return Object.freeze({ version: 1, migration: Object.freeze(result.migration), compression: Object.freeze({ ...result.compression, headroomArgs: Object.freeze([...result.compression.headroomArgs]) }) });
}
export function loadSettings({ path = settingsPath() } = {}) {
  try { return validateSettings(JSON.parse(readFileSync(path, 'utf8'))); } catch (error) {
    if (error?.code === 'ENOENT') return DEFAULT_SETTINGS;
    throw error;
  }
}
function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { renameSync(temporary, path); } catch (error) {
    try { unlinkSync(path); } catch { /* first write */ }
    try { renameSync(temporary, path); } catch { try { unlinkSync(temporary); } catch { /* best effort */ } throw error; }
  }
}
function parsedCliValue(key, value) {
  const descriptor = SETTING_TYPES[key];
  if (!descriptor) throw new Error(`unknown setting: ${key}`);
  const type = typeof descriptor === 'string' ? descriptor : descriptor.type;
  if (type === 'boolean') {
    if (!['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`);
    return value === 'true';
  }
  if (type === 'string-array') {
    try { return JSON.parse(value); } catch { throw new Error(`${key} must be a JSON array of strings`); }
  }
  if (type === 'non-empty-string' || type === 'enum') return value;
  if (!/^\d+$/u.test(value)) throw new Error(`${key} must be an integer`);
  return Number(value);
}
export function updateSetting(key, rawValue, { path = settingsPath() } = {}) {
  const current = loadSettings({ path });
  const [section, name] = key.split('.');
  const value = validateValue(key, parsedCliValue(key, rawValue));
  const next = validateSettings({ ...current, [section]: { ...current[section], [name]: value } });
  atomicWrite(path, next);
  return next;
}
export async function runSettingsCli(argv = process.argv.slice(2)) {
  const [verb = 'show', key, value] = argv;
  if (verb === 'show' && key === undefined) {
    process.stdout.write(`${JSON.stringify({ path: settingsPath(), settings: loadSettings() })}\n`);
    return;
  }
  if (verb === 'set' && key && value !== undefined && argv.length === 3) {
    process.stdout.write(`${JSON.stringify({ path: settingsPath(), settings: updateSetting(key, value) })}\n`);
    return;
  }
  throw new Error('Usage: ht config show | ht config set <setting> <value>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { await runSettingsCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
