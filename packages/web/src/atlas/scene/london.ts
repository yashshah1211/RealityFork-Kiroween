/**
 * The detailed London island (art/london-world, exported from Blender as a Draco-compressed GLB).
 *
 * Loaded once per page and kept: every London instance in the scene is a clone that references the same geometries,
 * materials and textures (Object3D.clone shares them), so a second instance costs draw calls, not memory. Reopening
 * the preview reuses the parsed model; a new renderer uploads it again.
 * The GLB carries no lights, only LIGHT_* empties with their kind, colour and range as glTF extras; they are read
 * here and turned into a few clustered lights plus cheap glow sprites by the scene.
 */
import { Box3, Group, Mesh, Quaternion, Vector3, type Material, type MeshStandardMaterial, type Object3D, type Texture, type WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
// The glTF build of the Draco decoder that ships with three.js. Imported as URLs so Vite serves it in development and
// emits it with the build: same origin, no CDN. (DRACO_GLTF_CONFIG points at the same files, but its URLs break when
// Vite pre-bundles the loader in development.)
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import dracoJsUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import londonGlbUrl from "../assets/london_island.glb?url";

/** Copied from art/london-world/export (Blender worktree). Imported as a URL: the build names it by its content hash,
 * so browsers cache it for good. Same origin: no third-party request. */
export const LONDON_URL = londonGlbUrl;

/** Yaw that turns the model's best side (the Blender front three-quarter view) towards the atlas camera (+Z). */
export const LONDON_YAW = (220 * Math.PI) / 180;
/** The meshes a distant London instance keeps: the rock, the river, the tower, the palace and the bridge. */
export const FAR_PARTS = new Set(["Island", "Water", "Landmarks"]);

export type AnchorKind = "lamp" | "flood" | "phone" | "pumpkin" | "candle" | "other";
export interface LightAnchor {
  readonly kind: AnchorKind;
  readonly spot: boolean;
  /** In the template's local space (metres, Y up). */
  readonly position: Vector3;
  /** Spots only: unit direction in the template's local space. */
  readonly direction: Vector3 | null;
  readonly color: string;
  readonly intensity: number;
  readonly range: number;
}

export interface LondonTemplate {
  /** The whole island, centred so the ground plane is at y = 0. Never added to the scene: instances are clones. */
  readonly root: Group;
  readonly anchors: readonly LightAnchor[];
  readonly bounds: Box3;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly textures: number;
  readonly bytes: number;
  readonly loadMs: number;
}

const KINDS: readonly AnchorKind[] = ["lamp", "flood", "phone", "pumpkin", "candle"];

function anchorFrom(o: Object3D): LightAnchor | null {
  const x = o.userData as Record<string, unknown>;
  if (typeof x.rf_light !== "string") return null;
  const kind = (KINDS.find((k) => o.name.startsWith(`LIGHT_${k}`)) ?? "other") as AnchorKind;
  const spot = x.rf_light === "spot";
  // Blender aims a light along its local -Z; the glTF exporter's Y-up conversion turns that into the node's local -Y.
  const direction = spot ? new Vector3(0, -1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion())).normalize() : null;
  return {
    kind, spot, position: o.getWorldPosition(new Vector3()), direction,
    color: typeof x.color === "string" ? x.color : "#ffb862",
    intensity: typeof x.intensity === "number" ? x.intensity : 1,
    range: typeof x.range === "number" ? x.range : 6,
  };
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}

/**
 * Load and prepare the template. Rejects on any network, decoder or parse failure; the caller shows the simple
 * island instead and says so.
 */
export async function loadLondon(renderer: WebGLRenderer, opts: { url?: string; onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {}): Promise<LondonTemplate> {
  const t0 = performance.now();
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoJsUrl, wasm: dracoWasmUrl });
  draco.preload();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let bytes = 0;
  try {
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>((resolve, reject) => {
      loader.load(
        opts.url ?? LONDON_URL,
        resolve,
        (e) => {
          bytes = e.loaded;
          opts.onProgress?.({ loaded: e.loaded, total: e.total });
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
      opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const anchors: LightAnchor[] = [];
    const empties: Object3D[] = [];
    scene.traverse((o) => {
      const a = anchorFrom(o);
      if (a) {
        anchors.push(a);
        empties.push(o);
      }
    });
    for (const e of empties) e.removeFromParent();

    const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const textures = new Set<Texture>();
    let triangles = 0;
    let drawCalls = 0;
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      drawCalls += 1;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3;
      const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
      const top = topPart(o);
      o.castShadow = top !== "Water";
      o.receiveShadow = true;
      o.userData.part = top;
      for (const m of mats) {
        const s = m as MeshStandardMaterial;
        for (const t of [s.map, s.normalMap, s.roughnessMap, s.metalnessMap, s.emissiveMap, s.aoMap]) {
          if (t) {
            t.anisotropy = maxAniso;
            textures.add(t);
          }
        }
        // Night scene: the environment only adds a faint sheen; the moon and the lamps do the lighting.
        if ("envMapIntensity" in s) s.envMapIntensity = s.name === "Water" ? 1.0 : 0.35;
        if (s.name === "Water") {
          s.roughness = Math.min(s.roughness, 0.12);
          s.metalness = 0;
        }
      }
    });
    const bounds = new Box3().setFromObject(scene);
    return { root: scene, anchors, bounds, triangles: Math.round(triangles), drawCalls, textures: textures.size, bytes, loadMs: performance.now() - t0 };
  } finally {
    draco.dispose();
  }
}

/** The five mesh groups of the GLB (export_glb.py joins the Blender objects into these). */
const PARTS = new Set(["Island", "Water", "Landmarks", "Town", "Nature"]);

/** The mesh group ("Island", "Town", ...) an object belongs to: a glTF mesh with several primitives is a Group. */
function topPart(o: Object3D): string {
  for (let cur: Object3D | null = o; cur; cur = cur.parent) if (PARTS.has(cur.name)) return cur.name;
  return "";
}

/**
 * One London instance. "full": everything. "far": only the rock, river and landmarks (about 40% of the triangles,
 * no foliage), for a London future that is not the one in focus. Geometry, materials and textures are shared.
 */
export function londonInstance(t: LondonTemplate, detail: "full" | "far"): Group {
  const g = new Group();
  g.name = `london-${detail}`;
  const copy = t.root.clone(true);
  if (detail === "far") {
    const drop: Object3D[] = [];
    copy.traverse((o) => {
      if (PARTS.has(o.name) && !FAR_PARTS.has(o.name)) drop.push(o);
      if (o instanceof Mesh) o.castShadow = false;
    });
    for (const o of drop) o.removeFromParent();
  }
  copy.rotation.y = LONDON_YAW;
  g.add(copy);
  return g;
}
