// Tests for src/lib/detectionHold.ts — each detection stays on screen for at
// least 1 second from the moment it first appears, so a tracking wobble does
// not flash the control panel away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DetectionHold, MIN_HOLD_MS } from '../src/lib/detectionHold.ts';

test('MIN_HOLD_MS is 1000', () => {
  assert.equal(MIN_HOLD_MS, 1000);
});

test('lost before the hold ends waits out the remainder', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  assert.equal(hold.lost(0, 200), 800);
});

test('lost at exactly the hold clears immediately', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  assert.equal(hold.lost(0, 1000), 0);
});

test('lost after the hold clears immediately', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  assert.equal(hold.lost(0, 2500), 0);
});

test('lost with nothing showing returns null', () => {
  assert.equal(new DetectionHold().lost(0, 0), null);
});

test('lost for a different target returns null', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  assert.equal(hold.lost(1, 100), null);
});

test('re-finding the same target does not restart the clock', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  hold.found(0, 500);
  assert.equal(hold.lost(0, 700), 300);
});

test('a different target replaces the held one immediately', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  hold.found(1, 100);
  assert.equal(hold.lost(1, 200), 900);
  assert.equal(hold.lost(0, 200), null);
});

test('clear() forgets the detection', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  hold.clear();
  assert.equal(hold.lost(0, 100), null);
});

test('found after clear starts a fresh hold', () => {
  const hold = new DetectionHold();
  hold.found(0, 0);
  hold.clear();
  hold.found(0, 5000);
  assert.equal(hold.lost(0, 5200), 800);
});

test('found returns the index to show', () => {
  const hold = new DetectionHold();
  assert.equal(hold.found(3, 0), 3);
});
