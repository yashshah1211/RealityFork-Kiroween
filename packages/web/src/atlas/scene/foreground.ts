/**
 * The ledge you look out from: a dark rock edge along the bottom of the frame, with a little dressing that belongs to
 * the universe (an iron fence and a lantern for a city, moonlit ferns for energy and environment, candles for the open
 * sky; on the landing page one small carved pumpkin among the candles). It frames the composition and gives
 * the scene a near plane. Decoration only: nothing here is a path or a fact.
 *
 * Drawn in a second pass with its own camera (same field of view, no view offset), so it stays at the bottom of the
 * screen whatever the camera does. Wide screens only; about 4k triangles in 8 draw calls.
 */
import {
  CanvasTexture,
  BufferAttribute,
  DynamicDrawUsage,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  Scene,
  SRGBColorSpace,
  Vector3,
  type Material,
  type ShaderMaterial,
  type Texture,
} from "three";
import type { Ledge, Universe } from "../environment/universes";
import { createHalos, type HaloSpec } from "./atmosphere";
import { AUTUMN, Builder, glowTexture, lampPost, leafCard, rng, tube, type GenericMaterials } from "./generic";

export type ForegroundKind = Ledge | "landing";

const D = 9;
const FACE_FRAMES = 4;

/** Resting grin, wink, surprise, and a wider grin in one tiny emissive atlas. */
function faceTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64 * FACE_FRAMES;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff";
  const carve = (pts: number[]) => {
    g.beginPath();
    g.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
    g.closePath();
    g.fill();
  };
  for (let frame = 0; frame < FACE_FRAMES; frame++) {
    g.save();
    g.translate(64 * frame, 0);
    if (frame === 1) carve([17, 27, 24, 23, 30, 27, 24, 26, 18, 30]);
    else carve([18, 26, 27, frame === 2 ? 13 : 18, 29, 29]);
    carve([46, 26, 37, frame === 2 ? 13 : 18, 35, 29]);
    carve([32, 31, 29, 37, 35, 37]);
    if (frame === 2) {
      g.beginPath();
      g.ellipse(32, 46, 6, 7, 0, 0, Math.PI * 2);
      g.fill();
    } else if (frame === 3) carve([13, 37, 22, 44, 27, 41, 32, 45, 37, 41, 42, 44, 51, 37, 46, 49, 38, 55, 24, 55, 17, 48]);
    else carve([16, 41, 22, 44, 26, 41, 30, 45, 34, 41, 38, 45, 42, 41, 48, 44, 44, 50, 32, 53, 20, 50]);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.repeat.x = 1 / FACE_FRAMES;
  return t;
}

export class Foreground {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(34, 1, 0.5, 60);
  private readonly root = new Group();
  private readonly hemi = new HemisphereLight(new Color("#8a92e6"), new Color("#1a1420"), 0.7);
  private readonly rim = new DirectionalLight(new Color("#c3cdff"), 1.6);
  private readonly warm = new PointLight(new Color("#ffb066"), 0, 3.2, 1.6);
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private halos: Points | null = null;
  private kind: ForegroundKind | null = null;
  private universe: Universe | null = null;
  private width = 1;
  private height = 1;
  private built: { geoms: { dispose(): void }[] } = { geoms: [] };
  pumpkin: { readonly position: Vector3; readonly face: MeshStandardMaterial; readonly atlas: CanvasTexture; expression: number } | null = null;
  private flames: { readonly positions: BufferAttribute; readonly material: MeshStandardMaterial } | null = null;
  private readonly flameTips: { index: number; x: number; y: number; z: number; phase: number }[] = [];
  readonly candlesAt = new Vector3();

  /** A wider, softer glow than the islands' (seen this close, a small sprite shows its edge). */
  private readonly glow: Texture = glowTexture(128, 0.95);

  constructor(private readonly gm: GenericMaterials, _islandGlow: Texture) {
    this.scene.add(this.hemi, this.rim, this.rim.target, this.warm, this.root);
    // Behind the ledge, looking back at the viewer: the rock is a silhouette with a moonlit rim.
    this.rim.position.set(1.5, 3, -26);
    this.rim.target.position.set(0, -1, -D);
  }

  get active(): boolean {
    return this.kind !== null;
  }

  set(kind: ForegroundKind | null, u: Universe) {
    if (kind === this.kind && u === this.universe) return;
    this.kind = kind;
    this.universe = u;
    this.hemi.color.set(u.hemi.sky);
    this.hemi.groundColor.set(u.hemi.ground);
    this.rim.color.set(u.moon.color);
    this.rebuild();
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.rebuild();
  }

  private clear() {
    this.pumpkin = this.flames = null;
    this.flameTips.length = 0;
    for (const g of this.built.geoms) g.dispose();
    this.built = { geoms: [] };
    this.root.clear();
    if (this.halos) {
      this.halos.removeFromParent();
      this.halos.geometry.dispose();
      (this.halos.material as ShaderMaterial).dispose();
      this.halos = null;
    }
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.warm.intensity = 0;
  }

  private rebuild() {
    this.clear();
    if (!this.kind || !this.universe) return;
    const kind = this.kind;
    const hh = D * Math.tan((17 * Math.PI) / 180);
    const hw = hh * this.camera.aspect;
    const r = rng(kind.length * 7919 + 3);
    const landing = kind === "landing";
    // The ledge spans the whole width (from the middle on the landing, where the question has the left half).
    const x0 = landing ? hw * 0.02 : -hw * 1.08;
    const x1 = hw * 1.08;
    const baseY = -hh + (landing ? 0.09 : 0.08) * 2 * hh;
    const rock = new Builder();
    const N = 120;
    const top: number[] = [];
    const ph = [r() * 6.3, r() * 6.3, r() * 6.3];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = x0 + (x1 - x0) * t;
      // A weathered rim: long, low undulations and a little grain, rising towards the frame's outer edge. On the
      // landing it starts below the bottom of the frame and climbs out, so it never ends in a cut edge mid-screen.
      const enter = 1 - Math.min(1, t / 0.42);
      const rise = landing ? 0.9 * Math.max(0, t - 0.7) ** 1.5 - 1.2 * enter * enter * (3 - 2 * enter) : 0.5 * Math.abs(t - 0.5) ** 3 * 8;
      const y = baseY + hh * (0.035 * Math.sin(t * 9.1 + ph[0]!) + 0.02 * Math.sin(t * 23.7 + ph[1]!) + 0.008 * Math.sin(t * 61 + ph[2]!) + rise * 0.3) + 0.004 * hh * (r() - 0.5);
      top.push(y);
      const back = rock.vert(x, y - 0.02, -D - 0.6, t * 9, 0, [0.62, 0.58, 0.64]);
      const front = rock.vert(x, y - 0.06 * hh, -D + 0.25, t * 9, 0.35, [0.36, 0.34, 0.4]);
      const bottom = rock.vert(x, -hh * 1.4, -D + 0.45, t * 9, 2.2, [0.12, 0.12, 0.15]);
      if (i > 0) {
        const b = (i - 1) * 3;
        rock.quad(b, b + 1, front, back);
        rock.quad(b + 1, b + 2, bottom, front);
      }
    }
    const at = (fx: number) => {
      const t = Math.max(0, Math.min(1, (fx * hw - x0) / (x1 - x0)));
      return { x: x0 + (x1 - x0) * t, y: top[Math.round(t * N)]! - 0.03 };
    };
    const rockMat = new MeshStandardMaterial({ name: "Ledge_Rock", map: this.gm.rock.map, normalMap: this.gm.rock.normalMap, color: new Color("#5a5566"), roughness: 0.95, vertexColors: true });
    const iron = new MeshStandardMaterial({ name: "Ledge_Iron", color: new Color("#14131a"), roughness: 0.5, metalness: 0.7 });
    const wax = new MeshStandardMaterial({ name: "Ledge_Wax", color: new Color("#e9dcc4"), roughness: 0.7, emissive: new Color("#ffb46a"), emissiveIntensity: 0.12 });
    const flame = new MeshStandardMaterial({ name: "Ledge_Flame", color: new Color("#ffd28a"), emissive: new Color("#ffad5c"), emissiveIntensity: 6, side: DoubleSide });
    const leaves = new MeshStandardMaterial({ name: "Ledge_Leaves", map: this.gm.leaves.map, alphaTest: 0.45, side: DoubleSide, roughness: 0.85, vertexColors: true });
    // Seen this close, the islands' lantern glass (bright enough to read from far away) burns out to white: a dimmer amber.
    const lantern = new MeshStandardMaterial({ name: "Ledge_Lantern", color: new Color("#4a2c14"), emissive: new Color("#ff9440"), emissiveIntensity: 1.5, roughness: 0.4 });
    this.materials.push(rockMat, iron, wax, flame, leaves, lantern);
    const ironB = new Builder();
    const glassB = new Builder();
    const waxB = new Builder();
    const flameB = new Builder();
    const leafB = new Builder();
    const glows: HaloSpec[] = [];
    const candle = (fx: number, h: number, dz = 0) => {
      const p = at(fx);
      tube(waxB, [new Vector3(p.x, p.y - 0.05, -D + dz), new Vector3(p.x, p.y + h, -D + dz)], [0.045, 0.042], 8);
      const fy = p.y + h + 0.05;
      for (const a of [0, Math.PI / 2]) {
        const dx = Math.cos(a) * 0.022, dzz = Math.sin(a) * 0.022;
        const v0 = flameB.vert(p.x - dx, fy - 0.04, -D + dz - dzz, 0, 0);
        const v1 = flameB.vert(p.x + dx, fy - 0.04, -D + dz + dzz, 1, 0);
        const v2 = flameB.vert(p.x, fy + 0.07, -D + dz, 0.5, 1);
        flameB.tri(v0, v1, v2);
        if (landing) this.flameTips.push({ index: v2, x: p.x, y: fy + 0.07, z: -D + dz, phase: fx * 53 });
      }
      glows.push({ position: new Vector3(p.x, fy + 0.01, -D + dz), color: new Color("#ffbd6a").multiplyScalar(0.55), size: 0.13 });
      return p;
    };
    let warmAt: { x: number; y: number } | null = at(0.3);
    const dress: Record<ForegroundKind, () => void> = {
      city: () => {
        // A run of iron railings with spear tops, and a lantern where it ends.
        const from = -0.16, to = 0.2;
        for (let fx = from; fx <= to + 1e-6; fx += 0.03) {
          const p = at(fx);
          tube(ironB, [new Vector3(p.x, p.y - 0.1, -D - 0.1), new Vector3(p.x, p.y + 0.46, -D - 0.1)], [0.011, 0.011], 5);
          tube(ironB, [new Vector3(p.x, p.y + 0.46, -D - 0.1), new Vector3(p.x, p.y + 0.53, -D - 0.1)], [0.022, 0.002], 4);
        }
        for (const h of [0.1, 0.38]) {
          const a = at(from), b = at(to);
          tube(ironB, [new Vector3(a.x, a.y + h, -D - 0.1), new Vector3(b.x, b.y + h, -D - 0.1)], [0.01, 0.01], 4);
        }
        const l = at(to + 0.035);
        const head = lampPost(ironB, glassB, new Vector3(l.x, l.y - 0.05, -D - 0.12), 0.72, 0.045, 0.065);
        glows.push({ position: head, color: new Color("#ffad5c").multiplyScalar(0.42), size: 0.2 });
        warmAt = { x: head.x, y: head.y };
      },
      wild: () => {
        // Ferns and grasses along the rim, lit only by the moon: no lamp, nothing built.
        for (let i = 0; i < 70; i++) {
          const fx = -0.95 + r() * 1.9;
          const p = at(fx);
          const green = [0.12 + r() * 0.08, 0.2 + r() * 0.1, 0.1] as const;
          leafCard(leafB, p.x, p.y + 0.1 + r() * 0.08, -D - 0.2 + r() * 0.4, 0.28 + r() * 0.3, r() * Math.PI, green, false);
        }
        warmAt = null;
      },
      stones: () => {
        const p = at(0.2);
        candle(0.17, 0.26);
        candle(0.2, 0.17, 0.08);
        candle(0.235, 0.33, -0.04);
        warmAt = { x: p.x, y: p.y + 0.3 };
      },
      landing: () => {
        candle(0.62, 0.26);
        const candles = candle(0.655, 0.16, 0.08);
        this.candlesAt.set(candles.x, candles.y + 0.3, -D);
        candle(0.69, 0.34, -0.05);
        // One small carved pumpkin, glowing from inside, half in shadow at the edge of the frame.
        const p = at(0.8);
        const pumpkin = new Builder();
        const R = 0.14;
        const cx = p.x, cy = p.y + R * 0.72, cz = -D + 0.05;
        const lat = 10, lon = 18;
        const grid: number[][] = [];
        for (let i = 0; i <= lat; i++) {
          const ph = (i / lat) * Math.PI;
          const row: number[] = [];
          for (let j = 0; j <= lon; j++) {
            const th = (j / lon) * Math.PI * 2;
            const rib = 1 - 0.07 * Math.abs(Math.cos(th * 4));
            row.push(pumpkin.vert(cx + Math.sin(ph) * Math.cos(th) * R * rib * 1.15, cy + Math.cos(ph) * R * 0.82, cz + Math.sin(ph) * Math.sin(th) * R * rib, j / lon, i / lat, [0.62, 0.3, 0.08]));
          }
          grid.push(row);
        }
        for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) pumpkin.quad(grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!);
        tube(ironB, [new Vector3(cx, cy + R * 0.78, cz), new Vector3(cx + 0.02, cy + R * 0.98, cz), new Vector3(cx + 0.05, cy + R * 1.05, cz)], [0.02, 0.016, 0.01], 5);
        const face = faceTexture();
        this.textures.push(face);
        const skin = new MeshStandardMaterial({ name: "Ledge_Pumpkin", color: new Color("#c8641c"), roughness: 0.7, vertexColors: true });
        // The carved face: the face texture on a small quad just in front of the pumpkin, glowing where it is cut.
        this.materials.push(skin);
        const fg = pumpkin.geometry();
        this.built.geoms.push(fg);
        this.root.add(new Mesh(fg, skin));
        const decal = new Builder();
        const w = R * 1.05, h = R * 0.95;
        const v0 = decal.vert(cx - w, cy - h, cz + R * 1.0, 0, 0), v1 = decal.vert(cx + w, cy - h, cz + R * 1.0, 1, 0);
        const v2 = decal.vert(cx + w, cy + h, cz + R * 1.0, 1, 1), v3 = decal.vert(cx - w, cy + h, cz + R * 1.0, 0, 1);
        decal.quad(v0, v1, v2, v3);
        const glowFace = new MeshStandardMaterial({ name: "Ledge_PumpkinFace", color: new Color("#000000"), emissive: new Color("#ff9a3c"), emissiveMap: face, emissiveIntensity: 1.6, transparent: true, alphaMap: face, depthWrite: false });
        this.pumpkin = { position: new Vector3(cx, cy, cz), face: glowFace, atlas: face, expression: 0 };
        this.materials.push(glowFace);
        const dg = decal.geometry();
        this.built.geoms.push(dg);
        this.root.add(new Mesh(dg, glowFace));
        glows.push({ position: new Vector3(cx, cy, cz + 0.1), color: new Color("#ff9a3c").multiplyScalar(0.45), size: 0.3 });
        // A few fallen leaves.
        for (let i = 0; i < 18; i++) {
          const q = at(0.5 + r() * 0.48);
          leafCard(leafB, q.x, q.y + 0.03, -D - 0.2 + r() * 0.5, 0.12 + r() * 0.08, r() * Math.PI, AUTUMN[Math.floor(r() * AUTUMN.length)]!, false);
        }
        warmAt = { x: at(0.65).x, y: at(0.65).y + 0.4 };
      },
    };
    dress[kind]();
    if (warmAt) {
      this.warm.position.set(warmAt.x, warmAt.y, -D + 0.5);
      this.warm.intensity = 1.8;
    }
    for (const [b, m] of [[rock, rockMat], [ironB, iron], [waxB, wax], [flameB, flame], [leafB, leaves], [glassB, lantern]] as const) {
      if (!b.idx.length) continue;
      const g = b.geometry();
      if (landing && b === flameB) {
        const positions = (g.getAttribute("position") as BufferAttribute).setUsage(DynamicDrawUsage);
        this.flames = { positions, material: flame };
      }
      this.built.geoms.push(g);
      this.root.add(new Mesh(g, m));
    }
    if (glows.length) {
      this.halos = createHalos(glows, this.glow);
      (this.halos.material as ShaderMaterial).uniforms.uOpacity!.value = 0.75;
      this.halos.frustumCulled = false;
      this.root.add(this.halos);
    }
  }

  updateLanding(t: number, idle: boolean, wind: number, faceGlow: number, expression: number, portalLight: number): boolean {
    let changed = false;
    const pumpkin = this.pumpkin;
    if (pumpkin && (pumpkin.face.emissiveIntensity !== faceGlow || pumpkin.expression !== expression)) {
      pumpkin.face.emissiveIntensity = faceGlow;
      pumpkin.expression = expression;
      pumpkin.atlas.offset.x = expression / FACE_FRAMES;
      changed = true;
    }
    if (!this.flames) return changed;
    const { positions, material } = this.flames;
    const light = 6 + (idle ? 0.36 * Math.sin(t * 6) + 0.17 * Math.sin(t * 11) : 0) - 0.4 * Math.abs(wind) + 0.9 * portalLight;
    for (const tip of this.flameTips) {
      const x = Math.fround(tip.x + wind * 0.046 + (idle ? Math.sin(t * 6 + tip.phase) * 0.009 : 0));
      const y = Math.fround(tip.y + (idle ? Math.sin(t * 8 + tip.phase) * 0.013 : 0) - Math.abs(wind) * 0.014);
      if (positions.getX(tip.index) === x && positions.getY(tip.index) === y) continue;
      positions.setXYZ(tip.index, x, y, tip.z);
      positions.needsUpdate = true;
      changed = true;
    }
    if (material.emissiveIntensity !== light) {
      material.emissiveIntensity = light;
      changed = true;
    }
    return changed;
  }

  dispose() {
    this.clear();
    this.glow.dispose();
  }
}
