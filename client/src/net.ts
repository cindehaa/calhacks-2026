import type { Identity } from 'spacetimedb';
import { DbConnection } from './module_bindings';

// ?host=...&db=... override the defaults, so one build can point at local or Maincloud.
const params = new URLSearchParams(location.search);
export const HOST = params.get('host') ?? `ws://${location.hostname}:3000`;
export const DB_NAME = params.get('db') ?? 'arena';
// sessionStorage, not localStorage: each tab is its own player, so two tabs can play.
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

export interface Net {
  conn: DbConnection;
  identity: Identity;
}

export function connect(onReady: (net: Net) => void, onStatus: (s: string) => void): void {
  let connected = false;
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(sessionStorage.getItem(TOKEN_KEY) || undefined)
    .onConnect((conn, identity, token) => {
      sessionStorage.setItem(TOKEN_KEY, token);
      connected = true;
      onStatus('connected');
      conn
        .subscriptionBuilder()
        .onApplied(() => onReady({ conn, identity }))
        .onError(() => onStatus('subscription failed'))
        .subscribeToAllTables();
    })
    // A failed first connect also fires onDisconnect; keep the "can't reach" message.
    .onDisconnect(() => connected && onStatus('disconnected'))
    .onConnectError((_ctx, err) => onStatus(`can't reach ${HOST} (${err.message})`))
    .build();
}
