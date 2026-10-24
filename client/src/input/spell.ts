// Spelling a room code out loud: "A B C D", "bee see", "alpha bravo" or a run the recogniser
// joined into one word ("ABCD") all become letters. Filler around them ("the code is") is skipped.

const SAID: Record<string, string> = {
  a: 'a', ay: 'a', eh: 'a', hey: 'a',
  b: 'b', be: 'b', bee: 'b', bea: 'b',
  c: 'c', see: 'c', sea: 'c', cee: 'c', si: 'c',
  d: 'd', dee: 'd', de: 'd',
  e: 'e', ee: 'e',
  f: 'f', ef: 'f', eff: 'f',
  g: 'g', gee: 'g', jee: 'g',
  h: 'h', aitch: 'h', haitch: 'h',
  i: 'i', eye: 'i', aye: 'i',
  j: 'j', jay: 'j',
  k: 'k', kay: 'k', cay: 'k',
  l: 'l', el: 'l', ell: 'l', elle: 'l',
  m: 'm', em: 'm',
  n: 'n', en: 'n',
  o: 'o', oh: 'o', owe: 'o',
  p: 'p', pee: 'p', pea: 'p',
  q: 'q', queue: 'q', cue: 'q', kyu: 'q',
  r: 'r', are: 'r', ar: 'r',
  s: 's', es: 's', ess: 's',
  t: 't', tee: 't', tea: 't',
  u: 'u', you: 'u', yu: 'u',
  v: 'v', vee: 'v',
  w: 'w',
  x: 'x', ex: 'x',
  y: 'y', why: 'y',
  z: 'z', zee: 'z', zed: 'z',
  // The phonetic alphabet
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g',
  hotel: 'h', india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n',
  oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v',
  whiskey: 'w', whisky: 'w', xray: 'x', yankee: 'y', zulu: 'z',
};

const FILLER = new Set(['the', 'code', 'is', 'its', 'room', 'letter', 'letters', 'and', 'then', 'um', 'uh', 'umm', 'capital', 'my', 'join', 'okay', 'ok']);

// The letters spelled in text, uppercase.
export function spokenLetters(text: string): string {
  const words = text.toLowerCase().replace(/x-ray/g, 'xray').replace(/['’]/g, '').split(/[^a-z]+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'double' && (words[i + 1] === 'u' || words[i + 1] === 'you')) {
      out += 'w';
      i++;
    } else if (SAID[w]) out += SAID[w];
    else if (!FILLER.has(w) && w.length <= 4) out += w; // letters run together: "abcd"
  }
  return out.toUpperCase();
}
