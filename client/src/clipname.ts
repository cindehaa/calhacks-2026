// The file name a saved or shared highlight clip gets (clipsui.ts).
// artifice-gameplay-<the clip's moment>, e.g. artifice-gameplay-swiftie-squad-summoned.webm. Two
// clips with the same moment get their number on the end so neither overwrites the other.
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
export function fileName(c: { label: string; ext: string }, i: number, all: readonly ({ label: string } | null)[] = []): string {
  const s = slug(c.label) || `highlight-${i + 1}`;
  const twin = !!slug(c.label) && all.some((o, j) => j !== i && o && slug(o.label) === slug(c.label));
  return `artifice-gameplay-${s}${twin ? `-${i + 1}` : ''}.${c.ext}`;
}
