// Towers and the cold (meta/aesthetics.md, "Tower frost"). Frost climbs a tower from its base as it
// loses health, and during overtime it creeps up every tower whatever its health. The frost is a
// faceted ice crust painted into the tower's own stone shader (no extra draw calls) with an uneven,
// brightly lit edge, plus clumps of ice crystals round the foot and icicles off the crown near the
// end, all crystals drawn as one instanced mesh. A destroyed tower crumbles: low-poly chunks of stone and crown fall,
// bounce and settle as rubble round a frosted stump (one more instanced mesh).
import * as THREE from 'three';
import { DOUBLE_ELIXIR_AT, MATCH_SECONDS } from '../../shared/arena';

export const ICE = '#dbe9f4';
export const ICE_DEEP = '#9cc3e0';
const ICE_SHADE = '#6f97bd';

const RIME = 0.06; // a thin rime at the base even at full health: the night is cold
const HURT_REACH = 0.86; // a tower one hit from falling is frosted this far up
const OVERTIME_FROM = 0.12, OVERTIME_TO = 0.6; // every tower's frost line over the overtime half minute
export const ICICLES_AT = 0.7; // frost level past which icicles hang off the crown

// How far up a tower (0 base … 1 top) the frost line stands: the higher of its damage and how far
// into overtime the match is.
export function frostLevel(hp: number, maxHp: number, time = 0, playing = true): number {
  if (hp <= 0) return 0.7; // the stump
  const hurt = RIME + (HURT_REACH - RIME) * (1 - Math.min(1, Math.max(0, hp / Math.max(1, maxHp))));
  if (!playing || time < DOUBLE_ELIXIR_AT) return hurt;
  const k = Math.min(1, (time - DOUBLE_ELIXIR_AT) / (MATCH_SECONDS - DOUBLE_ELIXIR_AT));
  return Math.max(hurt, OVERTIME_FROM + (OVERTIME_TO - OVERTIME_FROM) * k);
}

// Paint the ice crust into a tower body's stone material. The body is the unit tower cylinder
// (height 2.2, centred, 8 faces); `level` is its frost uniform, 0..1 of the body's height, and
// `seed` gives each tower its own crust.
export function frostStone(mat: THREE.MeshStandardMaterial, level: { value: number }, seed: number): void {
  const s = { value: seed };
  mat.onBeforeCompile = shader => paintFrost(shader, level, s);
}

const iceRgb = new THREE.Color(ICE), midRgb = new THREE.Color(ICE_DEEP), deepRgb = new THREE.Color(ICE_SHADE);
function paintFrost(shader: THREE.WebGLProgramParametersWithUniforms, level: { value: number }, seed: { value: number }): void {
  Object.assign(shader.uniforms, { uFrost: level, uSeed: seed, uIce: { value: iceRgb }, uIceMid: { value: midRgb }, uIceDeep: { value: deepRgb } });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFrostPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFrostPos = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vFrostPos;
uniform float uFrost, uSeed;
uniform vec3 uIce, uIceMid, uIceDeep;
float frostHash(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  // The crust's edge is uneven: each of the 8 corners stands at its own height and each face
  // rises to one peak somewhere across it, so the line is a run of big crystal facets, with a
  // fine bite along it.
  float seg = atan(vFrostPos.x, vFrostPos.z) * 1.2732395 + 8.0;
  float face = mod(floor(seg), 8.0), across = fract(seg);
  float up = vFrostPos.y + 1.1, reach = uFrost * 2.2;
  float amp = clamp(reach * 0.45, 0.05, 0.32);
  float c0 = frostHash(face), c1 = frostHash(mod(face + 1.0, 8.0));
  float peakAt = 0.2 + 0.6 * frostHash(face + 20.0);
  float peak = max(c0, c1) + 0.35 + 0.5 * frostHash(face + 40.0);
  float t = across < peakAt ? across / peakAt : (1.0 - across) / (1.0 - peakAt);
  float corner = mix(c0, c1, step(peakAt, across));
  float edge = reach + amp * (mix(corner, peak, t) - 0.75) - 0.03 * abs(fract(across * 6.0) * 2.0 - 1.0);
  float aa = max(fwidth(up), 1e-4);
  float frosted = step(0.001, uFrost) * smoothstep(aa, -aa, up - edge);
  float rim = smoothstep(aa, -aa, edge - 0.08 - up);
  // Inside, the ice is a mosaic of small triangular facets, each its own shade and clarity: milky
  // facets hide the stone, clear ones let it show through tinted blue. Some facet edges carry a
  // hairline crack.
  vec2 fp = vec2(across * 0.84, up) / 0.3;
  fp.x += fp.y * 0.5;
  vec2 fc = floor(fp), ff = fract(fp);
  float upper = step(ff.x, ff.y);
  float cell = fc.x * 7.0 + fc.y * 131.0 + upper * 3.0 + face * 977.0;
  float shade = frostHash(cell), clarity = frostHash(cell + 0.5);
  float toEdge = upper > 0.5 ? min(min(ff.x, 1.0 - ff.y), (ff.y - ff.x) * 0.707) : min(min(ff.y, 1.0 - ff.x), (ff.x - ff.y) * 0.707);
  float faa = max(fwidth(toEdge), 1e-4);
  float crack = step(0.84, frostHash(cell + 0.25)) * smoothstep(0.035 + faa, 0.035 - faa, toEdge);
  vec3 ice = mix(uIceMid, uIceDeep, step(peakAt, across) * 0.6 + (shade - 0.5) * 0.5);
  ice = mix(ice, uIce, step(0.8, shade) * 0.45);
  vec3 seen = mix(diffuseColor.rgb * vec3(0.7, 0.95, 1.35), ice, 0.5 + 0.42 * step(0.35, clarity));
  seen = mix(seen, uIce, crack * 0.75);
  // Glints: a few tiny bright facets scattered through the ice.
  vec2 gp = vec2(across * 0.84, up) / 0.05;
  float glint = step(0.975, frostHash(floor(gp.x) * 53.0 + floor(gp.y) * 389.0 + face * 11.0)) * (1.0 - rim);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(seen, uIce, rim), frosted);`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.2, frosted);')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // Light seems to pass through the ice: it glows most where you see it edge-on.
  float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += frosted * (mix(uIceMid * (0.18 + 0.12 * step(0.35, clarity)), uIce * 0.55, rim) + uIce * (fres * 0.45 + glint * 0.9 + crack * 0.2));`);
}

// The crystals' translucent glow, as in the crust: brighter edge-on.
function glowIce(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.86, 0.91, 0.96) * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0) * 0.6;`);
}

// Ice crystals in clumps round each tower's foot and icicles off its crown, every tower's in one
// draw call. Call begin(), add() each tower, then end().
export class TowerIce {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, max = 160) {
    // A six-sided crystal: a prism with a pointed tip, standing on its base, tip at y = 1.
    const geo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.68), new THREE.Vector2(0, 1)], 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: ICE_DEEP, emissiveIntensity: 0.3, roughness: 0.15, flatShading: true, transparent: true, opacity: 0.78 });
    mat.onBeforeCompile = glowIce;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    // Each crystal its own tint, from frost white to deep ice.
    const tint = new THREE.Color(), tints = [ICE, '#c4dbee', ICE_DEEP, '#b4d2ea', ICE_SHADE];
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, tint.set(tints[Math.floor(hash(i, 3) * tints.length)]));
    this.mesh.frustumCulled = false; // instances spread over the whole board
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin(): void { this.n = 0; }

  // A tower standing at `at` (its base centre), `r` tiles wide with a body `h` tiles tall.
  // `seed` keeps each tower's crystals in the same places frame to frame.
  add(at: THREE.Vector3, r: number, h: number, frost: number, seed: number, stump = false): void {
    if (frost <= 0) return;
    // Three clumps (two on a stump), each a tall crystal with smaller ones leaning off it.
    const clumps = stump ? 2 : 3;
    for (let c = 0; c < clumps; c++) {
      const a = ((c + hash(seed, c) * 0.7) / clumps) * Math.PI * 2;
      const big = h * (0.16 + frost * 0.44) * (0.75 + hash(seed, c + 9) * 0.5) * (stump ? 0.7 : 1);
      for (let k = 0; k < 3; k++) {
        const spread = (k - 1) * 0.22, aa = a + spread / r;
        const tall = big * (k === 1 ? 1 : 0.45 + hash(seed, c * 3 + k + 30) * 0.25);
        this.p.set(at.x + Math.sin(aa) * r * 1.18, at.y - 0.04, at.z + Math.cos(aa) * r * 1.18);
        // Lean out from the wall, the side crystals splayed further.
        this.e.set(0.2 + Math.abs(spread) * 1.6, a + spread * 2.2, 0, 'YXZ');
        this.put(tall * 0.22 + r * 0.05, tall);
      }
    }
    if (stump || frost < ICICLES_AT) return;
    // Icicles hang from the crown's flared rim, longer as the frost climbs.
    const n = 7, rim = h * (2.7 / 2.2); // the crown's top edge
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const len = (0.28 + (frost - ICICLES_AT) * 2) * (0.6 + hash(seed, i + 40) * 0.6) * Math.max(1, r * 0.8);
      this.p.set(at.x + Math.sin(a) * r * 1.1, at.y + rim, at.z + Math.cos(a) * r * 1.1);
      this.e.set(Math.PI, a, 0, 'YXZ');
      this.put(r * 0.07, len);
    }
  }

  private put(wide: number, tall: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromEuler(this.e);
    this.s.set(wide, tall, wide);
    this.mesh.setMatrixAt(this.n++, this.m.compose(this.p, this.q, this.s));
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Chunk { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; wx: number; wy: number; wz: number; size: number; rest: boolean }
interface Heap { chunks: Chunk[]; first: number; cx: number; cz: number; stumpR: number; stumpTop: number }

const GRAVITY = 20; // tiles/s²: snappier than real, so the fall reads in under a second

// Destroyed towers' rubble: chunks that fly off, fall, bounce and settle round the stump.
export class Rubble {
  readonly mesh: THREE.InstancedMesh;
  private heaps = new Map<unknown, Heap>();
  private free = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, private max = 160) {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  // Break the tower at (cx, cz) apart. `still` (reduced motion) lays the rubble down straight away.
  crumble(key: unknown, cx: number, cz: number, r: number, h: number, team: string, still: boolean, seed: number): void {
    if (this.heaps.has(key)) return;
    const stumpTop = h * 0.25;
    const heap: Heap = { chunks: [], first: this.free, cx, cz, stumpR: r * 1.1, stumpTop };
    const stone = 16, crown = 6, ice = 5;
    const teamRgb = new THREE.Color(team), dark = teamRgb.clone().multiplyScalar(0.6);
    for (let i = 0; i < stone + crown + ice && this.free < this.max; i++) {
      const isCrown = i >= stone && i < stone + crown, isIce = i >= stone + crown;
      const a = hash(seed, i) * Math.PI * 2, d = hash(seed, i + 50) * r * 0.9;
      const y = isCrown ? h * (1.05 + hash(seed, i + 70) * 0.15) : stumpTop + hash(seed, i + 70) * (h - stumpTop);
      const speed = 1.6 + hash(seed, i + 90) * 2.6;
      const size = r * (isCrown ? 0.26 + hash(seed, i + 110) * 0.14 : isIce ? 0.12 + hash(seed, i + 110) * 0.08 : 0.18 + hash(seed, i + 110) * 0.2);
      heap.chunks.push({
        x: cx + Math.sin(a) * d, y, z: cz + Math.cos(a) * d,
        vx: Math.sin(a) * speed, vy: 1 + hash(seed, i + 130) * 3, vz: Math.cos(a) * speed,
        rx: hash(seed, i + 150) * 6, ry: hash(seed, i + 170) * 6, rz: 0,
        wx: (hash(seed, i + 190) - 0.5) * 14, wy: 0, wz: (hash(seed, i + 210) - 0.5) * 14,
        size, rest: false,
      });
      // Stone in three shades (a touch lighter than the walls, so rubble reads on the dark ground),
      // crown chunks in the team colour, lit or shadowed, and a few frozen lumps.
      const shade = [0x4a5174, 0x3a4064, 0x2b3150][i % 3];
      this.mesh.setColorAt(this.free++, isCrown ? (i % 2 ? teamRgb : dark) : this.c.set(isIce ? (i % 2 ? ICE : ICE_DEEP) : shade));
    }
    this.heaps.set(key, heap);
    if (still) for (let k = 0; k < 240 && heap.chunks.some(c => !c.rest); k++) this.stepHeap(heap, 1 / 60);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.free;
  }

  // Drop every heap (a tower stood back up: a rematch or a new match). Rubble is rebuilt from the
  // heaps still wanted, so slots don't leak.
  clear(keep: (key: unknown) => boolean): void {
    let gone = false;
    for (const k of this.heaps.keys()) if (!keep(k)) { this.heaps.delete(k); gone = true; }
    if (!gone) return;
    // Compact: the remaining heaps keep their chunks but move down to the front of the buffer.
    const old = this.mesh.instanceColor?.array.slice();
    this.free = 0;
    for (const h of this.heaps.values()) {
      for (let i = 0; i < h.chunks.length; i++) {
        if (old) this.mesh.setColorAt(this.free + i, this.c.fromArray(old, (h.first + i) * 3));
      }
      h.first = this.free;
      this.free += h.chunks.length;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.free;
  }

  update(dt: number): void {
    if (!this.heaps.size) return;
    for (const h of this.heaps.values()) {
      if (dt > 0) this.stepHeap(h, dt);
      h.chunks.forEach((c, i) => {
        this.p.set(c.x, c.y, c.z);
        this.q.setFromEuler(this.e.set(c.rx, c.ry, c.rz));
        this.s.set(c.size, c.size * 0.8, c.size);
        this.mesh.setMatrixAt(h.first + i, this.m.compose(this.p, this.q, this.s));
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private stepHeap(h: Heap, dt: number): void {
    for (const c of h.chunks) {
      if (c.rest) continue;
      c.vy -= GRAVITY * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
      // The floor is the ground, or the stump's broken top for chunks that land on it.
      const onStump = Math.hypot(c.x - h.cx, c.z - h.cz) < h.stumpR;
      const floor = (onStump ? h.stumpTop : 0) + c.size * 0.55;
      if (c.y > floor) continue;
      c.y = floor;
      if (Math.abs(c.vy) < 1.4) {
        c.rest = true;
        continue;
      }
      c.vy = -c.vy * 0.3;
      c.vx *= 0.55; c.vz *= 0.55;
      c.wx *= 0.5; c.wz *= 0.5;
    }
  }
}

// A stable 0..1 number per (seed, i).
function hash(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
