// A summoning circle under each drop for the whole deploy wait: from the lock (a pending row)
// through the design landing (the troop in the air) to touchdown. Its outer ring fills clockwise
// with the timer; a dashed ring and eight spokes turn inside it, and it brightens to gold as it
// closes. One pooled mesh per live drop, drawn by a small shader, so it costs nothing per frame.
import * as THREE from 'three';
import { DEPLOY_DELAY } from '../../shared/arena';
import type { Airborne } from './juice';
import type { View } from './render';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
uniform float uFrac; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
#define TAU 6.2831853
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = fract(atan(p.x, p.y) / TAU + 1.0); // 0 at the top (far side), clockwise from above
  vec3 gold = vec3(1.0, 0.82, 0.48);
  vec3 col = mix(uColor, gold, smoothstep(0.6, 1.0, uFrac));
  float alpha = 0.0;
  // Outer ring: faint track, bright where filled, a hot head at the fill's edge.
  float band = smoothstep(0.84, 0.86, r) * (1.0 - smoothstep(0.96, 0.98, r));
  float filled = step(a, uFrac);
  float head = exp(-abs(a - uFrac) * 60.0) * step(0.001, uFrac);
  alpha += band * (0.18 + 0.8 * filled + 0.6 * head);
  // Dashed inner ring, turning.
  float inner = smoothstep(0.6, 0.62, r) * (1.0 - smoothstep(0.66, 0.68, r));
  alpha += inner * step(0.5, fract(a * 16.0 + uTime * 0.35)) * 0.55;
  // Eight spokes between the rings, turning the other way, lit as the wait fills.
  float spokes = smoothstep(0.7, 0.72, r) * (1.0 - smoothstep(0.8, 0.82, r));
  float s = fract(a * 8.0 - uTime * 0.12);
  alpha += spokes * (1.0 - smoothstep(0.0, 0.06, min(s, 1.0 - s))) * (0.3 + 0.6 * uFrac);
  // A glow pooling in the middle.
  alpha += pow(max(0.0, 1.0 - r / 0.62), 2.0) * 0.28 * uFrac;
  gl_FragColor = vec4(col, alpha * uAlpha);
}`;

const MINE = new THREE.Color('#4aa3ff');
const THEIRS = new THREE.Color('#ff5d6c');
const RADIUS = 1.3; // tiles

type At = (x: number, y: number, h: number, out: THREE.Vector3) => THREE.Vector3;

export class SummonCircles {
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private geo = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2);

  constructor(private scene: THREE.Scene, private at: At) {}

  sync(v: View, air: readonly Airborne[], now: number): void {
    let i = 0;
    for (const p of v.pendings) this.place(i++, p.side === v.mySide, p.x, p.y, Math.max(0, Math.min(1, p.age / DEPLOY_DELAY)), now);
    for (const a of air) this.place(i++, a.side === v.mySide, a.x, a.y, a.frac, now);
    for (let k = i; k < this.pool.length; k++) this.pool[k].visible = false;
  }

  private place(i: number, mine: boolean, x: number, y: number, frac: number, now: number): void {
    let m = this.pool[i];
    if (!m) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uFrac: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      m = new THREE.Mesh(this.geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.scene.add(m);
      this.pool.push(m);
    }
    const u = m.material.uniforms;
    u.uFrac.value = frac;
    u.uTime.value = now;
    (u.uColor.value as THREE.Color).copy(mine ? MINE : THEIRS);
    u.uAlpha.value = Math.min(1, 0.4 + frac * 2);
    m.scale.setScalar(1 + 0.06 * Math.sin(now * 5) * frac);
    this.at(x, y, 0.045, m.position);
    m.visible = true;
  }
}
