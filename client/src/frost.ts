// Towers and the cold (meta/aesthetics.md, "Tower frost"). Frost climbs a tower from its base as it
// loses health, and during overtime it creeps up every tower whatever its health. The walls are
// cut into small irregular facets, and the ice takes them one by one from the foot: each iced
// facet gets its own colour from a low-poly iceberg's range (white and mint where the art light
// falls, through aqua and steel blue, to cobalt and violet in shadow), the newest along the front
// paler, with tiny shards forming there and icicles off the crown near the end. The ice lives in
// the tower's own stone shader (no extra draw calls); the shards are one instanced mesh. A
// destroyed tower crumbles: low-poly chunks of stone and crown fall, bounce and settle as rubble
// round a frosted stump (one more instanced mesh).
import * as THREE from 'three';
import { DOUBLE_ELIXIR_AT, MATCH_SECONDS } from '../../shared/arena';

export const ICE = '#dbe9f4';
export const ICE_DEEP = '#9cc3e0';

// Lit to shadow, after a low-poly iceberg: white, mint, aqua, sky, steel, cobalt, violet.
export const ICE_RAMP = ['#eefbfa', '#c6f2ee', '#9de6e3', '#78d2d6', '#8cc0e0', '#6f9fcf', '#557fc0', '#3f62ad', '#33489a', '#3f3a86', '#523d7a'];
const FRESH = '#f4fbff'; // the newest facets along the front

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

// Where the ice's art light comes from, in the scene (the camera always looks toward −z): the
// upper left of the view, so the faces you see run white and mint on the left to violet on the right.
const ART_LIGHT = new THREE.Vector2(-0.8, 0.6).normalize();

// The tower body, as the 8-sided cylinder it replaces (radius 1.15 at the foot, 1 at the top,
// 2.2 tall, centred), with each face cut into small irregular triangles. Faces stay flat, so the
// stone looks the same; each triangle carries `aIce`: its height up the wall (where the frost
// takes it), how much it faces the art light, and an id for its colour.
export function frostBodyGeometry(cols = 3, rows = 7): THREE.BufferGeometry {
  const H = 2.2, rBot = 1.15, rTop = 1;
  // Grid points on face f at column i (0…cols), row j (0…rows). Points inside a face are jittered
  // within it; points on a shared edge only along the edge, the same for both faces.
  const point = (f: number, i: number, j: number): [number, number, number] => {
    let u = i / cols, v = j / rows;
    const inner = j > 0 && j < rows;
    if (i === 0 || i === cols) {
      const edge = i === 0 ? f : (f + 1) % 8;
      if (inner) v += (hash(edge + 400, j) - 0.5) * (0.7 / rows);
    } else {
      u += (hash(f * 97 + i * 13 + 500, j) - 0.5) * (0.7 / cols);
      if (inner) v += (hash(f * 97 + i * 13 + 700, j) - 0.5) * (0.7 / rows);
    }
    const r = rBot + (rTop - rBot) * v;
    const a0 = (f / 8) * Math.PI * 2, a1 = ((f + 1) / 8) * Math.PI * 2;
    const x = r * (Math.sin(a0) * (1 - u) + Math.sin(a1) * u), z = r * (Math.cos(a0) * (1 - u) + Math.cos(a1) * u);
    return [x, v * H - H / 2, z];
  };
  const pos: number[] = [], ice: number[] = [];
  let id = 0;
  const tri = (a: number[], b: number[], c: number[], lit: number) => {
    const h = (a[1] + b[1] + c[1]) / 3 + H / 2;
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) ice.push(h, lit, id);
    id++;
  };
  for (let f = 0; f < 8; f++) {
    const mid = ((f + 0.5) / 8) * Math.PI * 2;
    const lit = 0.5 + 0.5 * (Math.sin(mid) * ART_LIGHT.x + Math.cos(mid) * ART_LIGHT.y);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const p00 = point(f, i, j), p10 = point(f, i + 1, j), p01 = point(f, i, j + 1), p11 = point(f, i + 1, j + 1);
        // Outward-facing winding; the diagonal flips cell to cell so the facets don't line up.
        if (hash(f * 11 + i, j + 600) < 0.5) { tri(p00, p10, p11, lit); tri(p00, p11, p01, lit); }
        else { tri(p00, p10, p01, lit); tri(p10, p11, p01, lit); }
      }
    }
  }
  // The top: a flat octagon the frost never reaches.
  for (let f = 0; f < 8; f++) {
    const a0 = (f / 8) * Math.PI * 2, a1 = ((f + 1) / 8) * Math.PI * 2;
    tri([0, H / 2, 0], [Math.sin(a0) * rTop, H / 2, Math.cos(a0) * rTop], [Math.sin(a1) * rTop, H / 2, Math.cos(a1) * rTop], 0);
    ice[ice.length - 3] = ice[ice.length - 6] = ice[ice.length - 9] = 99;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aIce', new THREE.Float32BufferAttribute(ice, 3));
  geo.computeVertexNormals();
  return geo;
}

// Let the frost take a tower body's facets (frostBodyGeometry) in its stone material. `level` is
// its frost uniform, 0..1 of the body's height; `seed` gives each tower its own colours and front.
export function frostStone(mat: THREE.MeshStandardMaterial, level: { value: number }, seed: number): void {
  const s = { value: seed };
  mat.onBeforeCompile = shader => paintFrost(shader, level, s);
}

const ramp = ICE_RAMP.map(c => new THREE.Color(c)), fresh = new THREE.Color(FRESH);
function paintFrost(shader: THREE.WebGLProgramParametersWithUniforms, level: { value: number }, seed: { value: number }): void {
  Object.assign(shader.uniforms, { uFrost: level, uSeed: seed, uRamp: { value: ramp }, uFresh: { value: fresh } });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aIce;\nvarying vec3 vIce;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIce = aIce;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vIce;
uniform float uFrost, uSeed;
uniform vec3 uRamp[${ramp.length}];
uniform vec3 uFresh;
float frostHash(float n) { return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  // A facet is iced once the frost line passes it (each facet a little early or late, so the
  // front is ragged). Its colour comes off the iceberg ramp by how much it faces the art light,
  // give or take; the newest facets along the front are paler, fresh rime.
  float id = floor(vIce.z + 0.5);
  float reach = uFrost * 2.2;
  float at = vIce.x + (frostHash(id) - 0.5) * 0.3;
  float iced = step(0.001, uFrost) * step(at, reach);
  float fresh = iced * step(reach - 0.12, at) * step(0.4, frostHash(id + 19.0));
  // Neighbouring facets shade alike (a slow drift over the wall), each nudged a step or so.
  float drift = sin(vIce.x * 2.3 + uSeed * 1.7 + vIce.y * 5.0) * 1.6;
  int k = int(clamp((1.0 - vIce.y) * 11.0 + 0.6 + drift + (frostHash(id + 7.0) - 0.5) * 2.5 + 0.5, 0.0, ${ramp.length - 1}.0));
  vec3 ice = uRamp[k];
  ice = mix(ice, uFresh, fresh * (0.35 + 0.35 * frostHash(id + 13.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, ice, iced);`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.3, iced);')
    // The ice holds its colours in the night: part of each facet's colour glows.
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += iced * diffuseColor.rgb * 0.38;');
}

// Tiny ice shards forming along each tower's frost front, and icicles off the crown near the end,
// every tower's in one draw call. Call begin(), add() each tower, then end().
export class TowerIce {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, max = 260) {
    // A small six-sided crystal: a prism with a pointed tip, standing on its base, tip at y = 1.
    const geo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0.6), new THREE.Vector2(0, 1)], 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#bfe6ee', emissiveIntensity: 0.45, roughness: 0.25, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    // Each shard its own colour from the light end of the iceberg ramp.
    const tint = new THREE.Color();
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, tint.set(ICE_RAMP[Math.floor(hash(i, 3) * 6)]));
    this.mesh.frustumCulled = false; // instances spread over the whole board
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin(): void { this.n = 0; }

  // A tower standing at `at` (its base centre), `r` tiles wide with a body `h` tiles tall.
  // `seed` keeps each tower's shards in the same places frame to frame.
  add(at: THREE.Vector3, r: number, h: number, frost: number, seed: number, stump = false): void {
    if (frost <= 0) return;
    const reach = frost * h;
    // Shards forming on the wall just under the front: small (a tenth of a tile or so), in tight
    // little clusters, pointing up and out.
    const clusters = stump ? 4 : 8;
    for (let c = 0; c < clusters; c++) {
      const a = ((c + hash(seed, c + 300) * 0.8) / clusters) * Math.PI * 2;
      const y = Math.max(0.02, reach - (0.04 + hash(seed, c + 310) * 0.14) * h / 2.2);
      const wall = r * (1.15 - 0.15 * Math.min(1, y / h)) * Math.cos(Math.PI / 8);
      for (let k = 0; k < 3; k++) {
        const aa = a + (k - 1) * 0.07 / r;
        const tall = (0.07 + hash(seed, c * 3 + k + 320) * 0.1) * (k === 1 ? 1.4 : 1);
        this.p.set(at.x + Math.sin(aa) * wall, at.y + y, at.z + Math.cos(aa) * wall);
        this.e.set(0.35 + Math.abs(k - 1) * 0.4, aa + (k - 1) * 0.5, 0, 'YXZ');
        this.put(tall * 0.28, tall);
      }
    }
    if (stump || frost < ICICLES_AT) return;
    // Icicles hang from the crown's flared rim, longer as the frost climbs.
    const n = 10, rim = h * (2.7 / 2.2); // the crown's top edge
    for (let i = 0; i < n; i++) {
      const a = ((i + hash(seed, i + 340) * 0.6) / n) * Math.PI * 2;
      const len = (0.14 + (frost - ICICLES_AT) * 1.3) * (0.5 + hash(seed, i + 70) * 0.7) * Math.max(1, r * 0.8);
      this.p.set(at.x + Math.sin(a) * r * 1.1, at.y + rim, at.z + Math.cos(a) * r * 1.1);
      this.e.set(Math.PI, a, 0, 'YXZ');
      this.put(len * 0.22, len);
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
