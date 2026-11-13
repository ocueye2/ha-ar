// Tests for describeConnectError in src/lib/homeAssistant.ts — the
// home-assistant-js-websocket library throws bare numeric error codes, so
// they are mapped to plain messages here. The full connect flow (redirect,
// callback exchange, dead refresh token) is not covered in CI; it needs a
// fake Home Assistant server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
  ERR_INVALID_AUTH_CALLBACK,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_HTTPS_TO_HTTP,
} from 'home-assistant-js-websocket';
import { describeConnectError } from '../src/lib/homeAssistant.ts';

test('an Error passes its message through', () => {
  assert.equal(describeConnectError(new Error('custom failure')), 'custom failure');
});

test('cannot connect', () => {
  assert.equal(
    describeConnectError(ERR_CANNOT_CONNECT),
    'Could not reach Home Assistant. Check the URL and that it is running.',
  );
});

test('invalid auth', () => {
  assert.equal(
    describeConnectError(ERR_INVALID_AUTH),
    'Home Assistant rejected the saved sign-in. It has been cleared, please connect again.',
  );
});

test('invalid auth callback', () => {
  assert.equal(
    describeConnectError(ERR_INVALID_AUTH_CALLBACK),
    'The sign-in reply from Home Assistant was invalid or already used. Please connect again.',
  );
});

test('host required', () => {
  assert.equal(describeConnectError(ERR_HASS_HOST_REQUIRED), 'Enter your Home Assistant URL first.');
});

test('https page to http host', () => {
  assert.equal(
    describeConnectError(ERR_INVALID_HTTPS_TO_HTTP),
    'This page is on HTTPS but the Home Assistant URL is plain HTTP. Use the HTTPS address.',
  );
});

test('unknown codes fall back to a generic message', () => {
  assert.equal(describeConnectError(999), 'Connection failed.');
  assert.equal(describeConnectError('weird'), 'Connection failed.');
  assert.equal(describeConnectError(undefined), 'Connection failed.');
});
