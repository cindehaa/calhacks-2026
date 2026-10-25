// Which SpacetimeDB the page talks to. Dev talks to a local one, the deployed site (Vercel) to
// Maincloud; ?host=...&db=... override the defaults, so one build can point at either. Its own
// file so the Pavilion can read it without pulling in the game's bindings.
const params = new URLSearchParams(location.search);
export const HOST = params.get('host') ?? (import.meta.env.DEV ? `ws://${location.hostname}:3000` : 'https://maincloud.spacetimedb.com');
export const DB_NAME = params.get('db') ?? (import.meta.env.DEV ? 'arena' : 'calhacks-arena');

// The HTTP SQL endpoint for the same database (ws:// becomes http://).
export const SQL_URL = `${HOST.replace(/^ws/, 'http').replace(/\/$/, '')}/v1/database/${encodeURIComponent(DB_NAME)}/sql`;
