/**
 * Sky, ancestry threads and glow sprites for the 3D Explore preview. All three are single draw calls with small
 * shaders: no post-processing pass, no render targets.
 */
import {
  AdditiveBlending,
  BackSide,
  Group,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type Texture,
} from "three";

export const PALETTE = {
  top: "#05071a",
  mid: "#10153a",
  horizon: "#2a2c5e",
  below: "#0c0d24",
  fog: "#1a1d44",
  moon: "#dfe4ff",
  amber: "#ffbf7a",
  silver: "#9aa8ff",
} as const;

/** Where the moon sits: low over the horizon, to the right of the selected island (the camera looks slightly down). */
export const MOON_DIR = new Vector3(0.3, 0.04, -0.953).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

/*
 * The night every universe shares, drawn in one pass behind everything: a gradient sky, the moon in a clearing,
 * moonlit clouds overhead and a sea of cloud far below the islands, seen at its true angle from the camera (so it
 * shifts as the view moves). Value-noise fbm, five octaves (three on simplified quality); no render targets.
 */
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBelow;
uniform vec3 uMoonDir; uniform vec3 uMoon; uniform float uMoonSize; uniform float uMoonOn; uniform float uMoonGlow;
uniform float uTime; uniform float uStars; uniform vec3 uHaze; uniform float uHazeAmt;
uniform float uClouds; uniform vec3 uCloudDark; uniform vec3 uCloudLit;
uniform float uSea; uniform vec3 uSeaDark; uniform vec3 uSeaLit; uniform vec3 uCam; uniform float uOctaves;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uOctaves) break;
    s += a * vnoise(p); p = p * 2.03 + vec2(11.3, 7.7); a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.32, h));
  col = mix(col, uTop, smoothstep(0.28, 0.95, h));
  col = mix(col, uBelow, smoothstep(-0.02, -0.45, h));
  col += uHaze * uHazeAmt * exp(-abs(h) * 30.0);
  float c = max(dot(d, uMoonDir), 0.0);
  float clear = 1.0;
  // Clouds overhead: a layer seen from below; thinner straight up, parted round the moon, edges lit by it.
  if (h > -0.03 && uClouds > 0.0) {
    vec2 uv = d.xz / (h + 0.2) * 1.35 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    // Toward the moon a little: where density falls off in that direction, the cloud's edge catches the light.
    vec2 toMoon = normalize(uMoonDir.xz + 1e-4) * 0.09;
    float n2 = fbm(uv + toMoon);
    float dens = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.3, n) * smoothstep(-0.02, 0.09, h) * (1.0 - 0.5 * smoothstep(0.45, 0.95, h));
    dens *= 1.0 - 0.9 * smoothstep(0.975, 0.9985, c);
    float edge = clamp((n - n2) * 6.0 + 0.15, 0.0, 1.0);
    float near = pow(c, 6.0);
    vec3 cc = mix(uCloudDark, uCloudLit, clamp(edge * (0.35 + 1.4 * near) + 0.08, 0.0, 1.0));
    col = mix(col, cc, dens * 0.94);
    clear = 1.0 - dens;
  }
  // The sea of cloud far below: a plane 300 m under the camera, its detail lost in haze towards the horizon.
  if (h < 0.0 && uSea > 0.0) {
    float t = 300.0 / max(-h, 0.003);
    vec2 p = uCam.xz + d.xz * t;
    float n = fbm(p * 0.0026 + vec2(uTime * 0.003, uTime * 0.001));
    float near = smoothstep(-0.015, -0.2, h);
    // Towards the horizon the sea dissolves into haze, so sky and cloud meet without a line.
    float dens = mix(0.45, smoothstep(0.3, 0.78, n), near) * uSea * smoothstep(0.0, -0.05, h);
    float lit = pow(max(dot(normalize(vec3(d.x, 0.45, d.z)), uMoonDir), 0.0), 5.0);
    float tops = smoothstep(0.45, 0.85, n) * near;
    vec3 sc = mix(uSeaDark, uSeaLit, clamp(0.05 + 0.6 * tops + 0.45 * lit * (0.4 + tops), 0.0, 1.0));
    col = mix(col, sc, dens * 0.92);
    clear *= 1.0 - dens;
  }
  // The moon, in front of the cloud layer only where the clouds part for it.
  float disc = smoothstep(uMoonSize - 0.00006, uMoonSize, c) * uMoonOn;
  float mott = 0.93 + 0.07 * sin(d.x * 300.0 + d.y * 210.0) * sin(d.z * 260.0 - d.y * 180.0);
  col += uMoon * (pow(c, 1400.0) * 0.32 + (pow(c, 120.0) * 0.07 + pow(c, 12.0) * 0.022) * uMoonGlow) * uMoonOn;
  col = mix(col, uMoon * 0.97 * mott, disc * (0.7 + 0.3 * clear));
  vec3 g = d * 260.0;
  vec3 cell = floor(g);
  float s = hash(cell);
  float star = step(0.9972, s) * smoothstep(0.18, 0.0, length(fract(g) - 0.5)) * smoothstep(0.04, 0.4, h) * (1.0 - disc) * clear;
  col += vec3(0.78, 0.82, 1.0) * star * uStars * (0.55 + 0.25 * sin(uTime * 0.9 + s * 60.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyLook {
  readonly top: string;
  readonly mid: string;
  readonly horizon: string;
  readonly below: string;
  readonly moon: string;
  /** Cosine of the moon's angular radius (0.99955 is about 1.7 degrees). */
  readonly moonSize: number;
  readonly stars: number;
  /** A low glow along the horizon and how strong it is. */
  readonly haze: string;
  readonly hazeAmount: number;
  /** Clouds overhead: the share of sky they cover (0 to 1), their shadowed and moonlit colours. */
  readonly clouds: number;
  readonly cloudDark: string;
  readonly cloudLit: string;
  /** The sea of cloud below the islands: how dense (0 to 1), its shadowed and moonlit colours. */
  readonly sea: number;
  readonly seaDark: string;
  readonly seaLit: string;
}

/** Repaint a sky for a universe: uniforms only, so nothing is recompiled. */
export function paintSky(material: ShaderMaterial, look: SkyLook) {
  const u = material.uniforms;
  (u.uTop!.value as Color).set(look.top);
  (u.uMid!.value as Color).set(look.mid);
  (u.uHorizon!.value as Color).set(look.horizon);
  (u.uBelow!.value as Color).set(look.below);
  (u.uMoon!.value as Color).set(look.moon);
  (u.uHaze!.value as Color).set(look.haze);
  (u.uCloudDark!.value as Color).set(look.cloudDark);
  (u.uCloudLit!.value as Color).set(look.cloudLit);
  (u.uSeaDark!.value as Color).set(look.seaDark);
  (u.uSeaLit!.value as Color).set(look.seaLit);
  u.uStars!.value = look.stars;
  u.uHazeAmt!.value = look.hazeAmount;
  u.uClouds!.value = look.clouds;
  u.uSea!.value = look.sea;
  u.uMoonSize!.value = look.moonSize;
}

export function createSky(): { mesh: Mesh; material: ShaderMaterial } {
  const material = new ShaderMaterial({
    name: "Atlas_Sky",
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTop: { value: new Color(PALETTE.top) },
      uMid: { value: new Color(PALETTE.mid) },
      uHorizon: { value: new Color(PALETTE.horizon) },
      uBelow: { value: new Color(PALETTE.below) },
      uMoonDir: { value: MOON_DIR.clone() },
      uMoon: { value: new Color(PALETTE.moon) },
      uMoonSize: { value: 0.99955 },
      uMoonOn: { value: 1 },
      uMoonGlow: { value: 1 },
      uTime: { value: 0 },
      uStars: { value: 1 },
      uHaze: { value: new Color("#ff9f5a") },
      uHazeAmt: { value: 0 },
      uClouds: { value: 0 },
      uCloudDark: { value: new Color("#1a1838") },
      uCloudLit: { value: new Color("#8a86c8") },
      uSea: { value: 0 },
      uSeaDark: { value: new Color("#141433") },
      uSeaLit: { value: new Color("#6b68a8") },
      uCam: { value: new Vector3() },
      uOctaves: { value: 5 },
    },
  });
  const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
  mesh.name = "sky";
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.scale.setScalar(1500);
  return { mesh, material };
}

// ---------- threads ----------

const THREAD_VERT = /* glsl */ `
uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uP2; uniform vec3 uP3; uniform float uRadius; uniform float uGrow;
attribute float aT; attribute float aA;
varying float vT; varying float vFacing; varying float vDepth;
vec3 bez(float t) { float u = 1.0 - t; return u*u*u*uP0 + 3.0*u*u*t*uP1 + 3.0*u*t*t*uP2 + t*t*t*uP3; }
vec3 dbez(float t) { float u = 1.0 - t; return 3.0*u*u*(uP1-uP0) + 6.0*u*t*(uP2-uP1) + 3.0*t*t*(uP3-uP2); }
void main() {
  float t = aT * uGrow;
  vec3 c = bez(t);
  vec3 T = normalize(dbez(t) + vec3(1e-5));
  vec3 N = normalize(cross(T, abs(T.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(T, N);
  vec3 n = N * cos(aA) + B * sin(aA);
  // Thinner at both ends, like a filament.
  float taper = 0.35 + 0.65 * sin(3.14159 * clamp(aT, 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(c + n * uRadius * taper, 1.0);
  vec3 vn = normalize(normalMatrix * n);
  vFacing = abs(dot(vn, normalize(-mv.xyz)));
  vT = aT;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const THREAD_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uPulse; uniform float uFog; uniform float uSoft;
varying float vT; varying float vFacing; varying float vDepth;
void main() {
  // The core is a bright filament; the sheath (uSoft = 1) is a wide, faint glow round it.
  float core = mix(pow(vFacing, 1.6) * 0.85 + 0.15, pow(vFacing, 3.0), uSoft);
  // Light flowing along the path you are on, from where it starts towards the selected future.
  float flow = uPulse * pow(max(0.0, sin((vT * 7.0 - uTime * 0.55) * 6.2831853)), 14.0);
  float fog = exp(-pow(vDepth * uFog, 2.0));
  float a = uOpacity * core * (0.75 + 0.25 * fog) * (1.0 + flow * (2.4 - uSoft * 1.6));
  gl_FragColor = vec4(uColor * a, a);
}`;

const SEG = 64;
const SIDES = 6;
let threadGeometry: BufferGeometry | null = null;
function sharedThreadGeometry(): BufferGeometry {
  if (threadGeometry) return threadGeometry;
  const t: number[] = [];
  const a: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) for (let s = 0; s <= SIDES; s++) {
    t.push(i / SEG);
    a.push((s / SIDES) * Math.PI * 2);
  }
  for (let i = 0; i < SEG; i++) for (let s = 0; s < SIDES; s++) {
    const p = i * (SIDES + 1) + s;
    const q = p + SIDES + 1;
    idx.push(p, q, q + 1, p, q + 1, p + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(t.length * 3), 3));
  g.setAttribute("aT", new BufferAttribute(new Float32Array(t), 1));
  g.setAttribute("aA", new BufferAttribute(new Float32Array(a), 1));
  g.setIndex(idx);
  threadGeometry = g;
  return g;
}

const threadUniforms = () => ({
  uP0: { value: new Vector3() }, uP1: { value: new Vector3() }, uP2: { value: new Vector3() }, uP3: { value: new Vector3() },
  uRadius: { value: 0.18 }, uGrow: { value: 1 }, uColor: { value: new Color(PALETTE.silver) }, uOpacity: { value: 0.4 },
  uTime: { value: 0 }, uPulse: { value: 0 }, uFog: { value: 0.0021 }, uSoft: { value: 0 },
});

/** One ancestry thread: a filament and a soft sheath of light round it (two draw calls, one shared geometry). */
export class Thread {
  readonly mesh: Group;
  readonly material: ShaderMaterial;
  private readonly sheath: ShaderMaterial;
  constructor() {
    const make = (name: string) => new ShaderMaterial({ name, vertexShader: THREAD_VERT, fragmentShader: THREAD_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: threadUniforms() });
    this.material = make("Atlas_Thread");
    this.sheath = make("Atlas_ThreadGlow");
    this.sheath.uniforms.uSoft!.value = 1;
    this.mesh = new Group();
    const core = new Mesh(sharedThreadGeometry(), this.material);
    const glow = new Mesh(sharedThreadGeometry(), this.sheath);
    for (const m of [core, glow]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
    }
    this.mesh.add(glow, core);
  }
  /** A gentle catenary-like curve from a to b: it leaves a downwards and arrives at b from below. */
  set(a: Vector3, b: Vector3, sag: number) {
    for (const m of [this.material, this.sheath]) {
      const u = m.uniforms;
      (u.uP0!.value as Vector3).copy(a);
      (u.uP3!.value as Vector3).copy(b);
      (u.uP1!.value as Vector3).copy(a).lerp(b, 0.3).add(new Vector3(0, -sag, 0));
      (u.uP2!.value as Vector3).copy(a).lerp(b, 0.7).add(new Vector3(0, -sag * 0.8, 0));
    }
  }
  /** Give the sheath the filament's state: wider, fainter, the same colour and flow. */
  syncSheath(strength: number) {
    const c = this.material.uniforms;
    const g = this.sheath.uniforms;
    g.uRadius!.value = (c.uRadius!.value as number) * 5;
    g.uOpacity!.value = (c.uOpacity!.value as number) * 0.2 * strength;
    g.uGrow!.value = c.uGrow!.value;
    (g.uColor!.value as Color).copy(c.uColor!.value as Color);
    g.uPulse!.value = c.uPulse!.value;
    g.uTime!.value = c.uTime!.value;
  }
  dispose() {
    this.material.dispose();
    this.sheath.dispose();
  }
}

// ---------- mist ----------

const MIST_VERT = /* glsl */ `
attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSize; attribute float aAlpha;
varying vec2 vUv; varying float vAlpha; varying float vDepth;
void main() {
  // Camera-facing quads, sized in metres and scaled with their island.
  float s = length(modelMatrix[0].xyz);
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  // Wide, low banks: the quad is half as tall as it is wide; the texture still spans all of it.
  mv.xy += vec2(aCorner.x, aCorner.y * 0.55) * aSize * s;
  vUv = aCorner * 0.5 + 0.5;
  vAlpha = aAlpha;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const MIST_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; uniform float uFog;
varying vec2 vUv; varying float vAlpha; varying float vDepth;
void main() {
  float a = texture2D(uMap, vUv).r * vAlpha * uOpacity * (0.45 + 0.55 * exp(-pow(vDepth * uFog, 2.0)));
  gl_FragColor = vec4(uColor, a);
}`;

/** A soft, lumpy cloud texture drawn on a canvas (no image file). */
export function mistTexture(size = 128): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = size * (0.28 + r() * 0.44), y = size * (0.36 + r() * 0.28), rad = size * (0.16 + r() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, "rgba(255,255,255,0.32)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // Fade to nothing at the border so quads never show an edge.
  const edge = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "source-over";
  g.fillStyle = edge;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  return t;
}

/**
 * Mist hanging around an island's rock: a dozen soft camera-facing quads in one draw call. `radius` and `depth` in
 * metres (the island's own size); `seed` varies the arrangement.
 */
export function createMist(radius: number, depth: number, seed: number, map: Texture): Mesh {
  let s = seed % 2147483646 || 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Few, mid-sized quads: mist is transparent overdraw, the most expensive kind of pixel on integrated GPUs.
  const n = 7;
  const centers: number[] = [], corners: number[] = [], sizes: number[] = [], alphas: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const rr = radius * (0.7 + r() * 0.35);
    const y = -depth * (0.22 + r() * 0.4);
    const size = radius * (0.38 + r() * 0.26);
    const alpha = 0.5 + r() * 0.5;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      centers.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      corners.push(cx, cy);
      sizes.push(size);
      alphas.push(alpha);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(centers), 3));
  g.setAttribute("aCenter", new BufferAttribute(new Float32Array(centers), 3));
  g.setAttribute("aCorner", new BufferAttribute(new Float32Array(corners), 2));
  g.setAttribute("aSize", new BufferAttribute(new Float32Array(sizes), 1));
  g.setAttribute("aAlpha", new BufferAttribute(new Float32Array(alphas), 1));
  g.setIndex(idx);
  const m = new ShaderMaterial({
    name: "Atlas_Mist",
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: map }, uColor: { value: new Color("#9aa0d6") }, uOpacity: { value: 0.3 }, uFog: { value: 0.0021 } },
  });
  const mesh = new Mesh(g, m);
  mesh.name = "mist";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

// ---------- glow sprites ----------

const HALO_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor;
uniform float uScale; uniform float uFog;
varying vec3 vColor; varying float vFade;
#ifdef LANDING_AWAKE
uniform float uInvRadius;
uniform vec4 uAwake; // hover centre and strength, then sweep centre and strength
varying float vAwake;
#endif
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Islands are scaled as a whole: the glow scales with its island.
  float s = length(modelMatrix[0].xyz);
  gl_PointSize = clamp(aSize * s * uScale / -mv.z, 0.0, 160.0);
  vFade = exp(-pow(-mv.z * uFog, 2.0));
  vColor = aColor;
  #ifdef LANDING_AWAKE
  float x = position.x * uInvRadius;
  float hover = uAwake.y * (1.0 - smoothstep(0.05, 0.70, abs(x - uAwake.x)));
  float sweep = uAwake.w * (1.0 - smoothstep(0.06, 0.40, abs(x - uAwake.z)));
  vAwake = min(1.0, hover + sweep);
  gl_PointSize *= 1.0 + 0.65 * vAwake;
  #endif
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uOpacity;
varying vec3 vColor; varying float vFade;
#ifdef LANDING_AWAKE
varying float vAwake;
#endif
void main() {
  float a = texture2D(uMap, gl_PointCoord).r * uOpacity * (0.35 + 0.65 * vFade);
  vec3 color = vColor * a;
  #ifdef LANDING_AWAKE
  vec2 crosshair = abs(gl_PointCoord - 0.5);
  float glint = (1.0 - smoothstep(0.01, 0.11, min(crosshair.x, crosshair.y)))
              * (1.0 - smoothstep(0.12, 0.45, max(crosshair.x, crosshair.y)));
  color += vAwake * (0.64 * color + 0.20 * glint * vFade * vec3(0.94, 0.70, 1.0));
  #endif
  gl_FragColor = vec4(color, a);
}`;

export interface HaloSpec {
  readonly position: Vector3;
  readonly color: Color;
  /** World-space diameter in metres. */
  readonly size: number;
}

/** Pixels per metre at distance 1 (drawing-buffer height / 2 / tan(fov / 2)); one uniform shared by every glow. */
export const HALO_SCALE = { value: 600 };

/** Warm glows around lamps and lanterns: one point sprite each, additive, one draw call per island. */
export function createHalos(specs: readonly HaloSpec[], map: Texture, landingRadius?: number): Points {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(specs.flatMap((s) => [s.position.x, s.position.y, s.position.z])), 3));
  g.setAttribute("aColor", new BufferAttribute(new Float32Array(specs.flatMap((s) => [s.color.r, s.color.g, s.color.b])), 3));
  g.setAttribute("aSize", new BufferAttribute(new Float32Array(specs.map((s) => s.size)), 1));
  const m = new ShaderMaterial({
    name: "Atlas_Halo",
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    defines: landingRadius ? { LANDING_AWAKE: 1 } : {},
    uniforms: {
      uMap: { value: map }, uScale: HALO_SCALE, uOpacity: { value: 0.9 }, uFog: { value: 0.0021 },
      ...(landingRadius ? { uInvRadius: { value: 1 / landingRadius }, uAwake: { value: new Vector4() } } : {}),
    },
  });
  const p = new Points(g, m);
  p.name = "halos";
  p.renderOrder = 3;
  return p;
}
