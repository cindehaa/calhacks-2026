// What stays out of the Pavilion, the public showcase of every summon. The troop still fights; it
// just isn't put on display. Real attacks, armed conflicts and the people tied to them.
const OFF_LIMITS = new RegExp(
  '\\b(' + [
    '9\\s*/\\s*11', 'nine\\s*eleven', 'sept(ember)?\\.?\\s*11(th)?', 'twin\\s*towers?', 'world\\s*trade\\s*center',
    'terroris[mt]s?', 'suicide\\s*bomb(er|ers|ing)?', '(school|mass)\\s*shoot(er|ers|ing)?', 'columbine',
    'osama', 'bin\\s*laden', 'al[\\s-]*qaeda', 'isis', 'taliban', 'hamas', 'hezbollah',
    'netanyahu', 'idf', 'gaza', 'israeli?s?', 'palestin(e|ian|ians)',
    'hitler', 'nazis?', 'holocaust', 'auschwitz', 'kkk', 'ku\\s*klux', 'genocide',
  ].join('|') + ')\\b',
  'i'
);

// True when any of the texts (what was said, the name, the flavor) names one of them.
export function offLimits(...texts: string[]): boolean {
  return texts.some(s => OFF_LIMITS.test(s));
}
