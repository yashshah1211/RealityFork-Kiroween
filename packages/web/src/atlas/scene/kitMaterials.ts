/**
 * Materials for the scenery kits (kit.ts): brick, plaster, stone, slate, windows, doors and solar panels. Textures are
 * drawn once on canvases (no image files, no third-party assets) and shared by every island, so a second house costs
 * vertices, not memory or draw calls.
 */
import { AdditiveBlending, CanvasTexture, ClampToEdgeWrapping, Color, DoubleSide, MeshStandardMaterial, PointsMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { glowTexture } from "./generic";

export interface KitMaterials {
  readonly brick: MeshStandardMaterial;
  readonly plaster: MeshStandardMaterial;
  readonly stone: MeshStandardMaterial;
  readonly slate: MeshStandardMaterial;
  readonly trim: MeshStandardMaterial;
  /** Windows and doors: one atlas, lit cells glow (emissive), dark cells reflect the sky. */
  readonly windows: MeshStandardMaterial;
  readonly solar: MeshStandardMaterial;
  readonly metal: MeshStandardMaterial;
  readonly led: MeshStandardMaterial;
  readonly arch: MeshStandardMaterial;
  /** Still water that holds the night sky (ponds). */
  readonly water: MeshStandardMaterial;
  /** Planks: tables, crates, signs, timber, doors, a water wheel. */
  readonly wood: MeshStandardMaterial;
  /** Striped canvas (awnings, parasols): two colourways, chosen by the v coordinate (0–0.5 and 0.5–1). */
  readonly awning: MeshStandardMaterial;
  /** A warm glow from inside (a forge, an open workshop door, a lit doorway). */
  readonly ember: MeshStandardMaterial;
  /** Dark silhouettes of people at work, cut from a small atlas (see FIGURES). */
  readonly figures: MeshStandardMaterial;
  /** People at work in front of a building (shops and studios): the same figures, in the warm mid-tone of lamplit clothes, so they read against a dark terrace as well as a pale pavement. */
  readonly crew: MeshStandardMaterial;
  /** Soft puffs of steam over a coffee machine (points; brightness per puff from vertex colours, additive). */
  readonly steam: PointsMaterial;
  dispose(): void;
}

/**
 * Columns of the window atlas: two lit windows, two dark ones, a door, a window lit by screens (cool), a shop's display
 * window and a café's window (both warm).
 */
export const WINDOW_CELLS = 8;
export const CELL = { litA: 0, litB: 1, darkA: 2, darkB: 3, door: 4, cool: 5, shop: 6, cafe: 7 } as const;
/** Columns of the figure atlas: someone behind a counter, someone standing, someone at a desk. */
export const FIGURES = 3;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** A tiny deterministic random stream for texture detail. */
function noise(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function tiled(c: HTMLCanvasElement, srgb = true, aniso = 4): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/** Running-bond brick, sooty and uneven: one tile is 2 m of wall. */
function brickTexture(aniso: number): CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = noise(11);
  g.fillStyle = "#4a403c";
  g.fillRect(0, 0, 256, 256);
  const bw = 32, bh = 12;
  for (let row = 0; row * bh < 256; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 256 + bw; x += bw) {
      const l = 30 + r() * 12;
      const hue = 8 + r() * 10;
      g.fillStyle = `hsl(${hue} ${32 + r() * 14}% ${l}%)`;
      g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
      if (r() < 0.18) {
        g.fillStyle = "rgba(20,14,14,0.28)";
        g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
  }
  // Soot gathered towards the top of a wall.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "rgba(10,8,12,0.18)");
  grad.addColorStop(1, "rgba(10,8,12,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return tiled(c, true, aniso);
}

/** Slate courses with staggered joints and lighter lower edges. */
function slateTexture(aniso: number): CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = noise(23);
  g.fillStyle = "#23262f";
  g.fillRect(0, 0, 256, 256);
  const sw = 22, sh = 16;
  for (let row = 0; row * sh < 256; row++) {
    const off = row % 2 ? sw / 2 : 0;
    for (let x = -sw; x < 256 + sw; x += sw) {
      const l = 22 + r() * 9;
      g.fillStyle = `hsl(${222 + r() * 16} ${10 + r() * 8}% ${l}%)`;
      g.fillRect(x + off + 1, row * sh + 1, sw - 2, sh - 1);
      g.fillStyle = "rgba(190,200,230,0.10)";
      g.fillRect(x + off + 1, row * sh + sh - 3, sw - 2, 2);
    }
  }
  return tiled(c, true, aniso);
}

/** Window and door atlas, albedo and emission. Lit windows are warm with curtains; dark ones hold the night sky. */
function windowTextures(): { map: CanvasTexture; emissive: CanvasTexture } {
  const W = 64, H = 96;
  const [c, g] = canvas(W * WINDOW_CELLS, H);
  const [e, ge] = canvas(W * WINDOW_CELLS, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W * WINDOW_CELLS, H);
  const frame = "#cbc3b4";
  for (let i = 0; i < WINDOW_CELLS; i++) {
    const x0 = i * W;
    g.fillStyle = frame;
    g.fillRect(x0, 0, W, H);
    if (i === CELL.cool) {
      // Screens seen through tall factory glazing: a cool, even light, small panes.
      const grad = g.createLinearGradient(0, 6, 0, H - 6);
      grad.addColorStop(0, "#b9c4ff");
      grad.addColorStop(1, "#5a63c8");
      g.fillStyle = grad;
      g.fillRect(x0 + 5, 5, W - 10, H - 10);
      const ge2 = ge.createLinearGradient(0, 6, 0, H - 6);
      ge2.addColorStop(0, "#8f9cff");
      ge2.addColorStop(1, "#3c45a8");
      ge.fillStyle = ge2;
      ge.fillRect(x0 + 5, 5, W - 10, H - 10);
      g.fillStyle = "#3b3f52";
      ge.fillStyle = "#000";
      for (const gx of [W / 3, (2 * W) / 3]) {
        g.fillRect(x0 + gx - 1.5, 5, 3, H - 10);
        ge.fillRect(x0 + gx - 1.5, 5, 3, H - 10);
      }
      for (let gy = 1; gy < 4; gy++) {
        g.fillRect(x0 + 5, 5 + (gy * (H - 10)) / 4 - 1.5, W - 10, 3);
        ge.fillRect(x0 + 5, 5 + (gy * (H - 10)) / 4 - 1.5, W - 10, 3);
      }
      continue;
    }
    if (i === CELL.shop || i === CELL.cafe) {
      // A shop window: warm light, a thin frame, shelves of goods (shop) or a counter under two pendant lamps (café).
      const grad = g.createLinearGradient(0, 4, 0, H - 4);
      grad.addColorStop(0, "#ffd9a0");
      grad.addColorStop(1, "#d98c45");
      g.fillStyle = grad;
      g.fillRect(x0 + 3, 4, W - 6, H - 8);
      const ge2 = ge.createLinearGradient(0, 4, 0, H - 4);
      ge2.addColorStop(0, "#ffc985");
      ge2.addColorStop(1, "#b8662a");
      ge.fillStyle = ge2;
      ge.fillRect(x0 + 3, 4, W - 6, H - 8);
      g.fillStyle = "rgba(60,32,22,0.85)";
      ge.fillStyle = "rgba(40,16,6,0.9)";
      if (i === CELL.shop) {
        for (const sy of [30, 54, 78]) {
          g.fillRect(x0 + 6, sy, W - 12, 3);
          ge.fillRect(x0 + 6, sy, W - 12, 3);
          for (let k = 0; k < 6; k++) {
            const bw = 4 + ((k * 7 + sy) % 5), bh = 8 + ((k * 5 + sy) % 9);
            const bx = x0 + 8 + k * 8.5;
            g.fillRect(bx, sy - bh, bw, bh);
            ge.fillRect(bx, sy - bh, bw, bh);
          }
        }
      } else {
        g.fillRect(x0 + 3, H - 30, W - 6, 26);
        ge.fillRect(x0 + 3, H - 30, W - 6, 26);
        for (const lx of [W * 0.3, W * 0.7]) {
          g.fillRect(x0 + lx - 0.5, 4, 1, 22);
          g.fillStyle = "#fff1cf";
          g.beginPath();
          g.arc(x0 + lx, 28, 4, 0, Math.PI * 2);
          g.fill();
          ge.fillStyle = "#ffe2a8";
          ge.beginPath();
          ge.arc(x0 + lx, 28, 5, 0, Math.PI * 2);
          ge.fill();
          g.fillStyle = "rgba(60,32,22,0.85)";
          ge.fillStyle = "rgba(40,16,6,0.9)";
        }
      }
      g.fillStyle = frame;
      g.fillRect(x0 + W / 2 - 1, 4, 2, H - 8);
      ge.fillStyle = "#000";
      ge.fillRect(x0 + W / 2 - 1, 4, 2, H - 8);
      continue;
    }
    if (i === CELL.door) {
      // A panelled door under a small fanlight.
      g.fillStyle = "#2b1f22";
      g.fillRect(x0 + 6, 6, W - 12, H - 6);
      g.fillStyle = "#3a2a2e";
      for (const [px, py] of [[12, 30], [36, 30], [12, 62], [36, 62]] as const) g.fillRect(x0 + px, py, 16, 26);
      g.fillStyle = "#e9b46a";
      g.fillRect(x0 + 10, 9, W - 20, 14);
      ge.fillStyle = "#b5782e";
      ge.fillRect(x0 + 10, 9, W - 20, 14);
      continue;
    }
    const lit = i === CELL.litA || i === CELL.litB;
    const glassX = x0 + 6, glassY = 6, gw = W - 12, gh = H - 12;
    if (lit) {
      const grad = g.createLinearGradient(0, glassY, 0, glassY + gh);
      grad.addColorStop(0, "#ffd79a");
      grad.addColorStop(1, "#e59a4c");
      g.fillStyle = grad;
      g.fillRect(glassX, glassY, gw, gh);
      const ge2 = ge.createLinearGradient(0, glassY, 0, glassY + gh);
      ge2.addColorStop(0, "#ffcf8a");
      ge2.addColorStop(1, "#d9822f");
      ge.fillStyle = ge2;
      ge.fillRect(glassX, glassY, gw, gh);
      if (i === CELL.litA) {
        // Curtains half drawn.
        for (const [cx, cw] of [[glassX, 11], [glassX + gw - 11, 11]] as const) {
          g.fillStyle = "#7a3b2c";
          g.fillRect(cx, glassY, cw, gh);
          ge.fillStyle = "#3a1608";
          ge.fillRect(cx, glassY, cw, gh);
        }
      }
    } else {
      const grad = g.createLinearGradient(0, glassY, 0, glassY + gh);
      grad.addColorStop(0, i === CELL.darkA ? "#2c3762" : "#232c52");
      grad.addColorStop(1, "#0d1128");
      g.fillStyle = grad;
      g.fillRect(glassX, glassY, gw, gh);
      if (i === CELL.darkB) {
        g.fillStyle = "rgba(200,210,255,0.16)";
        g.beginPath();
        g.moveTo(glassX + 6, glassY + gh);
        g.lineTo(glassX + 22, glassY);
        g.lineTo(glassX + 30, glassY);
        g.lineTo(glassX + 14, glassY + gh);
        g.fill();
      }
    }
    // Glazing bars: one upright, two across (sash windows).
    g.fillStyle = frame;
    g.fillRect(x0 + W / 2 - 2, glassY, 4, gh);
    g.fillRect(glassX, glassY + gh / 2 - 2, gw, 4);
    g.fillRect(glassX, glassY + gh / 4 - 1, gw, 2);
    ge.fillStyle = "#000";
    ge.fillRect(x0 + W / 2 - 2, glassY, 4, gh);
    ge.fillRect(glassX, glassY + gh / 2 - 2, gw, 4);
    ge.fillRect(glassX, glassY + gh / 4 - 1, gw, 2);
  }
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  const emissive = new CanvasTexture(e);
  emissive.colorSpace = SRGBColorSpace;
  return { map, emissive };
}

/** A solar module: dark blue cells in a silver frame. */
function solarTexture(aniso: number): CanvasTexture {
  const [c, g] = canvas(128, 192);
  g.fillStyle = "#aab3c4";
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = "#0e1a36";
  g.fillRect(5, 5, 118, 182);
  g.strokeStyle = "#3d5180";
  g.lineWidth = 1.5;
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(5 + (118 * i) / 6, 5);
    g.lineTo(5 + (118 * i) / 6, 187);
    g.stroke();
  }
  for (let j = 1; j < 10; j++) {
    g.beginPath();
    g.moveTo(5, 5 + (182 * j) / 10);
    g.lineTo(123, 5 + (182 * j) / 10);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Weathered planks running along u: one tile is 1.5 m. */
function woodTexture(aniso: number): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = noise(37);
  g.fillStyle = "#2a1c16";
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    const l = 24 + r() * 10;
    g.fillStyle = `hsl(${20 + r() * 10} ${30 + r() * 12}% ${l}%)`;
    g.fillRect(0, y + 1, 128, 14);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = `rgba(20,12,8,${0.12 + r() * 0.14})`;
      g.fillRect(r() * 128, y + 2 + r() * 11, 18 + r() * 40, 1);
    }
    g.fillStyle = "rgba(10,6,4,0.5)";
    g.fillRect(((y * 37) % 100) + 10, y + 1, 1.5, 14);
  }
  return tiled(c, true, aniso);
}

/** Awning canvas: wide stripes, deep oxblood and cream above (v 0.5–1), bottle green and cream below (v 0–0.5). */
function awningTexture(aniso: number): CanvasTexture {
  const [c, g] = canvas(128, 128);
  for (const [y0, deep] of [[0, "#6e1f24"], [64, "#1f4a3a"]] as const) {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#d9cdb4" : deep;
      g.fillRect(i * 16, y0, 16, 64);
    }
    const grad = g.createLinearGradient(0, y0, 0, y0 + 64);
    grad.addColorStop(0, "rgba(0,0,0,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, y0, 128, 64);
  }
  const t = tiled(c, true, aniso);
  t.wrapT = ClampToEdgeWrapping;
  return t;
}

/** Silhouettes, cut out by alpha: behind a counter (head, shoulders, apron), standing, seated at a desk. */
function figureTexture(): CanvasTexture {
  const W = 64, H = 128;
  const [c, g] = canvas(W * FIGURES, H);
  g.fillStyle = "#fff";
  const body = (x0: number, shoulders: number, waist: number, top: number, bottom: number) => {
    const cx = x0 + W / 2;
    g.beginPath();
    g.ellipse(cx, top + 9, 8, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx - 4, top + 18);
    g.quadraticCurveTo(cx - shoulders, top + 22, cx - shoulders, top + 34);
    g.lineTo(cx - waist, bottom);
    g.lineTo(cx + waist, bottom);
    g.lineTo(cx + shoulders, top + 34);
    g.quadraticCurveTo(cx + shoulders, top + 22, cx + 4, top + 18);
    g.closePath();
    g.fill();
  };
  body(0, 17, 14, 18, 128);
  body(W, 15, 12, 8, 128);
  body(W * 2, 16, 15, 34, 128);
  const t = new CanvasTexture(c);
  return t;
}

export function kitMaterials(maxAnisotropy: number, rockMap: Texture | null): KitMaterials {
  const textures: Texture[] = [];
  const keep = <T extends Texture>(t: T) => (textures.push(t), t);
  const brick = new MeshStandardMaterial({ name: "Kit_Brick", map: keep(brickTexture(maxAnisotropy)), roughness: 0.92, vertexColors: true });
  const plaster = new MeshStandardMaterial({ name: "Kit_Plaster", color: new Color("#d6d0c6"), roughness: 0.9, vertexColors: true });
  const stone = new MeshStandardMaterial({ name: "Kit_Stone", ...(rockMap ? { map: rockMap } : {}), color: new Color("#d8c9b0"), roughness: 0.94, vertexColors: true });
  const slate = new MeshStandardMaterial({ name: "Kit_Slate", map: keep(slateTexture(maxAnisotropy)), roughness: 0.6, metalness: 0.05, side: DoubleSide, vertexColors: true });
  const trim = new MeshStandardMaterial({ name: "Kit_Trim", color: new Color("#bdb5a8"), roughness: 0.85, vertexColors: true });
  const w = windowTextures();
  keep(w.map);
  keep(w.emissive);
  const windows = new MeshStandardMaterial({
    name: "Kit_Windows", map: w.map, emissiveMap: w.emissive, emissive: new Color("#ffffff"), emissiveIntensity: 1.9, roughness: 0.32, metalness: 0.05,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const solar = new MeshStandardMaterial({ name: "Kit_Solar", map: keep(solarTexture(maxAnisotropy)), roughness: 0.2, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const metal = new MeshStandardMaterial({ name: "Kit_Metal", color: new Color("#d9dce4"), roughness: 0.45, metalness: 0.2, vertexColors: true });
  const led = new MeshStandardMaterial({ name: "Kit_Led", color: new Color("#7fe6d6"), emissive: new Color("#59d8c6"), emissiveIntensity: 3.2, roughness: 0.4 });
  const arch = new MeshStandardMaterial({ name: "Kit_Arch", ...(rockMap ? { map: rockMap } : {}), color: new Color("#b9b4c4"), roughness: 0.9, vertexColors: true });
  const water = new MeshStandardMaterial({ name: "Kit_Water", color: new Color("#0d2230"), roughness: 0.06, metalness: 0.2 });
  const wood = new MeshStandardMaterial({ name: "Kit_Wood", map: keep(woodTexture(maxAnisotropy)), roughness: 0.88, vertexColors: true });
  const awning = new MeshStandardMaterial({ name: "Kit_Awning", map: keep(awningTexture(maxAnisotropy)), roughness: 0.82, side: DoubleSide, vertexColors: true });
  const ember = new MeshStandardMaterial({ name: "Kit_Ember", color: new Color("#3a1606"), emissive: new Color("#ff8a3c"), emissiveIntensity: 2.4, roughness: 0.9 });
  const figures = new MeshStandardMaterial({ name: "Kit_Figures", color: new Color("#0b0a12"), alphaMap: keep(figureTexture()), alphaTest: 0.5, roughness: 1, side: DoubleSide });
  const all = [brick, plaster, stone, slate, trim, windows, solar, metal, led, arch, water, wood, awning, ember, figures];
  for (const m of all) m.envMapIntensity = 0.4;
  windows.envMapIntensity = 0.9;
  solar.envMapIntensity = 1.5;
  water.envMapIntensity = 1.6;
  figures.envMapIntensity = 0;
  const crew = new MeshStandardMaterial({ name: "Kit_Crew", color: new Color("#a3826c"), alphaMap: figures.alphaMap, alphaTest: 0.5, roughness: 1, side: DoubleSide });
  crew.envMapIntensity = 0;
  const steam = new PointsMaterial({ name: "Kit_Steam", map: keep(glowTexture(32)), color: new Color("#efe8df"), size: 0.62, sizeAttenuation: true, transparent: true, depthWrite: false, blending: AdditiveBlending, vertexColors: true });
  return {
    brick, plaster, stone, slate, trim, windows, solar, metal, led, arch, water, wood, awning, ember, figures, crew, steam,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of all) m.dispose();
      crew.dispose();
      steam.dispose();
    },
  };
}
