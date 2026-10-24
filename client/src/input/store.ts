// Input settings kept between visits. localStorage can throw (private windows, blocked site
// data); these are a convenience.

export function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export const KEYS = { prefs: 'arena.input.prefs' };
