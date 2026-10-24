// Towers and the cold (meta/aesthetics.md, "Tower frost"). Frost climbs a tower from its base as it
// loses health, and during overtime it creeps up every tower whatever its health. It looks like
// the frost in the menu's corners: long, thin, see-through ice shards, each with a lit and a
// shadow half and a ridge down its middle, fanning up the walls from the foot (the tallest reach
// the frost line), with icicles off the crown near the end. Every shard on the board is one instanced mesh. A destroyed tower crumbles: low-poly chunks
// of stone and crown fall, bounce and settle as rubble round a frosted stump (one more).
import * as THREE from 'three';
import { DOUBLE_ELIXIR_AT, MATCH_SECONDS } from '../../shared/arena';

export const ICE = '#dbe9f4';
export const ICE_DEEP = '#9cc3e0';

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

// One shard, as in the menu frost: a long blade from a blunt root (y = 0, half as wide as its
// widest) out to its widest (x = ±1) three quarters along, then a short point at y = 1, with a
// ridge down the middle raised toward +z. Flat shading splits it into a lit and a shadow half
// either side of the ridge, and the point catches the light apart from the blade.
function bladeGeometry(): THREE.BufferGeometry {
  const rootL = [-0.5, 0, 0], rootC = [0, 0, 0.2], rootR = [0.5, 0, 0];
  const midL = [-1, 0.75, 0], midC = [0, 0.75, 0.3], midR = [1, 0.75, 0], tip = [0, 1, 0];
  const tris = [
    rootL, rootC, midC, rootL, midC, midL, midL, midC, tip,
    rootC, rootR, midR, rootC, midR, midC, midC, midR, tip,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

// The shards glow a little more where you see them edge-on, like light passing through ice.
function glowIce(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.86, 0.91, 0.96) * pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.0) * 0.5;`);
}

// Every tower's frost shards and icicles, in one draw call. Call begin(), add() each tower, then end().
export class TowerIce {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, max = 520) {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', emissive: ICE_DEEP, emissiveIntensity: 1, roughness: 0.2, flatShading: true,
      transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    });
    mat.onBeforeCompile = glowIce;
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), mat, max);
    // Shards in the menu frost's two ices, a few nearly white.
    const tint = new THREE.Color(), tints = [ICE, ICE, ICE_DEEP, '#c4dbee', '#f4f9fd'];
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, tint.set(tints[Math.floor(hash(i, 3) * tints.length)]));
    this.mesh.frustumCulled = false; // instances spread over the whole board
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin(): void { this.n = 0; }

  // A tower standing at `at` (its base centre), `r` tiles wide with a body `h` tiles tall.
  // `seed` keeps each tower's shards in the same places frame to frame.
  add(at: THREE.Vector3, r: number, h: number, frost: number, seed: number, stump = false): void {
    if (frost <= 0) return;
    const reach = Math.max(0.12, frost * h);
    // Up the walls: bursts of shards radiating from the foot, as from the menu's corners. A big
    // burst on every other face, its upright shard reaching the frost line and the rest splayed
    // shorter, and a smaller one on the faces between, all overlapping.
    for (let f = 0; f < 8; f++) {
      const a = ((f + 0.5) / 8) * Math.PI * 2, big = f % 2 === 0;
      const count = stump ? 4 : big ? 9 : 6, spread = big ? 1.05 : 0.8;
      const out = r * 1.15 * Math.cos(Math.PI / 8) + 0.03; // just off the face at its foot
      for (let k = 0; k < count; k++) {
        const i = f * 10 + k, u = count > 1 ? (k / (count - 1)) * 2 - 1 : 0; // -1 … 1 across the burst
        const tilt = u * spread + (hash(seed, i) - 0.5) * 0.18;
        const len = reach * (big ? 1.15 : 0.8) * (1 - 0.5 * Math.abs(u)) * (0.8 + hash(seed, i + 7) * 0.35);
        const slide = (hash(seed, i + 13) - 0.5) * r * 0.12; // roots bunched near the face's middle
        this.p.set(at.x + Math.sin(a) * out + Math.cos(a) * slide, at.y, at.z + Math.cos(a) * out - Math.sin(a) * slide);
        // Lie flat on the face (its +z out of the wall), lean in with the wall's taper, fan in-plane.
        this.e.set(-0.06, a, tilt, 'YXZ');
        this.put(len * 0.075 + r * 0.02, len);
      }
    }
    if (stump || frost < ICICLES_AT) return;
    // Icicles: shards hanging from the crown's flared rim, longer as the frost climbs.
    const n = 8, rim = h * (2.7 / 2.2); // the crown's top edge
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const len = (0.28 + (frost - ICICLES_AT) * 2) * (0.6 + hash(seed, i + 70) * 0.6) * Math.max(1, r * 0.8);
      this.p.set(at.x + Math.sin(a) * r * 1.14, at.y + rim, at.z + Math.cos(a) * r * 1.14);
      this.e.set(0, a, Math.PI, 'YXZ');
      this.put(r * 0.05, len);
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
