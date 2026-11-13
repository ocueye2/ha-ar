import {
  createConnection, getAuth, subscribeEntities, callService,
  ERR_HASS_HOST_REQUIRED, type Connection, type HassEntities,
} from 'home-assistant-js-websocket';

const TOKEN_KEY = 'ha-ar-auth-tokens';
export type HAConnection = { connection: Connection; unsubscribe: () => void };

export async function connectHomeAssistant(hassUrl: string, onEntities: (entities: HassEntities) => void): Promise<HAConnection> {
  const base = hassUrl.replace(/\/+$/, '');
  const authOptions: any = {
    hassUrl: base,
    async loadTokens() {
      try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') ?? undefined; }
      catch { return undefined; }
    },
    saveTokens(tokens: unknown) { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); },
  };
  let auth;
  try { auth = await getAuth(authOptions); }
  catch (error) {
    if (error === ERR_HASS_HOST_REQUIRED) auth = await getAuth(authOptions);
    else throw error;
  }
  const connection = await createConnection({ auth });
  const unsubscribe = subscribeEntities(connection, onEntities);
  return { connection, unsubscribe };
}

export async function service(connection: Connection, entityId: string, domain: string, serviceName: string, data: Record<string, unknown> = {}) {
  return callService(connection, domain, serviceName, data, { entity_id: entityId });
}
export function disconnect(connection?: Connection) { connection?.close(); }
