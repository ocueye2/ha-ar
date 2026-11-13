// Tests for src/lib/ids.ts — newId() must produce an RFC 4122 v4-shaped
// UUID on all three paths: crypto.randomUUID, crypto.getRandomValues, and
// the Math.random fallback (plain HTTP on a LAN has neither of the first two).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../src/lib/ids.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('randomUUID path returns a v4 UUID', () => {
  assert.match(newId(), UUID_V4);
});

test('two ids differ', () => {
  assert.notEqual(newId(), newId());
});

// globalThis.crypto is a configurable getter in Node, so the fallback paths
// can be exercised by swapping it out and restoring it afterwards.
function withCrypto(fake: unknown, fn: () => void): void {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  }
}

test('getRandomValues fallback is v4-shaped with deterministic bytes', () => {
  withCrypto(
    {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        return arr;
      },
    },
    () => {
      // Bytes 0..15, with the version nibble forced to 4 and the variant to 10.
      assert.equal(newId(), '00010203-0405-4607-8809-0a0b0c0d0e0f');
    },
  );
});

test('Math.random fallback is v4-shaped with deterministic output', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  withCrypto({}, () => {
    assert.equal(newId(), '00000000-0000-4000-8000-000000000000');
  });
  Math.random = originalRandom;
});

test('getRandomValues fallback still varies', () => {
  // Capture the real one first: calling globalThis.crypto.getRandomValues
  // from inside the fake would recurse into the fake itself.
  const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  withCrypto({ getRandomValues: realGetRandomValues }, () => {
    assert.match(newId(), UUID_V4);
    assert.notEqual(newId(), newId());
  });
});
