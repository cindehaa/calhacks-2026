// The board, in 3D: you stand behind your own towers and look down the arena. Each frame's View
// goes in; toWorld turns a screen point into the board spot under it, for aiming and deploys.
// The scene renders into its own canvas; names, bars, effects and the hand cursor go on a 2D
// canvas on top, which is also the one that gets the mouse.
import * as THREE from 'three';
import {
  ARENA_H, ARENA_W, BRIDGE_HALF, BRIDGE_X, DEPLOY_DELAY, KING_LANE, MID_Y, RIVER_HALF, UNIT_RADIUS, deployZones, towerRadius, type Side,
} from '../../shared/arena';
import { Fx, quirks, roundRect, towerKey, type Shot, type Trail } from './fx';
import { drawInput } from './input/draw';
import { Juice } from './juice';
import { SummonCircles } from './summon';
import { spriteImage, type DrawTower, type DrawTroop, type DrawUnit, type View } from './render';
import { Scenery } from './scenery';
import { poseFrame } from './sprites';
import { glyphImage, sizeScale, troopGlyph } from './tokens';

// Where you stand, in your own view coords (your back line is y = 0): height, resting pitch and
// vertical field of view.
export const EYES = {
  top: { y: 3.9, h: 11, pitch: -0.76, fov: 64 }, // at the front parapet of your king tower, the whole field below
  tower: { y: -1, h: 8.5, pitch: -0.66, fov: 62 }, // over your king's shoulder, princess towers out front
  high: { y: -6, h: 13, pitch: -0.78, fov: 62 },
  low: { y: -3, h: 2.6, pitch: -0.12, fov: 62 },
} as const;
export type Eye = keyof typeof EYES;

const C = {
  bg: '#0a0c1a',
  myHalf: '#141b3b',
  theirHalf: '#1d162b',
  mine: '#4aa3ff',
  theirs: '#ff5d6c',
  mineDark: '#1d4a82',
  theirsDark: '#7d2431',
  mineLight: '#cfe6ff',
  theirsLight: '#ffd0d5',
  text: '#e8ebf5',
  elixir: '#ff8a3d', // embers: warm amber, a proposal for Cindy (meta/aesthetics.md)
};
const FONT = "'Cinzel', Georgia, serif"; // the menus' title face; its figures are lining, unlike Alegreya Sans's
const DROP_HEIGHT = 3; // tiles; troops hang here until the last 0.3 s of the deploy delay
const FLY_HEIGHT = 1; // tiles; flying units' feet hover this high
const BODY = 1.5; // bodies drawn this much bigger than on the flat board: perspective shrinks the far half
const MAX_POINTS = 400; // more than Fx ever keeps alive
const SWIPE_SEGS = 20;
const UP = new THREE.Vector3(0, 1, 0);
const OVER = 10; // renderOrder for shots, trails and particles: drawn over the bodies
const WHITE = new THREE.Color('#ffffff');

interface TowerMesh { grp: THREE.Group; base: THREE.Mesh; crown: THREE.Mesh; gem: THREE.Mesh; mat: THREE.MeshStandardMaterial; seen: number; hp: number }
interface UnitMesh {
  sprite: THREE.Sprite; mat: THREE.SpriteMaterial; glow: THREE.Sprite; glowMat: THREE.SpriteMaterial; ghosts: THREE.Sprite[] | null;
  shadow: THREE.Mesh; ring: THREE.Mesh; seen: number;
  h: number; top: number; // drawn body height and the height of its top, in tiles, for labels
}
interface PendingMesh { closing: THREE.Mesh; target: THREE.Mesh; pad: THREE.Mesh }
interface ShotMesh { head: THREE.Mesh; tail: THREE.Mesh; halo: THREE.Sprite; shadow: THREE.Mesh }
interface Points { points: THREE.Points; pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; shape: Float32Array }

// Effect colours come as CSS strings; parse each once. rgba() alpha is kept apart (alphaOf).
const colors = new Map<string, [THREE.Color, number]>();
function parsed(s: string): [THREE.Color, number] {
  let c = colors.get(s);
  if (!c) {
    const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(s.replace(/\s/g, ''));
    c = m ? [new THREE.Color(`rgb(${m[1]},${m[2]},${m[3]})`), Number(m[4])] : [new THREE.Color(s), 1];
    colors.set(s, c);
  }
  return c;
}
const color = (s: string) => parsed(s)[0];
const alphaOf = (s: string) => parsed(s)[1];

// Fx particles as round soft puffs (0), square chunks (1) or bright sparks (2), sized in tiles.
const POINT_VERT = `
attribute float size; attribute float alpha; attribute float shape;
uniform float uScale;
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main() {
  vColor = color; vAlpha = alpha; vShape = shape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.5, size * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FRAG = `
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  vec4 col;
  if (vShape > 0.5 && vShape < 1.5) col = vec4(vColor, vAlpha);
  else if (vShape > 1.5) { if (d > 0.5) discard; col = vec4(mix(vColor, vec3(1.0), smoothstep(0.3, 0.0, d)), vAlpha * smoothstep(0.5, 0.15, d)); }
  else { if (d > 0.5) discard; col = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, d)); }
  gl_FragColor = col;
  #include <colorspace_fragment>
}`;

export class PovBoard {
  readonly fx = new Fx();
  readonly juice = new Juice(); // cost reveal, landing impact, stamps, bubbles, freeze and slow motion
  private summons!: SummonCircles;
  eye: Eye = 'top';
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(62, 1, 0.05, 250);
  private g: CanvasRenderingContext2D;
  private side: Side = 0;
  private w = 1;
  private h = 1;
  private yaw = 0;
  private pitch = 0;
  private mouse: [number, number] | null = null;
  private last = performance.now();
  private frame = 0;
  private layout = new THREE.Group();
  private layoutKey = '';
  private pockets = new THREE.Group();
  private pocketKey = '';
  private hurt = 0; // 0..1, red edges after your king tower takes a hit
  private towers = new Map<unknown, TowerMesh>();
  private units = new Map<bigint, UnitMesh>();
  private pendings: PendingMesh[] = [];
  private silhouettes: THREE.Sprite[] = [];
  private textures = new Map<string, THREE.CanvasTexture>();
  private imageTextures = new WeakMap<object, THREE.Texture>();
  private ringPool: THREE.Mesh[] = [];
  private auraPool: THREE.Mesh[] = [];
  private flashPool: THREE.Sprite[] = [];
  private shotPool: ShotMesh[] = [];
  private trailObjs = new Map<Trail, { obj: THREE.Object3D; mats: THREE.MeshBasicMaterial[]; seen: number }>();
  private parts: Points;
  private flyers: number[] = []; // x, y of each flying unit this frame, so effects at one start up there
  private aimRing: THREE.Mesh;
  private lockRing: THREE.Mesh;
  private beam: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private v3c = new THREE.Vector3();
  private stone = new THREE.MeshStandardMaterial({ color: '#2b3150', roughness: 0.75 });
  // Unit-radius tower parts, scaled per tower (the king is wider and taller).
  private body = new THREE.CylinderGeometry(1, 1.15, 2.2, 8);
  private crownGeo = new THREE.CylinderGeometry(1.15, 1, 0.5, 8);
  private gemGeo = new THREE.OctahedronGeometry(0.35);
  private shadowGeo = new THREE.CircleGeometry(1, 20);
  private shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });
  private flyShadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false });
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private thinRingGeo = new THREE.RingGeometry(0.9, 1, 48);
  private dashGeo = dashedRing(0.82, 0.92, 16);
  private footGeo = new THREE.RingGeometry(0.8, 0.95, 32);
  private footMine = new THREE.MeshBasicMaterial({ color: C.mine, transparent: true, opacity: 0.7, depthWrite: false });
  private footTheirs = new THREE.MeshBasicMaterial({ color: C.theirs, transparent: true, opacity: 0.7, depthWrite: false });
  private coneGeo = new THREE.CircleGeometry(1, 12, -Math.PI / 6, Math.PI / 3);
  private ballGeo = new THREE.SphereGeometry(1, 10, 8);
  private stickGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  private glowTex = radialTexture();
  private silhouetteTex = silhouetteTexture();
  private scenery: Scenery;

  constructor(gl: HTMLCanvasElement, readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const s = this.scene;
    s.background = new THREE.Color(C.bg);
    s.fog = new THREE.Fog(C.bg, 30, 125); // far enough out that the mountains show through it
    this.cam.rotation.order = 'YXZ';
    s.add(new THREE.HemisphereLight('#aab8ff', '#120d1e', 1.6));
    const sun = new THREE.DirectionalLight('#ffe6c4', 2.4);
    sun.position.set(-14, 22, -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 24, bottom: -24, near: 1, far: 80 });
    s.add(sun);
    const rim = new THREE.PointLight(C.theirs, 40, 30);
    rim.position.set(0, 6, -MID_Y - 1);
    s.add(rim);
    s.add(this.layout, this.pockets);
    this.addSurroundings();
    this.scenery = new Scenery(s);
    this.parts = this.makePoints();
    this.summons = new SummonCircles(s, (x, y, h, out) => this.at(x, y, h, out));

    const ring = (inner: number, outer: number, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 48),
        new THREE.MeshBasicMaterial({ color: C.mine, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      s.add(m);
      return m;
    };
    this.aimRing = ring(0.7, 0.85, 0.7);
    this.lockRing = ring(0.9, 1.15, 1);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 8, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: C.mine, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.beam.visible = false;
    s.add(this.beam);

    addEventListener('mousemove', e => (this.mouse = [e.clientX, e.clientY]));
    addEventListener('resize', () => this.resize());
    const dock = document.getElementById('dock');
    if (dock) new ResizeObserver(() => this.resize()).observe(dock);
    this.resize();
  }

  resize(): void {
    this.w = innerWidth;
    this.h = innerHeight;
    this.renderer.setSize(this.w, this.h, false);
    const dpr = devicePixelRatio || 1;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    // Centre the view on the part of the screen above the dock, so the near bank isn't under it.
    const dock = (document.getElementById('dock')?.offsetHeight ?? 130) + 20;
    this.cam.aspect = this.w / Math.max(1, this.h - dock);
    this.cam.setViewOffset(this.w, this.h - dock, 0, 0, this.w, this.h);
    this.cam.updateProjectionMatrix();
  }

  // Screen px → board coords, by casting onto the ground. Off the ground gives a spot off the board.
  toWorld(px: number, py: number): [number, number] {
    this.ray.setFromCamera(new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.cam);
    if (!this.ray.ray.intersectPlane(this.ground, this.v3)) return [-1, -1];
    return this.toBoard(this.v3.x + ARENA_W / 2, MID_Y - this.v3.z);
  }

  // visible false (an opaque menu covers the board) still runs Fx, which plays the match's sounds
  // and music, but skips the scene and the overlay.
  draw(v: View, visible = true): void {
    const real = performance.now() / 1000;
    // Effects run on juice's clock, which slows for a moment when a tower falls (visual only).
    const now = this.juice.clock(real);
    this.side = v.mySide;
    this.fx.observe(v, now);
    this.juice.observe(v, now, real, this.fx);
    if (!visible) return;
    if (this.juice.frozen(real)) return; // hit freeze: the last frame stays on screen
    const dt = Math.min(0.05, real - this.last / 1000) * this.juice.timeRate;
    this.last = real * 1000;
    this.frame++;
    this.syncLayout();
    this.syncPockets(v.towers);
    this.moveCamera(v, dt, now, real);
    this.syncTowers(v, dt);
    this.syncUnits(v, now);
    this.syncPendings(v, now);
    this.summons.sync(v, this.juice.airborne(), now);
    this.syncEffects(v);
    this.syncCursor(v, now);
    this.scenery.update(dt, now);
    this.renderer.render(this.scene, this.cam);
    this.drawOverlay(v, now, real);
  }

  // ---------- coordinates ----------

  // Board coords ↔ your view coords: side 1 sees the board turned 180°.
  private toView(x: number, y: number): [number, number] {
    return this.side === 0 ? [x, y] : [ARENA_W - x, ARENA_H - y];
  }
  private toBoard(vx: number, vy: number): [number, number] {
    return this.side === 0 ? [vx, vy] : [ARENA_W - vx, ARENA_H - vy];
  }
  // Board coords → a point in the scene, `h` tiles up.
  private at(x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const [vx, vy] = this.toView(x, y);
    return out.set(vx - ARENA_W / 2, h, MID_Y - vy);
  }
  // Board coords → screen px, or null behind the camera.
  private project(x: number, y: number, h = 0): [number, number] | null {
    const p = this.at(x, y, h, this.v3).project(this.cam);
    if (p.z > 1) return null;
    return [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h];
  }

  // ---------- scene ----------

  // The banks and river channel under the board; everything around it is in scenery.ts.
  private addSurroundings(): void {
    // Two banks with a channel between them for the river.
    const stone = new THREE.MeshStandardMaterial({ color: '#191d36', roughness: 0.9 });
    const bankLen = MID_Y - RIVER_HALF + 0.6;
    for (const dir of [1, -1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W + 1.2, 1.2, bankLen), stone);
      bank.position.set(0, -0.61, dir * (RIVER_HALF + bankLen / 2));
      bank.receiveShadow = true;
      this.scene.add(bank);
    }
    const bed = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W + 1.2, 0.6, 2 * RIVER_HALF), stone);
    bed.position.y = -0.91;
    this.scene.add(bed);
  }

  // Halves, grid, the river and its two bridges, laid out as in shared/arena.ts. Built once per side.
  private syncLayout(): void {
    const key = String(this.side);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const L = this.layout;
    clearGroup(L);
    const flat = (w: number, d: number, vx: number, vy: number, h: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(vx - ARENA_W / 2, h, MID_Y - vy);
      m.receiveShadow = true;
      L.add(m);
    };
    const bank = MID_Y - RIVER_HALF;
    flat(ARENA_W, bank, ARENA_W / 2, bank / 2, 0.001, new THREE.MeshStandardMaterial({ color: C.myHalf, roughness: 0.95 }));
    flat(ARENA_W, bank, ARENA_W / 2, ARENA_H - bank / 2, 0.001, new THREE.MeshStandardMaterial({ color: C.theirHalf, roughness: 0.95 }));
    // A faint lane from each bridge to the towers behind it, on both sides.
    const lane = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.045, roughness: 1 });
    for (const bx of BRIDGE_X) flat(2 * BRIDGE_HALF, ARENA_H, this.toView(bx, 0)[0], MID_Y, 0.02, lane);

    const pts: THREE.Vector3[] = [];
    for (let x = 1; x < ARENA_W; x++) {
      for (const [z0, z1] of [[MID_Y, RIVER_HALF], [-RIVER_HALF, -MID_Y]]) pts.push(new THREE.Vector3(x - ARENA_W / 2, 0.01, z0), new THREE.Vector3(x - ARENA_W / 2, 0.01, z1));
    }
    for (let y = 1; y < ARENA_H; y++) {
      if (Math.abs(y - MID_Y) < RIVER_HALF) continue;
      pts.push(new THREE.Vector3(-ARENA_W / 2, 0.01, MID_Y - y), new THREE.Vector3(ARENA_W / 2, 0.01, MID_Y - y));
    }
    L.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.04 })));

    // Water sits a little below the banks; the bridges span it with a lip on each bank.
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_W, 0.5, 2 * RIVER_HALF),
      new THREE.MeshStandardMaterial({ color: '#244a8a', emissive: '#16306e', emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.2 })
    );
    water.position.y = -0.45;
    L.add(water);
    const wood = new THREE.MeshStandardMaterial({ color: '#4a4560', roughness: 0.85 });
    const rail = new THREE.MeshStandardMaterial({ color: '#6b6585', roughness: 0.7 });
    for (const bx of BRIDGE_X) {
      const x = this.toView(bx, 0)[0] - ARENA_W / 2, len = 2 * RIVER_HALF + 0.8;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2 * BRIDGE_HALF, 0.18, len), wood);
      deck.position.set(x, 0.06, 0);
      deck.castShadow = deck.receiveShadow = true;
      L.add(deck);
      for (const side of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, len), rail);
        r.position.set(x + side * (BRIDGE_HALF - 0.06), 0.3, 0);
        r.castShadow = true;
        L.add(r);
      }
    }
  }

  // Taking an enemy princess tower opens that side of their half for your drops: tint it.
  private syncPockets(towers: DrawTower[]): void {
    const zones = deployZones(this.side, towers.map(t => ({ side: t.side, lane: t.lane ?? -1, hp: t.hp }))).slice(1);
    const key = zones.map(z => [z.x0, z.x1, z.y0, z.y1].join(',')).join(';');
    if (key === this.pocketKey) return;
    this.pocketKey = key;
    clearGroup(this.pockets);
    const mat = new THREE.MeshBasicMaterial({ color: C.mine, transparent: true, opacity: 0.12, depthWrite: false });
    for (const z of zones) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.y1 - z.y0), mat);
      m.rotation.x = -Math.PI / 2;
      this.at((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 0.03, m.position);
      this.pockets.add(m);
    }
  }

  private moveCamera(v: View, dt: number, now: number, real: number): void {
    // Your head turns a little toward where you point: the hand cursor if there is one, else the mouse.
    const p = v.input?.cursor ? [v.input.cursor.x, v.input.cursor.y] : this.mouse;
    const nx = p ? (p[0] / this.w) * 2 - 1 : 0, ny = p ? -(p[1] / this.h) * 2 + 1 : 0;
    const k = 1 - Math.exp(-dt * 2.5);
    this.yaw += (-nx * 0.22 - this.yaw) * k;
    this.pitch += (ny * 0.1 - this.pitch) * k;
    const e = EYES[this.eye];
    const [shx, shy] = this.fx.shake();
    const [jx, jy, roll] = this.juice.shake(real);
    this.cam.position.set(Math.sin(now * 0.7) * 0.05 + shx * 0.01 + jx, e.h + Math.sin(now * 1.4) * 0.03 + shy * 0.01 + jy, MID_Y - e.y);
    this.cam.rotation.set(e.pitch + this.pitch + this.juice.pitchNudge(real), this.yaw, roll);
    const fov = e.fov + this.juice.fovKick(real);
    if (this.cam.fov !== fov) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
    this.cam.updateMatrixWorld();
  }

  private syncTowers(v: View, dt: number): void {
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    v.towers.forEach((tw, i) => {
      const key = towerKey(tw, i);
      let t = this.towers.get(key);
      if (!t) {
        const grp = new THREE.Group();
        const base = new THREE.Mesh(this.body, this.stone.clone());
        base.position.y = 1.1;
        base.castShadow = base.receiveShadow = true;
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.4 });
        const crown = new THREE.Mesh(this.crownGeo, mat);
        crown.position.y = 2.45;
        crown.castShadow = true;
        const gem = new THREE.Mesh(this.gemGeo, mat);
        gem.position.y = 3.25;
        grp.add(base, crown, gem);
        this.scene.add(grp);
        t = { grp, base, crown, gem, mat, seen: 0, hp: tw.hp };
        this.towers.set(key, t);
      }
      t.seen = this.frame;
      const king = tw.lane === KING_LANE, mine = tw.side === v.mySide;
      // Your king tower losing health reddens the edges of the screen.
      if (king && mine && tw.hp < t.hp && v.status === 'playing') this.hurt = Math.min(1, this.hurt + 0.6);
      t.hp = tw.hp;
      const col = mine ? C.mine : C.theirs;
      t.mat.color.set(col);
      t.mat.emissive.set(col);
      t.mat.emissiveIntensity = (sleeping(tw, v.towers) ? 0.08 : 0.35) + this.fx.towerFlash(key) * 1.5;
      const r = towerRadius(tw.lane ?? 0);
      // From the top eye your king is a lookout tall enough to stand on at eye height.
      const lookout = king && mine && this.eye === 'top';
      t.grp.scale.set(r, lookout ? (EYES.top.h - 1.4) / 2.2 : king ? 1.3 : 1, r);
      // Your own king sits right under the camera: ghost it so it doesn't hide the board. From the
      // top eye you stand on it, so it stays solid and its rim frames the bottom of the view.
      const ghost = king && mine && !lookout;
      for (const m of [t.base.material as THREE.MeshStandardMaterial, t.mat]) {
        m.transparent = ghost;
        m.opacity = ghost ? 0.28 : 1;
        m.depthWrite = !ghost;
      }
      t.base.castShadow = !ghost;
      this.at(tw.x, tw.y, 0, t.grp.position);
      const alive = tw.hp > 0;
      t.crown.visible = t.gem.visible = alive && !lookout;
      t.base.scale.y = alive ? 1 : 0.25;
      t.base.position.y = alive ? 1.1 : 0.28;
      t.gem.rotation.y += 0.02;
    });
    for (const [key, t] of this.towers) {
      if (t.seen === this.frame) continue;
      this.scene.remove(t.grp);
      (t.base.material as THREE.Material).dispose();
      t.mat.dispose();
      this.towers.delete(key);
    }
  }

  // Troops are camera-facing billboards standing on their feet: the troop's sprite (or its
  // attack-pose frame around a strike), else the placeholder token. A team ring and a contact
  // shadow sit on the ground under each; flying units hover higher over a fainter shadow.
  private syncUnits(v: View, now: number): void {
    this.flyers.length = 0;
    for (const u of v.units) {
      const troop = v.troops.get(u.troopId);
      const mine = u.side === v.mySide;
      const q = quirks(u);
      let m = this.units.get(u.id);
      if (!m) {
        const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.center.set(0.5, 0);
        const glowMat = new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
        const glow = new THREE.Sprite(glowMat);
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        const ring = new THREE.Mesh(this.footGeo, mine ? this.footMine : this.footTheirs);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(sprite, glow, shadow, ring);
        m = { sprite, mat, glow, glowMat, ghosts: null, shadow, ring, seen: 0, h: 1, top: 1 };
        this.units.set(u.id, m);
      }
      m.seen = this.frame;
      m.ring.material = mine ? this.footMine : this.footTheirs;

      const r = UNIT_RADIUS * sizeScale(u.maxHp);
      const a = this.fx.anim(u.id, r * BODY);
      const air = u.delay > 0;
      const flying = !air && q.trait === 'flying';
      const drop = air ? DROP_HEIGHT * (u.delay > 0.3 ? 1 : (u.delay / 0.3) ** 2) + (u.delay > 0.3 ? Math.sin(now * 5 + Number(u.id % 7n)) * 0.08 : 0) : 0;
      if (flying) this.flyers.push(u.x, u.y);
      const fly = flying ? FLY_HEIGHT + Math.sin(now * 3 + Number(u.id % 11n)) * 0.08 : 0;
      const alpha = air ? (u.delay > 0.3 ? 0.5 : 0.5 + 0.5 * (1 - u.delay / 0.3)) : 1;

      // Body: sprite, pose frame around a strike, or the token. Fit the longer side to the box.
      const base = troop?.spriteUrl ? spriteImage(troop.spriteUrl) : null;
      const pose = base && troop?.description ? poseFrame(troop.description, troop.flavor ?? '') : null;
      const img = pose && this.fx.posing(u.id) ? pose : base;
      let w: number, h: number;
      if (img) {
        const s = r * 2.9 * BODY;
        const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 1;
        const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;
        w = (s * iw) / Math.max(iw, ih);
        h = (s * ih) / Math.max(iw, ih);
        m.mat.map = this.imageTexture(img);
      } else {
        w = h = r * 2.6 * BODY;
        m.mat.map = this.tokenTexture(troopGlyph(troop?.name ?? '?', troop?.description), mine);
      }
      m.h = h;
      const mat = m.mat;
      mat.opacity = alpha;
      mat.rotation = -a.rot;
      // Slowed: tinted blue. Hit: a white flash.
      const slowed = !air && (q.slowT ?? 0) > 0;
      const f = 1 + a.flash * 1.5 + this.juice.shimmer(u.troopId, now) * 1.4;
      if (slowed) mat.color.setRGB(0.55 * f, 0.78 * f, 1.6 * f);
      else mat.color.setScalar(f);
      const [jsx, jsy] = this.juice.squash(u.troopId, u.delay, now);
      m.sprite.scale.set(w * a.sx * jsx, h * a.sy * jsy, 1);
      // The anim's dx/dy are screen-plane offsets in tiles (dy down the screen, toward you); up is the lift.
      const lift = drop + fly + Math.max(-0.1, a.up);
      this.at(u.x, u.y, lift, m.sprite.position);
      m.sprite.position.x += a.dx;
      m.sprite.position.z += a.dy + a.up;
      m.top = lift + h * a.sy;

      // Charge glow (cast, windup) behind the body.
      m.glow.visible = a.glow > 0.02 && !air;
      if (m.glow.visible) {
        m.glowMat.color.set(a.glowColor);
        m.glowMat.opacity = 0.75 * a.glow;
        m.glow.scale.setScalar(r * BODY * (2.6 + 1.4 * a.glow));
        m.glow.position.copy(m.sprite.position);
        m.glow.position.y += h * 0.45;
      }
      // Dash smear: two faint copies trailing behind.
      if (a.smear > 0 && !m.ghosts) {
        m.ghosts = [0, 1].map(() => {
          const gs = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
          gs.center.set(0.5, 0);
          this.scene.add(gs);
          return gs;
        });
      }
      m.ghosts?.forEach((gs, i) => {
        gs.visible = a.smear > 0;
        if (!gs.visible) return;
        const gm = gs.material;
        gm.map = mat.map;
        gm.opacity = 0.3 * a.smear;
        gs.scale.copy(m!.sprite.scale);
        gs.position.copy(m!.sprite.position);
        gs.position.x += a.smx * (i + 1);
        gs.position.z += a.smy * (i + 1);
      });

      this.at(u.x, u.y, 0.03, m.shadow.position);
      m.shadow.position.x += a.dx * 0.5;
      m.shadow.position.z += (a.dy + a.up) * 0.5;
      m.shadow.material = flying ? this.flyShadowMat : this.shadowMat;
      m.shadow.scale.setScalar(r * (air ? 0.6 + 0.6 * (1 - Math.min(1, u.delay / DEPLOY_DELAY)) : flying ? 0.7 : 1.05));
      m.ring.visible = !air;
      this.at(u.x, u.y, 0.04, m.ring.position);
      m.ring.scale.setScalar(r * 1.05);
    }
    for (const [id, m] of this.units) {
      if (m.seen === this.frame) continue;
      this.scene.remove(m.sprite, m.glow, m.shadow, m.ring);
      m.mat.dispose();
      m.glowMat.dispose();
      for (const gs of m.ghosts ?? []) { this.scene.remove(gs); gs.material.dispose() }
      this.units.delete(id);
    }
  }

  // One texture per loaded image (sprites and pose frames), uploaded once.
  private imageTexture(img: CanvasImageSource): THREE.Texture {
    let t = this.imageTextures.get(img);
    if (!t) {
      t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img as HTMLImageElement);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.imageTextures.set(img, t);
    }
    return t;
  }

  // The placeholder token: a team disc with the troop's glyph, one per (glyph, team).
  private tokenTexture(glyph: string, mine: boolean): THREE.CanvasTexture {
    const key = glyph + '|' + (mine ? 1 : 0);
    let t = this.textures.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    c.width = c.height = 128;
    g.fillStyle = mine ? C.mineDark : C.theirsDark;
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.arc(52, 50, 40, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = mine ? C.mine : C.theirs;
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.stroke();
    g.drawImage(glyphImage(glyph, 72), 26, 26, 76, 76);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, t);
    return t;
  }

  // A drop in flight: a shadow that darkens, a ring that closes in, a target ring that turns.
  // Your released drops still waiting on words or stats stand there as a pulsing silhouette.
  private syncPendings(v: View, now: number): void {
    v.pendings.forEach((p, i) => {
      let m = this.pendings[i];
      if (!m) {
        const mk = (geo: THREE.BufferGeometry) => {
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
          mesh.rotation.x = -Math.PI / 2;
          this.scene.add(mesh);
          return mesh;
        };
        m = { closing: mk(this.ringGeo), target: mk(this.dashGeo), pad: mk(this.shadowGeo) };
        (m.pad.material as THREE.MeshBasicMaterial).color.set('#000000');
        this.pendings.push(m);
      }
      const frac = Math.max(0, Math.min(1, p.age / DEPLOY_DELAY));
      const col = p.side === v.mySide ? C.mine : C.theirs;
      const closing = m.closing.material as THREE.MeshBasicMaterial, target = m.target.material as THREE.MeshBasicMaterial;
      closing.color.set(col);
      closing.opacity = 0.3 + 0.6 * frac;
      target.color.set(col);
      target.opacity = 0.85;
      (m.pad.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.3 * frac;
      m.closing.scale.setScalar(0.9 + 1.5 * (1 - frac));
      m.target.scale.setScalar(0.9);
      m.target.rotation.z = now * 0.8;
      m.pad.scale.setScalar(0.3 + 0.55 * frac);
      this.at(p.x, p.y, 0.05, m.closing.position);
      this.at(p.x, p.y, 0.06, m.target.position);
      this.at(p.x, p.y, 0.035, m.pad.position);
      m.closing.visible = m.target.visible = m.pad.visible = true;
    });
    for (let i = v.pendings.length; i < this.pendings.length; i++) {
      const m = this.pendings[i];
      m.closing.visible = m.target.visible = m.pad.visible = false;
    }

    const drops = v.drops ?? [];
    drops.forEach((d, i) => {
      let s = this.silhouettes[i];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.silhouetteTex, transparent: true, depthWrite: false }));
        s.center.set(0.5, 0);
        this.scene.add(s);
        this.silhouettes.push(s);
      }
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      s.visible = d.phase !== 'refused';
      s.material.opacity = 0.35 + 0.3 * pulse;
      s.scale.setScalar(1.3 + 0.1 * pulse);
      this.at(d.x, d.y, 0.05, s.position);
    });
    for (let i = drops.length; i < this.silhouettes.length; i++) this.silhouettes[i].visible = false;
  }

  // ---------- effects (Fx's particles, rings, shots and trails, drawn in the scene) ----------

  private syncEffects(v: View): void {
    const L = this.fx.live(), now = L.now;
    // Particles: one Points draw for all of them.
    const P = this.parts, n = Math.min(L.particles.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      const p = L.particles[i];
      const age = Math.min(1, (now - p.t0) / p.life);
      this.at(p.x, p.y, p.z, this.v3);
      P.pos[i * 3] = this.v3.x; P.pos[i * 3 + 1] = this.v3.y; P.pos[i * 3 + 2] = this.v3.z;
      const c = color(p.color);
      P.col[i * 3] = c.r; P.col[i * 3 + 1] = c.g; P.col[i * 3 + 2] = c.b;
      const ca = alphaOf(p.color);
      if (p.kind === 0) { P.size[i] = 2 * p.size * (1 + age * 1.6); P.alpha[i] = 0.55 * (1 - age) * ca; P.shape[i] = 0 }
      else if (p.kind === 1) { P.size[i] = p.size * 1.2; P.alpha[i] = (age > 0.7 ? (1 - age) / 0.3 : 1) * ca; P.shape[i] = 1 }
      else { P.size[i] = Math.max(0.08, 2.4 * p.size); P.alpha[i] = (1 - age) * ca; P.shape[i] = 2 }
    }
    const geo = P.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha', 'shape']) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    // Pixels per tile at depth 1, for gl_PointSize.
    (P.points.material as THREE.ShaderMaterial).uniforms.uScale.value = (this.cam.projectionMatrix.elements[5] * this.h * this.renderer.getPixelRatio()) / 2;

    // Impact rings, flat on the ground.
    L.rings.forEach((r, i) => {
      const m = this.ringPool[i] ?? this.addPooled(this.ringPool, this.thinRingGeo, -Math.PI / 2);
      const p = (now - r.t0) / r.dur, e = 1 - (1 - p) * (1 - p);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.copy(color(r.color));
      mat.opacity = Math.max(0, 1 - p) * alphaOf(r.color);
      m.scale.setScalar(Math.max(0.05, r.r0 + (r.r1 - r.r0) * e));
      this.at(r.x, r.y, 0.07, m.position);
      m.visible = true;
    });
    for (let i = L.rings.length; i < this.ringPool.length; i++) this.ringPool[i].visible = false;
    // Explosions (death_burst, a tower falling): a bright flash over the ring while it opens.
    let f = 0;
    for (const r of L.rings) {
      if (r.width < 4) continue;
      const p = (now - r.t0) / r.dur;
      let s = this.flashPool[f];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        s.renderOrder = OVER;
        this.scene.add(s);
        this.flashPool.push(s);
      }
      s.material.color.copy(color(r.color));
      s.material.opacity = Math.max(0, 1 - p * 1.4);
      s.scale.setScalar(r.r1 * (1 + p) * 1.6);
      this.at(r.x, r.y, 0.6, s.position);
      s.visible = true;
      f++;
    }
    for (let i = f; i < this.flashPool.length; i++) this.flashPool[i].visible = false;

    // heal_aura: a soft green disc out to its 2-tile reach, with a ring pulsing out once a second.
    let k = 0;
    for (const u of v.units) {
      if (quirks(u).trait !== 'heal_aura' || u.delay > 0) continue;
      const disc = this.auraPool[k * 2] ?? this.addPooled(this.auraPool, this.shadowGeo, -Math.PI / 2, '#6fe08a');
      const ring = this.auraPool[k * 2 + 1] ?? this.addPooled(this.auraPool, this.thinRingGeo, -Math.PI / 2, '#8af0a2');
      const p = (now + Number(u.id % 997n) * 0.01) % 1;
      (disc.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.06 * Math.sin(p * Math.PI);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - p);
      disc.scale.setScalar(2);
      ring.scale.setScalar(2 * (0.3 + 0.7 * p));
      this.at(u.x, u.y, 0.025, disc.position);
      this.at(u.x, u.y, 0.045, ring.position);
      disc.visible = ring.visible = true;
      k++;
    }
    for (let i = k * 2; i < this.auraPool.length; i++) this.auraPool[i].visible = false;

    this.syncShots(v, L.shots, now);
    this.syncTrails(L.trails, now);
  }

  // Shots: a glowing head on a short tail, arcing a little (lobs arc high over a ground shadow).
  private syncShots(v: View, shots: Shot[], now: number): void {
    const A = this.v3, B = this.v3b;
    shots.forEach((s, i) => {
      let m = this.shotPool[i];
      if (!m) {
        const head = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        const tail = new THREE.Mesh(this.stickGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        const shadow = new THREE.Mesh(this.shadowGeo, this.flyShadowMat);
        shadow.rotation.x = -Math.PI / 2;
        this.scene.add(head, tail, halo, shadow);
        head.renderOrder = tail.renderOrder = halo.renderOrder = OVER;
        this.shotPool.push((m = { head, tail, halo, shadow }));
      }
      const p = Math.min(1, (now - s.t0) / s.dur), q = Math.max(0, p - (s.arc ? 0.15 : 0.3));
      // Tower shots leave from the top of the tower; troops throw from about chest height.
      const h0 = v.towers.some(t => Math.hypot(t.x - s.fx, t.y - s.fy) < towerRadius(t.lane ?? 0) + 0.2) ? 3 : 0.6 + this.airAt(s.fx, s.fy);
      const h1 = 0.5 + this.airAt(s.tx, s.ty);
      const hgt = (t: number) => h0 + (h1 - h0) * t + Math.sin(t * Math.PI) * (s.arc || 0.35);
      this.at(s.fx + (s.tx - s.fx) * p, s.fy + (s.ty - s.fy) * p, hgt(p), A);
      this.at(s.fx + (s.tx - s.fx) * q, s.fy + (s.ty - s.fy) * q, hgt(q), B);
      const c = color(s.color);
      const rad = 0.045 * s.width * (s.orb || s.arc ? 1.4 : 1);
      m.head.position.copy(A);
      m.head.scale.setScalar(rad);
      (m.head.material as THREE.MeshBasicMaterial).color.copy(c).lerp(WHITE, 0.5);
      const tm = m.tail.material as THREE.MeshBasicMaterial;
      tm.color.copy(c);
      tm.opacity = 0.7;
      this.span(m.tail, B, A, rad * 0.7);
      m.halo.visible = true;
      m.halo.material.color.copy(c);
      m.halo.material.opacity = s.orb ? 0.9 : 0.5;
      m.halo.scale.setScalar(rad * (s.orb ? 9 : 5));
      m.halo.position.copy(A);
      m.shadow.visible = s.arc > 0;
      if (s.arc) {
        this.at(s.fx + (s.tx - s.fx) * p, s.fy + (s.ty - s.fy) * p, 0.04, m.shadow.position);
        m.shadow.scale.setScalar(0.18);
      }
      m.head.visible = m.tail.visible = true;
    });
    for (let i = shots.length; i < this.shotPool.length; i++) {
      const m = this.shotPool[i];
      m.head.visible = m.tail.visible = m.halo.visible = m.shadow.visible = false;
    }
  }

  // Slash arcs, breath cones, thrust and dash streaks, chain bolts. One object per live trail,
  // made when it appears (they last a fraction of a second), sharing geometry where the shape is fixed.
  private syncTrails(trails: Trail[], now: number): void {
    for (const tr of trails) {
      const p = (now - tr.t0) / tr.dur;
      let o = this.trailObjs.get(tr);
      if (!o) {
        o = this.makeTrail(tr);
        o.obj.traverse(c => (c.renderOrder = OVER));
        this.scene.add(o.obj);
        this.trailObjs.set(tr, o);
      }
      o.seen = this.frame;
      o.obj.visible = p >= 0 && p <= 1;
      const fade = Math.max(0, 1 - p);
      if (tr.kind === 'swipe') {
        const geo = (o.obj.children[0] as THREE.Mesh).geometry;
        geo.setDrawRange(0, 6 * Math.ceil(SWIPE_SEGS * Math.min(1, p / 0.4)));
        o.mats[0].opacity = 0.9 * fade;
      } else if (tr.kind === 'cone') {
        o.obj.scale.setScalar(tr.len * (0.6 + 0.4 * Math.min(1, p * 3)));
        o.mats[0].opacity = 0.4 * fade;
      } else if (tr.kind === 'line') {
        o.mats[0].opacity = 0.85 * fade;
      } else {
        const flick = fade * (0.6 + 0.4 * Math.sin(p * 40));
        o.mats[0].opacity = flick;
        o.mats[1].opacity = flick;
      }
    }
    for (const [tr, o] of this.trailObjs) {
      if (o.seen === this.frame) continue;
      this.scene.remove(o.obj);
      for (const mt of o.mats) mt.dispose();
      if (tr.kind === 'swipe') (o.obj.children[0] as THREE.Mesh).geometry.dispose();
      this.trailObjs.delete(tr);
    }
  }

  private makeTrail(tr: Trail): { obj: THREE.Object3D; mats: THREE.MeshBasicMaterial[]; seen: number } {
    const mat = () => new THREE.MeshBasicMaterial({ color: color(tr.color), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const obj = new THREE.Group();
    const mats = [mat()];
    // Facing: the trail's board angle, turned into the scene.
    const yaw = () => {
      this.at(tr.x, tr.y, 0, this.v3);
      this.at(tr.x + Math.cos(tr.ang), tr.y + Math.sin(tr.ang), 0, this.v3b);
      return Math.atan2(-(this.v3b.z - this.v3.z), this.v3b.x - this.v3.x);
    };
    if (tr.kind === 'swipe') {
      const geo = new THREE.RingGeometry(Math.max(0.1, tr.len - 0.14), tr.len, SWIPE_SEGS, 1, -1.1, 2.2);
      const mesh = new THREE.Mesh(geo, mats[0]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.y = tr.dir < 0 ? -1 : 1;
      obj.add(mesh);
      this.at(tr.x, tr.y, 0.5 + this.airAt(tr.x, tr.y), obj.position);
      obj.rotation.y = yaw();
    } else if (tr.kind === 'cone') {
      const mesh = new THREE.Mesh(this.coneGeo, mats[0]);
      mesh.rotation.x = -Math.PI / 2;
      obj.add(mesh);
      this.at(tr.x, tr.y, 0.35 + this.airAt(tr.x, tr.y), obj.position);
      obj.rotation.y = yaw();
    } else if (tr.kind === 'line') {
      const mesh = new THREE.Mesh(this.stickGeo, mats[0]);
      const h = 0.45 + this.airAt(tr.x, tr.y);
      this.span(mesh, this.at(tr.x, tr.y, h, new THREE.Vector3()), this.at(tr.x2, tr.y2, h, new THREE.Vector3()), 0.02 * tr.width);
      obj.add(mesh);
    } else if (tr.pts) {
      mats.push(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
      const pts = tr.pts;
      for (let i = 2; i < pts.length; i += 2) {
        const a = this.at(pts[i - 2], pts[i - 1], 0.55 + this.airAt(pts[i - 2], pts[i - 1]), new THREE.Vector3());
        const b = this.at(pts[i], pts[i + 1], 0.55 + this.airAt(pts[i], pts[i + 1]), new THREE.Vector3());
        const outer = new THREE.Mesh(this.stickGeo, mats[0]), core = new THREE.Mesh(this.stickGeo, mats[1]);
        this.span(outer, a, b, 0.07);
        this.span(core, a, b, 0.025);
        obj.add(outer, core);
      }
    }
    return { obj, mats, seen: this.frame };
  }

  // How high effects at (x, y) start: a flying unit's height if one is there, else the ground.
  private airAt(x: number, y: number): number {
    const f = this.flyers;
    for (let i = 0; i < f.length; i += 2) if (Math.abs(f[i] - x) < 0.45 && Math.abs(f[i + 1] - y) < 0.45) return FLY_HEIGHT;
    return 0;
  }

  // Stretch the unit stick from a to b with the given radius.
  private span(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const d = this.v3c.subVectors(b, a), len = d.length() || 1e-4;
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
    m.scale.set(radius, len, radius);
  }

  private addPooled(pool: THREE.Mesh[], geo: THREE.BufferGeometry, rotX: number, col = '#ffffff'): THREE.Mesh {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = rotX;
    this.scene.add(m);
    pool.push(m);
    return m;
  }

  private syncCursor(v: View, now: number): void {
    this.aimRing.visible = !!v.aim;
    if (v.aim) {
      this.at(v.aim[0], v.aim[1], 0.05, this.aimRing.position);
      this.aimRing.scale.setScalar(1 + Math.sin(now * 6) * 0.05);
    }
    this.lockRing.visible = this.beam.visible = !!v.lock;
    if (v.lock) {
      const pulse = Math.sin(now * 4) * 0.5 + 0.5;
      this.at(v.lock[0], v.lock[1], 0.06, this.lockRing.position);
      this.lockRing.rotation.z += 0.02;
      this.lockRing.scale.setScalar(1 + pulse * 0.2);
      this.at(v.lock[0], v.lock[1], 4, this.beam.position);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + pulse * 0.25;
    }
  }

  // ---------- 2D overlay ----------

  private drawOverlay(v: View, now: number, real: number): void {
    const g = this.g, dpr = devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    v.towers.forEach(tw => {
      if (tw.hp <= 0) return;
      const p = this.project(tw.x, tw.y, tw.lane === KING_LANE ? 4.9 : 3.9);
      if (!p) return;
      const s = this.scaleAt(tw.x, tw.y);
      const col = tw.side === v.mySide ? C.mine : C.theirs;
      this.bar(p[0] - 30 * s, p[1], 60 * s, Math.max(3, 5 * s), tw.hp / tw.maxHp, col);
      this.outlined(String(Math.ceil(tw.hp)), p[0], p[1] - 5 * s, Math.max(9, Math.round(12 * s)), C.text);
    });

    for (const p of v.pendings) {
      const q = this.project(p.x, p.y);
      if (!q) continue;
      const mine = p.side === v.mySide;
      const left = DEPLOY_DELAY - p.age;
      this.outlined(left > 0.05 ? left.toFixed(1) : '…', q[0], q[1] + 4, 13, mine ? C.text : C.theirsLight);
      if (!mine) this.pill('INCOMING', q[0], q[1] - 24, 10, C.theirsDark, C.theirs, '#ffffff');
    }
    // Your drops waiting on words or stats: what you said, and "designing…" then the name.
    for (const d of v.drops ?? []) {
      const q = this.project(d.x, d.y, 1.7);
      if (!q) continue;
      const refused = d.phase === 'refused';
      g.globalAlpha = refused ? Math.max(0, 1 - d.age / 1400) : 1;
      this.pill(d.text, q[0], q[1], 11, 'rgba(13,16,32,0.9)', refused ? C.theirs : C.mine, refused ? C.theirsLight : C.text);
      if (d.sub) this.outlined(d.sub, q[0], q[1] - 14, 11, refused ? C.theirsLight : d.phase === 'designing' && d.sub !== 'designing…' ? C.mineLight : C.text);
      g.globalAlpha = 1;
    }

    this.drawStatus(v);
    this.drawLabels(v, now);
    this.drawFloaters();
    this.juice.drawOverlay(g, v, (x, y, h) => this.project(x, y, h), now, real);
    if (this.hurt > 0) this.drawHurt();
    this.fx.drawBanners(g, this.w / 2, this.h * 0.38, Math.min(this.w, 720));
    if (v.input) drawInput(g, v.input);
  }

  // Screen px of a scene point, and how many px a tile spans there. Null behind the camera.
  private screenOf(p: THREE.Vector3): [number, number, number] | null {
    const depth = -this.v3c.copy(p).applyMatrix4(this.cam.matrixWorldInverse).z;
    if (depth < 0.1) return null;
    const q = this.v3c.copy(p).project(this.cam);
    return [((q.x + 1) / 2) * this.w, ((1 - q.y) / 2) * this.h, (this.cam.projectionMatrix.elements[5] * this.h) / 2 / depth];
  }

  // Shield ring (its arc is the shield left), stun stars over the head, and HP bars over damaged units.
  private drawStatus(v: View): void {
    const g = this.g, now = performance.now() / 1000;
    for (const u of v.units) {
      const m = this.units.get(u.id);
      if (!m || u.delay > 0) continue;
      const q = quirks(u);
      const max = q.maxShield ?? 0, sh = q.shield ?? 0;
      const stunned = (q.stunT ?? 0) > 0, hurt = u.hp < u.maxHp;
      if (!(max > 0 && sh > 0) && !stunned && !hurt) continue;
      const body = this.v3b.copy(m.sprite.position);
      body.y += m.h * 0.45;
      const c = this.screenOf(body);
      if (!c) continue;
      const [x, y, T] = c;
      const r = UNIT_RADIUS * sizeScale(u.maxHp) * BODY * T;
      if (max > 0 && sh > 0) {
        const R = r * 1.45, frac = Math.min(1, sh / max);
        g.strokeStyle = '#bfe8ff';
        g.lineWidth = Math.max(1.5, r * 0.08);
        g.globalAlpha = 0.3;
        g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 0.95;
        g.lineWidth = Math.max(2, r * 0.12);
        g.lineCap = 'round';
        g.beginPath(); g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
        g.lineCap = 'butt';
        g.globalAlpha = 1;
      }
      const topY = y - (m.h * 0.6) * T;
      if (stunned) {
        g.fillStyle = '#fff27a';
        const seed = Number(u.id % 13n), hy = topY - r * 0.25;
        for (let i = 0; i < 3; i++) {
          const a = now * 6 + seed + (i / 3) * Math.PI * 2;
          const sx = x + Math.cos(a) * r * 0.8, sy = hy + Math.sin(a) * r * 0.25;
          const s = Math.max(3, r * 0.26) * (0.8 + 0.2 * Math.sin(a));
          g.globalAlpha = 0.65 + 0.35 * Math.sin(a);
          g.beginPath(); // four-point sparkle
          g.moveTo(sx, sy - s);
          g.quadraticCurveTo(sx, sy, sx + s, sy);
          g.quadraticCurveTo(sx, sy, sx, sy + s);
          g.quadraticCurveTo(sx, sy, sx - s, sy);
          g.quadraticCurveTo(sx, sy, sx, sy - s);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (hurt) {
        const bw = Math.max(18, Math.min(70, r * 1.5));
        this.bar(x - bw / 2, topY - Math.max(4, r * 0.2), bw, Math.max(3, r * 0.14), u.hp / u.maxHp, u.side === v.mySide ? C.mine : C.theirs);
      }
    }
  }

  // Damage numbers rise off whatever was hit, sized by distance.
  private drawFloaters(): void {
    const g = this.g, L = this.fx.live();
    g.textAlign = 'center';
    g.lineJoin = 'round';
    for (const f of L.floaters) {
      const age = (L.now - f.t0) / 0.8;
      const rise = (1 - (1 - age) * (1 - age)) * 0.9;
      const c = this.screenOf(this.at(f.x, f.y, (f.size > 10 ? 4.2 : 1.3) + rise, this.v3b));
      if (!c) continue;
      const pop = age < 0.12 ? 1 + (0.12 - age) * 3 : 1;
      const size = Math.round(Math.min(30, Math.max(11, f.size * 1.6 * (c[2] / 40))) * pop);
      g.globalAlpha = age > 0.6 ? (1 - age) / 0.4 : 1;
      g.font = `800 ${size}px ${FONT}`;
      const text = String(Math.round(f.amt));
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8,10,20,0.85)';
      g.strokeText(text, c[0], c[1]);
      g.fillStyle = f.color;
      g.fillText(text, c[0], c[1]);
    }
    g.globalAlpha = 1;
  }

  // Red at the edges of the screen, like taking damage in a shooter.
  private drawHurt(): void {
    const g = this.g, w = this.w, h = this.h;
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
    grad.addColorStop(0, 'rgba(255,40,60,0)');
    grad.addColorStop(1, `rgba(255,40,60,${(0.7 * this.hurt).toFixed(3)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  // One name per troop above its lead unit, with the cost (or the drop countdown) over it. A
  // small tower before the name marks a troop that only chases buildings. Nearest troops place
  // first; a farther label that would land on one already placed steps up once, else drops its name.
  private drawLabels(v: View, now: number): void {
    const lead = this.lead, g = this.g;
    lead.clear();
    for (const u of v.units) {
      const l = lead.get(u.troopId);
      if (!l || u.id < l.id) lead.set(u.troopId, u);
    }
    const list = this.labels;
    list.length = 0;
    for (const u of lead.values()) {
      const troop: DrawTroop | undefined = v.troops.get(u.troopId);
      const m = this.units.get(u.id);
      if (!troop || !m) continue;
      const c = this.screenOf(this.at(u.x, u.y, m.top + 0.3, this.v3b));
      if (c) list.push({ u, troop, x: c[0], y: c[1], T: c[2] });
    }
    list.sort((a, b) => b.T - a.T);
    const boxes = this.labelBoxes;
    boxes.length = 0;
    const free = (x0: number, y0: number, x1: number, y1: number) => {
      for (let i = 0; i < boxes.length; i += 4) if (x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1]) return false;
      return true;
    };
    for (const { u, troop, x, y: y0, T } of list) {
      const mine = u.side === v.mySide;
      const s = Math.min(1.5, Math.max(0.8, T / 40));
      let name = troop.name;
      if (name.length > 16) name = name.slice(0, 15) + '…';
      const size = Math.round(13 * s);
      const ink = mine ? C.mineLight : C.theirsLight;
      const buildings = quirks(u).targets === 'buildings';
      g.font = `700 ${size}px ${FONT}`;
      const icon = buildings ? 13 * s : 0;
      const w = g.measureText(name).width + icon;
      const ph = 11 * s * 1.35;
      // Name and pill as one block: pill on top, name under it.
      let y = y0, placed = false;
      for (const dy of [0, -(size + ph + 6)]) {
        if (free(x - w / 2 - 2, y0 + dy - size - ph - 4, x + w / 2 + 2, y0 + dy + 3)) { y = y0 + dy; placed = true; break }
      }
      const py = y - size - 8 * s;
      if (placed) {
        boxes.push(x - w / 2 - 2, y - size - ph - 4, x + w / 2 + 2, y + 3);
        const st = this.juice.stamp(u.troopId, now); // the name slams in when the design arrives
        g.globalAlpha = st.alpha;
        this.outlined(name, x + icon / 2, y, Math.round(size * st.scale), ink);
        g.globalAlpha = 1;
        if (buildings) this.towerIcon(x - w / 2 + 5 * s, y - size * 0.35, s, ink);
      } else if (!free(x - 10, py - ph / 2, x + 10, py + ph / 2)) continue;
      // The cost stays hidden until the troop lands, then rolls like a slot reel (juice.ts).
      const cost = u.delay > 0 ? null : this.juice.costLabel(u.troopId, now);
      if (u.delay > 0) this.pill(u.delay.toFixed(1), x, py, 11 * s, 'rgba(13,16,32,0.9)', mine ? C.mine : C.theirs, C.text);
      else if (cost) {
        if (cost.glow) { g.shadowColor = cost.glow; g.shadowBlur = 14 }
        this.pill(cost.text, x, py, 11 * s * cost.scale, cost.fill, cost.stroke, cost.ink, EMBER);
        g.shadowColor = 'transparent'; g.shadowBlur = 0;
      } else this.pill(String(troop.cost), x, py, 11 * s, 'rgba(58,24,8,0.94)', C.elixir, '#ffe2c4', EMBER);
      if (!placed) boxes.push(x - 10, py - ph / 2, x + 10, py + ph / 2);
    }
  }
  private labels: { u: DrawUnit; troop: DrawTroop; x: number; y: number; T: number }[] = [];
  private labelBoxes: number[] = [];
  private lead = new Map<bigint, DrawUnit>();

  // A tiny crenellated tower, about 10 px at s = 1, centred on (x, y).
  private towerIcon(x: number, y: number, s: number, color: string): void {
    const g = this.g;
    g.fillStyle = 'rgba(8,10,20,0.85)';
    g.fillRect(x - 5 * s, y - 6 * s, 10 * s, 12 * s);
    g.fillStyle = color;
    g.fillRect(x - 3.5 * s, y - 2 * s, 7 * s, 6.5 * s);
    for (const dx of [-3.5, -1, 1.5]) g.fillRect(x + dx * s, y - 4.5 * s, 2 * s, 2.5 * s);
  }

  private makePoints(): Points {
    const pos = new Float32Array(MAX_POINTS * 3), col = new Float32Array(MAX_POINTS * 3);
    const size = new Float32Array(MAX_POINTS), alpha = new Float32Array(MAX_POINTS), shape = new Float32Array(MAX_POINTS);
    const geo = new THREE.BufferGeometry();
    const attr = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(pos, 3));
    geo.setAttribute('color', attr(col, 3));
    geo.setAttribute('size', attr(size, 1));
    geo.setAttribute('alpha', attr(alpha, 1));
    geo.setAttribute('shape', attr(shape, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } }, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      vertexColors: true, transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false; // the bounding sphere would go stale as particles move
    points.renderOrder = OVER;
    this.scene.add(points);
    return { points, pos, col, size, alpha, shape };
  }

  // How big things look at (x, y), relative to the middle of your half: labels shrink with distance.
  private scaleAt(x: number, y: number): number {
    const a = this.project(x, y), b = this.project(x + 1, y);
    if (!a || !b) return 1;
    return Math.hypot(b[0] - a[0], b[1] - a[1]) / 40;
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x, y, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private outlined(s: string, x: number, y: number, size: number, color: string): void {
    const g = this.g;
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8,10,20,0.85)';
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  // A rounded label. With `flame`, a small flame sits before the number: costs are paid in embers.
  private pill(text: string, x: number, y: number, size: number, fill: string, stroke: string, ink: string, flame?: string): void {
    const g = this.g;
    g.font = `800 ${size.toFixed(1)}px ${FONT}`;
    const tw = g.measureText(text).width, fw = flame ? size * 0.75 : 0;
    const w = tw + fw + size * 0.9, h = size * 1.35;
    roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.stroke();
    if (flame) flameGlyph(g, x - (tw + fw) / 2 + fw * 0.4, y, size * 0.95, flame);
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + fw / 2, y + size * 0.05);
    g.textBaseline = 'alphabetic';
  }
}

const EMBER = '#ff8a3d'; // the embers amber; proposal, see meta/aesthetics.md

// A small two-tone flame, h tall, centred on (x, y): the embers icon beside costs.
export function flameGlyph(g: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
  const r = h / 2;
  const tongue = (k: number) => {
    g.beginPath();
    g.moveTo(x, y - r * k);
    g.bezierCurveTo(x + r * 0.15 * k, y - r * 0.35 * k, x + r * 0.62 * k, y - r * 0.1 * k, x + r * 0.5 * k, y + r * 0.45 * k);
    g.bezierCurveTo(x + r * 0.42 * k, y + r * 0.85 * k, x - r * 0.42 * k, y + r * 0.85 * k, x - r * 0.5 * k, y + r * 0.45 * k);
    g.bezierCurveTo(x - r * 0.6 * k, y + r * 0.05 * k, x - r * 0.2 * k, y - r * 0.3 * k, x, y - r * k);
    g.closePath();
    g.fill();
  };
  g.fillStyle = color;
  tongue(1);
  g.fillStyle = '#ffe9a8';
  const yy = y; y = yy + r * 0.28; tongue(0.5); y = yy;
}

// Same rule as the sim: the king sleeps until it is hit or loses a princess tower.
function sleeping(tw: DrawTower, all: DrawTower[]): boolean {
  if (tw.lane !== KING_LANE || tw.hp <= 0 || tw.hp < tw.maxHp) return false;
  return !all.some(o => o.side === tw.side && o.lane !== undefined && o.lane !== KING_LANE && o.hp <= 0);
}

// Empty a group whose meshes own their geometry and materials (the layout, the pockets).
function clearGroup(g: THREE.Group): void {
  g.traverse(o => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  g.clear();
}

// A ring cut into dashes, for the target ring under a drop.
function dashedRing(inner: number, outer: number, dashes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) parts.push(new THREE.RingGeometry(inner, outer, 4, 1, i * step, step * 0.55));
  const pos: number[] = [];
  for (const p of parts) {
    const geo = p.toNonIndexed(), a = geo.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
    p.dispose();
    geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// A soft white disc fading to nothing at the edge, tinted per use (glows, shot halos).
function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Head and shoulders, standing on the bottom edge: a drop waiting on its design.
function silhouetteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = C.mineLight;
  g.beginPath();
  g.arc(32, 20, 11, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(12, 64);
  g.quadraticCurveTo(12, 34, 32, 34);
  g.quadraticCurveTo(52, 34, 52, 64);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
