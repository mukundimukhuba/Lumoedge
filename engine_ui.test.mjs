import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countdownCopy, headerStatus, ringMetrics } from './assets/autoTradeEngine.js';

test('countdown copy switches at 10 seconds without skipping', () => {
  const early = countdownCopy(15);
  assert.equal(early.kicker, 'ANALYZING');
  assert.equal(early.time, '00:15');
  assert.equal(early.sub, '');
  const late = countdownCopy(10);
  assert.equal(late.kicker, 'NEXT SCAN IN');
  assert.equal(late.time, '00:10');
  const times = [];
  for (let left = 15; left >= 1; left -= 1) times.push(countdownCopy(left).time);
  assert.deepEqual(times, [
    '00:15',
    '00:14',
    '00:13',
    '00:12',
    '00:11',
    '00:10',
    '00:09',
    '00:08',
    '00:07',
    '00:06',
    '00:05',
    '00:04',
    '00:03',
    '00:02',
    '00:01',
  ]);
});

test('the ring empties as the countdown falls', () => {
  const full = ringMetrics(15);
  const mid = ringMetrics(8);
  const empty = ringMetrics(0);
  assert.equal(full.offset, 0);
  assert.ok(mid.offset > full.offset);
  assert.ok(empty.offset > mid.offset);
  assert.ok(Math.abs(empty.offset - full.circ) < 0.001);
});

test('header status matches the engine phase', () => {
  assert.equal(headerStatus('ready'), 'READY');
  assert.equal(headerStatus('scanning'), 'ANALYZING');
  assert.equal(headerStatus('executing'), 'EXECUTING');
  assert.equal(headerStatus('open'), 'TRADE OPEN');
  assert.equal(headerStatus('stopped'), 'STOPPED');
  assert.equal(headerStatus('error'), 'ERROR');
});
