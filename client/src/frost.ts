// Towers and the cold (meta/aesthetics.md, "Tower frost"). Frost climbs a tower from its base as it
// loses health, and during overtime it creeps up every tower whatever its health. The look follows
// how ice really builds on a stone tower on a freezing night:
// - Cold air pools at the ground, so the ice is a shell that is thickest at the foot (flaring onto
//   the ground) and thins to nothing at the frost line, lumpy and faceted.
// - Freezing wind piles rime on the side it hits: there the shell is thicker and grows small
//   feathers pointing into the wind.
// - The tower's fire melts snow on the crown; the water drips over the rim and refreezes, so
//   icicles hang under the crown once it is cold enough, longer as the frost climbs.
// - Thin frost is white (air trapped in it scatters light), thick ice clear and blue: the shell
//   runs white at its thin edge to aqua and cobalt where it is thick, shaded by which way each
//   facet faces, after a low-poly iceberg.
// One shell mesh per tower; every feather, crystal and icicle on the board is one instanced mesh.
// A destroyed tower crumbles: low-poly chunks of stone and crown fall, bounce and settle as rubble
// round a frosted stump (one more instanced mesh).
import * as THREE from 'three';
import { DOUBLE_ELIXIR_AT, MATCH_SECONDS } from '../../shared/arena';

export const ICE = '#dbe9f4';
export const ICE_DEEP = '#9cc3e0';

// White to deep, after a low-poly iceberg: frost white, mint, aqua, sky, steel, cobalt, violet.
export const ICE_RAMP = ['#f4fbff', '#e3f7f5', '#c6f2ee', '#9de6e3', '#78d2d6', '#8cc0e0', '#6f9fcf', '#557fc0', '#3f62ad', '#33489a', '#3f3a86', '#523d7a'];

const RIME = 0.06; // a thin rime at the base even at full health: the night is cold
const HURT_REACH = 0.86; // a tower one hit from falling is frosted this far up
const OVERTIME_FROM = 0.12, OVERTIME_TO = 0.6; // every tower's frost line over the overtime half minute
export const ICICLES_AT = 0.45; // cold enough for the crown's meltwater to refreeze as icicles

// How far up a tower (0 base … 1 top) the frost line stands: the higher of its damage and how far
// into overtime the match is.
export function frostLevel(hp: number, maxHp: number, time = 0, playing = true): number {
  if (hp <= 0) return 0.7; // the stump
  const hurt = RIME + (HURT_REACH - RIME) * (1 - Math.min(1, Math.max(0, hp / Math.max(1, maxHp))));
  if (!playing || time < DOUBLE_ELIXIR_AT) return hurt;
  const k = Math.min(1, (time - DOUBLE_ELIXIR_AT) / (MATCH_SECONDS - DOUBLE_ELIXIR_AT));
  return Math.max(hurt, OVERTIME_FROM + (OVERTIME_TO - OVERTIME_FROM) * k);
}

// Where the wind comes from, in the scene's x/z (the camera always looks toward −z): the left of
// the view and a little toward you, so the rimed side is the side you see.
const WIND = new THREE.Vector2(-0.8, 0.6).normalize();

// The unit tower body (pov.ts): 8 sides, corner radius 1.15 at the foot and 1 at the top, 2.2 tall.
const BODY_H = 2.2, R_FOOT = 1.15, R_TOP = 1;

// How thick the shell stands off the wall at height `y` (0 … 2.2, body units), mirrored in the
// shell's vertex shader: thickest at the foot, thinning to nothing at the frost line, thicker
// to windward and with frost overall. `lump` 0..1 roughens it.
export function shellThickness(y: number, frost: number, wind: number, lump = 0.5): number {
  const reach = frost * BODY_H;
  if (frost <= 0 || y >= reach) return 0;
  const s = 1 - y / reach;
  return (0.05 + 0.2 * frost) * (1 + 0.9 * Math.max(0, wind)) * (0.7 + 0.6 * lump) * Math.pow(s, 0.55);
}

// The wall's distance from the axis at angle `a` (radians, from +z toward +x) and height `y`:
// the flat faces of the octagon, not a circle.
function wallRadius(a: number, y: number): number {
  const corner = R_FOOT + (R_TOP - R_FOOT) * Math.min(1, Math.max(0, y / BODY_H));
  const sector = Math.PI / 4, centre = (Math.floor(a / sector) + 0.5) * sector;
  return (corner * Math.cos(Math.PI / 8)) / Math.cos(a - centre);
}

// The ice shell's lattice, wrapped round the body's walls (centred like the body, so it can sit
// inside the body mesh and share its scale): `seg` columns round, `rings` rows up, every point
// jittered so the facets are irregular. Each vertex carries its outward direction (aOut) and
// aIce = (lump, how late the frost reaches it, how much it faces the wind, facet id).
function shellGeometry(seg = 24, rings = 9): THREE.BufferGeometry {
  const pt = (i: number, j: number) => {
    const ii = ((i % seg) + seg) % seg;
    const inner = j > 0 && j < rings;
    const a = ((ii + (j > 0 ? (hash(ii, j + 900) - 0.5) * 0.6 : 0)) / seg) * Math.PI * 2;
    const y = Math.max(0, Math.min(BODY_H, ((j + (inner ? (hash(ii + 50, j + 900) - 0.5) * 0.7 : 0)) / rings) * BODY_H));
    const r = wallRadius(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), y) - 0.012;
    const ox = Math.sin(a), oz = Math.cos(a);
    return { p: [ox * r, y - BODY_H / 2, oz * r], out: [ox, j === 0 ? -0.15 : 0, oz], lump: hash(ii + 100, j), late: hash(ii + 150, j), wind: ox * WIND.x + oz * WIND.y };
  };
  const pos: number[] = [], out: number[] = [], ice: number[] = [];
  let id = 0;
  const tri = (...vs: ReturnType<typeof pt>[]) => {
    for (const v of vs) { pos.push(...v.p); out.push(...v.out); ice.push(v.lump, v.late, v.wind, id); }
    id++;
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i, j + 1), d = pt(i + 1, j + 1);
      // Outward winding (angle runs from +z toward +x); the diagonal flips so the facets don't line up.
      if (hash(i + 200, j) < 0.5) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 3));
  geo.setAttribute('aIce', new THREE.Float32BufferAttribute(ice, 4));
  return geo;
}

let sharedShell: THREE.BufferGeometry | null = null;
const ramp = ICE_RAMP.map(c => new THREE.Color(c));

// A tower's ice shell: add it to the body mesh so it shares the body's place and scale. `level`
// is the tower's frost uniform (0..1 of the body's height); `seed` varies its colours.
export function iceShell(level: { value: number }, seed: number): THREE.Mesh {
  sharedShell ??= shellGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, flatShading: true });
  const uSeed = { value: seed };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uFrost: level, uSeed, uRamp: { value: ramp } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aOut;
attribute vec4 aIce;
uniform float uFrost;
varying float vThin;
varying float vTri;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  // Thickest at the foot, nothing at the frost line (each point reached a little early or late,
  // so the edge is ragged), thicker to windward; tucked inside the wall above the line. The
  // bottom ring flares out onto the ground.
  float y = position.y + 1.1;
  float reach = uFrost * 2.2 + (aIce.y - 0.5) * 0.3 * min(1.0, uFrost * 3.0);
  float s = clamp(1.0 - y / max(reach, 0.001), 0.0, 1.0);
  float t = (0.05 + 0.2 * uFrost) * (1.0 + 0.9 * max(aIce.z, 0.0)) * (0.7 + 0.6 * aIce.x) * pow(s, 0.55);
  if (y < 0.01) t *= 1.6;
  t = s > 0.0 ? t : -0.03;
  transformed += aOut * t;
  vThin = 1.0 - clamp(t / (0.12 + 0.3 * uFrost), 0.0, 1.0);
  vTri = aIce.w;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSeed;
uniform vec3 uRamp[${ramp.length}];
varying float vThin;
varying float vTri;
float frostHash(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  // Thin ice is white, thick ice blue; facets facing the view's upper left run light, those
  // facing away deep; each facet nudged a step.
  float facing = dot(normal, normalize(vec3(-0.55, 0.5, 0.65))) * 0.5 + 0.5;
  float id = floor(vTri + 0.5);
  float k = (1.0 - vThin) * 6.5 + (1.0 - facing) * 6.0 - 1.5 + (frostHash(id) - 0.5) * 2.4;
  diffuseColor.rgb = uRamp[int(clamp(k + 0.5, 0.0, ${ramp.length - 1}.0))];`)
      // The ice holds its colours in the night: part of each facet's colour glows.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.38;');
  };
  const mesh = new THREE.Mesh(sharedShell, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the vertex shader moves it off its bounds
  return mesh;
}

// Rime feathers to windward, frost crystals along the front and icicles off the crown, every
// tower's in one draw call. Call begin(), add() each tower, then end().
export class TowerIce {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, max = 420) {
    // A small six-sided crystal: a prism with a pointed tip, standing on its base, tip at y = 1.
    const geo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.6), new THREE.Vector2(0, 1)], 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#cfeef2', emissiveIntensity: 0.4, roughness: 0.25, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    const tint = new THREE.Color();
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, tint.set(ICE_RAMP[Math.floor(hash(i, 3) * 5)]));
    this.mesh.frustumCulled = false; // instances spread over the whole board
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin(): void { this.n = 0; }

  // A tower standing at `at` (its base centre), `r` tiles wide with a body `h` tiles tall (its y
  // scale is h / 2.2). `seed` keeps each tower's ice in the same places frame to frame.
  add(at: THREE.Vector3, r: number, h: number, frost: number, seed: number, stump = false): void {
    if (frost <= 0) return;
    const sy = h / BODY_H, reach = frost * BODY_H;
    // A point on the shell's surface at angle a and body height y, pushed out `extra` more.
    const onShell = (a: number, y: number, extra = 0) => {
      const wind = Math.sin(a) * WIND.x + Math.cos(a) * WIND.y;
      const d = (wallRadius(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), y) + shellThickness(y, frost, wind) + extra) * r;
      return this.p.set(at.x + Math.sin(a) * d, at.y + y * sy, at.z + Math.cos(a) * d);
    };
    // Rime feathers on the windward half: small plates growing out of the shell into the wind,
    // most near the front where the fresh rime is.
    const feathers = stump ? 8 : 22;
    for (let i = 0; i < feathers; i++) {
      const a = Math.atan2(WIND.x, WIND.y) + (hash(seed, i + 400) - 0.5) * 2.4;
      const y = reach * (0.25 + 0.75 * Math.sqrt(hash(seed, i + 410)));
      onShell(a, y);
      // Point out from the wall and into the wind, tilted up a little.
      const yaw = Math.atan2(Math.sin(a) + WIND.x * 0.8, Math.cos(a) + WIND.y * 0.8);
      this.e.set(Math.PI / 2 - 0.35 - hash(seed, i + 420) * 0.3, yaw, 0, 'YXZ');
      const len = (0.1 + 0.16 * hash(seed, i + 430)) * (0.6 + frost) * Math.max(1, r * 0.8);
      this.put(len * 0.35, len, len * 0.08); // flat, like a feather
    }
    // Frost crystals forming along the front: tiny needles standing off the wall.
    const needles = stump ? 8 : 18;
    for (let i = 0; i < needles; i++) {
      const a = ((i + hash(seed, i + 440) * 0.9) / needles) * Math.PI * 2;
      const y = Math.max(0.02, reach - hash(seed, i + 450) * 0.12);
      onShell(a, y, 0.01);
      this.e.set(0.5 + hash(seed, i + 460) * 0.5, a, 0, 'YXZ');
      const len = 0.05 + 0.07 * hash(seed, i + 470);
      this.put(len * 0.3, len, len * 0.3);
    }
    if (stump || frost < ICICLES_AT) return;
    // Icicles: the crown's meltwater refreezing as it drips over the rim, longer as it gets colder.
    const n = 12, rim = h * (2.7 / 2.2); // the crown's top edge
    for (let i = 0; i < n; i++) {
      const a = ((i + hash(seed, i + 340) * 0.7) / n) * Math.PI * 2;
      const len = (0.08 + (frost - ICICLES_AT) * 1.1) * (0.4 + hash(seed, i + 70) * 0.9) * Math.max(1, r * 0.8);
      this.p.set(at.x + Math.sin(a) * r * 1.1, at.y + rim, at.z + Math.cos(a) * r * 1.1);
      this.e.set(Math.PI, a, 0, 'YXZ');
      this.put(len * 0.2, len, len * 0.2);
    }
  }

  private put(sx: number, len: number, sz: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromEuler(this.e);
    this.s.set(sx, len, sz);
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
