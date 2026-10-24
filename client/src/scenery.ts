// The world around the arena, in the warmth-and-frost theme (meta/aesthetics.md): snowy faceted
// ground, snow-capped crags up both sides of a valley, pine woods and rocks beside the board, braziers whose
// firelight pools on the snow, standards in the enemy's colour beside their half, and snow falling over it all.
// Scene coords as in pov.ts: the board spans x ±ARENA_W/2 and z ±MID_Y, you look toward −z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_W, MID_Y } from '../../shared/arena';

const HALF_W = ARENA_W / 2;
const GROUND_Y = -1.2; // the plain around the raised board

// Same layout every load.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paint each triangle of a non-indexed geometry one flat colour, picked from its centre.
function paint(geo: THREE.BufferGeometry, pick: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const c = pick((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const tone = (hex: string, rand: () => number, spread = 0.06) => new THREE.Color(hex).offsetHSL(0, 0, (rand() - 0.5) * spread);

export class Scenery {
  private fires: { flame: THREE.Mesh; core: THREE.Mesh; light: THREE.PointLight; phase: number }[] = [];
  private flags: { mesh: THREE.Mesh; base: Float32Array; phase: number }[] = [];
  private cloth = new THREE.MeshStandardMaterial({ color: '#a3303e', roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  private snow: THREE.Points;
  private embers: THREE.Points;
  private emberLife: Float32Array;
  private still = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private scene: THREE.Scene) {
    const rand = seeded(13);
    this.ground(rand);
    this.mountains(rand);
    this.woods(rand);
    this.braziers();
    this.banners();
    this.snow = this.snowfall(rand);
    [this.embers, this.emberLife] = this.emberPoints();
  }

  // Faceted snow: flat round the board, rolling up into drifts further out.
  private ground(rand: () => number): void {
    const geo = new THREE.PlaneGeometry(240, 240, 72, 72);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const out = Math.max(0, Math.max(Math.abs(x) - HALF_W - 3, Math.abs(z) - MID_Y - 3));
      const lift = Math.min(1, out / 40) ** 2 * 5;
      p.setY(i, GROUND_Y + (out > 0 ? lift + (rand() - 0.3) * Math.min(1, out * 0.06) : 0));
    }
    const snowy = paint(geo, () => tone('#1f2a48', rand, 0.025));
    const m = new THREE.Mesh(snowy, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // The arena sits in a valley: snow-capped crags climb both sides (the camera looks down too
  // steeply to see a horizon, so the mountains stand where the view reaches), taller further off.
  private mountains(rand: () => number): void {
    const parts: THREE.BufferGeometry[] = [];
    const peak = (x: number, z: number, h: number, w: number) => {
      const geo = new THREE.ConeGeometry(w, h, 6 + Math.floor(rand() * 3), 3).toNonIndexed();
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k);
        if (y > h / 2 - 0.01) continue; // keep the peak sharp
        const j = 0.14 * w * (0.5 - y / h);
        pos.setXYZ(k, pos.getX(k) + (rand() - 0.5) * j, y + (rand() - 0.5) * h * 0.06, pos.getZ(k) + (rand() - 0.5) * j);
      }
      const line = h * (0.45 + rand() * 0.15); // snow starts this far below the top
      paint(geo, (_x, y) => y > h / 2 - line - (rand() - 0.5) * h * 0.16 ? tone('#8e9fbd', rand, 0.06) : tone('#1a1f3b', rand, 0.04));
      geo.rotateY(rand() * Math.PI);
      geo.translate(x, GROUND_Y + h / 2 - 0.6, z);
      parts.push(geo);
    };
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        peak(side * (23 + rand() * 6 + i * 1.2), 2 - i * 5.5 - rand() * 3, 6 + rand() * 6 + i * 0.9, 5 + rand() * 3);
        if (rand() < 0.7) peak(side * (30 + rand() * 8 + i), 2 - i * 6 - rand() * 4, 10 + rand() * 8 + i, 7 + rand() * 4);
      }
    }
    for (let i = 0; i < 8; i++) peak(-34 + i * 9.5 + rand() * 4, -50 - rand() * 10, 18 + rand() * 14, 9 + rand() * 6);
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // Pines in snowy woods down both sides and behind the enemy, with rocks between them.
  private woods(rand: () => number): void {
    // Each tier in three bands, the top band snow-laden.
    const tier = (r: number, h: number, y: number) =>
      paint(new THREE.ConeGeometry(r, h, 7, 3).translate(0, y, 0), (_x, cy) => ((cy - (y - h / 2)) / h > 0.62 ? tone('#aebfd6', rand, 0.05) : tone('#1f3d3f', rand, 0.05)));
    const trunk = paint(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 5).translate(0, 0.3, 0), () => new THREE.Color('#2a2030'));
    const needles = [tier(1, 1.4, 1.1), tier(0.78, 1.2, 1.75), tier(0.52, 1.0, 2.35)];
    const pine = mergeGeometries([trunk, ...needles]);
    const rock = paint(new THREE.IcosahedronGeometry(1, 0), (_x, y) => (y > 0.45 ? new THREE.Color('#7d8cab') : tone('#262b47', rand, 0.06)));

    const spots: [number, number, number][] = [];
    const clear = (x: number, z: number, m = 1.6) => Math.abs(x) < HALF_W + m && z > -MID_Y - m - 0.6 && z < MID_Y + 6;
    const fire = (x: number, z: number) => BRAZIERS.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 2);
    for (let tries = 0; spots.length < 130 && tries < 4000; tries++) {
      const x = (rand() - 0.5) * 56, z = -46 + rand() * 62;
      if (clear(x, z, 5) || fire(x, z)) continue; // a clear snow margin round the board
      const edge = Math.max(Math.abs(x) - HALF_W, -MID_Y - z);
      if (rand() > Math.min(1, edge / 22)) continue; // thinner toward the board
      spots.push([x, z, 0.7 + rand() * 0.9 + Math.min(0.8, edge / 25)]);
    }
    const trees = new THREE.InstancedMesh(pine, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), spots.length);
    const rocks = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), 30);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), at = new THREE.Vector3();
    const groundAt = (x: number, z: number) => {
      const out = Math.max(0, Math.max(Math.abs(x) - HALF_W - 3, Math.abs(z) - MID_Y - 3));
      return GROUND_Y + Math.min(1, out / 40) ** 2 * 5 - 0.15;
    };
    spots.forEach(([x, z, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      trees.setMatrixAt(i, m.compose(at.set(x, groundAt(x, z), z), q, s.set(k, k * (0.9 + rand() * 0.3), k)));
    });
    for (let i = 0; i < rocks.count; i++) {
      let x = 0, z = 0;
      do { x = (rand() - 0.5) * 50; z = -40 + rand() * 46; } while (clear(x, z, 2.5) || fire(x, z));
      q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand()));
      const k = 0.25 + rand() * 0.6;
      rocks.setMatrixAt(i, m.compose(at.set(x, groundAt(x, z) + k * 0.3, z), q, s.set(k * 1.3, k, k)));
    }
    trees.castShadow = trees.receiveShadow = true;
    rocks.castShadow = rocks.receiveShadow = true;
    this.scene.add(trees, rocks);
  }

  // Stone braziers along both banks; their light pools warm on the snow.
  private braziers(): void {
    const stone = new THREE.MeshStandardMaterial({ color: '#3a3f5c', roughness: 0.85, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: '#1d1b26', roughness: 0.6, metalness: 0.4, flatShading: true });
    const flameMat = new THREE.MeshBasicMaterial({ color: '#ff8a2e', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    const coreMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    BRAZIERS.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.8, 6), stone);
      pillar.position.y = 0.9;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.3, 0.4, 8), iron);
      bowl.position.y = 1.95;
      const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.34).scale(1, 1.9, 1), flameMat);
      flame.position.y = 2.5;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2).scale(1, 1.7, 1), coreMat);
      core.position.y = 2.35;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: '#ff8a2e', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(3.2, 3.2, 1);
      glow.position.y = 2.5;
      pillar.castShadow = bowl.castShadow = true;
      g.add(pillar, bowl, glow, flame, core);
      g.position.set(x, GROUND_Y + 0.6, z);
      const light = new THREE.PointLight('#ff9a3c', 22, 12, 1.6);
      light.position.set(x, GROUND_Y + 3.4, z);
      this.scene.add(g, light);
      this.fires.push({ flame, core, light, phase: i * 1.7 });
    });
  }

  // The enemy's standards are red, or blue when you play the red side.
  foe(side: number): void {
    this.cloth.color.set(side === 0 ? '#2c50a0' : '#a3303e');
  }

  // Standards beside the enemy's half (near the camera, poles foreshorten to sticks, so none on yours).
  private banners(): void {
    const pole = new THREE.MeshStandardMaterial({ color: '#1d1b26', roughness: 0.6, metalness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: '#f3d58a', roughness: 0.6, emissive: '#5a4310', emissiveIntensity: 0.4 });
    const cloth = this.cloth;
    const z = -MID_Y + 7.5;
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6), pole);
      p.position.y = 2.2;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), trim);
      tip.position.y = 4.5;
      // A swallowtail flag hanging off a crossbar, rippled each frame.
      const geo = new THREE.PlaneGeometry(1.2, 2.1, 5, 7).toNonIndexed();
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) if (pos.getY(k) < -1) pos.setY(k, -1.05 + Math.abs(pos.getX(k)) * 0.5 - 0.3);
      const flag = new THREE.Mesh(geo, cloth);
      flag.position.set(side * 0.65, 3.2, 0);
      flag.castShadow = true;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, 0.07), pole);
      bar.position.set(side * 0.65, 4.27, 0);
      g.add(p, tip, flag, bar);
      g.position.set(side * (HALF_W + 2.6), GROUND_Y + 0.5, z);
      g.rotation.y = side * 0.5; // turned a little toward the board
      this.scene.add(g);
      this.flags.push({ mesh: flag, base: Float32Array.from(pos.array as Float32Array), phase: z + side });
    }
  }

  private snowfall(rand: () => number): THREE.Points {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(rand() - 0.5) * 70, rand() * 24 - 1, -55 + rand() * 57], i * 3); // none right at the lens
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#dbe9f4', size: 0.13, map: dot(), transparent: true, opacity: 0.85, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  private emberPoints(): [THREE.Points, Float32Array] {
    const n = BRAZIERS.length * 10, pos = new Float32Array(n * 3), life = new Float32Array(n);
    for (let i = 0; i < n; i++) life[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffb02e', size: 0.12, map: dot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return [pts, life];
  }

  update(dt: number, now: number): void {
    if (this.still.matches) dt = 0;
    for (const f of this.fires) {
      const k = 0.85 + Math.sin(now * 9 + f.phase) * 0.06 + Math.sin(now * 23 + f.phase * 3) * 0.05;
      f.flame.scale.set(1, k * 1.05, 1);
      f.core.scale.set(1, 0.9 + (k - 0.85) * 2, 1);
      f.flame.rotation.y = now * 0.8 + f.phase;
      f.light.intensity = 22 * k;
    }
    for (const f of this.flags) {
      const p = f.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const bx = f.base[k * 3], by = f.base[k * 3 + 1];
        const hang = (1.05 - by) / 2.1; // 0 at the bar, 1 at the tails
        p.setZ(k, Math.sin(now * 2.2 + bx * 2 + by * 1.5 + f.phase) * 0.18 * hang);
      }
      p.needsUpdate = true;
      f.mesh.geometry.computeVertexNormals();
    }
    if (!dt) return;
    const s = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < s.count; i++) {
      let y = s.getY(i) - dt * (0.8 + (i % 7) * 0.12);
      const x = s.getX(i) + Math.sin(now * 0.5 + i) * dt * 0.3 + dt * 0.25;
      if (y < GROUND_Y) y += 25;
      s.setXY(i, x > 35 ? x - 70 : x, y);
    }
    s.needsUpdate = true;
    const e = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < e.count; i++) {
      this.emberLife[i] += dt / (1.6 + (i % 5) * 0.3);
      const [bx, bz] = BRAZIERS[i % BRAZIERS.length];
      if (this.emberLife[i] > 1) this.emberLife[i] -= 1;
      const t = this.emberLife[i];
      e.setXYZ(i, bx + Math.sin(now * 2 + i) * 0.25 * t + ((i * 7) % 5 - 2) * 0.08, GROUND_Y + 3.1 + t * 3.2, bz + Math.cos(now * 1.7 + i) * 0.25 * t);
    }
    e.needsUpdate = true;
    (this.embers.material as THREE.PointsMaterial).opacity = 0.9;
  }
}

// Brazier spots: down both banks, by the river and at the far corners.
const BRAZIERS: [number, number][] = [[-HALF_W - 1.4, -MID_Y + 0.5], [HALF_W + 1.4, -MID_Y + 0.5], [-HALF_W - 1.4, -1.6], [HALF_W + 1.4, -1.6]];

let dotTex: THREE.Texture | null = null;
function dot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return (dotTex = new THREE.CanvasTexture(c));
}
