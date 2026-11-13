// Tests for the pure resize math in src/lib/images.ts — reference photos are
// shrunk so the long edge is 640px before they are stored, which keeps the
// config under localStorage's ~5 MB cap. The DOM parts of downscaleImage
// (File, Image, canvas) are not covered here; the math is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledDimensions, MAX_REFERENCE_EDGE } from '../src/lib/images.ts';

test('MAX_REFERENCE_EDGE is 640', () => {
  assert.equal(MAX_REFERENCE_EDGE, 640);
});

test('phone photo 4032x3024 becomes 640x480', () => {
  assert.deepEqual(scaledDimensions(4032, 3024), [640, 480]);
});

test('portrait photo scales on the long edge', () => {
  assert.deepEqual(scaledDimensions(3024, 4032), [480, 640]);
});

test('a slightly oversized image scales down proportionally', () => {
  assert.deepEqual(scaledDimensions(800, 600), [640, 480]);
});

test('small photos are never upscaled', () => {
  assert.deepEqual(scaledDimensions(400, 300), [400, 300]);
  assert.deepEqual(scaledDimensions(640, 480), [640, 480]);
});

test('square images stay square', () => {
  assert.deepEqual(scaledDimensions(1000, 1000), [640, 640]);
});

test('a very wide image keeps its ratio', () => {
  assert.deepEqual(scaledDimensions(2000, 100), [640, 32]);
});

test('tiny images never round down to zero', () => {
  assert.deepEqual(scaledDimensions(1, 1), [1, 1]);
});
