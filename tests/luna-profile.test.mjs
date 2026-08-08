import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LUNA_DESKTOP_DIRECTORY,
  LUNA_DESKTOP_TARGET,
  LUNA_COMPLEX_EFFORT,
  LUNA_EFFORT,
  LUNA_MAX_REUSED_TURNS,
  LUNA_MODEL,
  selectLunaEffort,
  shouldUseLunaCompression,
} from '../scripts/luna-profile.mjs';

test('Desktop Luna profile is projectless, bounded, and reusable', () => {
  assert.equal(LUNA_MODEL, 'gpt-5.6-luna');
  assert.equal(LUNA_EFFORT, 'high');
  assert.equal(LUNA_COMPLEX_EFFORT, 'xhigh');
  assert.equal(LUNA_MAX_REUSED_TURNS, 8);
  assert.equal(LUNA_DESKTOP_TARGET, 'projectless');
  assert.equal(LUNA_DESKTOP_DIRECTORY, 'helioterm-luna-temp');
});

test('Desktop Luna uses xhigh only for complex semantic diagnosis', () => {
  assert.equal(selectLunaEffort(), 'high');
  assert.equal(selectLunaEffort({ complexFailure: true }), 'xhigh');
  assert.equal(selectLunaEffort({ crossModule: true }), 'xhigh');
  assert.equal(selectLunaEffort({ causalAnalysis: true }), 'xhigh');
});

test('Luna routing requires size, semantic need, and material evidence', () => {
  assert.equal(shouldUseLunaCompression({ rawBytes: 10_000, truncated: true, semanticSummaryRequired: true }), true);
  assert.equal(shouldUseLunaCompression({ rawBytes: 10_000, materialFailure: true, semanticSummaryRequired: true }), true);
  assert.equal(shouldUseLunaCompression({ rawBytes: 10_000, materialChange: true, semanticSummaryRequired: true }), true);
  assert.equal(shouldUseLunaCompression({ rawBytes: 2_047, truncated: true, semanticSummaryRequired: true }), false);
  assert.equal(shouldUseLunaCompression({ rawBytes: 10_000, truncated: true }), false);
  assert.equal(shouldUseLunaCompression({ rawBytes: 10_000, semanticSummaryRequired: true }), false);
  assert.throws(() => shouldUseLunaCompression({ rawBytes: -1 }), /rawBytes/u);
});
