export interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

export const COURTYARD: Footprint = { x: 0, z: 0.5, w: 24, d: 23 };
export const BOOKSHOP: Footprint = { x: -1.7, z: -9.35, w: 6.4, d: 4.6 };
export const BOOKSHOP_DOOR = { x: BOOKSHOP.x, z: BOOKSHOP.z + BOOKSHOP.d / 2 };
export const ARRIVAL = { x: 1.1, z: 9.5, yaw: 0.18, pitch: 0.105 };
export type HollowPose = typeof ARRIVAL;
export const EYE_HEIGHT = 1.68;
const RADIUS = 0.32;
const SPEED = 3.4;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class HollowNavigation {
  x: number;
  z: number;
  yaw: number;
  pitch: number;

  constructor(private readonly obstacles: readonly Footprint[], private readonly bounds = COURTYARD, pose = ARRIVAL) {
    this.x = pose.x;
    this.z = pose.z;
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
  }

  place(pose: HollowPose) {
    this.x = pose.x;
    this.z = pose.z;
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
  }

  look(horizontal: number, vertical: number) {
    const turn = 2 * Math.PI;
    this.yaw = ((this.yaw + horizontal) % turn + turn) % turn;
    this.pitch = clamp(this.pitch + vertical, -0.95, 1.18);
  }

  walk(forward: number, strafe: number, seconds: number) {
    const length = Math.hypot(forward, strafe);
    if (!length) return;
    // A suspended tab or a slow frame cannot move the player through a wall.
    const distance = SPEED * clamp(seconds, 0, 0.05) / Math.max(1, length);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const { x: cx, z: cz, w, d } = this.bounds;
    const x = clamp(this.x + distance * (strafe * cos - forward * sin), cx - w / 2 + RADIUS, cx + w / 2 - RADIUS);
    const z = clamp(this.z - distance * (forward * cos + strafe * sin), cz - d / 2 + RADIUS, cz + d / 2 - RADIUS);
    // Resolve the axes separately so the player can slide along walls.
    if (!this.obstructed(x, this.z)) this.x = x;
    if (!this.obstructed(this.x, z)) this.z = z;
  }

  private obstructed(x: number, z: number) {
    return this.obstacles.some((o) => {
      const dx = Math.max(0, Math.abs(o.x - x) - o.w / 2);
      const dz = Math.max(0, Math.abs(o.z - z) - o.d / 2);
      return dx * dx + dz * dz < RADIUS * RADIUS;
    });
  }
}
