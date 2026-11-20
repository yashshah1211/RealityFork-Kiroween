/**
 * The world around the islands: banks of cloud drifting between and below them, small distant worlds that fill the
 * background (what stands on them depends on the universe), fireflies (energy and environment) and a few bats crossing
 * the moon (city and open sky). Decoration only: none of it is a path, none of it can be picked, and none of it says
 * anything about a future. It sits in a frame that follows the camera's target, so it stays behind the composition.
 *
 * Budget: 6 draw calls, about 9k triangles; the cloud banks are the only transparent overdraw (off on simplified quality).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MathUtils,
  Mesh,
  MeshStandardMaterial,

  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
  type Vector2,
  type Texture,
} from "three";
import type { Distant, Universe } from "../environment/universes";
import { createHalos, type HaloSpec } from "./atmosphere";
import { Builder, rng } from "./generic";

// ---------- cloud banks ----------

/** A soft cumulus texture made with value noise: red = density, green = how much of the moon's light it catches. */
function cloudTexture(): CanvasTexture {
  const W = 128, H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const r = rng(91);
  const grid = Array.from({ length: 17 * 17 }, () => r());
  const vn = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => grid[((b & 15) * 17 + (a & 15))]!;
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      let n = 0, a = 0.5, f = 3;
      for (let o = 0; o < 4; o++) {
        n += a * vn(u * f * 2, v * f);
        f *= 2.1;
        a *= 0.5;
      }
      // A bank: rounded on top, flat and soft underneath, fading out at the sides.
      const dx = (u - 0.5) * 2, dy = (v - 0.55) * 2.2;
      const shape = Math.max(0, 1 - (dx * dx + (dy < 0 ? dy * dy * 1.3 : dy * dy * 2.4)));
      const d = Math.max(0, Math.min(1, (n * 1.25 - 0.32) * 1.8)) * shape ** 0.8;
      const lit = Math.max(0, Math.min(1, 1 - v * 1.25 + (n - 0.5) * 0.6));
      const k = (y * W + x) * 4;
      img.data[k] = Math.round(d * 255);
      img.data[k + 1] = Math.round(lit * 255);
      img.data[k + 2] = 0;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return new CanvasTexture(c);
}

const BANK_VERT = /* glsl */ `
attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSize; attribute float aAlpha; attribute float aDrift;
uniform float uTime;
varying vec2 vUv; varying float vAlpha; varying float vDepth;
void main() {
  vec3 c = aCenter + vec3(sin(uTime * 0.02 + aDrift) * 18.0, 0.0, 0.0);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += vec2(aCorner.x, aCorner.y * 0.42) * aSize;
  vUv = aCorner * 0.5 + 0.5;
  vAlpha = aAlpha;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const BANK_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uDark; uniform vec3 uLit; uniform vec3 uFogColor; uniform float uFog; uniform float uOpacity;
varying vec2 vUv; varying float vAlpha; varying float vDepth;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float fog = 1.0 - exp(-pow(vDepth * uFog, 2.0));
  vec3 col = mix(mix(uDark, uLit, t.g), uFogColor, fog * 0.75);
  gl_FragColor = vec4(col, t.r * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- distant worlds ----------

/** A small floating rock, top at y = 0 with radius 1, tapering to a tip about 1.8 below. */
function rockGeometry(): BufferGeometry {
  const b = new Builder();
  const r = rng(7);
  const n = 10;
  const rings: [number, number][] = [[0, 1], [-0.28, 0.94], [-0.7, 0.66], [-1.15, 0.36], [-1.55, 0.12]];
  const rows = rings.map(([y, rr], ri) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = ((i % n) / n) * Math.PI * 2;
      const k = rr * (1 + (ri === 0 ? 0.06 : 0.16) * (r() - 0.5));
      const shade = ri === 0 ? 1 : 0.75 - ri * 0.1;
      return b.vert(Math.cos(a) * k, y, Math.sin(a) * k, i / n, ri / 4, [shade, shade, shade]);
    }));
  const top = b.vert(0, 0.02, 0, 0.5, 0, [1, 1, 1]);
  for (let i = 0; i < n; i++) b.tri(top, rows[0]![i + 1]!, rows[0]![i]!);
  for (let ri = 0; ri + 1 < rows.length; ri++) for (let i = 0; i < n; i++) b.quad(rows[ri]![i]!, rows[ri]![i + 1]!, rows[ri + 1]![i + 1]!, rows[ri + 1]![i]!);
  const tip = b.vert(0.05, -1.85, -0.04, 0.5, 1, [0.4, 0.4, 0.4]);
  const last = rows[rows.length - 1]!;
  for (let i = 0; i < n; i++) b.tri(last[i]!, last[i + 1]!, tip);
  return b.geometry();
}

function box(b: Builder, x: number, z: number, w: number, h: number, d: number, y0 = 0) {
  const c: [number, number, number] = [1, 1, 1];
  const v = (px: number, py: number, pz: number) => b.vert(px, py, pz, 0, 0, c);
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
  b.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1));
  b.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0));
  b.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1));
  b.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0));
  b.quad(v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0));
}
function cone(b: Builder, x: number, z: number, rad: number, h: number, y0 = 0, sides = 6) {
  const c: [number, number, number] = [1, 1, 1];
  const apex = b.vert(x, y0 + h, z, 0, 0, c);
  const ring = Array.from({ length: sides + 1 }, (_, i) => {
    const a = ((i % sides) / sides) * Math.PI * 2;
    return b.vert(x + Math.cos(a) * rad, y0, z + Math.sin(a) * rad, 0, 0, c);
  });
  for (let i = 0; i < sides; i++) b.tri(ring[i + 1]!, ring[i]!, apex);
}

/** What stands on a distant island, in its unit space, and where its lights are. */
function topGeometry(kind: Distant): { geometry: BufferGeometry; lights: Vector3[] } {
  const b = new Builder();
  const r = rng(kind.length * 977);
  const lights: Vector3[] = [];
  if (kind === "towers") {
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.62;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.7;
      const w = 0.1 + r() * 0.12, h = 0.25 + r() * r() * 0.9;
      box(b, x, z, w, h, w);
      for (let k = 0; k < 2; k++) lights.push(new Vector3(x + (r() - 0.5) * w, h * (0.25 + r() * 0.6), z + w / 2 + 0.01));
    }
    box(b, 0.05, -0.1, 0.12, 1.05, 0.12);
    cone(b, 0.05, -0.1, 0.09, 0.55, 1.05, 4);
    lights.push(new Vector3(0.05, 0.9, -0.03));
  } else if (kind === "forest") {
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.75;
      cone(b, Math.cos(a) * d, Math.sin(a) * d, 0.09 + r() * 0.08, 0.28 + r() * 0.42);
    }
    box(b, 0.1, 0.2, 0.22, 0.14, 0.16);
    cone(b, 0.1, 0.2, 0.17, 0.12, 0.14, 4);
    lights.push(new Vector3(0.1, 0.07, 0.29));
  } else if (kind === "roofs") {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r(), d = 0.25 + r() * 0.35;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      box(b, x, z, 0.2, 0.14, 0.18);
      cone(b, x, z, 0.16, 0.13, 0.14, 4);
      lights.push(new Vector3(x, 0.07, z + 0.1));
    }
  } else {
    box(b, -0.18, 0, 0.08, 0.45, 0.08);
    box(b, 0.18, 0, 0.08, 0.45, 0.08);
    box(b, 0, 0, 0.46, 0.07, 0.08, 0.45);
    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2, d = 0.45 + r() * 0.25;
      box(b, Math.cos(a) * d, Math.sin(a) * d, 0.07, 0.18 + r() * 0.16, 0.05);
    }
    lights.push(new Vector3(0, 0.25, 0.05));
  }
  return { geometry: b.geometry(), lights };
}

// ---------- bats ----------

/** A short wingbeat cycle drawn from the same silhouette. */
function batTexture(frames: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64 * frames;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  const draw = (ox: number, lift: number) => {
    const cx = ox + 32, cy = 34;
    g.beginPath();
    g.moveTo(cx, cy - 6);
    // left wing: leading edge up and out, a scalloped trailing edge back to the body
    g.quadraticCurveTo(cx - 14, cy - 10 - lift, cx - 29, cy - 4 - lift * 1.3);
    g.quadraticCurveTo(cx - 24, cy + 1 - lift * 0.4, cx - 19, cy + 2 - lift * 0.2);
    g.quadraticCurveTo(cx - 15, cy - 1, cx - 11, cy + 4);
    g.quadraticCurveTo(cx - 7, cy + 1, cx - 3, cy + 6);
    // body and the little head between the wings
    g.quadraticCurveTo(cx, cy + 10, cx + 3, cy + 6);
    g.quadraticCurveTo(cx + 7, cy + 1, cx + 11, cy + 4);
    g.quadraticCurveTo(cx + 15, cy - 1, cx + 19, cy + 2 - lift * 0.2);
    g.quadraticCurveTo(cx + 24, cy + 1 - lift * 0.4, cx + 29, cy - 4 - lift * 1.3);
    g.quadraticCurveTo(cx + 14, cy - 10 - lift, cx, cy - 6);
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy - 6, 3.2, 4, 0, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = 0; i < frames; i++) draw(64 * i, 2 + 7 * Math.cos(2 * Math.PI * i / frames));
  const t = new CanvasTexture(c);
  return t;
}

const BAT_VERT = /* glsl */ `
attribute float aPhase; uniform float uTime; uniform float uPx; uniform float uFrames;
varying float vFrame;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPx * (0.85 + 0.3 * fract(aPhase * 7.1));
  vFrame = floor(uFrames * fract(uTime * 2.1 + aPhase));
  gl_Position = projectionMatrix * mv;
}`;
const BAT_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uColor; uniform float uFrames;
varying float vFrame;
void main() {
  vec2 uv = vec2((gl_PointCoord.x + vFrame) / uFrames, 1.0 - gl_PointCoord.y);
  float a = texture2D(uMap, uv).r;
  if (a < 0.05) discard;
  gl_FragColor = vec4(uColor, a * 0.92);
}`;

// ---------- fireflies ----------

const FLY_VERT = /* glsl */ `
attribute float aPhase; uniform float uTime; uniform float uScale; uniform float uMotion;
varying float vAlpha;
void main() {
  vec3 p = position + uMotion * vec3(sin(uTime * 0.31 + aPhase * 6.0) * 1.6, sin(uTime * 0.47 + aPhase * 9.0) * 0.9, cos(uTime * 0.27 + aPhase * 4.0) * 1.6);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(0.32 * uScale / -mv.z, 1.5, 9.0);
  vAlpha = mix(0.55, 0.15 + 0.85 * pow(0.5 + 0.5 * sin(uTime * 1.6 + aPhase * 40.0), 3.0), uMotion);
  gl_Position = projectionMatrix * mv;
}`;
const FLY_FRAG = /* glsl */ `
uniform vec3 uColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

// ---------- assembly ----------

export class Ambience {
  /** Follows the camera's target; its axes are the composed view's (forward is -Z). */
  readonly group = new Group();
  private readonly cloudMap = cloudTexture();
  private readonly batMap: CanvasTexture;
  private readonly rock = rockGeometry();
  private readonly rockMat = new MeshStandardMaterial({ name: "Ambience_Rock", color: new Color("#2c2840"), roughness: 1, vertexColors: true });
  private readonly topMat = new MeshStandardMaterial({ name: "Ambience_Top", color: new Color("#211f33"), roughness: 0.9 });
  private banks: Mesh | null = null;
  private distant: { rocks: InstancedMesh; tops: InstancedMesh; top: BufferGeometry; lights: Points } | null = null;
  private flies: Points | null = null;
  private bats: Points | null = null;
  private batDirs: { phase: number; radius: number; speed: number; x: number; y: number; baseX: number; baseY: number }[] = [];
  private readonly batRight = new Vector3();
  private readonly batUp = new Vector3();
  private readonly batDir = new Vector3();
  private readonly batPoint = new Vector3();
  private readonly worldUp = new Vector3(0, 1, 0);
  private batStart: number | null = null;
  private batBurst = -Infinity;
  private batLeader = 0;
  private batBurstX = 0;
  private batBurstY = 0;
  private universe: Universe | null = null;
  private quality: "high" | "low" = "high";
  /** "right": the landing page keeps the left half (the question) clear of distant worlds. */
  bias: "even" | "right" = "even";
  /** False: no distant worlds at all (set before the first universe). */
  distantWorlds = true;

  constructor(private readonly glow: Texture, private readonly haloScale: { value: number }, private readonly landing = false) {
    this.group.name = "ambience";
    this.batMap = batTexture(landing ? 6 : 2);
  }

  setQuality(q: "high" | "low") {
    if (q === this.quality) return;
    this.quality = q;
    if (this.universe) this.build(this.universe);
  }

  setUniverse(u: Universe) {
    if (u === this.universe) return;
    this.universe = u;
    this.build(u);
  }

  private clear() {
    for (const o of [this.banks, this.flies, this.bats]) {
      if (!o) continue;
      o.removeFromParent();
      o.geometry.dispose();
      (o.material as ShaderMaterial).dispose();
    }
    this.banks = this.flies = this.bats = null;
    if (this.distant) {
      const d = this.distant;
      d.rocks.removeFromParent();
      d.tops.removeFromParent();
      d.lights.removeFromParent();
      d.top.dispose();
      d.lights.geometry.dispose();
      (d.lights.material as ShaderMaterial).dispose();
      d.rocks.dispose();
      d.tops.dispose();
      this.distant = null;
    }
  }

  private build(u: Universe) {
    this.clear();
    const a = u.ambience;
    const r = rng(u.family.length * 131 + 17);
    if (this.distantWorlds) this.buildDistant(a, r);
    this.buildNear(u, r);
  }
  /** Distant worlds: a band of small islands from 340 to 900 m behind the target, fading into the fog. */
  private buildDistant(a: Universe["ambience"], r: () => number) {
    const N = 30;
    const top = topGeometry(a.distant);
    const rocks = new InstancedMesh(this.rock, this.rockMat, N);
    const tops = new InstancedMesh(top.geometry, this.topMat, N);
    const lights: HaloSpec[] = [];
    const m = new Matrix4();
    const q = new Quaternion();
    const lightColor = new Color(a.lightColor);
    for (let i = 0; i < N; i++) {
      const d = 340 + 560 * Math.pow(r(), 0.8);
      const side = this.bias === "right" ? -0.25 + r() * 1.15 : r() * 2 - 1;
      const x = side * 0.85 * d;
      // From well below the horizon up to just above it: they rise out of the sea of cloud, never in front of the moon.
      const y = (-0.2 + r() * 0.22) * d;
      // Keep the middle of the view (where the selected future floats) clear.
      const pos = new Vector3(Math.abs(x) < 0.16 * d ? x + Math.sign(x || 1) * 0.16 * d : x, y, -d);
      const s = (3.5 + 7 * r()) * Math.sqrt(d / 400);
      q.setFromAxisAngle(new Vector3(0, 1, 0), r() * Math.PI * 2);
      m.compose(pos, q, new Vector3(s, s * (0.8 + r() * 0.4), s));
      rocks.setMatrixAt(i, m);
      tops.setMatrixAt(i, m);
      if (r() < a.lights) {
        for (const l of top.lights) if (r() < 0.8) lights.push({ position: l.clone().applyMatrix4(m), color: lightColor.clone().multiplyScalar(0.8 + r() * 0.5), size: Math.min(3, s * 0.22) });
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    rocks.frustumCulled = tops.frustumCulled = false;
    const glowPoints = createHalos(lights, this.glow);
    (glowPoints.material as ShaderMaterial).uniforms.uOpacity!.value = 0.9;
    glowPoints.frustumCulled = false;
    // Forested worlds sit under a clearer, brighter sky: a little lighter, so they recede instead of reading as cut-outs.
    this.rockMat.color.set(a.distant === "forest" ? "#20313d" : "#191726");
    this.topMat.color.set(a.distant === "forest" ? "#152a24" : "#121120");
    this.group.add(rocks, tops, glowPoints);
    this.distant = { rocks, tops, top: top.geometry, lights: glowPoints };
  }
  /** Cloud banks, fireflies and bats. */
  private buildNear(u: Universe, r: () => number) {
    const a = u.ambience;
    // Banks of cloud: behind the islands, below them, and high and far. Simplified quality draws none.
    if (this.quality === "high" && a.banks > 0) {
      const centers: number[] = [], corners: number[] = [], sizes: number[] = [], alphas: number[] = [], drifts: number[] = [], idx: number[] = [];
      const add = (x: number, y: number, z: number, size: number, alpha: number) => {
        const base = centers.length / 3;
        for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          centers.push(x, y, z);
          corners.push(cx, cy);
          sizes.push(size);
          alphas.push(alpha);
          drifts.push(x * 0.01);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (let i = 0; i < a.banks; i++) {
        const t = i / a.banks;
        // Behind the islands at their own height, and lower down between them; never up in the sky (the moon is there).
        if (t < 0.5) add((r() * 2 - 1) * 340, -50 + r() * 45, -170 - r() * 260, 230 + r() * 200, 0.38 + r() * 0.2);
        else add((r() * 2 - 1) * 280, -100 + r() * 30, -70 - r() * 160, 210 + r() * 170, 0.5 + r() * 0.22);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(centers), 3));
      g.setAttribute("aCenter", new BufferAttribute(new Float32Array(centers), 3));
      g.setAttribute("aCorner", new BufferAttribute(new Float32Array(corners), 2));
      g.setAttribute("aSize", new BufferAttribute(new Float32Array(sizes), 1));
      g.setAttribute("aAlpha", new BufferAttribute(new Float32Array(alphas), 1));
      g.setAttribute("aDrift", new BufferAttribute(new Float32Array(drifts), 1));
      g.setIndex(idx);
      const mat = new ShaderMaterial({
        name: "Ambience_Banks", vertexShader: BANK_VERT, fragmentShader: BANK_FRAG, transparent: true, depthWrite: false,
        uniforms: { uMap: { value: this.cloudMap }, uDark: { value: new Color(a.bankDark) }, uLit: { value: new Color(a.bankLit) }, uFogColor: { value: new Color(u.fog.color) }, uFog: { value: u.fog.density }, uOpacity: { value: 1 }, uTime: { value: 0 } },
      });
      const banks = new Mesh(g, mat);
      banks.frustumCulled = false;
      banks.renderOrder = 1;
      this.group.add(banks);
      this.banks = banks;
    }

    // Fireflies round the futures in focus (energy and environment).
    const flyCount = this.quality === "high" ? a.fireflies : Math.round(a.fireflies / 3);
    if (flyCount > 0) {
      const pos: number[] = [], phase: number[] = [];
      for (let i = 0; i < flyCount; i++) {
        pos.push((r() * 2 - 1) * 75, -4 + r() * 34, -45 + r() * 90);
        phase.push(r());
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("aPhase", new BufferAttribute(new Float32Array(phase), 1));
      const mat = new ShaderMaterial({
        name: "Ambience_Fireflies", vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color("#e6f29a") }, uTime: { value: 0 }, uScale: this.haloScale, uMotion: { value: 1 } },
      });
      const flies = new Points(g, mat);
      flies.frustumCulled = false;
      flies.renderOrder = 3;
      this.group.add(flies);
      this.flies = flies;
    }

    // A few bats crossing the moon (placed in world space every frame, beside the moon's direction).
    if (a.bats > 0) {
      this.batDirs = Array.from({ length: a.bats }, () => ({ phase: r(), radius: 0.035 + r() * 0.05, speed: 0.05 + r() * 0.05, x: 0, y: 0, baseX: 0, baseY: 0 }));
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(a.bats * 3), 3).setUsage(DynamicDrawUsage));
      g.setAttribute("aPhase", new BufferAttribute(new Float32Array(this.batDirs.map((b) => b.phase)), 1));
      const mat = new ShaderMaterial({
        name: "Ambience_Bats", vertexShader: BAT_VERT, fragmentShader: BAT_FRAG, transparent: true, depthWrite: false,
        uniforms: { uMap: { value: this.batMap }, uColor: { value: new Color("#06060f") }, uTime: { value: 0 }, uPx: { value: 18 }, uFrames: { value: this.landing ? 6 : 2 } },
      });
      const bats = new Points(g, mat);
      bats.frustumCulled = false;
      bats.renderOrder = -5;
      this.bats = bats;
    }
  }

  /** The bats live in world space (they belong to the sky); the scene adds them to itself. */
  get batsObject(): Points | null {
    return this.bats;
  }

  scatterBats(t: number, leader: number) {
    const bat = this.batDirs[leader];
    if (!bat) return;
    this.batBurst = t;
    this.batLeader = leader;
    this.batBurstX = bat.baseX + bat.x;
    this.batBurstY = bat.baseY + bat.y;
  }

  /** A single bat batch follows the moon, with optional landing-only steering. */
  update(t: number, motion: boolean, target: Vector3, camera: PerspectiveCamera, moonDir: Vector3, pixelRatio: number, landing?: {
    readonly time: number; readonly damping: number; readonly motion: boolean; readonly pointer: Vector2 | null;
  }): boolean {
    this.group.position.copy(target);
    if (this.banks) (this.banks.material as ShaderMaterial).uniforms.uTime!.value = t;
    if (this.flies) {
      const u = (this.flies.material as ShaderMaterial).uniforms;
      u.uTime!.value = t;
      u.uMotion!.value = motion ? 1 : 0;
    }
    let steering = false;
    if (this.bats) {
      const p = this.bats.geometry.getAttribute("position") as BufferAttribute;
      const right = this.batRight.crossVectors(moonDir, this.worldUp).normalize();
      const up = this.batUp.crossVectors(right, moonDir).normalize();
      let flock = 0, sweep = 0, burst = 0, spread = 0;
      if (landing) {
        this.batStart ??= landing.time;
        sweep = Math.min(1, ((landing.time - this.batStart) % 26) / 6);
        flock = motion ? Math.sin(Math.PI * sweep) ** 2 : 0;
        const age = landing.time - this.batBurst;
        if (landing.motion) {
          burst = MathUtils.smoothstep(age, 0, 0.19) * (1 - MathUtils.smoothstep(age, 0.56, 1.72));
          spread = MathUtils.smoothstep(age, 0.03, 0.55);
        } else this.batBurst = -Infinity;
      }
      let changed = false;
      for (let i = 0; i < this.batDirs.length; i++) {
        const b = this.batDirs[i]!;
        const a = b.phase * Math.PI * 2 + (motion ? t * b.speed : 0);
        let x = Math.cos(a) * b.radius * 1.6 - 0.03;
        let y = Math.sin(a) * b.radius + 0.035;
        if (landing) {
          x += flock * ((0.5 - sweep) * 0.44 - i * 0.019 - x);
          y += flock * (0.024 + i * 0.011 + Math.sin(sweep * 6 - i) * 0.018 - y);
          b.baseX = x;
          b.baseY = y;
          let avoidX = 0, avoidY = 0;
          if (landing.pointer) {
            this.batDir.copy(moonDir).addScaledVector(right, x).addScaledVector(up, y).normalize();
            const projected = this.batPoint.copy(camera.position).addScaledVector(this.batDir, 900).project(camera);
            const dx = (projected.x - landing.pointer.x) * camera.aspect;
            const dy = projected.y - landing.pointer.y;
            const distance = Math.hypot(dx, dy);
            const force = 0.045 * Math.max(0, 1 - distance / 0.17);
            avoidX = distance < 0.005 ? force * (i % 2 ? -1 : 1) : force * dx / distance;
            avoidY = distance < 0.005 ? force : force * dy / distance;
          }
          const slot = (i - this.batLeader + this.batDirs.length) % this.batDirs.length;
          const scatterX = this.batBurstX - x + (slot === 0 ? 0.020 : slot === 1 ? -0.14 : 0.13) * (0.44 + spread * 0.56);
          const scatterY = this.batBurstY - y + (slot === 0 ? 0.063 : slot === 1 ? -0.012 : -0.056);
          const nextX = landing.motion ? steer(b.x, avoidX * (1 - burst) + scatterX * burst, landing.damping) : 0;
          const nextY = landing.motion ? steer(b.y, avoidY * (1 - burst) + scatterY * burst, landing.damping) : 0;
          steering ||= b.x !== nextX || b.y !== nextY;
          b.x = nextX;
          b.y = nextY;
          x += b.x;
          y += b.y;
        }
        this.batDir.copy(moonDir).addScaledVector(right, x).addScaledVector(up, y).normalize();
        const w = this.batPoint.copy(camera.position).addScaledVector(this.batDir, 900);
        const px = Math.fround(w.x), py = Math.fround(w.y), pz = Math.fround(w.z);
        if (p.getX(i) === px && p.getY(i) === py && p.getZ(i) === pz) continue;
        p.setXYZ(i, px, py, pz);
        changed = true;
      }
      if (changed) p.needsUpdate = true;
      const u = (this.bats.material as ShaderMaterial).uniforms;
      const wingTime = motion ? t : steering && landing?.motion ? landing.time : 0;
      const wingsChanged = u.uTime!.value !== wingTime;
      u.uTime!.value = wingTime;
      u.uPx!.value = 17 * pixelRatio;
      return !!landing && (changed || wingsChanged);
    }
    return false;
  }

  dispose() {
    this.bats?.removeFromParent();
    this.clear();
    this.cloudMap.dispose();
    this.batMap.dispose();
    this.rock.dispose();
    this.rockMat.dispose();
    this.topMat.dispose();
  }
}

function steer(value: number, target: number, damping: number) {
  const next = value + (target - value) * damping;
  return Math.abs(next - target) < 0.00015 ? target : next;
}




