// The Pavilion's data, with no DOM: reading the pavilion table's rows out of an HTTP SQL answer,
// which of them are yours, and the counts the screen shows. Kept apart so it can be tested.

export interface Exhibit {
  id: number;
  at: number; // ms since the epoch
  owner: string; // identity hex
  kind: 'troop' | 'spell';
  name: string;
  description: string;
  element: string;
  flavor: string;
  cost: number;
  spriteUrl: string;
}

// The SQL endpoint answers with one result per statement: a schema (column names, snake_case) and
// rows as arrays in that order. Unknown columns are ignored and missing ones read as empty, so a
// later column added to the table doesn't break an older page.
interface SqlResult { schema?: { elements?: { name?: { some?: string } }[] }; rows?: unknown[][] }

export function parseExhibits(answer: unknown): Exhibit[] {
  const res = (Array.isArray(answer) ? answer[0] : null) as SqlResult | null;
  const cols = res?.schema?.elements?.map(e => e.name?.some ?? '') ?? [];
  const at = (name: string) => cols.indexOf(name);
  const ix = {
    id: at('id'), at: at('at'), owner: at('owner'), kind: at('kind'), name: at('name'), description: at('description'),
    element: at('element'), flavor: at('flavor'), cost: at('cost'), spriteUrl: at('sprite_url'),
  };
  const str = (row: unknown[], i: number) => (i >= 0 && typeof row[i] === 'string' ? (row[i] as string) : '');
  const num = (row: unknown[], i: number) => (i >= 0 ? Number(row[i]) || 0 : 0);
  return (res?.rows ?? []).filter(Array.isArray).map((row): Exhibit => ({
    id: num(row, ix.id),
    at: num(row, ix.at),
    owner: str(row, ix.owner).toLowerCase(),
    kind: str(row, ix.kind) === 'spell' ? 'spell' : 'troop',
    name: str(row, ix.name) || str(row, ix.description) || 'Unnamed',
    description: str(row, ix.description),
    element: str(row, ix.element),
    flavor: str(row, ix.flavor),
    cost: num(row, ix.cost),
    spriteUrl: str(row, ix.spriteUrl),
  }));
}

// Newest first. The id breaks ties, since rows logged in one transaction share a time.
export const newestFirst = (a: Exhibit, b: Exhibit) => b.at - a.at || b.id - a.id;

export interface Tally {
  troops: number;
  spells: number;
  yours: number; // troops and spells
  latestYours: Exhibit | null;
}

export function tally(all: readonly Exhibit[], mine: ReadonlySet<string>): Tally {
  let troops = 0, spells = 0, yours = 0;
  let latestYours: Exhibit | null = null;
  for (const e of all) {
    if (e.kind === 'spell') spells++;
    else troops++;
    if (!mine.has(e.owner)) continue;
    yours++;
    // A troop beats a spell for the spotlight: it has art to show.
    const better = !latestYours || (e.kind === 'troop' && latestYours.kind === 'spell') || (e.kind === latestYours.kind && newestFirst(e, latestYours) < 0);
    if (better) latestYours = e;
  }
  return { troops, spells, yours, latestYours };
}

// Troops summoned more than once (every "fire dragon" of the weekend) share one pile on the wall,
// keyed by kind and name, rather than repeating the same card down it. A pile shows its newest
// summon, with the newest art among them in case that one's failed, and sits where its newest is.
export interface Pile {
  key: string;
  top: Exhibit; // the newest in the pile
  art: string; // the newest sprite in the pile; '' if none has one
  count: number;
  mine: boolean; // any of them yours
}

export const pileKey = (e: Exhibit) => `${e.kind}:${e.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;

// `rows` newest first; the piles come out in the same order.
export function piles(rows: readonly Exhibit[], mine: ReadonlySet<string>): Pile[] {
  const by = new Map<string, Pile>();
  for (const e of rows) {
    const key = pileKey(e);
    const p = by.get(key);
    if (!p) {
      by.set(key, { key, top: e, art: e.spriteUrl, count: 1, mine: mine.has(e.owner) });
      continue;
    }
    p.count++;
    if (!p.art) p.art = e.spriteUrl;
    if (mine.has(e.owner)) p.mine = true;
  }
  return [...by.values()];
}

// Every identity this browser has played as. sessionStorage gives each tab its own player, so
// "summoned by you" is the union of them, kept in localStorage; a Pavilion opened in a second tab
// still finds the troop the first tab just summoned.
const IDS_KEY = 'arena.identities';
const IDS_MAX = 50;

export function myIdentities(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(IDS_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((s): s is string => typeof s === 'string').map(s => s.toLowerCase()) : []);
  } catch {
    return new Set(); // private mode or junk
  }
}

export function rememberIdentity(hex: string): void {
  try {
    const ids = [...myIdentities()].filter(id => id !== hex.toLowerCase());
    ids.push(hex.toLowerCase());
    localStorage.setItem(IDS_KEY, JSON.stringify(ids.slice(-IDS_MAX)));
  } catch { /* private mode */ }
}
