import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, DoubleSide, DynamicDrawUsage,
  Group, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, Object3D, Path, Points, PointsMaterial,
  Shape, ShapeGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Texture,
} from "three";
import { rng } from "../scene/generic";
import { BELL, WELL } from "./courtyard";

const WATER_Y = 1.071;
const smooth = (value: number, start: number, end: number) => MathUtils.smoothstep(value, start, end);

/** The existing emissive glass and ground pools pick up the same moving front. */
export class BellLightWave {
  private readonly pulse = new Vector3(0, 0, 1);

  attach(material: MeshBasicMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uHollowBell = { value: this.pulse };
      shader.vertexShader = `varying vec2 vHollowGround;\n${shader.vertexShader}`.replace("#include <project_vertex>", `
        #include <project_vertex>
        vec4 hollowPosition = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          hollowPosition = instanceMatrix * hollowPosition;
        #endif
        vHollowGround = (modelMatrix * hollowPosition).xz;
      `);
      shader.fragmentShader = `uniform vec3 uHollowBell; varying vec2 vHollowGround;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `
        #include <color_fragment>
        float hollowDistance = length(vHollowGround - vec2(${BELL.x}, ${BELL.z}));
        float hollowWave = 1. - smoothstep(0., uHollowBell.z, abs(hollowDistance - uHollowBell.x));
        diffuseColor.rgb *= 1. + vec3(1.2, .6, .25) * hollowWave * uHollowBell.y;
      `);
    };
  }

  update(progress: number | null, reduced: boolean) {
    if (progress === null) this.pulse.set(0, 0, 1);
    else if (reduced) this.pulse.set(16, 0.72, 19);
    else this.pulse.set(4 + 31 * progress, 1.62 * (1 - smooth(progress, 0.7, 1)), 4.6);
  }

  strength(x: number, z: number) {
    return this.pulse.y * (1 - smooth(Math.abs(Math.hypot(x - BELL.x, z - BELL.z) - this.pulse.x), 0, this.pulse.z));
  }

  get radius() { return this.pulse.x; }
}

function visionTexture() {
  const bitmap = document.createElement("canvas");
  bitmap.width = bitmap.height = 256;
  const g = bitmap.getContext("2d")!;
  g.translate(128, 128);
  const halo = g.createRadialGradient(0, 0, 18, 0, 0, 125);
  halo.addColorStop(0, "#8153abd0");
  halo.addColorStop(0.68, "#36204fdd");
  halo.addColorStop(1, "#2a194000");
  g.fillStyle = halo;
  g.fillRect(-128, -128, 256, 256);
  g.strokeStyle = "#cba3ff";
  g.lineWidth = 1.6;
  for (const r of [80, 91]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    g.save();
    g.rotate(i * Math.PI / 6);
    g.translate(0, -99);
    g.beginPath();
    g.moveTo(-4, 0);
    g.lineTo(0, -5);
    g.lineTo(4, 0);
    g.lineTo(0, 5);
    g.closePath();
    g.stroke();
    g.restore();
  }
  g.lineCap = "round";
  for (const [end, rise, ink] of [[-52, -19, "#d6adff"], [0, -52, "#fff0cb"], [52, -19, "#f5c6e4"]] as const) {
    g.strokeStyle = ink;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(0, 56);
    g.bezierCurveTo(0, 8, end, 11, end, rise);
    g.stroke();
    g.beginPath();
    g.arc(end, rise - 7, 6, 0, Math.PI * 2);
    g.stroke();
  }
  const texture = new CanvasTexture(bitmap);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function ghostGeometry() {
  const cloak = new Shape();
  cloak.moveTo(-0.38, -0.48);
  cloak.quadraticCurveTo(-0.29, -0.05, -0.25, 0.30);
  cloak.quadraticCurveTo(-0.18, 0.59, 0.03, 0.56);
  cloak.quadraticCurveTo(0.28, 0.55, 0.29, 0.22);
  cloak.quadraticCurveTo(0.33, -0.12, 0.41, -0.47);
  cloak.lineTo(0.23, -0.39);
  cloak.lineTo(0.04, -0.53);
  cloak.lineTo(-0.12, -0.43);
  cloak.closePath();
  for (const x of [-0.078, 0.105]) {
    const eye = new Path();
    eye.absellipse(x, 0.23, 0.032, 0.043, 0, Math.PI * 2, true, 0);
    cloak.holes.push(eye);
  }
  return new ShapeGeometry(cloak, 6);
}

function batGeometry() {
  const bat = new Shape();
  bat.moveTo(-0.5, 0.19);
  bat.lineTo(-0.27, 0.14);
  bat.lineTo(-0.10, -0.015);
  bat.lineTo(-0.065, 0.10);
  bat.lineTo(0, 0.052);
  bat.lineTo(0.065, 0.10);
  bat.lineTo(0.10, -0.015);
  bat.lineTo(0.27, 0.14);
  bat.lineTo(0.5, 0.19);
  bat.quadraticCurveTo(0.34, -0.055, 0.23, -0.07);
  bat.quadraticCurveTo(0.11, -0.045, 0, -0.16);
  bat.quadraticCurveTo(-0.11, -0.045, -0.23, -0.07);
  bat.quadraticCurveTo(-0.34, -0.055, -0.5, 0.19);
  return new ShapeGeometry(bat, 5);
}

export class CourtyardEffects {
  readonly group = new Group();
  private readonly water = new Mesh(new CircleGeometry(0.87, 16), new MeshBasicMaterial({
    color: "#ba82ff", transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending,
  }));
  private readonly vision = new Sprite(new SpriteMaterial({ map: visionTexture(), transparent: true, depthWrite: false }));
  private readonly ghost = new Mesh(ghostGeometry(), new MeshBasicMaterial({
    color: "#d5c9ff", side: DoubleSide, transparent: true, depthWrite: false,
  }));
  private readonly bats;
  private readonly batPose = new Object3D();
  private readonly particles;
  private readonly positions: BufferAttribute;
  private readonly motes: readonly { angle: number; radius: number; delay: number; speed: number }[];

  constructor(soft: Texture, detail: boolean, private readonly bell: Mesh, private readonly wave: BellLightWave) {
    this.water.position.set(WELL.x, WATER_Y, WELL.z);
    this.water.rotation.x = -Math.PI / 2;
    // Three's default sprite quad is global. Give this visit ownership of the uploaded buffer.
    this.vision.geometry = this.vision.geometry.clone();
    this.vision.position.set(WELL.x, 2.08, WELL.z);
    this.water.material.map = soft;
    this.ghost.position.set(BELL.x + 0.31, 8.63, BELL.z + 1.88);
    this.bats = new InstancedMesh(batGeometry(), new MeshBasicMaterial({ color: "#2c2036", side: DoubleSide }), detail ? 6 : 4);
    this.bats.frustumCulled = false;

    const random = rng(0x71dd);
    const count = detail ? 28 : 16;
    this.motes = Array.from({ length: count }, () => ({
      angle: random() * Math.PI * 2, radius: 0.14 + random() * 0.7, delay: random() * 0.45, speed: 0.72 + random() * 0.56,
    }));
    this.positions = new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry().setAttribute("position", this.positions);
    this.particles = new Points(geometry, new PointsMaterial({
      map: soft, color: "#edb7ff", size: 0.13, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.particles.frustumCulled = false;
    for (const object of [this.water, this.vision, this.ghost, this.bats, this.particles]) object.visible = false;
    this.group.add(this.water, this.vision, this.ghost, this.bats, this.particles);
  }

  well(nearing: boolean, progress: number | null, reduced: boolean, eyeX: number, eyeZ: number) {
    const rise = progress === null ? 0 : reduced ? 0.85 : smooth(progress, 0, 0.2) * (1 - smooth(progress, 0.74, 1));
    const reveal = progress === null ? 0 : reduced ? 1 : smooth(progress, 0.13, 0.38) * (1 - smooth(progress, 0.70, 0.98));
    this.water.material.opacity = Math.max(nearing ? 0.32 : 0, rise * 0.82);
    this.water.visible = this.water.material.opacity > 0;
    this.vision.visible = reveal > 0.015;
    this.vision.material.opacity = reveal;
    if (this.vision.visible) {
      const dx = eyeX - WELL.x, dz = eyeZ - WELL.z;
      // Float the vision in front of the crossbeam so the branching paths read from either side.
      const face = 0.64 / Math.max(0.64, Math.hypot(dx, dz));
      this.vision.scale.setScalar(reduced ? 1.66 : 1.03 + reveal * 0.68);
      this.vision.position.set(WELL.x + face * dx, reduced ? 2.15 : 1.85 + reveal * 0.44, WELL.z + face * dz);
    }
    this.particles.visible = progress !== null && !reduced && rise > 0.015;
    if (!this.particles.visible || progress === null) return;
    this.particles.material.opacity = rise;
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i]!;
      const height = (progress * 2.7 * mote.speed + mote.delay) % 1;
      const angle = mote.angle + height * 1.58;
      this.positions.setXYZ(i, WELL.x + Math.cos(angle) * mote.radius * (1 + height * 0.4),
        WATER_Y + height * 1.63, WELL.z + Math.sin(angle) * mote.radius * (1 + height * 0.4));
    }
    this.positions.needsUpdate = true;
  }

  ring(progress: number | null, reduced: boolean) {
    this.wave.update(progress, reduced);
    this.bell.rotation.z = progress === null || reduced ? 0 : Math.sin(progress * 32) * (1 - progress) ** 1.6 * 0.57;
    const apparition = progress === null ? 0 : reduced ? 0.66 : smooth(progress, 0.16, 0.32) * (1 - smooth(progress, 0.55, 0.74));
    this.ghost.visible = apparition > 0.02;
    this.ghost.material.opacity = apparition * 0.65;
    this.bats.visible = progress !== null && !reduced && progress >= 0.11 && progress < 0.87;
    if (!this.bats.visible || progress === null) return;
    const travel = (progress - 0.11) / 0.76;
    for (let i = 0; i < this.bats.count; i++) {
      const direction = i % 2 ? -1 : 1;
      const spread = 0.62 + i * 0.16;
      const pose = this.batPose;
      pose.position.set(BELL.x + direction * (0.5 + travel * (5.8 + i * 0.58)),
        8.5 + i * 0.44 + Math.sin(travel * Math.PI * 0.82) * (1.5 + i * 0.27), BELL.z + 2 + travel * (3 + spread));
      const scale = spread * (1 - smooth(travel, 0.76, 1));
      pose.scale.set(scale, scale * (0.55 + 0.42 * Math.cos(progress * 83 + i)), 1);
      pose.rotation.z = direction * (0.16 + Math.sin(travel * 7 + i) * 0.16);
      pose.updateMatrix();
      this.bats.setMatrixAt(i, pose.matrix);
    }
    this.bats.instanceMatrix.needsUpdate = true;
  }

  stats() {
    return {
      wellGlow: this.water.material.opacity, vision: this.vision.visible, motes: this.particles.visible ? this.motes.length : 0,
      bellAngle: this.bell.rotation.z, bats: this.bats.visible ? this.bats.count : 0, ghost: this.ghost.visible,
      waveRadius: this.wave.radius,
    };
  }

  dispose() {
    this.bats.dispose();
    this.vision.geometry.dispose();
    this.vision.material.map?.dispose();
    this.vision.material.dispose();
    for (const object of [this.water, this.ghost, this.bats, this.particles]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.group.clear();
  }
}
