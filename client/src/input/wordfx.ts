// What you say, made physical: element words light up in the live transcript as you speak ("fire"
// glows orange, "ice" frosts over), a ring round the cursor breathes with the mic level, firing
// pulls the words into an orb that drops onto the spot, and a cancel crumples them up. Drawn in
// screen px over the board by draw.ts; a keyword match in the browser, nothing sent anywhere.

export interface ElementLook { color: string; glow: string; frost?: boolean }

// First match wins, so "fire" beats "light" in "firelight".
const ELEMENT_WORDS: [RegExp, ElementLook][] = [
  [/^(fire|fiery|flames?|flaming|blaze|blazing|burn(ing|s)?|lava|magma|inferno|ember|embers|phoenix|dragon)$/, { color: '#ffb35c', glow: 'rgba(255,120,30,0.95)' }],
  [/^(ice|icy|frost|frosty|frozen|freeze|freezing|snow|snowy|blizzard|glacier|glacial|cold|icicles?|yeti)$/, { color: '#cdf2ff', glow: 'rgba(120,210,255,0.95)', frost: true }],
  [/^(lightning|thunder|storm|stormy|electric|electricity|spark|sparks|sparky|shock|volt|zap|tesla)$/, { color: '#fff27a', glow: 'rgba(255,235,90,0.95)' }],
  [/^(poison|poisonous|toxic|venom|venomous|acid|acidic|plague|slime|rot|rotting)$/, { color: '#a8ff7a', glow: 'rgba(110,230,70,0.9)' }],
  [/^(holy|angel|angelic|divine|sacred|light|radiant|sun|solar|heavenly|paladin)$/, { color: '#fff1c2', glow: 'rgba(255,225,140,0.95)' }],
  [/^(shadow|shadows|dark|darkness|void|ghost|ghostly|spectral|cursed|necro|undead|death)$/, { color: '#cdb0ff', glow: 'rgba(150,100,255,0.9)' }],
];

export function elementOf(word: string): ElementLook | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  for (const [re, look] of ELEMENT_WORDS) if (re.test(w)) return look;
  return null;
}

const FONT = "700 13px 'Alegreya Sans', system-ui, sans-serif";

// The live transcript pill, with element words lit. Same box as draw.ts's plain pill.
export function wordsPill(g: CanvasRenderingContext2D, s: string, x: number, y: number, ink: string, now: number): void {
  g.save();
  g.font = FONT;
  const w = g.measureText(s).width + 16;
  g.fillStyle = 'rgba(13,16,32,0.85)';
  g.beginPath();
  g.roundRect(x - w / 2, y - 15, w, 22, 11);
  g.fill();
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  let cx = x - w / 2 + 8;
  for (const part of s.split(/(\s+)/)) {
    const pw = g.measureText(part).width;
    const look = /\S/.test(part) ? elementOf(part) : null;
    if (look) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 160 + cx);
      g.shadowColor = look.glow;
      g.shadowBlur = 10 * pulse;
      g.fillStyle = look.color;
      g.fillText(part, cx, y);
      g.fillText(part, cx, y); // twice: a stronger glow
      g.shadowBlur = 0;
      if (look.frost) frost(g, cx, y, pw, now);
    } else {
      g.fillStyle = ink;
      g.fillText(part, cx, y);
    }
    cx += pw;
  }
  g.restore();
}

// Rime on an ice word: a few tiny glints along its top edge that come and go.
function frost(g: CanvasRenderingContext2D, x: number, y: number, w: number, now: number): void {
  g.fillStyle = '#ffffff';
  const n = Math.max(2, Math.round(w / 9));
  for (let i = 0; i < n; i++) {
    const k = 0.5 + 0.5 * Math.sin(now / 210 + i * 2.3 + x);
    if (k < 0.45) continue;
    const px = x + ((i + 0.5) / n) * w, py = y - 10 + Math.sin(i * 1.7) * 1.5, s = 1.6 * k;
    g.globalAlpha = k;
    g.beginPath();
    g.moveTo(px, py - s * 1.6); g.lineTo(px + s * 0.5, py); g.lineTo(px, py + s * 1.6); g.lineTo(px - s * 0.5, py); g.closePath();
    g.moveTo(px - s * 1.6, py); g.lineTo(px, py + s * 0.5); g.lineTo(px + s * 1.6, py); g.lineTo(px, py - s * 0.5); g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}

// A ring round the cursor that swells and brightens with the mic level (dB, about −90 to −10).
export function micRing(g: CanvasRenderingContext2D, x: number, y: number, db: number, speaking: boolean): void {
  const k = Math.max(0, Math.min(1, (db + 70) / 50));
  g.save();
  g.strokeStyle = speaking ? `rgba(197,108,240,${0.45 + 0.5 * k})` : `rgba(142,150,179,${0.25 + 0.3 * k})`;
  g.lineWidth = 2 + 2.5 * k;
  g.beginPath();
  g.arc(x, y, 20 + 14 * k, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// On fire: the words' letters gather into an orb above the cursor, which drops onto the spot.
// On a cancel: the words crumple into a ball and fall away. a is 0..1 through the flash.
export function wordsFlash(g: CanvasRenderingContext2D, kind: 'deploy' | 'cancel', words: string, x: number, y: number, a: number): void {
  if (!words) return;
  g.save();
  g.font = FONT;
  g.textAlign = 'center';
  const s = `“${words.length > 40 ? '…' + words.slice(-40) : words}”`;
  const y0 = y - 34;
  if (kind === 'deploy') {
    // 0–0.35: the words squeeze into the orb; 0.35–0.6: the orb drops to the spot.
    if (a < 0.35) {
      const k = a / 0.35, sx = Math.max(0.02, 1 - k);
      g.globalAlpha = 1 - k * 0.6;
      g.translate(x, y0);
      g.scale(sx, 1 - 0.3 * k);
      g.fillStyle = '#e8ebf5';
      g.fillText(s, 0, 0);
    }
    g.restore();
    g.save();
    const k = Math.max(0, Math.min(1, (a - 0.2) / 0.4));
    if (k <= 0 || k >= 1) { g.restore(); return }
    const oy = y0 - 4 + (y - y0 + 4) * k * k, r = 5 + 5 * Math.sin(Math.min(1, a / 0.35) * Math.PI / 2) * (1 - k * 0.5);
    const glow = g.createRadialGradient(x, oy, 0, x, oy, r * 3);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.3, 'rgba(255,138,61,0.85)'); // the orb carries the embers: same amber as the motes
    glow.addColorStop(1, 'rgba(255,138,61,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(x, oy, r * 3, 0, Math.PI * 2); g.fill();
  } else {
    // Crumple: squash and spin into a grey ball, then drop and fade.
    const k = Math.min(1, a / 0.4), fall = Math.max(0, a - 0.4) / 0.6;
    g.globalAlpha = 1 - fall;
    g.translate(x, y0 + 60 * fall * fall);
    g.rotate(k * 2.4 + fall * 3);
    if (k < 1) {
      g.scale(1 - 0.85 * k, 1 - 0.6 * k);
      g.fillStyle = '#8e96b3';
      g.fillText(s, 0, 4);
    }
    if (k > 0.5) {
      g.globalAlpha *= (k - 0.5) * 2;
      g.fillStyle = '#c9cfe3';
      g.strokeStyle = '#5d6278';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 9; i++) { // a lumpy paper ball
        const ang = (i / 9) * Math.PI * 2, rr = 8 + (i % 3) * 1.6;
        if (i === 0) g.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); else g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-4, -3); g.lineTo(2, 1); g.lineTo(-1, 5); g.moveTo(3, -5); g.lineTo(1, 0); g.stroke();
    }
  }
  g.restore();
}
