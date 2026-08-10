const OUTPUT_LIMIT_BYTES = 256;
const NOTE_LIMIT_CHARACTERS = 72;

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

function factNumbers(canonical) {
  return [...String(canonical).matchAll(/(?:^|\|)[^=|]+=(-?\d+)(?:\||$)/gu)].map((match) => match[1]);
}

export function composeLunaCompression({ canonical, note, material = true, maxBytes = OUTPUT_LIMIT_BYTES }) {
  if (typeof canonical !== 'string' || !/^(?:OK|FAIL)\|[^\r\n]+$/u.test(canonical)) throw new Error('canonical must be one compact fact line');
  const normalized = String(note ?? '').replace(/[\r\n|]+/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[,:;/—-]+$/u, '');
  if (!material && !normalized) return { text: canonical, note: '', accepted: true, reason: 'no-material-note' };
  if (!material) return { text: canonical, note: '', accepted: false, reason: 'unexpected-note' };
  if (!normalized) return { text: canonical, note: '', accepted: false, reason: 'missing-note' };
  const lower = normalized.toLowerCase();
  if (/^(?:working tree has|there (?:are|is)|tests? (?:passed|failed)|changes? detected|存在|共有|测试通过|检测到)/u.test(lower)) {
    return { text: canonical, note: '', accepted: false, reason: 'generic-note' };
  }
  if (/\bluna_context\b.{0,32}\b(?:unavailable|missing|not (?:available|found)|inaccessible)\b/u.test(lower)
    || /^(?:the )?(?:mcp )?tool (?:is )?(?:unavailable|missing|not (?:available|found))/u.test(lower)
    || /^(?:cannot|can't|unable to) (?:access|read) (?:the )?(?:context|evidence|ticket)/u.test(lower)
    || /^no (?:context|evidence) (?:is )?(?:available|provided)/u.test(lower)) {
    return { text: canonical, note: '', accepted: false, reason: 'transport-note' };
  }
  if (/(?:\b(?:and|or|with|including)|以及|和|与|包括)$/iu.test(normalized)) {
    return { text: canonical, note: '', accepted: false, reason: 'incomplete-note' };
  }
  if (factNumbers(canonical).some((number) => new RegExp(`(?:^|\\D)${number}(?:\\D|$)`, 'u').test(normalized))) {
    return { text: canonical, note: '', accepted: false, reason: 'recounted-fact' };
  }
  const prefix = `${canonical}|note=`;
  const budget = maxBytes - Buffer.byteLength(prefix, 'utf8');
  if (budget < 8) return { text: canonical, note: '', accepted: false, reason: 'no-note-budget' };
  let clipped = clipUtf8(normalized, budget);
  if (clipped !== normalized && /\s/u.test(clipped)) clipped = clipped.replace(/\s+\S*$/u, '').replace(/[\s,:;/—-]+$/u, '');
  if (!clipped) return { text: canonical, note: '', accepted: false, reason: 'no-note-budget' };
  return { text: `${prefix}${clipped}`, note: clipped, accepted: true, reason: 'semantic-note' };
}

export function desktopLunaPrompt({ canonical, evidence, material = true }) {
  return [
    'You are a temporary HelioTerm semantic compressor inside Codex Desktop.',
    'Do not use tools. Return only JSON matching {"note":"..."}.',
    `The note must be one complete phrase under ${NOTE_LIMIT_CHARACTERS} characters. Do not repeat status, counts, numbers, or the canonical line.`,
    material
      ? 'Explain concrete failure/change kinds and affected areas. State only causes directly supported by the evidence; if causality is ambiguous, describe the observed symptom without guessing.'
      : 'There is no material failure or working-tree change; return {"note":""}.',
    `CANONICAL=${canonical}`,
    `EVIDENCE=${String(evidence ?? '')}`,
  ].join('\n');
}

export function parseDesktopLunaResponse({ canonical, response, material = true, maxBytes = OUTPUT_LIMIT_BYTES }) {
  let parsed;
  try { parsed = JSON.parse(String(response ?? '')); }
  catch { return { text: canonical, note: '', accepted: false, reason: 'invalid-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || typeof parsed.note !== 'string') {
    return { text: canonical, note: '', accepted: false, reason: 'invalid-shape' };
  }
  return composeLunaCompression({ canonical, note: parsed.note, material, maxBytes });
}

export function desktopLunaTicketPrompt({ ticket, readerPath = null }) {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{16}$/u.test(ticket)) throw new Error('invalid Luna ticket');
  const access = readerPath
    ? `Call the HelioTerm MCP tool luna_context exactly once with ticket ${ticket}. If and only if that exact tool is unavailable, make one Desktop integrated-terminal call: node "${readerPath}" --ticket ${ticket}`
    : `Call the HelioTerm MCP tool luna_context exactly once with ticket ${ticket}.`;
  return [
    'You are already the temporary HelioTerm Luna leaf in Codex Desktop.',
    'Leaf guard: never create, fork, list, read, send to, wait for, or archive any Codex task. The parent owns task lifecycle and archival.',
    access,
    readerPath
      ? 'The fallback is a local evidence reader, not Codex CLI. Use no other terminal, shell, filesystem, web, model, or agent tool.'
      : 'Do not use a terminal, shell, filesystem tool, web tool, or any other model/agent.',
    'After reading the returned canonical facts and evidence, return only JSON matching {"note":"..."}.',
    'If evidence access fails, return {"note":""}; never describe tool, context, ticket, or transport availability.',
    'Do not repeat status, counts, numbers, or the canonical line. Do not add Markdown or explanation.',
  ].join('\n');
}

export const DESKTOP_LUNA_NOTE_LIMIT_CHARACTERS = NOTE_LIMIT_CHARACTERS;
export const DESKTOP_LUNA_OUTPUT_LIMIT_BYTES = OUTPUT_LIMIT_BYTES;
