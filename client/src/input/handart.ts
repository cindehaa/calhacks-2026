// The two hand diagrams, as inline SVG, after a recording of the real motions: aim with an "L"
// (palm to the camera, index up, thumb straight out to the side, the other fingers loosely bent)
// and pinch by folding the thumb across the palm onto the curling middle finger, the index still
// up, then opening back to the L. Drawn like the virtual hand (handview.ts): frost bones, dark
// joints, amber fingertips. The pinch closes and opens on a loop and the pointing hand drifts;
// under reduced motion both hold still (the pinch shown closed).
type P = [number, number];
type Pose = P[]; // the 21 landmarks, in a 100 × 120 box, as you see your hand on screen

// The L: index up, thumb out to the right, middle loosely bent, ring and pinky as short knuckle
// stubs (DIP and tip sit on PIP).
const stub = (k: P, pip: P): P[] => [k, pip, pip, pip];
const L: Pose = [
  [48, 112], [60, 98], [70, 90], [81, 86], [92, 84],
  [59, 62], [60, 44], [61, 31], [62, 18],
  [48, 60], [46, 49], [47, 43], [50, 41],
  ...stub([38, 63], [35, 54]), ...stub([30, 69], [26, 61]),
];
const POINT = L;
const with_ = (base: Pose, moves: Record<number, P>): Pose => base.map((p, i) => moves[i] ?? p);
const PINCH_OPEN = L;
const PINCH_SHUT = with_(L, { 2: [66, 92], 3: [62, 80], 4: [57, 69], 10: [47, 50], 11: [52, 57], 12: [55, 64] });
const TOUCH: P = [56, 66]; // where thumb and middle finger meet

const CHAINS = [[13, 14], [17, 18], [9, 10, 11, 12], [0, 1, 2, 3, 4], [5, 6, 7, 8]]; // index last, on top
const PALM = [0, 1, 5, 9, 13, 17];

// The aiming L, for the setup preview's ghost hand (where to hold your hand): landmarks in the
// 100 × 120 box, the bone chains and the palm.
export const GHOST = { pose: L as readonly P[], chains: CHAINS, palm: PALM };
const TIPS = [4, 8, 12, 14, 18];
const JOINTS = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 17];

const BONE = '#9cc3e0', JOINT = '#1a2045', TIP = '#dbe9f4', AIM = '#ffb02e', FLASH = '#fff1c4';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pts = (pose: Pose, idx: number[]) => idx.map(i => pose[i].join(',')).join(' ');

// One hand. With `to`, it moves to that pose and back on a loop (keyTimes: open, shut, shut, open).
function hand(from: Pose, to: Pose | null, dur: number, hot: number[]): string {
  const KT = 'keyTimes="0;.3;.55;.8;1"';
  const anim = (attr: string, a: string, b: string) =>
    to ? `<animate attributeName="${attr}" values="${a};${b};${b};${a};${a}" ${KT} dur="${dur}s" repeatCount="indefinite"/>` : '';
  const poly = (idx: number[], extra: string) =>
    `<polyline points="${pts(from, idx)}" ${extra}>${anim('points', pts(from, idx), to ? pts(to, idx) : '')}</polyline>`;
  const dot = (i: number, r: number, fill: string) => {
    const [x, y] = from[i], [tx, ty] = to?.[i] ?? from[i];
    const moves = to && (x !== tx || y !== ty);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}">${moves ? anim('cx', `${x}`, `${tx}`) + anim('cy', `${y}`, `${ty}`) : ''}</circle>`;
  };
  return [
    `<polygon points="${pts(from, PALM)}" fill="${BONE}" fill-opacity=".16" stroke="${BONE}" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round">${anim('points', pts(from, PALM), to ? pts(to, PALM) : '')}</polygon>`,
    ...CHAINS.map((c, k) => poly(c, `fill="none" stroke="${k < 2 ? '#7f9fbc' : BONE}" stroke-width="${k < 2 ? 4.5 : 5.5}" stroke-linecap="round" stroke-linejoin="round"`)),
    ...JOINTS.map(i => dot(i, 2, JOINT)),
    ...TIPS.map(i => dot(i, hot.includes(i) ? 4.4 : 3, hot.includes(i) ? AIM : TIP)),
  ].join('');
}

const svg = (body: string, label: string) =>
  `<svg viewBox="0 0 100 120" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

// Point to aim: the hand drifts and the fingertip leads, with arrows round it.
export function pointArt(animate = !reduced()): string {
  const arrows = [[62, 5, 0], [75, 18, 90], [49, 18, 270]] // not down: the finger is there
    .map(([x, y, r]) => `<path d="M-4,2 L0,-2 L4,2" transform="translate(${x},${y}) rotate(${r})" fill="none" stroke="${AIM}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`)
    .join('');
  const drift = animate
    ? '<animateTransform attributeName="transform" type="translate" values="0 0;8 -3;-7 4;0 0" keyTimes="0;.35;.7;1" dur="3.2s" repeatCount="indefinite"/>'
    : '';
  return svg(`<g>${drift}${hand(POINT, null, 0, [8])}${arrows}</g>`, 'Point with your index finger, thumb out');
}

// Pinch to click: thumb tip to middle fingertip while the index keeps pointing, a flash where
// they touch.
export function pinchArt(animate = !reduced()): string {
  const [cx, cy] = TOUCH;
  const flash = animate
    ? `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${FLASH}" stroke-width="2" opacity="0"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.28;.32;.55;1" dur="2.4s" repeatCount="indefinite"/><animate attributeName="r" values="4;4;5;12;12" keyTimes="0;.28;.32;.55;1" dur="2.4s" repeatCount="indefinite"/></circle>`
    : `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${FLASH}" stroke-width="2" opacity=".8"/>`;
  return svg(
    animate ? hand(PINCH_OPEN, PINCH_SHUT, 2.4, [4, 12]) + flash : hand(PINCH_SHUT, null, 0, [4, 12]) + flash,
    'Touch your thumb to your middle finger',
  );
}

// Say a troop: a frost speech bubble with an amber voice level bouncing inside, the same look as
// the hands. Holds still under reduced motion.
export function sayArt(animate = !reduced()): string {
  const H = [14, 26, 36, 22, 30, 16]; // resting bar heights
  const bars = H.map((h, i) => {
    const x = 26 + i * 9.6, lo = Math.max(6, h * 0.35);
    const anim = animate
      ? `<animate attributeName="height" values="${lo};${h};${lo + 4};${h * 0.8};${lo}" dur="${1.1 + (i % 3) * 0.17}s" begin="${-i * 0.23}s" repeatCount="indefinite"/><animate attributeName="y" values="${56 - lo / 2};${56 - h / 2};${56 - (lo + 4) / 2};${56 - h * 0.4};${56 - lo / 2}" dur="${1.1 + (i % 3) * 0.17}s" begin="${-i * 0.23}s" repeatCount="indefinite"/>`
      : '';
    return `<rect x="${x - 2.5}" y="${56 - h / 2}" width="5" height="${h}" rx="2.5" fill="${AIM}">${anim}</rect>`;
  }).join('');
  const bubble = `<path d="M22,24 H78 Q90,24 90,36 V76 Q90,88 78,88 H40 L24,104 L27,88 H22 Q10,88 10,76 V36 Q10,24 22,24 Z" fill="${BONE}" fill-opacity=".16" stroke="${BONE}" stroke-opacity=".85" stroke-width="4" stroke-linejoin="round"/>`;
  return svg(bubble + bars, 'Say the troop out loud');
}

// The whole move on a loop, for the setup screen, the how-to card and the home screen's "How it
// works": pinch, a speech bubble while it's held, the hand carries it across, opens, and a troop
// drops where it let go. About 6 s. Under reduced motion, one still frame: pinched, talking.
export function loopArt(animate = !reduced()): string {
  const DUR = 6;
  //                 open   shut          carried                open
  const KT = '0;.12;.2;.55;.72;.78;1';
  const seq = [PINCH_OPEN, PINCH_OPEN, PINCH_SHUT, PINCH_SHUT, PINCH_SHUT, PINCH_OPEN, PINCH_OPEN];
  const anim = (attr: string, vals: string[]) =>
    `<animate attributeName="${attr}" values="${vals.join(';')}" keyTimes="${KT}" dur="${DUR}s" repeatCount="indefinite"/>`;
  const poly = (idx: number[], extra: string) => animate
    ? `<polyline points="${pts(PINCH_OPEN, idx)}" ${extra}>${anim('points', seq.map(p => pts(p, idx)))}</polyline>`
    : `<polyline points="${pts(PINCH_SHUT, idx)}" ${extra}/>`;
  const dot = (i: number, r: number, fill: string) => {
    const still = PINCH_SHUT[i];
    if (!animate) return `<circle cx="${still[0]}" cy="${still[1]}" r="${r}" fill="${fill}"/>`;
    return `<circle cx="${PINCH_OPEN[i][0]}" cy="${PINCH_OPEN[i][1]}" r="${r}" fill="${fill}">${anim('cx', seq.map(p => `${p[i][0]}`))}${anim('cy', seq.map(p => `${p[i][1]}`))}</circle>`;
  };
  const palm = animate
    ? `<polygon points="${pts(PINCH_OPEN, PALM)}" fill="${BONE}" fill-opacity=".16" stroke="${BONE}" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round">${anim('points', seq.map(p => pts(p, PALM)))}</polygon>`
    : `<polygon points="${pts(PINCH_SHUT, PALM)}" fill="${BONE}" fill-opacity=".16" stroke="${BONE}" stroke-opacity=".7" stroke-width="4" stroke-linejoin="round"/>`;
  const handBody = [
    palm,
    ...CHAINS.map((c, k) => poly(c, `fill="none" stroke="${k < 2 ? '#7f9fbc' : BONE}" stroke-width="${k < 2 ? 4.5 : 5.5}" stroke-linecap="round" stroke-linejoin="round"`)),
    ...JOINTS.map(i => dot(i, 2, JOINT)),
    ...TIPS.map(i => dot(i, [4, 12].includes(i) ? 4.4 : 3, [4, 12].includes(i) ? AIM : TIP)),
  ].join('');
  // The hand slides right while the pinch is held, and back while it's hidden by the fade.
  const carry = animate
    ? `<animateTransform attributeName="transform" type="translate" values="10 20;10 20;10 20;10 20;100 20;100 20;10 20" keyTimes="${KT}" dur="${DUR}s" repeatCount="indefinite"/>`
    : '';
  const show = (vals: string) => animate ? `<animate attributeName="opacity" values="${vals}" keyTimes="${KT}" dur="${DUR}s" repeatCount="indefinite"/>` : '';
  // The words: a bubble over the hand from just after the pinch until it lets go.
  const bars = [10, 18, 24, 14, 20].map((h, i) => `<rect x="${-14 + i * 7}" y="${-h / 2}" width="4" height="${h}" rx="2" fill="${AIM}"/>`).join('');
  const bubble = `<g opacity="${animate ? 0 : 1}">${show('0;0;0;1;1;0;0')}<path d="M-24,-16 H24 Q30,-16 30,-10 V10 Q30,16 24,16 H0 L-8,24 L-7,16 H-24 Q-30,16 -30,10 V-10 Q-30,-16 -24,-16 Z" fill="#171b2e" fill-opacity=".85" stroke="${BONE}" stroke-width="2.5"/>${bars}</g>`;
  // The troop: lands where the hand let go, with a ring going out.
  const troop = animate
    ? `<g transform="translate(166,96)" opacity="0">${show('0;0;0;0;0;1;1')}<circle r="6" fill="none" stroke="${FLASH}" stroke-width="2"><animate attributeName="r" values="6;6;6;6;6;6;22" keyTimes="${KT}" dur="${DUR}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;0;0;0;1;0" keyTimes="${KT}" dur="${DUR}s" repeatCount="indefinite"/></circle><path d="M0,-11 L9,0 L0,11 L-9,0 Z" fill="${AIM}" stroke="#1a2045" stroke-width="2"/></g>`
    : '';
  const ground = `<path d="M8,110 H192" stroke="${BONE}" stroke-opacity=".25" stroke-width="2" stroke-dasharray="4 5"/>`;
  return `<svg viewBox="0 0 200 120" role="img" aria-label="Pinch and hold, say the troop, move, and let go to place it" xmlns="http://www.w3.org/2000/svg">${ground}${troop}<g transform="translate(10 20)">${carry}<g transform="scale(.8)">${handBody}</g><g transform="translate(44 -4)">${bubble}</g></g></svg>`;
}
