import {
  AdditiveBlending, DirectionalLight, FogExp2, HemisphereLight, InstancedMesh, MathUtils, MeshBasicMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, PointLight, Scene, Vector3, type WebGLRenderer,
} from "three";
import { createSky, paintSky } from "../scene/atmosphere";
import { glowTexture } from "../scene/generic";
import type { Quality } from "../scene/AtlasScene";
import type { Bookshop } from "./bookshop";
import { BELL_PULL, buildCourtyard, WELL } from "./courtyard";
import { BellLightWave, CourtyardEffects } from "./effects";
import { HollowInteractions, type InteractionView, type Landmark } from "./interactions";
import { BOOKSHOP_DOOR, EYE_HEIGHT, HollowNavigation } from "./navigation";
import { rules, type Approach } from "./story/mara";
import type { StoryNode } from "./story/timeline";

const SEALS = { sell: "#edba83", keep: "#ba9fe2", share: "#93cecc" };

const WELL_LANDMARK: Landmark = {
  id: "well", x: WELL.x, z: WELL.z, range: 3.6, label: "Examine the well", owner: WELL, seconds: 4.8,
  story: "In the water, one road becomes three. The well remembers the choices the village left behind.",
};
const ENTER_SHOP = { id: "enter-shop", ...BOOKSHOP_DOOR, range: 1.48, label: "Enter Bookshop", seconds: 0, story: "" } satisfies Landmark;
const LANDMARKS = [
  ENTER_SHOP,
  WELL_LANDMARK,
  { id: "bell", x: BELL_PULL.x, z: BELL_PULL.z + 0.21, range: 3.25, label: "Ring the tower bell", seconds: 4.5,
    story: "The bell once marked the hour at which the village chose to stay. In the belfry, someone is still waiting." },
  { id: "bookshop", ...BOOKSHOP_DOOR, range: 3.25, label: "Listen at the bookshop", seconds: 0.7, once: true,
    story: "A violet light stirs between the shelves." },
] satisfies readonly Landmark[];

export type HollowArea = "courtyard" | "bookshop";
export type DoorwayEscape = "cancel-entry" | "wait" | null;
type Doorway = {
  to: HollowArea;
  phase: "loading" | "cover" | "reveal";
  elapsed: number;
  room?: Bookshop;
  atWell?: boolean;
};

export class HollowWorld {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(59, 1, 0.05, 200);
  private readonly sky = createSky();
  private readonly courtyard;
  private readonly courtyardNavigation;
  private readonly courtyardInteractions;
  private shop: Bookshop | null = null;
  private doorway: Doorway | null = null;
  private fade = 0;
  private readonly wave = new BellLightWave();
  private readonly effects;
  private readonly warmLamps: PointLight[] = [];
  private readonly poolMap = glowTexture(64, 0.79);
  private readonly poolGeometry = new PlaneGeometry(1, 1);
  private readonly poolMaterial = new MeshBasicMaterial({
    map: this.poolMap, color: "#d88c61", transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.43,
  });
  private readonly contactMaterial = new MeshBasicMaterial({
    map: this.poolMap, color: "#110f1e", transparent: true, depthWrite: false, opacity: 0.72,
  });
  private readonly magic = new PointLight("#c592ff", 0, 6.8, 2);
  private width = 0;
  private height = 0;
  private dirty = true;
  private nearWell = false;
  private renderedEvent: string | null = null;
  private awakened = false;
  private illumination = 0;
  private inscription: string | null = null;
  private sealColor = "#c58fea";
  private readonly windowIdle = this.magic.color.clone().set("#655b72");
  private readonly windowLit = this.magic.color.clone().set("#ffe1ff").multiplyScalar(2.1);

  constructor(private readonly quality: Quality, private readonly onInteraction: (view: InteractionView) => void,
    private readonly onArea: (area: HollowArea) => void, private readonly onFade: (opacity: number) => void,
    private readonly onDoorwayEscape: (action: DoorwayEscape) => void,
    private readonly onStoryLandmark: (id: "well" | "forking-mirror") => void) {
    const detail = quality === "high";
    this.courtyard = buildCourtyard(detail);
    this.courtyardNavigation = new HollowNavigation(this.courtyard.obstacles);
    this.courtyardInteractions = new HollowInteractions(LANDMARKS, this.courtyard.sightlines, onInteraction);
    this.effects = new CourtyardEffects(this.poolMap, detail, this.courtyard.bell, this.wave);
    this.wave.attach(this.courtyard.light);
    this.wave.attach(this.poolMaterial);
    this.scene.fog = new FogExp2("#514663", 0.027);
    paintSky(this.sky.material, {
      top: "#121226", mid: "#28223c", horizon: "#514968", below: "#3b344d", moon: "#f6e4ff",
      moonSize: 0.99938, stars: 1.35, haze: "#ad86b4", hazeAmount: 0.025,
      clouds: detail ? 0.76 : 0.69, cloudDark: "#24243f", cloudLit: "#695775", sea: 0, seaDark: "#282741", seaLit: "#514968",
    });
    this.sky.material.uniforms.uMoonDir!.value.set(0.087, 0.555, -1).normalize();
    this.sky.material.uniforms.uOctaves!.value = detail ? 3 : 2;
    this.sky.mesh.scale.setScalar(126);
    this.scene.add(this.sky.mesh, this.courtyard.group, this.effects.group);

    const hemi = new HemisphereLight("#b4bbff", "#6f5170", 2.05);
    const moon = new DirectionalLight("#c1c9ff", 2.85);
    moon.position.set(-8, 11, 9);
    this.scene.add(hemi, moon);

    const pools = new InstancedMesh(this.poolGeometry, this.poolMaterial, this.courtyard.lamps.length);
    const contactShadows = new InstancedMesh(this.poolGeometry, this.contactMaterial, this.courtyard.obstacles.length);
    contactShadows.renderOrder = 1;
    pools.renderOrder = 2;
    const pool = new Object3D();
    pool.rotation.x = -Math.PI / 2;
    this.courtyard.obstacles.forEach(({ x, z, w, d }, i) => {
      pool.position.set(x, 0.046, z);
      pool.scale.set(w * 2.4 + 1.3, d * 2.4 + 1.3, 1);
      pool.updateMatrix();
      contactShadows.setMatrixAt(i, pool.matrix);
    });
    pool.scale.setScalar(6.1);
    this.courtyard.lamps.forEach(([x, z], i) => {
      pool.position.set(x, 0.048, z);
      pool.updateMatrix();
      pools.setMatrixAt(i, pool.matrix);
    });
    this.scene.add(contactShadows, pools);
    if (detail) {
      for (const [x, z] of [this.courtyard.lamps[1], this.courtyard.lamps[2]]) {
        const lamp = new PointLight("#ffab60", 30, 10, 2);
        lamp.position.set(x, 2.95, z);
        this.warmLamps.push(lamp);
        this.scene.add(lamp);
      }
    }
    this.magic.position.set(BOOKSHOP_DOOR.x, 2, BOOKSHOP_DOOR.z + 0.67);
    this.courtyard.windows.color.copy(this.windowIdle);
    this.scene.add(this.magic);
  }

  move(forward: number, strafe: number, seconds: number) {
    if (this.doorway || (!forward && !strafe)) return;
    const { x, z } = this.navigation;
    this.navigation.walk(forward, strafe, seconds);
    if (x !== this.navigation.x || z !== this.navigation.z) {
      this.interactions.update(this.navigation);
      if (!this.shop) this.nearWell = this.interactions.available(this.navigation, WELL_LANDMARK);
      this.dirty = true;
    }
  }

  look(horizontal: number, vertical: number) {
    if (this.doorway) return;
    this.navigation.look(horizontal, vertical);
    this.interactions.update(this.navigation);
    this.dirty = true;
  }

  interact() {
    if (this.doorway) return false;
    const id = this.interactions.activate(this.navigation);
    if (!id) return false;
    if (id === ENTER_SHOP.id) {
      this.awakened = true;
      void this.enterBookshop();
    } else if (id === "leave-shop") this.leaveBookshop();
    else if (id === "bookshop") this.awakened = true;
    else if (id === "well" || id === "forking-mirror") this.onStoryLandmark(id);
    this.dirty = true;
    return true;
  }

  invalidate() {
    this.dirty = true;
  }

  setChapter({ choice, state }: StoryNode, approach: Approach | null) {
    const title = choice ? rules[choice].title : null;
    if (title === this.inscription) return;
    this.inscription = title;
    this.sealColor = approach ? SEALS[approach] : "#c58fea";
    this.shop?.inscribe(title, this.sealColor);
    if (this.shop && (this.shop.interactions.eventId === "keepers-desk" || this.shop.interactions.targetId === "keepers-desk")) {
      this.shop.interactions.clear();
      this.shop.interactions.update(this.shop.navigation);
    }
    const sold = state.shop === rules.sell.change.shop;
    this.courtyard.shutters.visible = sold;
    this.courtyard.sign.write(sold ? "Bookshop sold · Memory archive" : title ?? "The Whispering Bookshop");
    const site = state.location === rules.hall.change.location ? "hall" : state.location === rules.school.change.location ? "school" : null;
    this.courtyard.markLending(site, state.location + " · " + state.access);
    if (approach) this.awakened = true;
    this.windowLit.set(approach ? SEALS[approach] : "#ffe1ff").multiplyScalar(2.1);
    this.courtyard.windows.color.copy(this.windowIdle).lerp(this.windowLit, this.illumination);
    this.magic.color.set(approach ? SEALS[approach] : "#c592ff");
    this.dirty = true;
  }

  visitWell() {
    if (this.doorway) return;
    if (this.shop) {
      this.leaveBookshop(true);
    } else {
      this.placeAtWell();
    }
  }

  private placeAtWell() {
    this.courtyardNavigation.place({ x: WELL.x + 1.7, z: WELL.z + 2.7, yaw: 0.38, pitch: -0.08 });
    this.nearWell = true;
    this.courtyardInteractions.update(this.courtyardNavigation);
    this.dirty = true;
  }

  private get navigation() { return this.shop?.navigation ?? this.courtyardNavigation; }
  private get interactions() { return this.shop?.interactions ?? this.courtyardInteractions; }

  private async enterBookshop() {
    const doorway: Doorway = { to: "bookshop", phase: "loading", elapsed: 0 };
    this.doorway = doorway;
    this.onDoorwayEscape("cancel-entry");
    this.courtyardInteractions.clear();
    try {
      const { Bookshop } = await import("./bookshop");
      if (this.doorway !== doorway) return;
      doorway.room = new Bookshop(this.quality === "high", this.onInteraction);
      doorway.phase = "cover";
    } catch {
      if (this.doorway !== doorway) return;
      this.doorway = null;
      this.onDoorwayEscape(null);
      this.onInteraction({ prompt: ENTER_SHOP.label, story: "The door hasn’t opened. Try again." });
    }
  }

  /** Escape may close the bookshop while the walk-up door remains available to touch players. */
  leaveBookshop(atWell = false) {
    if (this.doorway) {
      if (!this.shop && this.doorway.to === "bookshop") {
        this.doorway.room?.dispose();
        this.doorway = null;
        this.onDoorwayEscape(null);
        this.setFade(0);
        this.courtyardInteractions.update(this.courtyardNavigation);
      }
      return true;
    }
    if (!this.shop) return false;
    this.shop.interactions.clear();
    this.doorway = { to: "courtyard", phase: "cover", elapsed: 0, atWell };
    this.onDoorwayEscape("wait");
    return true;
  }

  private setFade(opacity: number) {
    if (opacity === this.fade) return;
    this.fade = opacity;
    this.onFade(opacity);
  }

  private stepDoorway(step: number, reduced: boolean) {
    const door = this.doorway;
    if (!door || door.phase === "loading") return;
    door.elapsed += step;
    if (door.phase === "cover") {
      const t = reduced ? 1 : MathUtils.smoothstep(door.elapsed, 0, 0.28);
      if (!reduced) this.setFade(t);
      if (t < 1) return;
      if (door.to === "bookshop") {
        this.shop = door.room!;
        this.shop.inscribe(this.inscription, this.sealColor);
        door.room = undefined;
        this.onDoorwayEscape("wait");
      } else {
        this.shop?.dispose();
        this.shop = null;
        this.courtyardNavigation.place({ x: BOOKSHOP_DOOR.x, z: BOOKSHOP_DOOR.z + 1.02, yaw: Math.PI, pitch: 0.05 });
        this.nearWell = false;
        if (door.atWell) this.placeAtWell();
      }
      this.camera.far = this.shop ? 24 : 200;
      this.camera.updateProjectionMatrix();
      this.onArea(door.to);
      this.dirty = true;
      door.phase = "reveal";
      door.elapsed = 0;
    }
    const t = reduced ? 1 : MathUtils.smoothstep(door.elapsed, 0, 0.34);
    this.setFade(1 - t);
    if (t === 1) {
      this.doorway = null;
      this.onDoorwayEscape(null);
      this.interactions.update(this.navigation);
    }
  }

  private updateCourtyard(step: number, reducedMotion: boolean) {
    if (this.renderedEvent === this.interactions.eventId) this.interactions.advance(step, this.navigation);
    const event = this.interactions.eventId;
    const progress = this.interactions.progress;
    if (event === "bell" || this.renderedEvent === "bell") {
      this.effects.ring(event === "bell" ? progress : null, reducedMotion);
      for (const lamp of this.warmLamps) lamp.intensity = 30 + 32 * this.wave.strength(lamp.position.x, lamp.position.z);
      this.dirty = true;
    }
    if (event === "well" || this.renderedEvent === "well" || this.dirty) {
      this.effects.well(this.nearWell, event === "well" ? progress : null, reducedMotion, this.navigation.x, this.navigation.z);
      this.dirty = true;
    }
    this.renderedEvent = event;
    if (this.awakened && this.illumination < 1) {
      this.illumination = reducedMotion ? 1 : Math.min(1, this.illumination + Math.min(step, 0.05) * 1.9);
      const strength = MathUtils.smoothstep(this.illumination, 0, 1);
      this.courtyard.windows.color.copy(this.windowIdle).lerp(this.windowLit, strength);
      this.magic.intensity = strength * 23;
      this.dirty = true;
    }
  }

  draw(renderer: WebGLRenderer, viewport: HTMLElement, step: number, reducedMotion: boolean) {
    this.stepDoorway(step, reducedMotion);
    if (this.shop) {
      if (this.shop.update(step, reducedMotion)) this.dirty = true;
    } else this.updateCourtyard(step, reducedMotion);
    if (!this.dirty) return;
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      const touch = window.matchMedia("(pointer: coarse)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === "low" ? 1 : touch ? 1.5 : 1.75));
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.fov = MathUtils.lerp(77, 59, MathUtils.smoothstep(this.camera.aspect, 0.42, 1.28));
      this.camera.updateProjectionMatrix();
    }
    const { x, z, yaw, pitch } = this.navigation;
    this.camera.position.set(x, EYE_HEIGHT, z);
    this.camera.rotation.set(pitch, yaw, 0, "YXZ");
    if (!this.shop) this.sky.mesh.position.copy(this.camera.position);
    renderer.info.reset();
    renderer.clear();
    renderer.render(this.shop?.scene ?? this.scene, this.camera);
    this.dirty = false;
  }

  stats() {
    return {
      position: this.camera.position.toArray(),
      yaw: this.navigation.yaw,
      pitch: this.navigation.pitch,
      bookshopLight: this.illumination,
      target: this.interactions.targetId,
      event: this.interactions.eventId,
      progress: this.interactions.progress,
      area: this.shop ? "bookshop" : "courtyard",
      doorway: this.doorway?.phase ?? null,
      fade: this.fade,
      signs: { shop: this.courtyard.sign.text, lending: this.courtyard.lending.mesh.visible ? this.courtyard.lending.text : null },
      room: this.shop?.stats() ?? null,
      ...this.effects.stats(),
    };
  }

  dispose() {
    this.doorway?.room?.dispose();
    this.doorway = null;
    this.shop?.dispose();
    this.shop = null;
    this.effects.dispose();
    this.courtyard.dispose();
    this.sky.mesh.geometry.dispose();
    this.sky.material.dispose();
    this.poolGeometry.dispose();
    this.poolMaterial.dispose();
    this.contactMaterial.dispose();
    this.poolMap.dispose();
    this.scene.traverse((object) => { if (object instanceof InstancedMesh) object.dispose(); });
    this.scene.clear();
  }
}
