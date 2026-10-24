// Three.js POV view of the board: you stand behind your own towers and look down the arena.
// Takes the same View and answers the same toWorld as Board, so input and deploys don't change.
// The 3D scene renders into its own canvas; names, bars, effects and the hand cursor go on the
// flat board's 2D canvas, which sits on top and stays the one that gets the mouse.
import * as THREE from 'three';
import { ARENA_H, ARENA_W, DEPLOY_DELAY, MID_Y, TOWER_RADIUS, UNIT_RADIUS, type Side } from '../../shared/arena';
import { Fx, roundRect, towerKey } from './fx';
import { drawInput } from './input/draw';
import type { DrawTower, DrawTroop, DrawUnit, View } from './render';
import { glyphImage, sizeScale, troopGlyph } from './tokens';

// Where you stand, in your own view coords (your back line is y = 0): height and resting pitch.
export const EYES = {
  tower: { y: -5, h: 7.5, pitch: -0.5 },
  high: { y: -6, h: 13, pitch: -0.78 },
  low: { y: -3, h: 2.6, pitch: -0.12 },
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
  elixir: '#c56cf0',
};
const FONT = 'system-ui, sans-serif';
const DROP_HEIGHT = 3; // tiles; troops hang here until the last 0.3 s of the deploy delay

interface TowerMesh { grp: THREE.Group; base: THREE.Mesh; crown: THREE.Mesh; gem: THREE.Mesh; mat: THREE.MeshStandardMaterial; seen: number }
interface UnitMesh { sprite: THREE.Sprite; shadow: THREE.Mesh; tex: string; seen: number }

export class PovBoard {
  readonly fx = new Fx();
  eye: Eye = 'tower';
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
  private towers = new Map<unknown, TowerMesh>();
  private units = new Map<bigint, UnitMesh>();
  private pendings: THREE.Mesh[] = [];
  private textures = new Map<string, THREE.CanvasTexture>();
  private aimRing: THREE.Mesh;
  private lockRing: THREE.Mesh;
  private beam: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private v3 = new THREE.Vector3();
  private stone = new THREE.MeshStandardMaterial({ color: '#2b3150', roughness: 0.75 });
  private body = new THREE.CylinderGeometry(TOWER_RADIUS, TOWER_RADIUS * 1.15, 2.2, 8);
  private crownGeo = new THREE.CylinderGeometry(TOWER_RADIUS * 1.15, TOWER_RADIUS, 0.5, 8);
  private gemGeo = new THREE.OctahedronGeometry(0.35);
  private shadowGeo = new THREE.CircleGeometry(1, 20);
  private shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false });
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.g = overlay.getContext('2d')!;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const s = this.scene;
    s.background = new THREE.Color(C.bg);
    s.fog = new THREE.Fog(C.bg, 26, 75);
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
    s.add(this.layout);
    this.addSurroundings();

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

  show(on: boolean): void {
    this.canvas.hidden = !on;
  }

  resize(): void {
    this.w = innerWidth;
    this.h = innerHeight;
    this.renderer.setSize(this.w, this.h, false);
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

  draw(v: View): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    this.side = v.mySide;
    this.fx.observe(v, now / 1000);
    this.syncLayout(v.towers);
    this.moveCamera(v, dt, now / 1000);
    this.syncTowers(v);
    this.syncUnits(v, now / 1000);
    this.syncPendings(v);
    this.syncCursor(v, now / 1000);
    this.renderer.render(this.scene, this.cam);
    this.drawOverlay(v);
  }

  // ---------- coordinates ----------

  // Board coords ↔ your view coords: side 1 sees the board turned 180°, like Board does.
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

  private addSurroundings(): void {
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#0e1022', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -1.2;
    outer.receiveShadow = true;
    this.scene.add(outer);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W + 1.2, 1.2, ARENA_H + 1.2), new THREE.MeshStandardMaterial({ color: '#191d36', roughness: 0.9 }));
    plinth.position.y = -0.61;
    plinth.receiveShadow = true;
    this.scene.add(plinth);
    // Distant spires so the horizon has something on it.
    const spire = new THREE.MeshStandardMaterial({ color: '#171a33', roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.1;
      const r = 34 + Math.random() * 14, h = 6 + Math.random() * 16;
      const m = new THREE.Mesh(new THREE.ConeGeometry(2 + Math.random() * 3, h, 5), spire);
      m.position.set(Math.cos(a) * r, h / 2 - 1.2, Math.sin(a) * r * 1.3);
      this.scene.add(m);
    }
  }

  // Halves, grid, lanes and bridges. Lanes and bridges follow the towers, so the board matches
  // whatever layout the match uses.
  private syncLayout(towers: DrawTower[]): void {
    const xs = [...new Set(towers.map(t => this.toView(t.x, t.y)[0]))].sort((a, b) => a - b);
    const key = this.side + ':' + xs.join(',');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const L = this.layout;
    L.clear();
    const flat = (w: number, d: number, vx: number, vy: number, h: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(vx - ARENA_W / 2, h, MID_Y - vy);
      m.receiveShadow = true;
      L.add(m);
    };
    flat(ARENA_W, MID_Y, ARENA_W / 2, MID_Y / 2, 0.001, new THREE.MeshStandardMaterial({ color: C.myHalf, roughness: 0.95 }));
    flat(ARENA_W, MID_Y, ARENA_W / 2, MID_Y * 1.5, 0.001, new THREE.MeshStandardMaterial({ color: C.theirHalf, roughness: 0.95 }));
    const lane = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.05, roughness: 1 });
    for (const x of xs) flat(2, ARENA_H, x, MID_Y, 0.02, lane);

    const pts: THREE.Vector3[] = [];
    for (let x = 1; x < ARENA_W; x++) pts.push(new THREE.Vector3(x - ARENA_W / 2, 0.01, MID_Y), new THREE.Vector3(x - ARENA_W / 2, 0.01, -MID_Y));
    for (let y = 1; y < ARENA_H; y++) pts.push(new THREE.Vector3(-ARENA_W / 2, 0.01, MID_Y - y), new THREE.Vector3(ARENA_W / 2, 0.01, MID_Y - y));
    L.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.04 })));

    const river = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_W, 0.3, 1.6),
      new THREE.MeshStandardMaterial({ color: '#2a3a7a', emissive: '#1b2a6b', emissiveIntensity: 0.6, roughness: 0.25 })
    );
    river.position.y = -0.12;
    L.add(river);
    const bridge = new THREE.MeshStandardMaterial({ color: '#3a3f5e', roughness: 0.8 });
    for (const x of xs) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.2), bridge);
      b.position.set(x - ARENA_W / 2, 0.08, 0);
      b.castShadow = b.receiveShadow = true;
      L.add(b);
    }
  }

  private moveCamera(v: View, dt: number, now: number): void {
    // Your head turns a little toward where you point: the hand cursor if there is one, else the mouse.
    const p = v.input?.cursor ? [v.input.cursor.x, v.input.cursor.y] : this.mouse;
    const nx = p ? (p[0] / this.w) * 2 - 1 : 0, ny = p ? -(p[1] / this.h) * 2 + 1 : 0;
    const k = 1 - Math.exp(-dt * 2.5);
    this.yaw += (-nx * 0.22 - this.yaw) * k;
    this.pitch += (ny * 0.1 - this.pitch) * k;
    const e = EYES[this.eye];
    const [shx, shy] = this.fx.shake();
    this.cam.position.set(Math.sin(now * 0.7) * 0.05 + shx * 0.01, e.h + Math.sin(now * 1.4) * 0.03 + shy * 0.01, MID_Y - e.y);
    this.cam.rotation.set(e.pitch + this.pitch, this.yaw, 0);
    this.cam.updateMatrixWorld();
  }

  private syncTowers(v: View): void {
    v.towers.forEach((tw, i) => {
      const key = towerKey(tw, i);
      let t = this.towers.get(key);
      if (!t) {
        const grp = new THREE.Group();
        const base = new THREE.Mesh(this.body, this.stone);
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
        t = { grp, base, crown, gem, mat, seen: 0 };
        this.towers.set(key, t);
      }
      t.seen = this.frame;
      const col = tw.side === v.mySide ? C.mine : C.theirs;
      t.mat.color.set(col);
      t.mat.emissive.set(col);
      t.mat.emissiveIntensity = 0.35 + this.fx.towerFlash(key) * 1.5;
      this.at(tw.x, tw.y, 0, t.grp.position);
      const alive = tw.hp > 0;
      t.crown.visible = t.gem.visible = alive;
      t.base.scale.y = alive ? 1 : 0.25;
      t.base.position.y = alive ? 1.1 : 0.28;
      t.gem.rotation.y += 0.02;
    });
    for (const [key, t] of this.towers) {
      if (t.seen === this.frame) continue;
      this.scene.remove(t.grp);
      this.towers.delete(key);
    }
  }

  // Troops are billboards: a team disc with the troop's glyph, standing on a contact shadow.
  private syncUnits(v: View, now: number): void {
    for (const u of v.units) {
      const troop = v.troops.get(u.troopId);
      const mine = u.side === v.mySide;
      const tex = troopGlyph(troop?.name ?? '?', troop?.description) + '|' + (mine ? 1 : 0);
      let m = this.units.get(u.id);
      if (!m || m.tex !== tex) {
        if (m) this.scene.remove(m.sprite);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(tex, mine), transparent: true }));
        sprite.center.set(0.5, 0);
        const shadow = m?.shadow ?? new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        this.scene.add(sprite, shadow);
        m = { sprite, shadow, tex, seen: 0 };
        this.units.set(u.id, m);
      }
      m.seen = this.frame;
      const r = UNIT_RADIUS * sizeScale(u.maxHp);
      const a = this.fx.anim(u.id, r);
      const air = u.delay > 0;
      const lift = air ? DROP_HEIGHT * (u.delay > 0.3 ? 1 : (u.delay / 0.3) ** 2) + (u.delay > 0.3 ? Math.sin(now * 5 + Number(u.id % 7n)) * 0.08 : 0) : 0;
      const mat = m.sprite.material;
      mat.opacity = air ? (u.delay > 0.3 ? 0.5 : 0.5 + 0.5 * (1 - u.delay / 0.3)) : 1;
      mat.color.setScalar(1 + a.flash * 1.5);
      const s = r * 2.6;
      m.sprite.scale.set(s * a.sx, s * a.sy, 1);
      this.at(u.x, u.y, lift - a.dy, m.sprite.position);
      m.sprite.position.x += a.dx;
      this.at(u.x, u.y, 0.03, m.shadow.position);
      m.shadow.scale.setScalar(r * (air ? 0.6 + 0.6 * (1 - Math.min(1, u.delay / DEPLOY_DELAY)) : 1.1));
    }
    for (const [id, m] of this.units) {
      if (m.seen === this.frame) continue;
      this.scene.remove(m.sprite, m.shadow);
      m.sprite.material.dispose();
      this.units.delete(id);
    }
  }

  private texture(key: string, mine: boolean): THREE.CanvasTexture {
    let t = this.textures.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = mine ? C.mineDark : C.theirsDark;
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = mine ? C.mine : C.theirs;
    g.stroke();
    g.drawImage(glyphImage(key.slice(0, key.lastIndexOf('|')), 72), 26, 26, 76, 76);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, t);
    return t;
  }

  // A drop in flight: a ring that closes in on the landing spot.
  private syncPendings(v: View): void {
    v.pendings.forEach((p, i) => {
      let m = this.pendings[i];
      if (!m) {
        m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        this.scene.add(m);
        this.pendings.push(m);
      }
      const frac = Math.max(0, Math.min(1, p.age / DEPLOY_DELAY));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(p.side === v.mySide ? C.mine : C.theirs);
      mat.opacity = 0.35 + 0.6 * frac;
      m.scale.setScalar(0.9 + 1.5 * (1 - frac));
      this.at(p.x, p.y, 0.05, m.position);
      m.visible = true;
    });
    for (let i = v.pendings.length; i < this.pendings.length; i++) this.pendings[i].visible = false;
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

  private drawOverlay(v: View): void {
    const g = this.g, dpr = devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    // Fx draws in screen px from a tile size; use the size of a tile mid-way up your half.
    const toScreen = (x: number, y: number): [number, number] => this.project(x, y) ?? [-999, -999];
    const [mx, my] = this.toBoard(ARENA_W / 2, MID_Y / 2);
    const a = this.project(mx, my), b = this.project(mx + 1, my);
    const T = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 20;
    this.fx.drawGround(g, toScreen, T);

    v.towers.forEach(tw => {
      if (tw.hp <= 0) return;
      const p = this.project(tw.x, tw.y, 3.9);
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

    this.drawLabels(v);
    this.fx.drawAir(g, toScreen, T);
    this.fx.drawBanners(g, this.w / 2, this.h * 0.38, Math.min(this.w, 720));
    if (v.input) drawInput(g, v.input);
  }

  // One name per troop above its lead unit, with the cost (or the drop countdown) beside it.
  private drawLabels(v: View): void {
    const lead = new Map<bigint, DrawUnit>();
    for (const u of v.units) {
      const l = lead.get(u.troopId);
      if (!l || u.id < l.id) lead.set(u.troopId, u);
      if (u.delay <= 0 && u.hp < u.maxHp) {
        const r = UNIT_RADIUS * sizeScale(u.maxHp);
        const p = this.project(u.x, u.y, r * 2.8);
        if (p) {
          const s = this.scaleAt(u.x, u.y);
          this.bar(p[0] - 14 * s, p[1], 28 * s, Math.max(2, 3 * s), u.hp / u.maxHp, u.side === v.mySide ? C.mine : C.theirs);
        }
      }
    }
    for (const u of lead.values()) {
      const troop: DrawTroop | undefined = v.troops.get(u.troopId);
      if (!troop) continue;
      const mine = u.side === v.mySide;
      const r = UNIT_RADIUS * sizeScale(u.maxHp);
      const air = u.delay > 0;
      const p = this.project(u.x, u.y, r * 2.8 + (air ? DROP_HEIGHT : 0) + 0.3);
      if (!p) continue;
      const s = Math.min(1.4, Math.max(0.7, this.scaleAt(u.x, u.y)));
      let name = troop.name;
      if (name.length > 16) name = name.slice(0, 15) + '…';
      this.outlined(name, p[0], p[1] - 6, Math.round(12 * s), mine ? C.mineLight : C.theirsLight);
      if (air) this.pill(u.delay.toFixed(1), p[0], p[1] - 24 * s, 10 * s, 'rgba(13,16,32,0.9)', mine ? C.mine : C.theirs, C.text);
      else this.pill(String(troop.cost), p[0], p[1] - 24 * s, 10 * s, 'rgba(48,16,76,0.94)', C.elixir, '#f3dcff');
    }
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

  private pill(text: string, x: number, y: number, size: number, fill: string, stroke: string, ink: string): void {
    const g = this.g;
    g.font = `800 ${size.toFixed(1)}px ${FONT}`;
    const w = g.measureText(text).width + size * 0.9, h = size * 1.35;
    roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y + size * 0.05);
    g.textBaseline = 'alphabetic';
  }
}
