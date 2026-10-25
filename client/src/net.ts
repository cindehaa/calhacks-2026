import type { Identity } from 'spacetimedb';
import { DbConnection } from './module_bindings';
import { healthSet } from './diag';
import { checkModule } from './health';

// Dev talks to a local SpacetimeDB, the deployed site (Vercel) to Maincloud.
// ?host=...&db=... override the defaults, so one build can point at either.
const params = new URLSearchParams(location.search);
export const HOST = params.get('host') ?? (import.meta.env.DEV ? `ws://${location.hostname}:3000` : 'https://maincloud.spacetimedb.com');
export const DB_NAME = params.get('db') ?? (import.meta.env.DEV ? 'arena' : 'calhacks-arena');
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
      healthSet('spacetimedb', `connected to ${HOST} db ${DB_NAME}`, 'info', 'DB');
      void checkModule(HOST, DB_NAME);
      onStatus('connected');
      conn
        .subscriptionBuilder()
        .onApplied(() => onReady({ conn, identity }))
        .onError(ctx => {
          healthSet('spacetimedb', `subscription FAILED on ${HOST}/${DB_NAME}: ${(ctx as { event?: Error }).event?.message ?? 'unknown'} (stale module or schema mismatch?)`, 'error', 'DB');
          onStatus('subscription failed');
        })
        .subscribeToAllTables();
    })
    // A failed first connect also fires onDisconnect; keep the "can't reach" message.
    .onDisconnect((_ctx, err) => {
      if (connected) healthSet('spacetimedb', `disconnected from ${HOST}/${DB_NAME}${err ? `: ${err.message}` : ''}`, 'warn', 'DB');
      if (connected) onStatus('disconnected');
    })
    .onConnectError((_ctx, err) => {
      healthSet('spacetimedb', `can't reach ${HOST} db ${DB_NAME}: ${err.message} (wrong host/db name, or SpacetimeDB down)`, 'error', 'DB');
      onStatus(`can't reach ${HOST} (${err.message})`);
    })
    .build();
}
