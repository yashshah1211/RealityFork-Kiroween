import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments,
  MathUtils, Mesh, MeshBasicMaterial, Points, PointsMaterial, Raycaster, SphereGeometry, Vector2, Vector3,
  type PerspectiveCamera, type Scene, type ShaderMaterial, type Texture, type Vector4,
} from "three";
import type { Ambience } from "./ambience";
import type { Foreground } from "./foreground";
import { Builder, type GenericIsland } from "./generic";
import { LandingPointer } from "./landingPointer";

export interface LandingIsland {
  readonly id: string;
  readonly root: Group;
  readonly bob: Group;
  readonly proxy: Mesh;
  readonly built: GenericIsland | null;
  readonly halos: Points | null;
}

const TAU = 2 * Math.PI;
const PORTAL = "@portal";
const PUMPKIN = "@pumpkin";
const MOON = "@moon";
const BAT = "@bat";
const GATHER = 0.76;
const ARRIVE = 1.94;
const OPEN = 2.62;
const CROSS = 3.42;
const CALM = 4.94;
const END = 5.8;
const TOUCH_ENTRY_SECONDS = 10;

export const HOLLOW_ISLAND = "city";
export const LANDING_SECRET_ACTIONS = [
  ["Island Awakening", "Awaken the city island"],
  ["Bat Whisperer", "Scatter the bats"],
  ["Pumpkin Trick", "Light the pumpkin"],
  ["Shy Ghost", "Invite the shy ghost"],
  ["Moon Magic", "Trace the moon"],
] as const;
export type LandingSecret = typeof LANDING_SECRET_ACTIONS[number][0];

function ease(value: number, target: number, damping: number) {
  const next = value + (target - value) * damping;
  return Math.abs(next - target) < 0.0005 ? target : next;
}

function pulse(age: number, duration: number) {
  return age >= 0 && age < duration ? Math.sin(Math.PI * (age / duration) ** 0.45) ** 1.4 : 0;
}

function dynamicGeometry(points: number) {
  return new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(points * 3), 3).setUsage(DynamicDrawUsage));
}

function setPoint(positions: BufferAttribute, i: number, point: Vector3) {
  positions.setXYZ(i, point.x, point.y, point.z);
}

/** A small, faceted spirit with a scalloped hem and a single mesh for its face. */
function makeGhost() {
  const geometry = new SphereGeometry(1, 12, 8);
  const p = geometry.getAttribute("position");
  const colors = new Float32Array(p.count * 3);
  const shade = new Color("#9180bc"), light = new Color("#e6dfff"), color = new Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const skirt = Math.max(0, -y);
    const hem = y < -0.93 ? 0 : 0.12 * Math.cos(4 * Math.atan2(z, x)) * skirt;
    p.setXYZ(i, x * 0.79 * (1 + skirt * 0.35), Math.max(-0.74, y) + hem, z * 0.67);
    color.copy(shade).lerp(light, 0.5 + 0.27 * (y - x)).toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const body = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  const face = new Builder();
  for (const [x, y, w, h, z] of [[-0.23, 0.32, 0.083, 0.12, 0.617], [0.23, 0.32, 0.083, 0.12, 0.617], [0, 0.08, 0.124, 0.065, 0.675]] as const) {
    const center = face.vert(x, y, z, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = TAU * i / 8, b = TAU * (i + 1) / 8;
      face.tri(center, face.vert(x + Math.cos(a) * w, y + Math.sin(a) * h, z, 0, 0), face.vert(x + Math.cos(b) * w, y + Math.sin(b) * h, z, 0, 0));
    }
  }
  const features = new Mesh(face.geometry(), new MeshBasicMaterial({ color: "#302344", transparent: true, depthWrite: false }));
  const group = new Group();
  group.add(body, features);
  group.visible = false;
  body.renderOrder = 4;
  features.renderOrder = 5;
  return { group, body, features };
}

/** Landing-only animation state. All effects work on the same meshes, cameras and passes as the backdrop. */
export class LandingHaunt {
  private readonly input = new LandingPointer(() => {
    this.touchEntryUntil = -Infinity;
    this.placeEntry();
  });
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly aim = new Vector2();
  private readonly projected = new Vector3();
  private readonly point = new Vector3();
  private readonly proxies: Mesh[] = [];
  private readonly hits: ReturnType<Raycaster["intersectObjects"]> = [];
  private readonly ghost = makeGhost();
  private readonly star = new LineSegments(dynamicGeometry(6), new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  private readonly constellation = new LineSegments(dynamicGeometry(8), new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  private readonly anchors = [new Vector3(), new Vector3(), new Vector3()] as const;
  private readonly jewels: Points<BufferGeometry, PointsMaterial>;
  private readonly energy: Points<BufferGeometry, PointsMaterial>;
  private readonly visits = new Set<string>();
  private readonly discoveries = new Set<LandingSecret>();
  private readonly islandPulses = new Map<string, number>();
  private readonly portalPosition = new Vector3();
  private readonly portalBase = new Color("#b9b3ff");
  private readonly portalGold = new Color("#ffd59b");
  /** Strength and time for the existing portal's shader. */
  private readonly door = { value: new Vector2() };
  private portal: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private portalIsland: string | null = null;
  private batHit = -1;
  private lastSample = -Infinity;
  private portalNear = 0;
  private windGoal = 0;
  private moonNear = false;
  private moonHover = 0;
  private portalHover = 0;
  private wind = 0;
  private ghostTime = -Infinity;
  private stillGhostUntil = -Infinity;
  private starTime = -Infinity;
  private constellationTime = -Infinity;
  private finalePlayed = false;
  private finale = false;
  private pumpkinTime = -Infinity;
  private portalTime = -Infinity;
  private pumpkinTaps = 0;
  private portalTaps = 0;
  private ghostLook = 0;
  private ghostLookGoal = 0;
  private constellationIds: string[] = [];
  private hover: string | null = null;
  private lastActivation: string | null = null;
  private steering = false;
  private damping = 1;
  private time = 0;
  private motion = true;
  private moonGlow = 1;
  private entry: { control: HTMLButtonElement; enter: () => void } | null = null;
  private entryPointing = false;
  private entryPreview = "";
  private touchEntryUntil = -Infinity;

  constructor(
    scene: Scene, glow: Texture, private readonly canvas: HTMLCanvasElement, private readonly camera: PerspectiveCamera,
    private readonly foreground: Foreground, private readonly ambience: Ambience, private readonly sky: ShaderMaterial,
    private readonly islands: ReadonlyMap<string, LandingIsland>,
    private readonly onDiscovery: (count: number) => void,
  ) {
    this.star.geometry.setAttribute("color", new BufferAttribute(new Float32Array([
      1, 0.84, 0.67, 0.75, 0.57, 1, 0.75, 0.57, 1, 0.26, 0.18, 0.44, 0.26, 0.18, 0.44, 0, 0, 0,
    ]), 3));
    const lineColors = new Float32Array(24);
    const violet = new Color("#c9b9ff"), amber = new Color("#f9c997");
    for (let i = 0; i < 8; i++) (i < 7 ? violet : amber).toArray(lineColors, 3 * i);
    this.constellation.geometry.setAttribute("color", new BufferAttribute(lineColors, 3));
    this.jewels = new Points(dynamicGeometry(3), new PointsMaterial({
      map: glow, color: "#e4d7ff", size: 8, sizeAttenuation: false, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.energy = new Points(dynamicGeometry(2), new PointsMaterial({
      map: glow, color: "#ffcea0", size: 23, sizeAttenuation: false, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    for (const effect of [this.star, this.constellation, this.jewels, this.energy]) {
      effect.visible = false;
      effect.frustumCulled = false;
      effect.renderOrder = 6;
    }
    scene.add(this.ghost.group, this.star, this.constellation, this.jewels, this.energy);
  }

  get bats() {
    return this.batState;
  }

  setEntry(control: HTMLButtonElement | null, enter?: () => void) {
    this.entry = control && enter ? { control, enter } : null;
    this.touchEntryUntil = -Infinity;
    this.placeEntry();
  }

  /** Keep the entry label on the actual city island, including when the question shifts the composition. */
  placeEntry() {
    const control = this.entry?.control;
    const city = this.islands.get(HOLLOW_ISLAND);
    if (!control?.parentElement || !city?.root.visible) return;
    const canvas = this.canvas.getBoundingClientRect();
    const band = control.parentElement.getBoundingClientRect();
    city.proxy.updateWorldMatrix(true, false);
    this.projected.setFromMatrixPosition(city.proxy.matrixWorld).project(this.camera);
    const x = canvas.left - band.left + (1 + this.projected.x) * canvas.width / 2;
    const y = canvas.top - band.top + (1 - this.projected.y) * canvas.height / 2;
    const bottom = this.point.set(0, -0.5, 0).applyMatrix4(city.proxy.matrixWorld).project(this.camera);
    control.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    control.style.setProperty("--hollow-plaque-offset", `${Math.max(18, (this.projected.y - bottom.y) * canvas.height / 2 + 6).toFixed(1)}px`);
    control.dataset.placed = "";
  }

  private readonly batState = { time: 0, damping: 1, motion: false, pointer: null as Vector2 | null };

  beginFrame(time: number, span: number, motion: boolean) {
    this.time = time;
    this.damping = motion ? 1 - Math.exp(-span * 9) : 1;
    if (motion !== this.motion) this.stillGhostUntil = -Infinity;
    this.motion = motion;
    if (!motion) {
      this.hover = null;
      this.steering = this.moonNear = false;
      this.portalNear = this.windGoal = this.ghostLookGoal = 0;
      this.ghostTime = this.starTime = this.constellationTime = this.pumpkinTime = this.portalTime = -Infinity;
      this.finale = false;
      this.islandPulses.clear();
      this.visits.clear();
      this.pumpkinTaps = this.portalTaps = 0;
    }
  }

  /** Move the scenery under the existing composition transform. */
  pose(island: LandingIsland, idle: boolean, phase: number, fade: number) {
    const bob = island.bob;
    const target = this.motion && island.id === this.hover;
    const activation = this.islandPulses.get(island.id);
    const age = this.time - (activation ?? -Infinity);
    const tap = pulse(age, 1.32);
    if (activation !== undefined && age >= 1.32) this.islandPulses.delete(island.id);
    const base = idle ? Math.sin(this.time * 0.55 + phase) * 0.45 : 0;
    const oldHeight = bob.position.y;
    const oldPitch = bob.rotation.x, oldRoll = bob.rotation.z;
    const lift = bob.userData.lift as number | undefined;
    bob.userData.lift = ease(lift ?? 0, target ? 0.9 : 0, this.damping);
    bob.position.y = base + (bob.userData.lift as number) + tap * 0.45;
    bob.rotation.x = ease(oldPitch, target ? -this.aim.y * 0.034 : 0, this.damping);
    bob.rotation.z = ease(oldRoll, target ? -this.aim.x * 0.033 : 0, this.damping);
    const flicker = idle ? 0.035 * Math.sin(this.time * 4.2 + phase) : 0;
    const entryLight = island.id === HOLLOW_ISLAND && this.entryPreview ? 0.28 : 0;
    const opacity = (0.8 + flicker + (bob.userData.lift as number) * 0.1 + tap * 0.19 + entryLight) * fade;
    const uniforms = (island.halos?.material as ShaderMaterial | undefined)?.uniforms;
    const glow = uniforms?.uOpacity;
    const awake = uniforms?.uAwake?.value as Vector4 | undefined;
    const focus = target ? this.aim.x * 0.72 : awake?.x ?? 0;
    const shimmer = (bob.userData.lift as number) * (0.88 + (idle ? 0.12 * Math.sin(this.time * 5.2 + phase) : 0));
    const sweep = tap > 0 ? -1.1 + 2.2 * (age / 1.32) : 0;
    const changed = (!!glow && glow.value !== opacity) || (!!awake && (awake.x !== focus || awake.y !== shimmer || awake.z !== sweep || awake.w !== tap));
    if (glow) glow.value = opacity;
    awake?.set(focus, shimmer, sweep, tap);
    return changed || oldHeight !== bob.position.y || oldPitch !== bob.rotation.x || oldRoll !== bob.rotation.z;
  }

  update(moonDir: Vector3, moonSize: number, moonGlow: number, idle: boolean): boolean {
    const t = this.time, dt = this.damping;
    this.findPortal();
    this.sample(moonDir, moonSize);
    const control = this.entry?.control;
    const preview = !control ? ""
      : control.matches(":focus-visible") ? "keyboard"
      : t < this.touchEntryUntil ? "touch"
      : this.entryPointing ? "pointer" : "";
    const entryChanged = preview !== this.entryPreview;
    this.entryPreview = preview;
    if (control && control.dataset.preview !== preview) control.dataset.preview = preview;
    this.batState.time = t;
    this.batState.damping = dt;
    this.batState.motion = this.motion;
    this.batState.pointer = this.steering ? this.ndc : null;

    this.portalHover = ease(this.portalHover, this.portalNear, dt);
    this.moonHover = ease(this.moonHover, this.moonNear ? 1 : 0, dt);
    this.wind = ease(this.wind, this.windGoal, dt);
    const age = t - this.constellationTime;
    const finaleAge = this.finale ? age : -Infinity;
    const doorway = MathUtils.smoothstep(finaleAge, OPEN - 0.14, OPEN + 0.46) * (1 - MathUtils.smoothstep(finaleAge, CALM - 0.30, END));
    const moonPulse = pulse(t - this.starTime, 1.3);
    const halo = moonGlow * (1 + 0.9 * this.moonHover + 0.36 * moonPulse);
    const portalPulse = pulse(t - this.portalTime, 1.35);
    const arch = Math.min(0.98, 0.42 + 0.12 * this.portalHover + 0.46 * portalPulse + 0.53 * doorway);
    const shimmer = doorway > 0 ? finaleAge - OPEN : 0;
    const changed = this.moonGlow !== halo || (!!this.portal && this.portal.material.opacity !== arch)
      || this.door.value.x !== doorway || this.door.value.y !== shimmer;
    this.moonGlow = halo;
    this.sky.uniforms.uMoonGlow!.value = halo;
    this.door.value.set(doorway, shimmer);
    if (this.portal) {
      this.portal.material.opacity = arch;
      this.portal.material.color.copy(this.portalBase).lerp(this.portalGold, doorway * 0.48);
    }
    const pumpkin = t - this.pumpkinTime;
    const expression = pumpkin < 0 || pumpkin >= 1.42 ? 0 : pumpkin < 0.31 ? 1 : pumpkin < 0.78 ? 2 : 3;
    const faceGlow = 1.6 + 2.3 * pulse(pumpkin, 1.6) - 1.15 * pulse(pumpkin, 0.3);
    const fore = this.foreground.updateLanding(t, idle, this.wind, faceGlow, expression, doorway);
    const crossing = finaleAge >= CROSS && finaleAge < CALM + 0.26;
    const ghostAge = this.motion ? t - this.ghostTime : t < this.stillGhostUntil ? 0.75 : -Infinity;
    const ghost = this.updateGhost(crossing ? finaleAge - CROSS : ghostAge, crossing, !this.motion);
    const star = this.updateStar(t - this.starTime, moonDir);
    const constellation = this.updateConstellation(age);
    if (this.finale && finaleAge >= END) this.finale = false;
    return fore || ghost || star || constellation || changed || entryChanged;
  }

  private findPortal() {
    // The existing archway has its own material and named mesh. Its other kit materials are shared.
    if (this.portal?.parent?.parent) return;
    for (const island of this.islands.values()) {
      const mesh = island.built?.group.getObjectByName("archway-glow") as typeof this.portal;
      if (!mesh) continue;
      mesh.geometry.computeBoundingSphere();
      mesh.material.onBeforeCompile = (shader) => {
        shader.uniforms.uDoor = this.door;
        shader.fragmentShader = `uniform vec2 uDoor;\n${shader.fragmentShader}`.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          #ifdef USE_MAP
          float fold = sin(vMapUv.y * 19.0 - uDoor.y * 5.8 + 1.7 * sin(vMapUv.x * 11.0 + uDoor.y * 2.2));
          float ribbon = pow(0.5 + 0.5 * fold, 3.0);
          diffuseColor.rgb *= 1.0 + uDoor.x * (0.34 + 0.76 * ribbon);
          diffuseColor.a *= 1.0 + uDoor.x * ribbon * 0.26;
          #endif`,
        );
      };
      mesh.material.needsUpdate = true;
      this.portal = mesh;
      this.portalIsland = island.id;
      return;
    }
    this.portal = this.portalIsland = null;
  }

  private sample(moonDir: Vector3, moonSize: number) {
    const { taps, hover } = this.input;
    if (!taps.length && hover && this.time - this.lastSample < 0.045) return;
    this.lastSample = this.time;
    this.hover = null;
    this.entryPointing = false;
    this.steering = this.moonNear = false;
    this.portalNear = this.windGoal = this.ghostLookGoal = 0;
    if (!taps.length && !hover) return;
    const rect = this.canvas.getBoundingClientRect();
    for (const tap of taps) {
      if (!this.setNdc(tap, rect)) continue;
      const hit = this.pick(moonDir, moonSize, rect, false);
      if (this.motion) this.activate(hit);
      if (hit !== HOLLOW_ISLAND || !this.entry) this.touchEntryUntil = -Infinity;
      else if (tap.pointerType === "touch" && this.time >= this.touchEntryUntil) this.touchEntryUntil = this.time + TOUCH_ENTRY_SECONDS;
      else {
        this.touchEntryUntil = -Infinity;
        this.entry.enter();
        break;
      }
    }
    taps.length = 0;
    if (hover && this.setNdc(hover, rect)) {
      if (this.motion && this.ghost.group.visible && this.distance(this.ghost.group.position, this.camera, rect) < 58) {
        this.ghostLookGoal = MathUtils.clamp((this.ndc.x - this.projected.x) * rect.width / 80, -1, 1);
      }
      const hit = this.pick(moonDir, moonSize, rect, this.motion);
      this.entryPointing = hit === HOLLOW_ISLAND;
      if (this.motion) {
        this.hover = hit === PORTAL ? this.portalIsland : hit;
        this.steering = true;
      }
    }
  }

  private setNdc(p: { x: number; y: number }, rect: DOMRect) {
    this.ndc.set(2 * (p.x - rect.left) / rect.width - 1, 1 - 2 * (p.y - rect.top) / rect.height);
    return Math.abs(this.ndc.x) <= 1 && Math.abs(this.ndc.y) <= 1;
  }

  private distance(point: Vector3, camera: PerspectiveCamera, rect: DOMRect) {
    this.projected.copy(point).project(camera);
    if (Math.abs(this.projected.z) > 1) return Infinity;
    return 0.5 * Math.hypot((this.ndc.x - this.projected.x) * rect.width, (this.ndc.y - this.projected.y) * rect.height);
  }

  private pick(moonDir: Vector3, moonSize: number, rect: DOMRect, hover: boolean): string | null {
    const fg = this.foreground;
    if (fg.pumpkin) {
      const pumpkin = this.distance(fg.pumpkin.position, fg.camera, rect);
      const candle = this.distance(fg.candlesAt, fg.camera, rect);
      if (hover && candle < 60) this.windGoal = Math.sign(this.projected.x - this.ndc.x) * (1 - candle / 60);
      if (pumpkin <= Math.max(19, rect.height * 0.027)) return PUMPKIN;
    }
    const camera = this.camera;
    const bats = this.ambience.batsObject?.geometry.getAttribute("position");
    let batDistance = Infinity;
    this.batHit = -1;
    if (bats) for (let i = 0; i < bats.count; i++) {
      this.point.set(bats.getX(i), bats.getY(i), bats.getZ(i));
      const distance = this.distance(this.point, camera, rect);
      if (distance < batDistance) {
        batDistance = distance;
        this.batHit = i;
      }
    }
    this.point.copy(camera.position).addScaledVector(moonDir, 900);
    const moonDistance = this.distance(this.point, camera, rect);
    const moonRadius = (rect.height / 2) * Math.tan(Math.acos(moonSize)) / Math.tan(camera.fov * Math.PI / 360);
    if (hover) this.moonNear = moonDistance < moonRadius + 9;
    if (batDistance < 14) return BAT;
    if (moonDistance < Math.max(18, moonRadius + 4)) return MOON;

    let portalDistance = Infinity;
    if (this.portal) {
      this.readPortalPosition();
      portalDistance = this.distance(this.portalPosition, camera, rect);
      if (hover) this.portalNear = Math.max(0, 1 - portalDistance / 52);
    }
    this.ray.setFromCamera(this.ndc, camera);
    this.proxies.length = this.hits.length = 0;
    for (const island of this.islands.values()) {
      if (!island.root.visible) continue;
      island.proxy.updateWorldMatrix(true, false);
      this.proxies.push(island.proxy);
    }
    const picked = this.ray.intersectObjects(this.proxies, false, this.hits)[0]?.object;
    const id = picked?.userData.id as string | undefined;
    const portalHit = portalDistance < 22 && this.portalIsland && (!id || id === this.portalIsland);
    if (hover && (picked || portalHit)) {
      const height = rect.height / 2;
      if (picked) this.point.setFromMatrixPosition(picked.matrixWorld);
      else this.point.copy(this.portalPosition);
      this.point.project(camera);
      this.aim.set(
        Math.max(-1, Math.min(1, (this.ndc.x - this.point.x) * rect.width / 120)),
        Math.max(-1, Math.min(1, (this.ndc.y - this.point.y) * height / 62)),
      );
    }
    if (portalHit) return PORTAL;
    return id ?? null;
  }

  activateSecret(secret: LandingSecret) {
    switch (secret) {
      case "Island Awakening": this.activate(HOLLOW_ISLAND); break;
      case "Bat Whisperer": this.activate(BAT, 0); break;
      case "Pumpkin Trick": this.activate(PUMPKIN); break;
      case "Shy Ghost": this.summonGhost(); break;
      case "Moon Magic": this.activate(MOON); break;
    }
  }

  private summonGhost() {
    if (this.motion) {
      if (this.time - this.ghostTime > 2.5) this.ghostTime = this.time;
    } else {
      this.stillGhostUntil = this.time + 2.45;
    }
  }

  private activate(hit: string | null, bat = this.batHit) {
    if (!hit) return;
    const t = this.time;
    this.lastActivation = hit;
    if (hit === BAT) {
      this.ambience.scatterBats(t, bat);
      this.discover("Bat Whisperer");
      return;
    }
    if (hit === MOON) {
      this.starTime = t;
      this.discover("Moon Magic");
      return;
    }
    if (hit === PUMPKIN) {
      this.pumpkinTime = t;
      this.discover("Pumpkin Trick");
      if (++this.pumpkinTaps % 3 === 0 && this.motion) this.summonGhost();
      return;
    }
    if (hit === PORTAL) {
      this.portalTime = t;
      if (++this.portalTaps % 2 === 0) this.summonGhost();
      hit = this.portalIsland!;
    }
    this.islandPulses.set(hit, t);
    this.discover("Island Awakening");
    if (t - this.constellationTime < (this.finale ? END : 3.6)) return;
    for (const id of this.visits) if (!this.islands.get(id)?.root.visible) this.visits.delete(id);
    this.visits.add(hit);
    if (this.visits.size === 3) {
      this.constellationIds = [...this.visits];
      this.visits.clear();
      this.constellationTime = t;
      this.finale = !this.finalePlayed;
      this.finalePlayed = true;
    }
  }

  private discover(secret: LandingSecret) {
    if (this.discoveries.has(secret)) return;
    this.discoveries.add(secret);
    this.onDiscovery(this.discoveries.size);
  }

  private readPortalPosition() {
    const portal = this.portal!;
    this.portalPosition.copy(portal.geometry.boundingSphere!.center);
    portal.localToWorld(this.portalPosition);
  }

  private updateGhost(age: number, crossing: boolean, still: boolean) {
    const { group, body, features } = this.ghost;
    const was = group.visible;
    const duration = crossing ? CALM + 0.26 - CROSS : 2.45;
    group.visible = !!this.portal && age >= 0 && age < duration;
    this.ghostLook = ease(this.ghostLook, this.ghostLookGoal, this.damping);
    if (!group.visible) return was;
    const emerge = MathUtils.smoothstep(age, 0, crossing ? 0.54 : 0.75);
    const retreat = MathUtils.smoothstep(age, duration - 0.83, duration);
    const peek = emerge * (1 - retreat);
    if (peek > 0.15) this.discover("Shy Ghost");
    const portal = this.portal!;
    const drift = MathUtils.smoothstep(age, 0, duration);
    const x = crossing ? -0.36 + 5.35 * drift : 0.54 + 3.4 * peek;
    const y = crossing ? -1.54 + 2.9 * emerge - 0.9 * retreat : -2.18 + 3.3 * peek;
    const lean = this.ghostLook * peek;
    group.position.copy(portal.geometry.boundingSphere!.center).add(this.point.set(x + 0.33 * lean, y + 0.1 * Math.sin(age * 8), crossing ? -0.86 + 2.2 * drift : -0.64 + 0.35 * peek));
    portal.localToWorld(group.position);
    group.quaternion.copy(this.camera.quaternion);
    group.rotateZ(-0.13 * peek - 0.21 * lean);
    group.scale.setScalar(crossing ? 1.33 : 1.18);
    body.material.opacity = 0.85 * peek;
    features.material.opacity = 0.96 * peek;
    return !still || !was;
  }

  private updateStar(age: number, moonDir: Vector3) {
    const was = this.star.visible;
    this.star.visible = age >= 0 && age < 1.06;
    if (!this.star.visible) return was;
    const sweep = age / 1.06;
    const left = moonDir.x > 0 ? 1 : -1;
    const positions = this.star.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < 6; i++) {
      const tail = Math.floor((i + 1) / 2) * Math.min(1, sweep * 9);
      // Build the streak in the camera plane at the moon's depth.
      this.point.set(left * (20 - sweep * 164 + tail * 10), 48 - sweep * 52 + tail * 3.4, 0).applyQuaternion(this.camera.quaternion);
      this.point.addScaledVector(moonDir, 870).add(this.camera.position);
      positions.setXYZ(i, this.point.x, this.point.y, this.point.z);
    }
    positions.needsUpdate = true;
    this.star.material.opacity = 0.9 * pulse(age, 1.06);
    return true;
  }

  private updateConstellation(age: number) {
    const was = this.constellation.visible || this.energy.visible;
    const active = age >= 0 && age < (this.finale ? 4.28 : 3.6) && this.constellationIds.every((id) => this.islands.get(id)?.root.visible);
    this.constellation.visible = this.jewels.visible = active;
    this.energy.visible = false;
    if (!active) return was;
    const nodes = this.jewels.geometry.getAttribute("position") as BufferAttribute;
    const lines = this.constellation.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < 3; i++) {
      const island = this.islands.get(this.constellationIds[i]!)!;
      const anchor = this.anchors[i]!;
      island.bob.localToWorld(anchor.set(0, (island.built?.top ?? 8) + 2.8, 0));
      setPoint(nodes, i, anchor);
    }
    for (let i = 0; i < 3; i++) {
      setPoint(lines, i * 2, this.anchors[i]!);
      setPoint(lines, i * 2 + 1, this.anchors[(i + 1) % 3]!);
    }
    nodes.needsUpdate = true;
    lines.needsUpdate = true;
    const glow = this.finale
      ? MathUtils.smoothstep(age, 0, GATHER) * (1 - MathUtils.smoothstep(age, OPEN, 4.28))
      : pulse(age, 3.6);
    this.constellation.material.opacity = glow * 0.61;
    this.jewels.material.opacity = glow * 0.90;
    this.constellation.geometry.setDrawRange(0, 6);
    if (this.finale && this.portal && age >= GATHER) {
      this.readPortalPosition();
      let junction = this.portalIsland ? this.constellationIds.indexOf(this.portalIsland) : -1;
      if (junction < 0) {
        junction = 0;
        for (let i = 1; i < 3; i++) {
          if (this.anchors[i]!.distanceToSquared(this.portalPosition) < this.anchors[junction]!.distanceToSquared(this.portalPosition)) junction = i;
        }
      }
      const hub = this.anchors[junction]!;
      if (age >= ARRIVE - 0.19) {
        setPoint(lines, 6, hub);
        setPoint(lines, 7, this.portalPosition);
        this.constellation.geometry.setDrawRange(0, 8);
      }
      this.sendEnergy(age, junction, hub);
    }
    return true;
  }

  private sendEnergy(age: number, junction: number, hub: Vector3) {
    if (age >= OPEN + 0.24) return;
    const positions = this.energy.geometry.getAttribute("position") as BufferAttribute;
    if (age < ARRIVE) {
      let index = 0;
      for (let i = 0; i < 3; i++) {
        if (i === junction) continue;
        const progress = MathUtils.smoothstep(age, GATHER + 0.13 * index, ARRIVE);
        setPoint(positions, index++, this.point.lerpVectors(this.anchors[i]!, hub, progress));
      }
      this.energy.geometry.setDrawRange(0, 2);
    } else {
      const progress = MathUtils.smoothstep(age, ARRIVE, OPEN);
      setPoint(positions, 0, this.point.lerpVectors(hub, this.portalPosition, progress));
      this.energy.geometry.setDrawRange(0, 1);
    }
    positions.needsUpdate = true;
    this.energy.visible = true;
    this.energy.material.opacity = 0.96 * MathUtils.smoothstep(age, GATHER, GATHER + 0.22) * (1 - MathUtils.smoothstep(age, OPEN, OPEN + 0.24));
  }

  private finaleStage() {
    if (!this.finale) return null;
    const age = this.time - this.constellationTime;
    if (age < GATHER) return "constellation";
    if (age < OPEN) return "energy";
    if (age < CROSS) return "doorway";
    if (age < CALM) return "crossing";
    return "calm";
  }

  /** Read-only diagnostics on the existing atlasDebug flag. Coordinates are canvas fractions. */
  stats(moonDir: Vector3) {
    const project = (p: Vector3, camera = this.camera) => {
      this.projected.copy(p).project(camera);
      return [(1 + this.projected.x) / 2, (1 - this.projected.y) / 2];
    };
    if (this.portal) this.readPortalPosition();
    const bats = this.ambience.batsObject?.geometry.getAttribute("position");
    return {
      hover: this.hover, lastActivation: this.lastActivation, motion: this.motion, moonGlow: this.moonGlow,
      portalGlow: this.portal?.material.opacity, pumpkinGlow: this.foreground.pumpkin?.face.emissiveIntensity, wind: this.wind,
      pumpkinExpression: this.foreground.pumpkin?.expression, ghostLean: this.ghostLook,
      discoveries: [...this.discoveries], finalePlayed: this.finalePlayed, finaleStage: this.finaleStage(), energy: this.energy.visible,
      doorway: this.door.value.x,
      ghost: this.ghost.group.visible, star: this.star.visible, constellation: this.constellation.visible,
      points: {
        moon: project(this.point.copy(this.camera.position).addScaledVector(moonDir, 900)),
        portal: this.portal ? project(this.portalPosition) : null,
        ghost: this.ghost.group.visible ? project(this.ghost.group.position) : null,
        pumpkin: this.foreground.pumpkin ? project(this.foreground.pumpkin.position, this.foreground.camera) : null,
        candles: this.foreground.pumpkin ? project(this.foreground.candlesAt, this.foreground.camera) : null,
        bats: bats ? Array.from({ length: bats.count }, (_, i) => project(this.point.set(bats.getX(i), bats.getY(i), bats.getZ(i)))) : [],
      },
      islands: Array.from(this.islands.values()).filter((island) => island.root.visible).map(({ id, proxy, bob, halos }) => {
        proxy.updateWorldMatrix(true, false);
        const uniforms = (halos?.material as ShaderMaterial | undefined)?.uniforms;
        const awake = uniforms?.uAwake?.value as Vector4 | undefined;
        return { id, point: project(this.point.setFromMatrixPosition(proxy.matrixWorld)), lift: (bob.userData.lift ?? 0) as number, tilt: [bob.rotation.x, bob.rotation.z], shimmer: awake?.y ?? 0, sweep: awake?.w ?? 0, glow: (uniforms?.uOpacity?.value as number | undefined) ?? 0 };
      }),
    };
  }

  clearPointer() {
    this.input.clear();
  }

  dispose() {
    this.input.dispose();
    this.star.geometry.dispose();
    this.constellation.geometry.dispose();
    this.jewels.geometry.dispose();
    this.energy.geometry.dispose();
    this.ghost.body.geometry.dispose();
    this.ghost.features.geometry.dispose();
    for (const mesh of [this.star, this.constellation, this.jewels, this.energy, this.ghost.body, this.ghost.features]) mesh.material.dispose();
    for (const effect of [this.star, this.constellation, this.jewels, this.energy, this.ghost.group]) effect.removeFromParent();
  }
}
