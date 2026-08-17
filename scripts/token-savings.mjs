const ESTIMATOR = 'utf8-bytes-ceil-div4-v1';

export function estimateTokens(value) {
  const bytes = Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');
  return bytes === 0 ? 0 : Math.ceil(bytes / 4);
}

function measurement({ rawBytes, compactBytes, rawEstimatedTokens, compactEstimatedTokens }) {
  return Object.freeze({
    scope: 'tool-content-only',
    estimator: ESTIMATOR,
    rawBytes,
    compactBytes,
    savedBytes: rawBytes - compactBytes,
    rawEstimatedTokens,
    compactEstimatedTokens,
    savedEstimatedTokens: rawEstimatedTokens - compactEstimatedTokens,
  });
}

export function measureTokenSavings({ rawText = '', compactText = '' }) {
  return measurement({
    rawBytes: Buffer.byteLength(rawText, 'utf8'),
    compactBytes: Buffer.byteLength(compactText, 'utf8'),
    rawEstimatedTokens: estimateTokens(rawText),
    compactEstimatedTokens: estimateTokens(compactText),
  });
}

export function measureTokenSavingsFromBytes({ rawBytes, compactText = '' }) {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw new Error('rawBytes must be a non-negative safe integer');
  const compactBytes = Buffer.byteLength(compactText, 'utf8');
  return measurement({
    rawBytes,
    compactBytes,
    rawEstimatedTokens: rawBytes === 0 ? 0 : Math.ceil(rawBytes / 4),
    compactEstimatedTokens: estimateTokens(compactText),
  });
}

export function aggregateTokenSavings(entries, compactText) {
  const measurements = Array.isArray(entries) ? entries.filter(Boolean) : [];
  return measurement({
    rawBytes: measurements.reduce((sum, entry) => sum + entry.rawBytes, 0),
    compactBytes: Buffer.byteLength(compactText, 'utf8'),
    rawEstimatedTokens: measurements.reduce((sum, entry) => sum + entry.rawEstimatedTokens, 0),
    compactEstimatedTokens: estimateTokens(compactText),
  });
}

export function replaceCompactTokenSavings(entry, compactText) {
  if (!entry || entry.estimator !== ESTIMATOR || entry.scope !== 'tool-content-only') throw new Error('invalid token savings measurement');
  return measurement({
    rawBytes: entry.rawBytes,
    compactBytes: Buffer.byteLength(compactText, 'utf8'),
    rawEstimatedTokens: entry.rawEstimatedTokens,
    compactEstimatedTokens: estimateTokens(compactText),
  });
}

export function createTokenSavingsMeter() {
  const totals = {
    runs: 0,
    rawBytes: 0,
    compactBytes: 0,
    savedBytes: 0,
    rawEstimatedTokens: 0,
    compactEstimatedTokens: 0,
    savedEstimatedTokens: 0,
    ownerWakeupsAvoided: 0,
    samplingBoundariesAvoided: 0,
  };
  return Object.freeze({
    record(entry, { ownerWakeupsAvoided = 0, samplingBoundariesAvoided = ownerWakeupsAvoided } = {}) {
      if (!entry || entry.estimator !== ESTIMATOR || entry.scope !== 'tool-content-only') throw new Error('invalid token savings measurement');
      if (!Number.isSafeInteger(ownerWakeupsAvoided) || ownerWakeupsAvoided < 0) throw new Error('ownerWakeupsAvoided must be a non-negative safe integer');
      if (!Number.isSafeInteger(samplingBoundariesAvoided) || samplingBoundariesAvoided < 0) throw new Error('samplingBoundariesAvoided must be a non-negative safe integer');
      totals.runs += 1;
      for (const field of ['rawBytes', 'compactBytes', 'savedBytes', 'rawEstimatedTokens', 'compactEstimatedTokens', 'savedEstimatedTokens']) totals[field] += entry[field];
      totals.ownerWakeupsAvoided += ownerWakeupsAvoided;
      totals.samplingBoundariesAvoided += samplingBoundariesAvoided;
      return this.snapshot();
    },
    snapshot() {
      return Object.freeze({ ...totals, scope: 'tool-content-only', estimator: ESTIMATOR });
    },
  });
}

export function formatTokenSavings(snapshot) {
  const percent = snapshot.rawBytes > 0 ? ((snapshot.savedBytes / snapshot.rawBytes) * 100).toFixed(1) : '0.0';
  const base = `OK|calls=0|meter=content|runs=${snapshot.runs}|rawB=${snapshot.rawBytes}|outB=${snapshot.compactBytes}|savedB=${snapshot.savedBytes}|rawEst=${snapshot.rawEstimatedTokens}|outEst=${snapshot.compactEstimatedTokens}|savedEst=${snapshot.savedEstimatedTokens}|wakeupsAvoided=${snapshot.ownerWakeupsAvoided}|boundariesAvoided=${snapshot.samplingBoundariesAvoided}|pctB=${percent}`;
  let reportEstimatedTokens = 0;
  let report = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const netEstimatedTokens = snapshot.savedEstimatedTokens - reportEstimatedTokens;
    report = `${base}|reportEst=${reportEstimatedTokens}|netEst=${netEstimatedTokens}|method=bytes4-content-estimate-not-billing|scope=content|model=0`;
    const next = estimateTokens(report);
    if (next === reportEstimatedTokens) break;
    reportEstimatedTokens = next;
  }
  return report;
}

export const TOKEN_ESTIMATOR = ESTIMATOR;
