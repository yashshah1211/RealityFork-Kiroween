/**
 * The 3D scene of the Explore preview: one floating island per path, ancestry threads between them, a moonlit sky.
 * Presentation only. It is given the paths (id, parent, which world) and where each one floats (layout.ts); it reports
 * clicks back as ids. It never reads or changes the map itself.
 *
 * Performance rules (see docs/validation/atlas-3d/):
 *  - the London GLB is loaded once; the focused London path gets the full model, other London paths a lighter copy
 *    (rock, river, landmarks) that shares its geometry, materials and textures; on low quality they use the open
 *    landscape instead;
 *  - one fixed rig of lights follows the focused island, so changing focus never changes the number of lights and
 *    never recompiles shaders; every other light is a glow sprite;
 *  - one shadow-casting light; no post-processing; DPR capped.
 */
import {
  ACESFilmicToneMapping,

  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Points,
  type ShaderMaterial,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { HollowWorld } from "../hollow/world";
import type { Mode, Slot } from "../layout";
import type { Universe } from "../environment/universes";
import { UNIVERSES } from "../environment/universes";
import { createHalos, createMist, createSky, HALO_SCALE, mistTexture, MOON_DIR, paintSky, PALETTE, Thread, type HaloSpec } from "./atmosphere";
import { Ambience } from "./ambience";
import { Foreground, type ForegroundKind } from "./foreground";
import { genericMaterials, glowTexture, type GenericIsland, type GenericMaterials } from "./generic";
import { buildKitIsland, kitSignature, type KitView } from "./kit";
import { kitMaterials, type KitMaterials } from "./kitMaterials";
import { LandingHaunt, type LandingSecret } from "./landingHaunt";
import { loadLondon, londonInstance, type LightAnchor, type LondonTemplate } from "./london";

export type Quality = "high" | "low";
export type ModelStatus =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly loaded: number; readonly total: number }
  | { readonly state: "ready"; readonly ms: number }
  | { readonly state: "failed"; readonly message: string };

export interface AtlasNodeView {
  readonly id: string;
  readonly parentId: string | null;
  /** The detailed hand-made place, when the map says the path happens there (otherwise its family's kit). */
  readonly place: "london" | null;
  /** The family's scenery for this path: what its island is dressed with when it has no detailed place. */
  readonly kit: KitView;
  readonly seed: number;
}

export interface AtlasSceneOptions {
  readonly reducedMotion: boolean;
  readonly quality: Quality;
  readonly onSelect: (id: string) => void;
  readonly onHover?: (id: string | null) => void;
  readonly onModel?: (s: ModelStatus) => void;
  readonly onQuality?: (q: Quality, reason: string) => void;
  readonly onContextLost?: () => void;
  /** Test hook: load the London model from another URL (a missing file exercises the fallback). */
  readonly londonUrl?: string;
  /** False to disable Explore orbit, selection, and the pointer cursor. */
  readonly interactive?: boolean;
  /** The Imagine backdrop's interactions. */
  readonly landingEffects?: { readonly onDiscovery: (count: number) => void; readonly onReady?: () => void };
  /** The universe to start in (sky, fog and light). */
  readonly universe?: Universe;
  /** "full": every London path gets the full model (Compare shows two futures side by side, lit the same way). */
  readonly londonDetail?: "auto" | "full";
  /** The ledge in the foreground: the universe's own ("auto"), the landing page's, or none. */
  readonly foreground?: "auto" | "landing" | null;
  /** "right": distant worlds keep to the right of the view (the landing page's question has the left). */
  readonly ambienceBias?: "even" | "right";
  /** False: no distant worlds (Compare's short band, where they read as debris beside the two islands). */
  readonly distantWorlds?: boolean;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface LandingVisit {
  readonly camera: PerspectiveCamera;
  readonly destination: Vector3;
  readonly renderer: WebGLRenderer;
  readonly quality: Quality;
  readonly reducedMotion: () => boolean;
  readonly drawApproach: (camera: PerspectiveCamera) => void;
  readonly mount: (viewport: HTMLElement) => void;
  readonly end: () => void;
}

export interface LandingVisitStats {
  phase: "approach" | "reveal" | "exploring";
  progress: number;
  approachEye: number[];
  looking: boolean;
  world: ReturnType<HollowWorld["stats"]> | null;
}

const FOV = 34;
const FOCUS_EL = (13 * Math.PI) / 180;
const OVERVIEW_EL = (15 * Math.PI) / 180;
const LONDON_SIZE = { top: 24.7, bottom: -18.3, radius: 23, label: 26.5 };
const FOG_DENSITY = 0.0021;
/** The moon never sets into the sea of cloud below the horizon (sin of its lowest elevation). */
const MOON_MIN_Y = 0.05;

/** Critically damped spring towards a target (semi-implicit Euler, stable for the clamped frame step). */
class Spring3 {
  readonly v = new Vector3();
  constructor(readonly x: Vector3) {}
  /** `n` substeps of `dt` each (slow frames are split so the motion keeps real time). */
  step(target: Vector3, omega: number, dt: number, n = 1) {
    for (let i = 0; i < n; i++) {
      const ax = -2 * omega * this.v.x - omega * omega * (this.x.x - target.x);
      const ay = -2 * omega * this.v.y - omega * omega * (this.x.y - target.y);
      const az = -2 * omega * this.v.z - omega * omega * (this.x.z - target.z);
      this.v.x += ax * dt; this.v.y += ay * dt; this.v.z += az * dt;
      this.x.addScaledVector(this.v, dt);
    }
  }
  snap(target: Vector3) {
    this.x.copy(target);
    this.v.set(0, 0, 0);
  }
}
class Spring1 {
  v = 0;
  constructor(public x: number) {}
  step(target: number, omega: number, dt: number, n = 1) {
    for (let i = 0; i < n; i++) {
      this.v += (-2 * omega * this.v - omega * omega * (this.x - target)) * dt;
      this.x += this.v * dt;
    }
  }
  snap(target: number) {
    this.x = target;
    this.v = 0;
  }
}

type VisualKind = "kit" | "london-full" | "london-far";

interface Island {
  readonly id: string;
  place: "london" | null;
  kit: KitView;
  seed: number;
  parentId: string | null;
  readonly root: Group;
  readonly bob: Group;
  visual: Object3D | null;
  /** The object lights and halos attach to (inside the visual's own rotation). */
  mount: Object3D | null;
  visualKind: VisualKind | null;
  /** The island's own scenery, built once per seed and look (kitSignature). */
  built: GenericIsland | null;
  builtKey: string;
  halos: Points | null;
  /** Soft mist around the rock (high quality only). */
  mist: Mesh | null;
  readonly proxy: Mesh;
  readonly pos: Spring3;
  readonly scale: Spring1;
  readonly fade: Spring1;
  slot: Slot;
  removing: boolean;
  label: HTMLElement | null;
  phase: number;
}

interface Edge {
  readonly childId: string;
  readonly thread: Thread;
  readonly opacity: Spring1;
  readonly grow: Spring1;
}

/** A first guess at the device's quality tier; the scene steps down by itself if frames are slow. */
export function guessQuality(override: string | null): Quality {
  if (override === "low" || override === "high") return override;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if ((nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (coarse && (nav.hardwareConcurrency ?? 8) <= 6)) return "low";
  return "high";
}

export class AtlasScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 4000);
  private readonly controls: OrbitControls;
  private readonly world = new Group();
  private readonly islands = new Map<string, Island>();
  private readonly edges = new Map<string, Edge>();
  private readonly mats: GenericMaterials;
  private readonly kitMats: KitMaterials;
  private universe: Universe;
  private readonly ambience: Ambience;
  private readonly fg: Foreground;
  private readonly landing: LandingHaunt | null;
  private fgWanted: "auto" | "landing" | null;
  private readonly glow: Texture;
  private readonly mistMap: Texture;
  private readonly proxyMat = new MeshBasicMaterial({ visible: false });
  private readonly proxyGeo = new CylinderGeometry(1, 1, 1, 12);
  private readonly moon: DirectionalLight;
  private readonly rim: DirectionalLight;
  private readonly hemi: HemisphereLight;
  /** The lights that follow the focused island. Always the same number and kinds (no shader recompiles). */
  private readonly rig: { readonly group: Group; readonly points: PointLight[]; readonly spots: SpotLight[] };
  private readonly sky = createSky();
  private lastFrame = 0;
  private landingVisit: { readonly frame: (now: number, step: number) => void; readonly stats: () => LandingVisitStats } | null = null;
  private landingPauseMs = 0;
  private readonly raycaster = new Raycaster();
  private london: LondonTemplate | null = null;
  private londonHalos: HaloSpec[] = [];
  private londonState: ModelStatus = { state: "idle" };
  private londonFirstFrame: number | null = null;
  private loadStarted = false;
  private selectedId: string | null = null;
  /** Focus mode: the composed camera and how a screen hint (layout.ts) maps to a place in the world. */
  private focus: { target: Vector3; distance: number; f: Vector3; r: Vector3; u: Vector3; kx: number; ky: number; kr: number } | null = null;
  /** Where the moon shows in the sky: kept at the same place in the composed view, upper right of the free area. */
  private readonly moonDir = MOON_DIR.clone();
  private readonly moonGoal = MOON_DIR.clone();
  private mode: Mode = "focus";
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Screen rectangles (CSS px) a label must not cover: the title, the panel, the controls. */
  private blockers: readonly DOMRectReadOnly[] = [];
  private width = 1;
  private height = 1;
  private readonly frameMs = new Float32Array(600);
  /** JavaScript time spent preparing and submitting each frame (not GPU time). */
  private readonly cpuMs = new Float32Array(600);
  /** True once every island and the camera have reached their places (for tests and the report). */
  private settled = false;
  private frames = 0;
  private raf = 0;
  private disposed = false;
  private camTarget = new Spring3(new Vector3(0, 3, 0));
  private camRadius = new Spring1(140);
  private camPolar = new Spring1(Math.PI / 2 - FOCUS_EL);
  private camAzimuth = new Spring1(0);
  private camGoal = { target: new Vector3(0, 3, 0), radius: 140, polar: Math.PI / 2 - FOCUS_EL, azimuth: 0 };
  /** True while the camera eases to a new goal; false once the user takes over with the pointer. */
  private easing = true;
  private userOrbit = false;
  private quality: Quality;
  private reducedMotion: boolean;
  private down: { x: number; y: number; t: number } | null = null;
  private hoverId: string | null = null;
  private lastHover = 0;
  private qualityChecked = false;
  /** When the quality check started measuring (after the London model, if any, has loaded). */
  private qualityWindow: { readonly t0: number; readonly f0: number } | null = null;
  /** Something changed that needs a new frame even when nothing is moving. */
  private dirty = true;
  /** Frames actually drawn (an idle scene on low quality or with reduced motion is not redrawn). */
  private renders = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly host: HTMLElement, private readonly opts: AtlasSceneOptions) {
    this.quality = opts.quality;
    this.reducedMotion = opts.reducedMotion;
    this.universe = opts.universe ?? UNIVERSES.neutral;
    this.fgWanted = opts.foreground ?? null;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = this.quality === "high";
    // Two passes per frame (the scene, then the ledge in front of it): clear once, and count both in the statistics.
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = "atlas-canvas";
    canvas.setAttribute("aria-hidden", "true");
    // Hidden until its first frame is drawn (the page shows the sky colours meanwhile), so there is no black flash.
    canvas.style.opacity = "0";
    host.appendChild(canvas);
    canvas.addEventListener("webglcontextlost", this.onLost);

    this.scene.fog = new FogExp2(new Color(PALETTE.fog), FOG_DENSITY);
    this.scene.add(this.sky.mesh);
    this.scene.add(this.world);

    this.hemi = new HemisphereLight(new Color("#8790e0"), new Color("#3a2a3f"), 1.55);
    this.scene.add(this.hemi);
    this.moon = new DirectionalLight(new Color("#c3cdff"), 3.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 20; sc.far = 320;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.moon, this.moon.target);
    // A cool violet rim from behind and the moon's side, so islands separate from the sky.
    this.rim = new DirectionalLight(new Color("#9a8bff"), 1.3);
    this.rim.position.copy(MOON_DIR).multiplyScalar(200);
    this.scene.add(this.rim);

    const rig = new Group();
    rig.name = "focus-rig";
    const points = Array.from({ length: 4 }, () => {
      const l = new PointLight(new Color("#ffb46a"), 0, 26, 2);
      rig.add(l);
      return l;
    });
    const spots = Array.from({ length: 2 }, () => {
      const l = new SpotLight(new Color("#ffc58a"), 0, 70, Math.PI / 7, 0.65, 1.6);
      rig.add(l, l.target);
      return l;
    });
    this.rig = { group: rig, points, spots };
    this.scene.add(rig);

    this.mats = genericMaterials(Math.min(4, this.renderer.capabilities.getMaxAnisotropy()));
    this.glow = this.glowTex();
    this.kitMats = kitMaterials(Math.min(4, this.renderer.capabilities.getMaxAnisotropy()), this.mats.rock.map);
    this.ambience = new Ambience(this.glowTex(), HALO_SCALE, !!opts.landingEffects);
    this.ambience.bias = opts.ambienceBias ?? "even";
    this.ambience.distantWorlds = opts.distantWorlds ?? true;
    this.ambience.setQuality(this.quality);
    this.scene.add(this.ambience.group);
    this.fg = new Foreground(this.mats, this.glowTex());
    this.applyUniverse();
    this.mistMap = mistTexture(128);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = opts.interactive !== false;
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.6;
    this.controls.minPolarAngle = Math.PI / 2 - (36 * Math.PI) / 180;
    this.controls.maxPolarAngle = Math.PI / 2 - (2 * Math.PI) / 180;
    this.controls.minAzimuthAngle = -1.0;
    this.controls.maxAzimuthAngle = 1.0;
    this.controls.addEventListener("change", () => {
      this.dirty = true;
    });
    this.controls.addEventListener("start", () => {
      this.easing = false;
      this.userOrbit = true;
    });

    if (opts.interactive !== false) {
      canvas.addEventListener("pointerdown", this.onDown);
      canvas.addEventListener("pointerup", this.onUp);
      canvas.addEventListener("pointermove", this.onMove);
      canvas.addEventListener("pointerleave", () => this.setHover(null));
    } else {
      canvas.style.pointerEvents = "none";
    }
    this.landing = opts.landingEffects
      ? new LandingHaunt(this.scene, this.glow, canvas, this.camera, this.fg, this.ambience, this.sky.material, this.islands, opts.landingEffects.onDiscovery)
      : null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Drawing resolution: at most 1.75 device pixels per CSS pixel (1.5 on touch screens, 1 on low quality). */
  private pixelRatio(): number {
    const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    return Math.min(window.devicePixelRatio || 1, this.quality === "high" ? (touch ? 1.5 : 1.75) : 1);
  }

  // ---------- public API ----------

  activateLandingSecret(secret: LandingSecret) {
    if (!this.disposed && !this.landingVisit) this.landing?.activateSecret(secret);
  }

  setLandingEntry(control: HTMLButtonElement | null, enter?: () => void) {
    this.landing?.setEntry(control, enter);
  }

  /** Lend the landing canvas and its frame loop to an excursion while the diorama stays in memory. */
  beginLandingVisit(id: string, draw: (visit: LandingVisit, now: number, step: number) => void, stats: () => LandingVisitStats): LandingVisit | null {
    const island = this.islands.get(id);
    if (!this.landing || this.disposed || this.landingVisit || !island?.root.visible) return null;
    const camera = this.camera.clone();
    const destination = island.bob.localToWorld(new Vector3(0, 5, 0));
    const started = performance.now();
    const canvas = this.renderer.domElement;
    let mounted = false;
    this.landing.clearPointer();
    this.qualityWindow = null;
    const visit: LandingVisit = {
      camera, destination, renderer: this.renderer, quality: this.quality,
      reducedMotion: () => this.reducedMotion,
      drawApproach: (eye) => this.drawBackdrop(eye),
      mount: (viewport) => {
        viewport.appendChild(canvas);
        mounted = true;
      },
      end: () => {
        if (this.landingVisit?.frame !== frame) return;
        this.landingVisit = null;
        this.landingPauseMs += performance.now() - started;
        this.landing?.clearPointer();
        if (this.disposed || this.renderer.getContext().isContextLost()) return;
        if (mounted) this.host.appendChild(canvas);
        this.resize(mounted);
        this.drawBackdrop(this.camera);
        this.dirty = true;
      },
    };
    const frame = (now: number, step: number) => draw(visit, now, step);
    this.landingVisit = { frame, stats };
    return visit;
  }

  /** The paths, where each floats, which one is selected and the view. Call whenever any of these change. */
  update(nodes: readonly AtlasNodeView[], slots: ReadonlyMap<string, Slot>, selectedId: string, mode: Mode) {
    const firstUpdate = this.islands.size === 0;
    const known = new Set(nodes.map((n) => n.id));
    for (const isl of this.islands.values()) if (!known.has(isl.id)) isl.removing = true;
    for (const n of nodes) {
      const slot = slots.get(n.id);
      if (!slot) continue;
      let isl = this.islands.get(n.id);
      if (!isl) {
        isl = this.addIsland(n, slot, firstUpdate);
      } else {
        isl.removing = false;
        isl.place = n.place;
        isl.kit = n.kit;
        isl.seed = n.seed;
        isl.parentId = n.parentId;
      }
      isl.slot = slot;
    }
    const focusChanged = selectedId !== this.selectedId || mode !== this.mode;
    this.selectedId = selectedId;
    this.mode = mode;
    if (!this.loadStarted && nodes.some((n) => n.place === "london")) void this.loadLondonModel();
    this.dirty = true;
    this.refreshVisuals();
    this.syncEdges(nodes);
    if (focusChanged || firstUpdate) this.aimCamera(firstUpdate || this.reducedMotion);
  }

  /** Screen space covered by the panel and controls, in CSS pixels: the camera frames the free area. */
  setInsets(insets: Insets) {
    const same = (["top", "right", "bottom", "left"] as const).every((k) => insets[k] === this.insets[k]);
    if (same) return;
    this.insets = insets;
    this.dirty = true;
    this.applyViewOffset();
    this.aimCamera(this.reducedMotion);
  }

  /**
   * Put the moon at a place on the canvas (fractions of its width and height from the top left), or null to keep it
   * beside the free area. The landing page on phones uses it: there the free area is below the question, so the moon
   * would otherwise rise behind the question. It still never sinks below its lowest elevation. `scale` resizes the disc
   * and `glow` dims its wide halo (a small screen has less room for them, and text sits close by).
   */
  setMoonAt(at: { readonly x: number; readonly y: number } | null, scale = 1, glow = 1) {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
    if (scale !== this.moonScale) {
      this.moonScale = scale;
      this.applyMoonSize();
      this.dirty = true;
    }
    if (this.moonGlow !== glow) {
      this.moonGlow = glow;
      this.sky.material.uniforms.uMoonGlow!.value = glow;
      this.dirty = true;
    }
    if (at === this.moonAt || (at && this.moonAt && near(at.x, this.moonAt.x) && near(at.y, this.moonAt.y))) return;
    this.moonAt = at;
    this.dirty = true;
    this.aimCamera(this.reducedMotion);
  }
  private moonAt: { readonly x: number; readonly y: number } | null = null;
  private moonScale = 1;
  private moonGlow = 1;
  private applyMoonSize() {
    this.sky.material.uniforms.uMoonSize!.value = Math.cos(Math.acos(this.universe.sky.moonSize) * this.moonScale);
  }

  /** Areas labels must stay clear of. */
  setBlockers(rects: readonly DOMRectReadOnly[]) {
    this.blockers = rects;
  }

  /** The label element of one island, positioned by the scene every frame. */
  setLabel(id: string, el: HTMLElement | null) {
    this.dirty = true;
    const isl = this.islands.get(id);
    if (isl) isl.label = el;
    else if (el) this.pendingLabels.set(id, el);
  }
  private readonly pendingLabels = new Map<string, HTMLElement>();

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.controls.enableDamping = !reduced;
    if (this.landing) this.dirty = true;
  }

  /** The ledge in the foreground (wide screens): the universe's own, the landing page's, or none. */
  setForeground(kind: "auto" | "landing" | null) {
    if (kind === this.fgWanted) return;
    this.fgWanted = kind;
    this.applyForeground();
    this.dirty = true;
  }

  private applyForeground() {
    const kind: ForegroundKind | null = this.fgWanted === "auto" ? this.universe.ambience.ledge : this.fgWanted;
    this.fg.set(kind, this.universe);
    this.fg.resize(this.width, this.height);
  }

  /** The glow sprite texture, created on first use (the ambience and the ledge share it with the islands). */
  private glowTex() {
    return (this.sharedGlow ??= glowTexture(64));
  }
  private sharedGlow: Texture | null = null;

  /** The universe the islands float in: sky, clouds, fog, light and ambience. Lights keep their number, so nothing recompiles. */
  setUniverse(u: Universe) {
    if (u === this.universe) return;
    this.universe = u;
    this.applyUniverse();
    this.dirty = true;
  }

  private applyUniverse() {
    const u = this.universe;
    paintSky(this.sky.material, u.sky);
    this.applyMoonSize();
    this.sky.material.uniforms.uOctaves!.value = this.quality === "high" ? 5 : 3;
    const oldBats = this.ambience.batsObject;
    this.ambience.setUniverse(u);
    if (oldBats !== this.ambience.batsObject) oldBats?.removeFromParent();
    if (this.ambience.batsObject) this.scene.add(this.ambience.batsObject);
    this.applyForeground();
    const fog = this.scene.fog as FogExp2;
    fog.color.set(u.fog.color);
    fog.density = u.fog.density;
    this.hemi.color.set(u.hemi.sky);
    this.hemi.groundColor.set(u.hemi.ground);
    this.hemi.intensity = u.hemi.intensity;
    this.moon.color.set(u.moon.color);
    this.moon.intensity = u.moon.intensity;
    this.rim.color.set(u.rim.color);
    this.rim.intensity = u.rim.intensity;
    this.renderer.toneMappingExposure = u.exposure;
    for (const isl of this.islands.values()) if (isl.mist) ((isl.mist.material as ShaderMaterial).uniforms.uColor!.value as Color).set(u.mist);
    // Environment: this universe's sky, prefiltered once. Gives water, glass and wet stone a faint sheen of it.
    const pmrem = new PMREMGenerator(this.renderer);
    const envScene = new Scene();
    const envSky = createSky();
    paintSky(envSky.material, { ...u.sky, stars: 0 });
    envScene.add(envSky.mesh);
    const previous = this.scene.environment;
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    previous?.dispose();
    envSky.material.dispose();
    envSky.mesh.geometry.dispose();
    pmrem.dispose();
  }

  /** Try the London model again after a failed load. */
  retryLondon() {
    if (this.londonState.state !== "failed") return;
    void this.loadLondonModel();
  }

  /** Back to the composed view after the user orbited or zoomed. */
  recenter() {
    this.userOrbit = false;
    this.aimCamera(this.reducedMotion);
  }

  /** Measurements for the validation report. Frame times are wall-clock times between animation frames. */
  stats() {
    const n = Math.min(this.frames, this.frameMs.length);
    const recent = Array.from(this.frameMs.slice(0, n)).filter((x) => x > 0).sort((a, b) => a - b);
    const q = (p: number) => (recent.length ? recent[Math.min(recent.length - 1, Math.floor(p * recent.length))]! : 0);
    const info = this.renderer.info;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const cpu = Array.from(this.cpuMs.slice(0, n)).filter((x) => x > 0).sort((a, b) => a - b);
    const qc = (p: number) => (cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(p * cpu.length))]! : 0);
    return {
      frames: this.frames,
      renders: this.renders,
      settled: this.settled,
      medianCpuMs: +qc(0.5).toFixed(2),
      p95CpuMs: +qc(0.95).toFixed(2),
      longFrames: recent.filter((x) => x > 50).length,
      medianFrameMs: +q(0.5).toFixed(2),
      p95FrameMs: +q(0.95).toFixed(2),
      maxFrameMs: +q(1).toFixed(2),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      size: [this.width, this.height],
      quality: this.quality,
      model: this.londonState,
      londonTriangles: this.london?.triangles ?? 0,
      londonFirstFrameMs: this.londonFirstFrame,
      gpu: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      universe: this.universe.family,
      ...(this.landing ? { landing: this.landing.stats(this.moonDir), hollow: this.landingVisit?.stats() ?? null } : {}),
      islands: [...this.islands.values()].filter((i) => !i.removing).map((i) => ({ id: i.id, visual: i.visualKind, family: i.kit.family, theme: i.kit.theme, props: i.kit.props, people: i.kit.people, hypothetical: i.kit.hypothetical, visible: i.slot.visible })),
    };
  }

  /**
   * Rough GPU memory held by what the scene shows: vertex and index buffers of every distinct geometry, and every
   * distinct texture at 4 bytes per pixel plus a third for mipmaps. An estimate, not a measurement: drivers add their own
   * overhead, and the shadow map, render targets and the environment map are counted separately.
   */
  memoryEstimate() {
    const geoms = new Set<{ attributes: Record<string, { array: ArrayLike<number> & { byteLength: number } }>; index: { array: { byteLength: number } } | null }>();
    const textures = new Set<Texture>();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh && !(o as Points).isPoints) return;
      geoms.add(m.geometry as never);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && (v as Texture).isTexture) textures.add(v as Texture);
      }
    });
    let geometryBytes = 0;
    for (const g of geoms) {
      for (const a of Object.values(g.attributes)) geometryBytes += a.array.byteLength;
      if (g.index) geometryBytes += g.index.array.byteLength;
    }
    let textureBytes = 0;
    for (const t of textures) {
      const img = t.image as { width?: number; height?: number } | null;
      if (img?.width && img.height) textureBytes += img.width * img.height * 4 * 1.33;
    }
    const shadow = this.renderer.shadowMap.enabled ? this.moon.shadow.mapSize.x * this.moon.shadow.mapSize.y * 4 : 0;
    const drawing = this.width * this.height * this.renderer.getPixelRatio() ** 2 * (4 + 4) * 2;
    return { geometries: geoms.size, geometryMB: +(geometryBytes / 1e6).toFixed(1), textures: textures.size, textureMB: +(textureBytes / 1e6).toFixed(1), shadowMB: +(shadow / 1e6).toFixed(1), framebufferMB: +(drawing / 1e6).toFixed(1) };
  }

  /** Reset the frame-time window (before a measured interval). */
  resetFrameTimes() {
    this.frameMs.fill(0);
    this.cpuMs.fill(0);
    this.frames = 0;
  }

  dispose() {
    this.disposed = true;
    this.landingVisit = null;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.landing?.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", this.onLost);
    for (const isl of this.islands.values()) this.destroyIsland(isl);
    this.islands.clear();
    for (const e of this.edges.values()) e.thread.dispose();
    this.edges.clear();
    this.mats.dispose();
    this.kitMats.dispose();
    this.ambience.dispose();
    this.fg.dispose();
    this.glow.dispose();
    this.mistMap.dispose();
    this.proxyGeo.dispose();
    this.proxyMat.dispose();
    this.sky.material.dispose();
    this.sky.mesh.geometry.dispose();
    this.scene.environment?.dispose();
    this.moon.shadow.map?.dispose();
    // The London template's geometries and textures are released with the context below; the parsed model stays
    // cached in memory so reopening the preview does not download it again.
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // ---------- islands ----------

  private addIsland(n: AtlasNodeView, slot: Slot, instant: boolean): Island {
    const root = new Group();
    root.name = `island-${n.id}`;
    const bob = new Group();
    root.add(bob);
    const proxy = new Mesh(this.proxyGeo, this.proxyMat);
    proxy.userData.id = n.id;
    (this.landing ? bob : root).add(proxy);
    // A new path rises from the island it was made from.
    const parent = n.parentId ? this.islands.get(n.parentId) : undefined;
    const start = !instant && parent ? parent.pos.x.clone().add(new Vector3(0, -6, 0)) : new Vector3(...slot.position);
    const isl: Island = {
      id: n.id, place: n.place, kit: n.kit, seed: n.seed, parentId: n.parentId, root, bob, visual: null, mount: null, visualKind: null, built: null, builtKey: "", halos: null, mist: null, proxy,
      pos: new Spring3(start), scale: new Spring1(instant || !parent ? slot.scale : 0.05), fade: new Spring1(instant ? 1 : 0), slot, removing: false,
      label: this.pendingLabels.get(n.id) ?? null, phase: (n.seed % 1000) / 159.2,
    };
    this.pendingLabels.delete(n.id);
    root.position.copy(isl.pos.x);
    root.scale.setScalar(isl.scale.x);
    this.world.add(root);
    this.islands.set(n.id, isl);
    return isl;
  }

  private destroyIsland(isl: Island) {
    // Keep the light rig in the scene (a light leaving the scene would change every shader).
    if (isl.mount && isAncestor(isl.root, this.rig.group)) this.scene.add(this.rig.group);
    this.setVisual(isl, null);
    isl.built?.dispose();
    isl.built = null;
    isl.root.removeFromParent();
  }

  /** Which representation each island shows now. Only the focused London path gets the full model. */
  private refreshVisuals() {
    this.dirty = true;
    for (const isl of this.islands.values()) {
      let want: VisualKind = "kit";
      if (isl.place === "london" && this.london) {
        if (isl.id === this.selectedId || this.opts.londonDetail === "full") want = "london-full";
        else want = this.quality === "high" ? "london-far" : "kit";
      }
      const stale = want === "kit" && isl.builtKey !== kitSignature(isl.kit);
      if (want !== isl.visualKind || stale) this.setVisual(isl, want);
    }
    this.attachRig();
  }

  private setVisual(isl: Island, kind: VisualKind | null) {
    if (isl.mount && isAncestor(isl.mount, this.rig.group)) this.scene.add(this.rig.group);
    if (isl.mist) {
      isl.mist.removeFromParent();
      isl.mist.geometry.dispose();
      (isl.mist.material as ShaderMaterial).dispose();
      isl.mist = null;
    }
    if (isl.visual) {
      isl.visual.removeFromParent();
      if (isl.halos) {
        isl.halos.removeFromParent();
        isl.halos.geometry.dispose();
        (isl.halos.material as { dispose(): void }).dispose();
        isl.halos = null;
      }
      isl.visual = null;
      isl.mount = null;
    }
    isl.visualKind = kind;
    if (!kind) return;
    let size: { top: number; bottom: number; radius: number };
    if (kind === "kit") {
      const key = kitSignature(isl.kit);
      if (!isl.built || isl.builtKey !== key) {
        isl.built?.dispose();
        isl.built = buildKitIsland(isl.seed, isl.kit, this.mats, this.kitMats);
        isl.builtKey = key;
      }
      const g = isl.built;
      isl.visual = g.group;
      isl.mount = g.group;
      isl.halos = createHalos(g.glows.map((x) => ({ position: x.position, color: new Color(x.color ?? "#ffc58c").multiplyScalar(0.8), size: x.size })), this.glow, this.landing ? g.radius : undefined);
      size = g;
    } else {
      const inst = londonInstance(this.london!, kind === "london-full" ? "full" : "far");
      isl.visual = inst;
      isl.mount = inst.children[0] ?? inst;
      isl.halos = createHalos(this.londonHalos, this.glow);
      size = LONDON_SIZE;
      if (kind === "london-full" && this.londonFirstFrame === null) this.londonFirstFrame = -performance.now();
    }
    isl.bob.add(isl.visual);
    isl.mount.add(isl.halos);
    if (this.quality === "high") {
      isl.mist = createMist(size.radius, -size.bottom, isl.seed, this.mistMap);
      ((isl.mist.material as ShaderMaterial).uniforms.uColor!.value as Color).set(this.universe.mist);
      isl.bob.add(isl.mist);
    }
    isl.proxy.scale.set(size.radius, size.top - size.bottom, size.radius);
    isl.proxy.position.y = (size.top + size.bottom) / 2;
  }

  /** Move the light rig onto the focused island and set it up for what that island is. */
  private attachRig() {
    const isl = this.selectedId ? this.islands.get(this.selectedId) : undefined;
    const { points, spots, group } = this.rig;
    for (const l of points) l.intensity = 0;
    for (const s of spots) s.intensity = 0;
    if (!isl?.mount) {
      this.scene.add(group);
      return;
    }
    isl.mount.add(group);
    group.position.set(0, 0, 0);
    if (isl.visualKind === "london-full" && this.london) {
      const lamps = clusters(this.london.anchors.filter((a) => a.kind === "lamp" || a.kind === "phone"), points.length);
      lamps.forEach((c, i) => {
        const l = points[i]!;
        l.position.copy(c.center).add(new Vector3(0, 0.6, 0));
        l.color.set("#ffb066");
        l.intensity = 7 * c.count ** 0.8;
        l.distance = 14 + 2 * c.spread;
      });
      const floods = clusters(this.london.anchors.filter((a) => a.spot), spots.length);
      floods.forEach((c, i) => {
        const s = spots[i]!;
        s.position.copy(c.center);
        const dir = c.direction ?? new Vector3(0, 1, 0);
        s.target.position.copy(c.center).addScaledVector(dir, 30);
        s.color.set("#ffc68f");
        s.intensity = 260 * c.count ** 0.6;
        s.angle = Math.PI / 6;
        s.distance = 60;
      });
    } else if (isl.built) {
      const l = points[0]!;
      l.position.copy(isl.built.lantern);
      l.color.set("#ffb066");
      l.intensity = 22;
      l.distance = 16;
    }
  }

  private async loadLondonModel() {
    this.loadStarted = true;
    this.setModel({ state: "loading", loaded: 0, total: 0 });
    try {
      const t = await cachedLondon(this.renderer, this.opts.londonUrl, (p) => this.setModel({ state: "loading", loaded: p.loaded, total: p.total }));
      if (this.disposed) return;
      this.london = t;
      this.londonHalos = t.anchors.map((a) => haloFor(a));
      // Compile the model's shaders before it appears, so the first frame with it does not stall.
      const probe = londonInstance(t, "full");
      try {
        await this.renderer.compileAsync(probe, this.camera, this.scene);
      } catch {
        /* compileAsync is an optimisation only */
      }
      if (this.disposed) return;
      this.setModel({ state: "ready", ms: Math.round(t.loadMs) });
      this.refreshVisuals();
      this.aimCamera(this.reducedMotion);
    } catch (e) {
      if (this.disposed) return;
      this.setModel({ state: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private setModel(s: ModelStatus) {
    this.londonState = s;
    this.opts.onModel?.(s);
  }

  // ---------- threads ----------

  private syncEdges(nodes: readonly AtlasNodeView[]) {
    const want = new Set(nodes.filter((n) => n.parentId && this.islands.has(n.parentId)).map((n) => n.id));
    for (const [id, e] of this.edges) {
      if (!want.has(id)) {
        e.thread.mesh.removeFromParent();
        e.thread.dispose();
        this.edges.delete(id);
      }
    }
    for (const id of want) {
      if (this.edges.has(id)) continue;
      const thread = new Thread();
      this.world.add(thread.mesh);
      const isNew = (this.islands.get(id)?.fade.x ?? 1) < 0.5;
      this.edges.set(id, { childId: id, thread, opacity: new Spring1(0), grow: new Spring1(isNew && !this.reducedMotion ? 0 : 1) });
    }
  }

  // ---------- camera ----------

  private applyViewOffset() {
    const { left, right, top, bottom } = this.insets;
    const ox = (right - left) / 2;
    const oy = (bottom - top) / 2;
    if (ox === 0 && oy === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, ox, oy, this.width, this.height);
  }

  /** The composed view: the focused island filling the free area, or every visible island (overview). */
  private aimCamera(instant: boolean) {
    const freeW = Math.max(160, this.width - this.insets.left - this.insets.right);
    const freeH = Math.max(160, this.height - this.insets.top - this.insets.bottom);
    const vfov = (FOV * Math.PI) / 180;
    const tanV = Math.tan(vfov / 2);
    const aspect = this.width / this.height;
    const tanH = tanV * aspect;
    let target: Vector3;
    let radius: number;
    let polar: number;
    const kx = (freeW / this.width) * tanH;
    const ky = (freeH / this.height) * tanV;
    if (this.mode === "focus") {
      const isl = this.selectedId ? this.islands.get(this.selectedId) : undefined;
      const sz = isl ? this.sizeOf(isl) : sizeFrom(LONDON_SIZE);
      const fill = isl?.slot.screen?.size ?? 0.66;
      // Frame the bounding sphere, so a tall London island and a flat open landscape take the same room on screen.
      radius = Math.max((sz.sphere * this.height) / (fill * freeH * tanV), (sz.sphere * this.height) / (0.8 * freeW * tanV));
      target = new Vector3(0, sz.center, 0);
      polar = Math.PI / 2 - FOCUS_EL;
      const b = basis(polar, 0);
      this.focus = { target, distance: radius, ...b, kx, ky, kr: (Math.min(freeW, freeH) * tanV) / this.height };
    } else {
      const vis = [...this.islands.values()].filter((i) => i.slot.visible && !i.removing);
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const i of vis) {
        const p = new Vector3(...i.slot.position);
        const s = i.slot.scale;
        lo.min(p.clone().add(new Vector3(-24 * s, -19 * s, -24 * s)));
        hi.max(p.clone().add(new Vector3(24 * s, 27 * s, 24 * s)));
      }
      if (!vis.length) {
        lo.set(-30, -20, -30);
        hi.set(30, 25, 30);
      }
      target = lo.clone().add(hi).multiplyScalar(0.5);
      const half = hi.clone().sub(lo).multiplyScalar(0.5);
      const dh = (half.y + half.z * Math.sin(OVERVIEW_EL)) / (tanV * (freeH / this.height));
      const dw = half.x / (tanH * (freeW / this.width));
      radius = Math.max(dh, dw) + half.z * 0.15;
      polar = Math.PI / 2 - OVERVIEW_EL;
    }
    this.camGoal = { target, radius, polar, azimuth: 0 };
    const mb = basis(polar, 0);
    if (this.moonAt) {
      // The canvas point, seen through the view offset: the camera axis falls on the centre of the free area.
      const ax = this.width / 2 - (this.insets.right - this.insets.left) / 2, ay = this.height / 2 - (this.insets.bottom - this.insets.top) / 2;
      const dx = (this.moonAt.x * this.width - ax) / (this.width / 2), dy = (ay - this.moonAt.y * this.height) / (this.height / 2);
      this.moonGoal.copy(mb.f).addScaledVector(mb.r, dx * tanH).addScaledVector(mb.u, dy * tanV).normalize();
    } else this.moonGoal.copy(mb.f).addScaledVector(mb.r, 0.5 * kx).addScaledVector(mb.u, 0.8 * ky).normalize();
    if (this.moonGoal.y < MOON_MIN_Y) {
      const k = Math.sqrt((1 - MOON_MIN_Y * MOON_MIN_Y) / Math.max(1e-6, this.moonGoal.x ** 2 + this.moonGoal.z ** 2));
      this.moonGoal.set(this.moonGoal.x * k, MOON_MIN_Y, this.moonGoal.z * k);
    }
    if (instant) this.moonDir.copy(this.moonGoal);
    this.controls.minDistance = radius * 0.55;
    this.controls.maxDistance = radius * 1.6;
    // Start the ease from wherever the camera is now (the user may have orbited or zoomed).
    if (!this.easing || this.userOrbit) {
      const off = this.camera.position.clone().sub(this.controls.target);
      this.camTarget.snap(this.controls.target);
      this.camRadius.snap(off.length());
      this.camPolar.snap(Math.acos(Math.min(1, Math.max(-1, off.y / Math.max(1e-6, off.length())))));
      this.camAzimuth.snap(Math.atan2(off.x, off.z));
    }
    this.userOrbit = false;
    this.easing = true;
    if (instant) {
      this.camTarget.snap(target);
      this.camRadius.snap(radius);
      this.camPolar.snap(polar);
      this.camAzimuth.snap(0);
      this.placeCamera();
    }
  }

  /** The size of an island as drawn now: London (full or far) or its own scenery. */
  private sizeOf(isl: Island) {
    return sizeFrom(isl.visualKind?.startsWith("london") ? LONDON_SIZE : isl.built ? { top: isl.built.top, bottom: isl.built.bottom, radius: isl.built.radius } : LONDON_SIZE);
  }

  /**
   * Where an island goes and how large it is. Overview: its position in metres. Focus: its screen hint, turned into a
   * position along the composed view (so it lands at that place on screen at that depth) and a scale that gives it
   * that size on screen.
   */
  private placement(isl: Island): { pos: Vector3; scale: number } {
    const show = isl.slot.visible && !isl.removing;
    const h = isl.slot.screen;
    const F = this.focus;
    if (this.mode === "overview" || !h || !F) {
      return { pos: new Vector3(...isl.slot.position), scale: isl.removing ? 0.02 : show ? isl.slot.scale : isl.slot.scale * 0.6 };
    }
    const sz = this.sizeOf(isl);
    const dist = F.distance + h.depth;
    let scale = isl.slot.role === "selected" ? 1 : (h.size * F.kr * dist) / sz.sphere;
    if (isl.removing) scale = 0.02;
    else if (!show) scale *= 0.6;
    const pos = F.target.clone().addScaledVector(F.f, h.depth).addScaledVector(F.r, h.x * F.kx * dist).addScaledVector(F.u, h.y * F.ky * dist);
    pos.y -= sz.center * scale;
    return { pos, scale };
  }

  private placeCamera() {
    const r = this.camRadius.x;
    const ph = this.camPolar.x;
    const th = this.camAzimuth.x;
    const t = this.camTarget.x;
    this.camera.position.set(t.x + r * Math.sin(ph) * Math.sin(th), t.y + r * Math.cos(ph), t.z + r * Math.sin(ph) * Math.cos(th));
    this.controls.target.copy(t);
    this.camera.lookAt(t);
  }

  private resize(restoreCanvas = false) {
    if (this.landingVisit) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const resized = w !== this.width || h !== this.height;
    if (!resized && !restoreCanvas) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.dirty = true;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
    HALO_SCALE.value = (h * this.renderer.getPixelRatio()) / 2 / Math.tan((FOV * Math.PI) / 360);
    this.fg.resize(w, h);
    if (resized) this.aimCamera(true);
  }

  // ---------- frame ----------

  private drawBackdrop(camera: PerspectiveCamera) {
    this.sky.mesh.position.copy(camera.position);
    (this.sky.material.uniforms.uCam!.value as Vector3).copy(camera.position);
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    if (this.fg.active) {
      this.renderer.clearDepth();
      this.renderer.render(this.fg.scene, this.fg.camera);
    }
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtReal = this.lastFrame ? Math.max(0, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    if (this.landingVisit) {
      this.landingVisit.frame(now, dtReal);
      return;
    }
    this.frameMs[this.frames % this.frameMs.length] = dtReal * 1000;
    this.frames += 1;
    // Springs advance in steps of at most 1/30 s; a slow frame takes several (up to a quarter of a second).
    const span = Math.min(dtReal, 0.25);
    const steps = Math.max(1, Math.ceil(span * 30));
    const dt = span / steps;
    const t = (now - this.landingPauseMs) / 1000;
    const motion = !this.reducedMotion;
    // The gentle floating, the thread pulse and the twinkling stars: off with reduced motion and on low quality,
    // so an idle scene can stop drawing altogether.
    const idle = motion && this.quality === "high";
    const cpu0 = performance.now();
    this.landing?.beginFrame(t, span, motion);
    let moving = 0;
    let landingChanged = false;

    // Islands glide to their places.
    for (const [id, isl] of this.islands) {
      const show = isl.slot.visible && !isl.removing;
      const { pos: target, scale } = this.placement(isl);
      if (motion) {
        isl.pos.step(target, 3.2, dt, steps);
        isl.scale.step(scale, 3.6, dt, steps);
        isl.fade.step(show ? 1 : 0, 4.5, dt, steps);
      } else {
        isl.pos.snap(target);
        isl.scale.snap(scale);
        isl.fade.snap(show ? 1 : 0);
      }
      moving = Math.max(moving, isl.pos.x.distanceTo(target), Math.abs(isl.scale.x - scale) * 40, Math.abs(isl.fade.x - (show ? 1 : 0)) * 40);
      isl.root.position.copy(isl.pos.x);
      isl.root.scale.setScalar(Math.max(0.001, isl.scale.x));
      isl.root.visible = isl.fade.x > 0.02;
      if (this.landing) landingChanged = this.landing.pose(isl, idle, isl.phase, isl.fade.x) || landingChanged;
      else isl.bob.position.y = idle ? Math.sin(t * 0.55 + isl.phase) * 0.45 : 0;
      // Moving parts (rotors, a mill wheel, drifting stones) turn only while the scene animates.
      if (idle && isl.visualKind === "kit" && isl.root.visible) isl.built?.animate?.(t + isl.phase * 10);
      isl.bob.rotation.y = idle ? Math.sin(t * 0.21 + isl.phase) * 0.012 : 0;
      if (!this.landing && isl.halos) (isl.halos.material as ShaderMaterial).uniforms.uOpacity!.value = 0.8 * isl.fade.x;
      if (isl.mist) (isl.mist.material as ShaderMaterial).uniforms.uOpacity!.value = 0.36 * isl.fade.x;
      if (isl.removing && isl.fade.x < 0.03) {
        this.destroyIsland(isl);
        this.islands.delete(id);
      }
    }

    // Threads follow the islands.
    for (const e of this.edges.values()) {
      const c = this.islands.get(e.childId);
      const p = c?.parentId ? this.islands.get(c.parentId) : undefined;
      if (!c || !p) continue;
      const both = c.slot.visible && p.slot.visible && !c.removing && !p.removing;
      const lit = c.slot.onPath && p.slot.onPath;
      if (motion) {
        e.opacity.step(both ? (lit ? 0.95 : 0.55) : 0, 4, dt, steps);
        e.grow.step(1, 2.2, dt, steps);
      } else {
        e.opacity.snap(both ? (lit ? 0.95 : 0.55) : 0);
        e.grow.snap(1);
      }
      e.thread.mesh.visible = e.opacity.x > 0.01;
      if (!e.thread.mesh.visible) continue;
      const a = p.pos.x.clone();
      const b = c.pos.x.clone();
      const ra = (p.visualKind?.startsWith("london") ? LONDON_SIZE.radius : p.built?.radius ?? 16) * p.scale.x;
      const rb = (c.visualKind?.startsWith("london") ? LONDON_SIZE.radius : c.built?.radius ?? 16) * c.scale.x;
      const flat = b.clone().sub(a).setY(0);
      const dir = flat.lengthSq() > 1e-4 ? flat.normalize() : new Vector3(1, 0, 0);
      a.addScaledVector(dir, ra * 0.62).add(new Vector3(0, -4.5 * p.scale.x + p.bob.position.y, 0));
      b.addScaledVector(dir, -rb * 0.62).add(new Vector3(0, -4.5 * c.scale.x + c.bob.position.y, 0));
      e.thread.set(a, b, a.distanceTo(b) * 0.14);
      const u = e.thread.material.uniforms;
      u.uOpacity!.value = e.opacity.x;
      u.uGrow!.value = e.grow.x;
      u.uRadius!.value = (lit ? 0.42 : 0.26) * Math.max(0.6, Math.min(p.scale.x, c.scale.x) + 0.25);
      (u.uColor!.value as Color).set(lit ? PALETTE.amber : PALETTE.silver);
      u.uPulse!.value = lit && idle ? 1 : 0;
      u.uTime!.value = idle ? t : 0;
      e.thread.syncSheath(lit ? 1 : 0.55);
    }

    // Camera: ease to the composed view unless the user is orbiting.
    if (this.easing && !this.userOrbit) {
      if (motion) {
        this.camTarget.step(this.camGoal.target, 2.6, dt, steps);
        this.camRadius.step(this.camGoal.radius, 2.6, dt, steps);
        this.camPolar.step(this.camGoal.polar, 2.6, dt, steps);
        this.camAzimuth.step(this.camGoal.azimuth, 2.6, dt, steps);
      } else {
        this.camTarget.snap(this.camGoal.target);
        this.camRadius.snap(this.camGoal.radius);
        this.camPolar.snap(this.camGoal.polar);
        this.camAzimuth.snap(this.camGoal.azimuth);
      }
      this.placeCamera();
      moving = Math.max(moving, this.camTarget.x.distanceTo(this.camGoal.target), Math.abs(this.camRadius.x - this.camGoal.radius) * 0.2);
    } else {
      this.controls.update();
    }

    // Moonlight and its shadow follow the focused island.
    const focus = this.selectedId ? this.islands.get(this.selectedId) : undefined;
    const fp = focus?.pos.x ?? new Vector3();
    this.moon.target.position.copy(fp);
    this.moon.position.copy(fp).add(new Vector3(-70, 120, 95));
    if (motion) this.moonDir.lerp(this.moonGoal, 1 - Math.exp(-span * 2.5)).normalize();
    else this.moonDir.copy(this.moonGoal);
    (this.sky.material.uniforms.uMoonDir!.value as Vector3).copy(this.moonDir);
    this.rim.position.copy(fp).addScaledVector(this.moonDir, 200);
    this.sky.material.uniforms.uTime!.value = idle ? t : 0;
    if (this.landing) {
      this.camera.updateMatrixWorld();
      landingChanged = this.landing.update(this.moonDir, this.sky.material.uniforms.uMoonSize!.value as number, this.moonGlow, idle) || landingChanged;
    }
    const batsChanged = this.ambience.update(idle ? t : 0, idle, this.camTarget.x, this.camera, this.moonDir, this.renderer.getPixelRatio(), this.landing?.bats);

    this.settled = moving < 0.05;
    if (idle || !this.settled || this.dirty || landingChanged || batsChanged) {
      this.drawBackdrop(this.camera);
      this.renders += 1;
      if (this.renders === 1) {
        this.renderer.domElement.style.opacity = "1";
        this.opts.landingEffects?.onReady?.();
      }
      this.dirty = false;
      if (this.landing) this.landing.placeEntry();
      else this.placeLabels();
    }
    this.cpuMs[(this.frames - 1) % this.cpuMs.length] = performance.now() - cpu0;
    if (this.londonFirstFrame !== null && this.londonFirstFrame < 0) this.londonFirstFrame = performance.now() + this.londonFirstFrame;
    this.checkQuality(now);
  };

  /**
   * Step down once if the device cannot keep up: measured over 2.5 s once the London model (if any) has loaded. Fewer
   * than 12 frames in that time, or a median frame over 40 ms (under 25 frames per second), means "low".
   */
  private checkQuality(now: number) {
    if (this.qualityChecked || this.quality === "low") return;
    if (this.londonState.state === "loading") {
      this.qualityWindow = null;
      return;
    }
    // Wait out the first frames: compiling shaders and uploading textures stall them on any device.
    if (!this.qualityWindow) {
      if (this.renders < 45) return;
      this.qualityWindow = { t0: now, f0: this.frames };
      return;
    }
    if (now - this.qualityWindow.t0 < 2500) return;
    this.qualityChecked = true;
    const n = Math.min(this.frames - this.qualityWindow.f0, this.frameMs.length);
    const recent: number[] = [];
    for (let i = 1; i <= n; i++) recent.push(this.frameMs[(this.frames - i + this.frameMs.length) % this.frameMs.length]!);
    recent.sort((a, b) => a - b);
    const median = recent[Math.floor(recent.length / 2)] ?? Infinity;
    if (n < 12 || median > 40) {
      this.quality = "low";
      this.renderer.shadowMap.enabled = false;
      for (const isl of this.islands.values()) {
        if (!isl.mist) continue;
        isl.mist.removeFromParent();
        isl.mist.geometry.dispose();
        (isl.mist.material as ShaderMaterial).dispose();
        isl.mist = null;
      }
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(this.width, this.height, false);
      this.ambience.setQuality("low");
      if (this.landing && this.ambience.batsObject) this.scene.add(this.ambience.batsObject);
      this.sky.material.uniforms.uOctaves!.value = 3;
      this.refreshVisuals();
      this.dirty = true;
      this.opts.onQuality?.("low", n < 12 ? `${n} frames in 2.5 s` : `median frame ${median.toFixed(0)} ms`);
    }
  }

  private placeLabels() {
    const v = new Vector3();
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const order = [...this.islands.values()].filter((i) => i.label).sort((a, b) => b.slot.emphasis - a.slot.emphasis);
    for (const isl of order) {
      const el = isl.label;
      if (!el) continue;
      const top = isl.visualKind?.startsWith("london") ? LONDON_SIZE.label : (isl.built?.top ?? 8) + 2.2;
      v.set(0, top * isl.scale.x, 0).add(isl.root.position);
      v.y += isl.bob.position.y;
      v.project(this.camera);
      const w0 = Math.min(240, el.offsetWidth || 160) / 2;
      const x = Math.min(this.width - w0 - 6, Math.max(w0 + 6, v.x * halfW + halfW));
      let y = -v.y * halfH + halfH;
      // The label box sits above its anchor: about 18 rem wide at most and 3 rem tall.
      const w = Math.min(240, el.offsetWidth || 160) / 2;
      const hgt = el.offsetHeight || 44;
      // A label that would cover a more important one moves up above it.
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((p) => x + w > p.l && x - w < p.r && y > p.t && y - hgt < p.b);
        if (!hit) break;
        y = hit.t - 4;
      }
      // A label that only grazes the bottom of the title moves down out of its way (a few pixels) instead of vanishing.
      const graze = this.blockers.find((b) => x + w > b.left && x - w < b.right && y - hgt < b.bottom && b.top < y - hgt && b.bottom - (y - hgt) <= 16);
      if (graze) {
        const ny = graze.bottom + hgt + 4;
        if (!placed.some((p) => x + w > p.l && x - w < p.r && ny > p.t && ny - hgt < p.b)) y = ny;
      }
      const clear = this.blockers.every((b) => x + w < b.left || x - w > b.right || y < b.top || y - hgt > b.bottom);
      const inside = v.z < 1 && x - w > 4 && x + w < this.width - 4 && y - hgt > 4 && y < this.height - 4 && clear;
      const o = inside && isl.slot.visible && !isl.removing ? Math.min(1, isl.fade.x) : 0;
      if (o > 0.25) placed.push({ l: x - w, r: x + w, t: y - hgt, b: y });
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      el.style.opacity = o.toFixed(3);
      const hidden = o < 0.25;
      if (el.dataset.hidden !== String(hidden)) {
        el.dataset.hidden = String(hidden);
        el.style.pointerEvents = hidden ? "none" : "";
      }
    }
  }

  // ---------- pointer ----------

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const proxies = [...this.islands.values()].filter((i) => i.slot.visible && !i.removing && i.fade.x > 0.5).map((i) => i.proxy);
    const hit = this.raycaster.intersectObjects(proxies, false)[0];
    return hit ? (hit.object.userData.id as string) : null;
  }

  private readonly onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const id = this.pick(e.clientX, e.clientY);
    if (id) this.opts.onSelect(id);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const now = performance.now();
    if (now - this.lastHover < 60) return;
    this.lastHover = now;
    this.setHover(this.pick(e.clientX, e.clientY));
  };

  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderer.domElement.style.cursor = id && id !== this.selectedId ? "pointer" : "";
    this.opts.onHover?.(id);
  }

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.opts.onContextLost?.();
  };
}

// ---------- helpers ----------

function sizeFrom(s: { readonly top: number; readonly bottom: number; readonly radius: number }) {
  return { ...s, center: (s.top + s.bottom) / 2, sphere: Math.max((s.top - s.bottom) / 2, s.radius) };
}

/** Forward, right and up of a camera at polar angle ph and azimuth th around its target (world up is +Y). */
function basis(ph: number, th: number): { f: Vector3; r: Vector3; u: Vector3 } {
  const f = new Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)).negate();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  return { f, r, u };
}

function isAncestor(root: Object3D, o: Object3D): boolean {
  for (let p: Object3D | null = o.parent; p; p = p.parent) if (p === root) return true;
  return false;
}

const londonCache = new Map<string, Promise<LondonTemplate>>();
/** One download and parse per page; a failure is not cached, so "Try again" really tries again. */
function cachedLondon(renderer: WebGLRenderer, url: string | undefined, onProgress: (p: { loaded: number; total: number }) => void): Promise<LondonTemplate> {
  const key = url ?? "default";
  let p = londonCache.get(key);
  if (!p) {
    p = loadLondon(renderer, { ...(url ? { url } : {}), onProgress });
    londonCache.set(key, p);
    p.catch(() => londonCache.delete(key));
  }
  return p;
}

function haloFor(a: LightAnchor): HaloSpec {
  const size = a.kind === "flood" ? 1.1 : a.kind === "candle" ? 0.45 : a.kind === "pumpkin" ? 0.8 : a.kind === "phone" ? 1.3 : 1.25;
  return { position: a.position.clone(), color: new Color(a.color).multiplyScalar(a.kind === "flood" ? 0.35 : 0.75), size };
}

/** Group light markers into at most k clusters (deterministic k-means, seeded by distance from the first marker). */
function clusters(anchors: readonly LightAnchor[], k: number): { center: Vector3; count: number; spread: number; direction: Vector3 | null }[] {
  if (!anchors.length) return [];
  const pts = anchors.map((a) => a.position);
  const centers: Vector3[] = [pts[0]!.clone()];
  while (centers.length < Math.min(k, pts.length)) {
    let best = pts[0]!;
    let bestD = -1;
    for (const p of pts) {
      const d = Math.min(...centers.map((c) => c.distanceToSquared(p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    centers.push(best.clone());
  }
  let assign: number[] = [];
  for (let it = 0; it < 8; it++) {
    assign = pts.map((p) => centers.reduce((bi, c, i) => (c.distanceToSquared(p) < centers[bi]!.distanceToSquared(p) ? i : bi), 0));
    centers.forEach((c, i) => {
      const mine = pts.filter((_, j) => assign[j] === i);
      if (mine.length) c.copy(mine.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / mine.length));
    });
  }
  return centers.map((center, i) => {
    const mine = anchors.filter((_, j) => assign[j] === i);
    const spread = Math.max(0, ...mine.map((a) => a.position.distanceTo(center)));
    const dirs = mine.map((a) => a.direction).filter((d): d is Vector3 => d !== null);
    const direction = dirs.length ? dirs.reduce((s, d) => s.add(d), new Vector3()).normalize() : null;
    return { center, count: mine.length, spread, direction };
  }).filter((c) => c.count > 0);
}
