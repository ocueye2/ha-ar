import {
  createConnection, getAuth, subscribeEntities, callService,
  ERR_HASS_HOST_REQUIRED, ERR_INVALID_AUTH, ERR_INVALID_AUTH_CALLBACK,
  ERR_CANNOT_CONNECT, ERR_INVALID_HTTPS_TO_HTTP,
  type Auth, type Connection, type HassEntities,
} from 'home-assistant-js-websocket';

const TOKEN_KEY = 'ha-ar-auth-tokens';
export type HAConnection = { connection: Connection; unsubscribe: () => void };

// The library throws bare numeric error codes (1-6), not Errors, so the old
// code showed every failure as a generic "Connection failed". Map them.
export function describeConnectError(e: unknown): string {
  if (e instanceof Error) return e.message;
  switch (e) {
    case ERR_CANNOT_CONNECT:
      return 'Could not reach Home Assistant. Check the URL and that it is running.';
    case ERR_INVALID_AUTH:
      return 'Home Assistant rejected the saved sign-in. It has been cleared, please connect again.';
    case ERR_INVALID_AUTH_CALLBACK:
      return 'The sign-in reply from Home Assistant was invalid or already used. Please connect again.';
    case ERR_HASS_HOST_REQUIRED:
      return 'Enter your Home Assistant URL first.';
    case ERR_INVALID_HTTPS_TO_HTTP:
      return 'This page is on HTTPS but the Home Assistant URL is plain HTTP. Use the HTTPS address.';
    default:
      return 'Connection failed.';
  }
}

export function hasStoredTokens(): boolean {
  try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
}

export function hasAuthCallback(): boolean {
  try { return new URLSearchParams(location.search).has('auth_callback'); } catch { return false; }
}

export function clearStoredTokens() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

// Home Assistant sends the browser back with ?auth_callback=1&code=...&state=...
// after authorizing. That query string MUST be removed once handled: if the
// code exchange fails once, the stale params stay in the URL and getAuth
// throws ERR_INVALID_AUTH_CALLBACK on every later load, bricking sign-in
// until the user edits the address bar by hand.
export function clearAuthCallbackFromUrl() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('auth_callback')) return;
    url.searchParams.delete('auth_callback');
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch { /* history unavailable */ }
}

function loadTokens() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') ?? undefined; }
  catch { return undefined; }
}

function saveTokens(tokens: unknown) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch { /* storage unavailable */ }
}

// One sign-in attempt: exchange a callback code, reuse saved tokens, or
// redirect the whole page to Home Assistant to authorize (getAuth does that
// itself and returns a promise that never resolves while navigating away).
// A dead refresh token or a bad callback clears the saved sign-in so the
// next attempt starts clean instead of failing the same way forever.
export async function authenticate(hassUrl: string): Promise<Auth> {
  const base = hassUrl.replace(/\/+$/, '');
  try {
    return await getAuth({ hassUrl: base, loadTokens, saveTokens });
  } catch (e) {
    if (e === ERR_INVALID_AUTH || e === ERR_INVALID_AUTH_CALLBACK) clearStoredTokens();
    throw e;
  } finally {
    clearAuthCallbackFromUrl();
  }
}

export async function connectHomeAssistant(hassUrl: string, onEntities: (entities: HassEntities) => void): Promise<HAConnection> {
  const auth = await authenticate(hassUrl);
  let connection: Connection;
  try {
    connection = await createConnection({ auth });
  } catch (e) {
    // A refresh token that Home Assistant no longer accepts fails here, not
    // in getAuth. Clear it so the next attempt re-authorizes cleanly.
    if (e === ERR_INVALID_AUTH) clearStoredTokens();
    throw e;
  }
  const unsubscribe = subscribeEntities(connection, onEntities);
  return { connection, unsubscribe };
}

export async function service(connection: Connection, entityId: string, domain: string, serviceName: string, data: Record<string, unknown> = {}) {
  return callService(connection, domain, serviceName, data, { entity_id: entityId });
}
export function disconnect(connection?: Connection) { connection?.close(); }
