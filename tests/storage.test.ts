// Tests for src/lib/storage.ts — the config (Home Assistant URL, devices,
// reference photos) lives in localStorage, which browsers cap at about 5 MB.
// A full store must surface a plain message instead of a bare
// QuotaExceededError. localStorage itself is faked here; the real one is
// restored after each test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, saveConfig, defaultConfig } from '../src/lib/storage.ts';

type Store = Record<string, string>;

function fakeStorage(store: Store = {}, onSet?: (key: string, value: string) => void) {
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      if (onSet) onSet(key, value);
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
}

function withStorage(storage: unknown, fn: () => void): void {
  const original = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = storage;
  try {
    fn();
  } finally {
    if (original === undefined) delete (globalThis as Record<string, unknown>).localStorage;
    else (globalThis as Record<string, unknown>).localStorage = original;
  }
}

test('loadConfig returns the default when nothing is stored', () => {
  withStorage(fakeStorage(), () => {
    assert.deepEqual(loadConfig(), defaultConfig);
  });
});

test('loadConfig merges stored values over the default', () => {
  withStorage(fakeStorage({ 'ha-ar-config-v1': JSON.stringify({ hassUrl: 'http://ha:8123' }) }), () => {
    const config = loadConfig();
    assert.equal(config.hassUrl, 'http://ha:8123');
    assert.deepEqual(config.devices, []);
  });
});

test('loadConfig returns the default on bad JSON', () => {
  withStorage(fakeStorage({ 'ha-ar-config-v1': '{not json' }), () => {
    assert.deepEqual(loadConfig(), defaultConfig);
  });
});

test('saveConfig round-trips through loadConfig', () => {
  const store: Store = {};
  withStorage(fakeStorage(store), () => {
    saveConfig({ hassUrl: 'http://ha:8123', devices: [] });
    assert.equal(loadConfig().hassUrl, 'http://ha:8123');
  });
});

test('saveConfig reports a full store in plain words', () => {
  const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
  withStorage(
    fakeStorage({}, () => {
      throw quotaError;
    }),
    () => {
      assert.throws(
        () => saveConfig({ hassUrl: 'http://ha:8123', devices: [] }),
        (e: unknown) =>
          e instanceof Error &&
          e.message.startsWith('Storage is full:') &&
          e.message.includes('Delete an old device'),
      );
    },
  );
});

test('saveConfig rethrows non-quota errors unchanged', () => {
  const boom = new Error('boom');
  withStorage(
    fakeStorage({}, () => {
      throw boom;
    }),
    () => {
      assert.throws(() => saveConfig({ hassUrl: 'http://ha:8123', devices: [] }), boom);
    },
  );
});
