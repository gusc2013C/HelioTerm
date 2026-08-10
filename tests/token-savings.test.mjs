import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateTokenSavings,
  createTokenSavingsMeter,
  estimateTokens,
  formatTokenSavings,
  measureTokenSavings,
  TOKEN_ESTIMATOR,
} from '../scripts/token-savings.mjs';

test('token estimator is deterministic and explicitly byte based', () => {
  assert.equal(TOKEN_ESTIMATOR, 'utf8-bytes-ceil-div4-v1');
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('测'), 1);
});

test('token savings measurements retain exact bytes and estimated tokens', () => {
  const entry = measureTokenSavings({ rawText: 'x'.repeat(400), compactText: 'y'.repeat(40) });
  assert.deepEqual(entry, {
    scope: 'tool-content-only',
    estimator: TOKEN_ESTIMATOR,
    rawBytes: 400,
    compactBytes: 40,
    savedBytes: 360,
    rawEstimatedTokens: 100,
    compactEstimatedTokens: 10,
    savedEstimatedTokens: 90,
  });
  const aggregate = aggregateTokenSavings([entry, entry], 'z'.repeat(60));
  assert.equal(aggregate.rawBytes, 800);
  assert.equal(aggregate.compactBytes, 60);
  assert.equal(aggregate.rawEstimatedTokens, 200);
  assert.equal(aggregate.compactEstimatedTokens, 15);
  assert.equal(aggregate.savedEstimatedTokens, 185);
});

test('cumulative meter reports its own content cost without a model', () => {
  const meter = createTokenSavingsMeter();
  const entry = measureTokenSavings({ rawText: 'x'.repeat(400), compactText: 'y'.repeat(40) });
  meter.record(entry, { ownerWakeupsAvoided: 2, samplingBoundariesAvoided: 2 });
  meter.record(entry, { ownerWakeupsAvoided: 1, samplingBoundariesAvoided: 1 });
  const snapshot = meter.snapshot();
  assert.equal(snapshot.runs, 2);
  assert.equal(snapshot.savedBytes, 720);
  assert.equal(snapshot.savedEstimatedTokens, 180);
  assert.equal(snapshot.ownerWakeupsAvoided, 3);
  assert.equal(snapshot.samplingBoundariesAvoided, 3);
  const report = formatTokenSavings(snapshot);
  assert.match(report, /^OK\|calls=0\|meter=content\|runs=2\|rawB=800\|outB=80\|savedB=720\|rawEst=200\|outEst=20\|savedEst=180\|wakeupsAvoided=3\|boundariesAvoided=3\|pctB=90\.0/u);
  assert.match(report, /\|method=bytes4-content-estimate-not-billing\|scope=content\|model=0$/u);
  assert.ok(Buffer.byteLength(report, 'utf8') <= 256);
  const reportEstimate = Number(/\|reportEst=(-?\d+)\|/u.exec(report)?.[1]);
  const netEstimate = Number(/\|netEst=(-?\d+)\|/u.exec(report)?.[1]);
  assert.equal(reportEstimate, estimateTokens(report));
  assert.equal(netEstimate, snapshot.savedEstimatedTokens - reportEstimate);
});
