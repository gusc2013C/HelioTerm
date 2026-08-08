export const LUNA_MODEL = 'gpt-5.6-luna';
export const LUNA_EFFORT = 'high';
export const LUNA_COMPLEX_EFFORT = 'xhigh';
export const LUNA_MAX_REUSED_TURNS = 8;
export const LUNA_DESKTOP_TARGET = 'projectless';
export const LUNA_DESKTOP_DIRECTORY = 'helioterm-luna-temp';

export function selectLunaEffort({ complexFailure = false, crossModule = false, causalAnalysis = false } = {}) {
  return complexFailure || crossModule || causalAnalysis ? LUNA_COMPLEX_EFFORT : LUNA_EFFORT;
}

export function shouldUseLunaCompression({
  rawBytes = 0,
  materialFailure = false,
  materialChange = false,
  truncated = false,
  semanticSummaryRequired = false,
} = {}) {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw new Error('rawBytes must be a non-negative safe integer');
  return rawBytes >= 2048
    && semanticSummaryRequired
    && (materialFailure || materialChange || truncated);
}
