/**
 * Trace analysis (sync-tracing-v1.md).
 *
 * Per TEST-43 these projections are tested as pure functions over constructed
 * frames: they are the instrument used to judge the protocol, so an
 * uninstrumented instrument is worse than none. Every bug this file guards was
 * a *naming* defect — code that typechecked, ran, and drew a plausible chart
 * while describing something that had not happened (TEST-42).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correlate, objectRows, invariantStatuses, associationSummaries,
  friendStatuses, layerStatuses, toJsonl, fromJsonl, LAYERS,
} from '../out-test/syncAnalysis.js';

const T0 = 1000;
const NOW = T0 + 120_000;
const f = (o) => ({ seq: 0, at: T0, assoc: 'A', dir: 'local', phase: 'block', level: 'debug', msg: '?', detail: '', ...o });

const cfgFriend = (pk) => f({ phase: 'config', msg: 'friend-configured', remoteProfile: pk, at: T0, data: {} });
const haveIn = (hs, at = T0) => f({ dir: 'in', phase: 'anti-entropy', msg: 'have', at, data: { hashes: hs } });
const haveOut = (hs, at = T0) => f({ dir: 'out', phase: 'anti-entropy', msg: 'have', at, data: { hashes: hs } });
const armed = (h, at = T0 + 10) => f({ msg: 'want-armed', at, remoteProfile: 'ff1', data: { hash: h, corrId: h, corrKind: 'hash' } });
const received = (h, at = T0 + 20) => f({ dir: 'in', msg: 'block-received', at, data: { hash: h, corrId: h, corrKind: 'hash' } });
const served = (missing, at = T0 + 30) => f({ msg: 'want-served', level: 'warn', at, data: { missingHashes: missing } });
const rotation = (at = T0 + 40) => f({ phase: 'session', msg: 'session-stall', level: 'info', at, remoteProfile: 'ff1', data: { reason: 'session-rotation' } });
const resumeStall = (at = T0 + 40) => f({ phase: 'session', msg: 'session-stall', level: 'warn', at, remoteProfile: 'ff1', data: { reason: 'resume-timeout' } });
const wantTimeout = (hs, at = T0 + 40) => f({ msg: 'want-timeout', level: 'warn', at, remoteProfile: 'ff1', data: { reason: 'want-timeout', hashes: hs } });
const inv = (frames, id) => invariantStatuses(frames).find((i) => i.id === id);

test('every layer is listed even with no traffic (TRACE-20)', () => {
  const rows = layerStatuses([]);
  assert.equal(rows.length, LAYERS.length, 'a silent layer must still have a row');
  assert.ok(rows.every((r) => r.state === 'armed'), 'silence reads as armed, not absent');
});

test('every invariant is listed before any frame arrives (TRACE-41)', () => {
  const rows = invariantStatuses([]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.state === 'watching'), 'a guard you cannot see is a guard you cannot trust');
});

test('SYNC-18 licenses silence for a block never announced', () => {
  const frames = [armed('hX')];
  assert.equal(correlate(frames, NOW).unmatched[0]?.kind, 'unanswerable');
  assert.equal(inv(frames, 'SYNC-18a').violations, 0, 'partial replicas are normal, not faults');
});

test('SYNC-18a: announced then never served is a fault', () => {
  const frames = [haveIn(['h1']), armed('h1')];
  assert.equal(correlate(frames, NOW).unmatched[0]?.kind, 'overdue', 'have() is a commitment');
  assert.equal(inv(frames, 'SYNC-18a').violations, 1);
});

test('SYNC-18a: a served commitment is clean', () => {
  const frames = [haveIn(['h1']), armed('h1'), received('h1')];
  assert.equal(correlate(frames, NOW).unmatched.length, 0);
  assert.equal(inv(frames, 'SYNC-18a').violations, 0);
});

test('overdue wants sort above unanswerable ones', () => {
  const { unmatched } = correlate([armed('hX'), haveIn(['h1']), armed('h1')], NOW);
  assert.equal(unmatched[0].kind, 'overdue', 'real faults must not be buried under licensed silence');
});

test('SYNC-18b: we announced a hash then could not serve it', () => {
  assert.equal(inv([haveOut(['h9']), served(['h9'])], 'SYNC-18b').violations, 1);
  assert.equal(inv([served(['hZ'])], 'SYNC-18b').violations, 0, 'never announced, so never promised');
});

test('routine session rotation is not reported as a block failure', () => {
  const frames = [cfgFriend('ff1'), armed('h1'), rotation()];
  assert.equal(objectRows(frames).find((o) => o.hash === 'h1')?.state, 'in-flight',
    'rotation must not time out outstanding hashes');
  assert.equal(friendStatuses(frames)[0].stalls, 0,
    'the healthy periodic re-dial would otherwise make every peer look sick');
  assert.equal(associationSummaries(frames)[0].state, 'stalled', 'the FSM still moves');
});

test('a real want timeout does report', () => {
  const frames = [cfgFriend('ff1'), armed('h1'), wantTimeout(['h1'])];
  assert.equal(objectRows(frames).find((o) => o.hash === 'h1')?.state, 'timed-out');
  assert.equal(friendStatuses(frames)[0].stalls, 1);
});

test('a non-rotation stall counts without timing out hashes', () => {
  const frames = [cfgFriend('ff1'), armed('h1'), resumeStall()];
  assert.equal(friendStatuses(frames)[0].stalls, 1);
  assert.equal(objectRows(frames).find((o) => o.hash === 'h1')?.state, 'in-flight');
});

test('a configured friend that was never contacted is visible (TRACE-23)', () => {
  const rows = friendStatuses([cfgFriend('ff1'), cfgFriend('ff2')]);
  assert.equal(rows.length, 2, 'all configured friends, contacted or not');
  assert.ok(rows.every((r) => r.state === 'never-contacted'),
    '"no transport attempted" must be distinguishable from "attempted and failed"');
});

test('config frames do not invent phantom associations', () => {
  assert.equal(associationSummaries([cfgFriend('ff1'), cfgFriend('ff2')]).length, 0);
});

test('JSONL round-trips and replays identically (TRACE-50/51)', () => {
  const frames = [cfgFriend('ff1'), haveIn(['h1']), armed('h1'), wantTimeout(['h1'])];
  const back = fromJsonl(toJsonl(frames));

  assert.equal(back.length, frames.length);
  assert.equal(toJsonl(frames).split('\n').length, frames.length, 'one frame per line');
  const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  same(layerStatuses(frames, 1e12), layerStatuses(back, 1e12));
  same(friendStatuses(frames), friendStatuses(back));
  same(correlate(frames, NOW), correlate(back, NOW));
  same(objectRows(frames), objectRows(back));
  same(invariantStatuses(frames), invariantStatuses(back));
});

test('malformed JSONL lines are skipped, not fatal', () => {
  assert.equal(fromJsonl('{"seq":0,"at":1,"msg":"x"}\nnot json\n\n').length, 1);
});
