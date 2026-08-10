import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desktopLunaPrompt, parseDesktopLunaResponse } from './luna-compressor.mjs';
import { selectLunaEffort, shouldUseLunaCompression } from './luna-profile.mjs';

export const ADAPTIVE_TICKET_SCHEMA = 'HELIOTERM_LUNA_TICKET_V1';
export const ADAPTIVE_TICKET_TTL_MILLISECONDS = 30 * 60 * 1000;
export const ADAPTIVE_EVIDENCE_LIMIT_BYTES = 48 * 1024;
export const ADAPTIVE_TICKET_ROOT = join(tmpdir(), 'helioterm-luna-tickets');

const HANDLE = /^[A-Za-z0-9_-]{16}$/u;
const FILE_LIKE = /(?:^|[\s:(])([A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9_-]{1,12})(?=$|[\s:),])/gmu;

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

function field(text, name) {
  return new RegExp(`(?:^|\\|)${name}=([^|]*)(?:\\||$)`, 'u').exec(String(text ?? ''))?.[1] ?? null;
}

function integerField(text, name) {
  const value = field(text, name);
  return value !== null && /^\d+$/u.test(value) ? Number(value) : null;
}

function normalizedPathVariants(cwd) {
  if (!cwd) return [];
  return [...new Set([cwd, cwd.replace(/\\/gu, '/'), cwd.replace(/\//gu, '\\')])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function sanitizeAdaptiveEvidence(value, cwd = null) {
  let text = String(value ?? '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\u0000/gu, '')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replace(/(\b(?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s"']+/giu, '$1[REDACTED]');
  for (const variant of normalizedPathVariants(cwd)) text = text.replace(new RegExp(escapeRegex(variant), 'giu'), '.');
  return text.replace(/\r\n/gu, '\n').trim();
}

function collapseConsecutiveEvidenceLines(text) {
  const lines = text.split('\n');
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    let next = index + 1;
    while (next < lines.length && lines[next] === line) next += 1;
    const repetitions = next - index;
    output.push(line);
    if (line && repetitions > 1) output.push(`...[same line repeated ${repetitions - 1} more times]...`);
    index = next;
  }
  return output.join('\n');
}

export function boundedAdaptiveEvidence(value, cwd = null, maxBytes = ADAPTIVE_EVIDENCE_LIMIT_BYTES) {
  const text = collapseConsecutiveEvidenceLines(sanitizeAdaptiveEvidence(value, cwd));
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '\n...[deterministically clipped]...\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const headBudget = Math.floor((maxBytes - markerBytes) * 0.65);
  const tailBudget = maxBytes - markerBytes - headBudget;
  const head = clipUtf8(text, headBudget).replace(/[^\n]*$/u, '');
  const reversed = [...text].reverse().join('');
  const tail = [...clipUtf8(reversed, tailBudget)].reverse().join('').replace(/^[^\n]*/u, '');
  return `${head}${marker}${tail}`;
}

function gitResult(result) {
  return result.operation === 'git'
    || (result.operation === 'terminal' && /(?:^|[\\/])git(?:\.exe)?$/iu.test(String(result.command?.file ?? '')));
}

function materialGitChange(result) {
  if (!gitResult(result)) return false;
  const subcommand = result.command?.args?.[0];
  if (!['status', 'diff'].includes(subcommand) || result.command?.args?.includes('--check')) return false;
  return ['changes', 'files', 'hunks', 'add', 'del', 'lines']
    .some((name) => (integerField(result.text, name) ?? 0) > 0);
}

function distinctSourceAreas(evidence) {
  const areas = new Set();
  for (const match of String(evidence ?? '').matchAll(FILE_LIKE)) {
    const path = match[1].replace(/\\/gu, '/');
    areas.add(path.split('/').slice(0, -1).join('/'));
  }
  return areas.size;
}

function evidenceDiversity(evidence) {
  const lines = String(evidence ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('...[same line repeated'));
  return new Set(lines).size;
}

function semanticGitPatch(result) {
  if (!gitResult(result)) return false;
  const [subcommand, ...args] = result.command?.args ?? [];
  if (!['diff', 'show'].includes(subcommand)) return false;
  return !args.some((value) => /^(?:--check|--name-only|--name-status|--numstat|--shortstat|--stat)(?:=|$)/u.test(value));
}

function semanticOperationScore(result, { diverseEvidence, diagnosticEvidence, semantic }) {
  if (!String(result.text ?? '').startsWith('OK|')) return 4;
  if (semanticGitPatch(result)) return 4;
  if (field(result.text, 'more') !== '1') return 0;
  const diagnosticOperation = ['build', 'bench', 'check'].includes(result.operation);
  if (diagnosticOperation && diagnosticEvidence) return 3;
  const requestedSemanticOperation = ['read', 'search', 'terminal'].includes(result.operation)
    || (result.operation === 'git' && ['log', 'show'].includes(result.command?.args?.[0]));
  return semantic && requestedSemanticOperation && (diverseEvidence || diagnosticEvidence) ? 3 : 0;
}

export function classifyAdaptiveCompression({ results, semantic = false } = {}) {
  const entries = Array.isArray(results) ? results.filter(Boolean) : [];
  const rawBytes = entries.reduce((sum, result) => sum + (result.savings?.rawBytes ?? integerField(result.text, 'raw') ?? 0), 0);
  const failures = entries.filter((result) => !String(result.text ?? '').startsWith('OK|'));
  const materialFailure = failures.length > 0;
  const materialChange = entries.some(materialGitChange);
  const truncated = entries.some((result) => field(result.text, 'more') === '1');
  const evidence = entries.map((result) => `[${result.operation}]\n${result.adaptiveEvidence ?? ''}`).join('\n');
  const diverseEvidence = evidenceDiversity(evidence) >= 4;
  const diagnosticEvidence = /(?:^|\b)(?:assert(?:ion)?error|error|exception|fail(?:ed|ure)?|panic|traceback|warn(?:ing)?)(?:\b|:)/iu.test(evidence);
  const automaticScore = entries.reduce((maximum, result) => Math.max(maximum, semanticOperationScore(result, { diverseEvidence, diagnosticEvidence, semantic })), 0);
  const semanticScore = semantic && (truncated || materialFailure || materialChange) ? Math.max(3, automaticScore) : automaticScore;
  const semanticSummaryRequired = semanticScore > 0;
  const crossModule = distinctSourceAreas(evidence) > 1;
  const complexFailure = failures.length > 1 || (materialFailure && rawBytes >= 32 * 1024);
  const causalAnalysis = semanticScore === 4 && materialChange && crossModule && rawBytes >= 16 * 1024;
  const useLuna = shouldUseLunaCompression({ rawBytes, materialFailure, materialChange, truncated, semanticSummaryRequired, semanticScore });
  return Object.freeze({
    useLuna,
    rawBytes,
    materialFailure,
    materialChange,
    truncated,
    semanticSummaryRequired,
    semanticScore,
    diverseEvidence,
    diagnosticEvidence,
    complexFailure,
    crossModule,
    effort: selectLunaEffort({ complexFailure, causalAnalysis }),
    reason: materialFailure ? 'failure' : semanticGitPatch(entries.find((entry) => semanticGitPatch(entry)) ?? {}) ? 'patch' : semantic ? 'requested' : semanticScore > 0 ? 'semantic-output' : 'none',
    evidence,
  });
}

function ticketPath(handle, root = ADAPTIVE_TICKET_ROOT) {
  if (!HANDLE.test(handle)) throw new Error('invalid Luna ticket');
  return join(root, `${handle}.json`);
}

export function pruneAdaptiveTickets({ root = ADAPTIVE_TICKET_ROOT, now = Date.now() } = {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!/^[A-Za-z0-9_-]{16}\.json$/u.test(name)) continue;
    const path = join(root, name);
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) { rmSync(path); removed += 1; }
    } catch {
      if (statSync(path).mtimeMs + ADAPTIVE_TICKET_TTL_MILLISECONDS <= now) { rmSync(path); removed += 1; }
    }
  }
  return removed;
}

export function createAdaptiveTicket({ canonical, decision, cwd = null, root = ADAPTIVE_TICKET_ROOT, now = Date.now() }) {
  if (!decision?.useLuna) return null;
  if (typeof canonical !== 'string' || !/^(?:OK|FAIL)\|[^\r\n]+$/u.test(canonical)) throw new Error('canonical must be one compact fact line');
  pruneAdaptiveTickets({ root, now });
  const handle = randomBytes(12).toString('base64url');
  const evidence = boundedAdaptiveEvidence(decision.evidence, cwd);
  const record = {
    schemaVersion: ADAPTIVE_TICKET_SCHEMA,
    handle,
    canonical: canonical.replace(/\|model=0$/u, ''),
    evidence,
    material: decision.materialFailure || decision.materialChange || decision.truncated,
    effort: decision.effort,
    reason: decision.reason,
    rawBytes: decision.rawBytes,
    evidenceBytes: Buffer.byteLength(evidence, 'utf8'),
    createdAt: now,
    expiresAt: now + ADAPTIVE_TICKET_TTL_MILLISECONDS,
  };
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(ticketPath(handle, root), JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return Object.freeze(record);
}

export function readAdaptiveTicket(handle, { root = ADAPTIVE_TICKET_ROOT, now = Date.now() } = {}) {
  const record = JSON.parse(readFileSync(ticketPath(handle, root), 'utf8'));
  if (record.schemaVersion !== ADAPTIVE_TICKET_SCHEMA || record.handle !== handle) throw new Error('invalid Luna ticket record');
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) throw new Error('expired Luna ticket');
  return Object.freeze(record);
}

export function removeAdaptiveTicket(handle, { root = ADAPTIVE_TICKET_ROOT } = {}) {
  rmSync(ticketPath(handle, root), { force: true });
}

export function contextForAdaptiveTicket(handle, options = {}) {
  const record = readAdaptiveTicket(handle, options);
  const prompt = desktopLunaPrompt({ canonical: record.canonical, evidence: record.evidence, material: record.material });
  return Object.freeze({ record, prompt, contextBytes: Buffer.byteLength(prompt, 'utf8') });
}

function boundedSuffix(base, suffix, maxBytes = 256) {
  if (Buffer.byteLength(`${base}${suffix}`, 'utf8') <= maxBytes) return `${base}${suffix}`;
  const withoutSample = base.replace(/\|sample=[^|]*/u, '');
  if (Buffer.byteLength(`${withoutSample}${suffix}`, 'utf8') <= maxBytes) return `${withoutSample}${suffix}`;
  const parts = withoutSample.split('|');
  let result = parts.shift() ?? 'FAIL';
  for (const part of parts) {
    if (Buffer.byteLength(`${result}|${part}${suffix}`, 'utf8') > maxBytes) continue;
    result += `|${part}`;
  }
  return `${result}${suffix}`;
}

function routeEnvelope(canonical, ticket) {
  const status = canonical.startsWith('FAIL|') ? 'fail' : 'ok';
  const names = ['calls', 'exit', 'pass', 'fail', 'testfail', 'changes', 'ok', 'opfail', 'raw'];
  const facts = names.map((name) => [name, field(canonical, name)]).filter(([, value]) => value !== null);
  const base = `MORE|${facts.map(([name, value]) => `${name}=${value}`).join('|')}|status=${status}`;
  return boundedSuffix(base, `|route=luna|effort=${ticket.effort}|ticket=${ticket.handle}`, 248);
}

export function attachAdaptiveRoute({ result, results = null, semantic = false, cwd = null, root = ADAPTIVE_TICKET_ROOT, now = Date.now() }) {
  const entries = Array.isArray(results) && results.length ? results : [result];
  const decision = classifyAdaptiveCompression({ results: entries, semantic });
  if (!decision.useLuna) return { ...result, adaptive: Object.freeze({ routed: false, decision }) };
  const ticket = createAdaptiveTicket({ canonical: result.text, decision, cwd, root, now });
  return { ...result, text: routeEnvelope(result.text, ticket), adaptive: Object.freeze({ routed: true, decision, ticket }) };
}

export function acceptAdaptiveLunaResponse({ ticket, response, root = ADAPTIVE_TICKET_ROOT, now = Date.now() }) {
  const context = contextForAdaptiveTicket(ticket, { root, now });
  try {
    const modelSuffix = '|model=luna';
    const semanticCanonical = context.record.canonical.replace(/\|sample=[^|]*/u, '');
    const validation = parseDesktopLunaResponse({
      canonical: semanticCanonical,
      response,
      material: context.record.material,
      maxBytes: 256 - Buffer.byteLength(modelSuffix, 'utf8'),
    });
    const text = validation.accepted
      ? boundedSuffix(validation.text, modelSuffix)
      : boundedSuffix(context.record.canonical, '|model=0');
    return Object.freeze({
      ...validation,
      text,
      ticket,
      effort: context.record.effort,
      metrics: Object.freeze({
        rawBytes: context.record.rawBytes,
        canonicalBytes: Buffer.byteLength(context.record.canonical, 'utf8'),
        semanticCanonicalBytes: Buffer.byteLength(semanticCanonical, 'utf8'),
        evidenceBytes: context.record.evidenceBytes,
        contextBytes: context.contextBytes,
        responseBytes: Buffer.byteLength(String(response ?? ''), 'utf8'),
        finalBytes: Buffer.byteLength(text, 'utf8'),
      }),
    });
  } finally {
    removeAdaptiveTicket(ticket, { root });
  }
}
