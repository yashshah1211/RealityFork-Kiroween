import type { Footprint } from "./navigation";

interface DeskNote { readonly title: string; readonly consequence: string }

export interface Landmark {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly range: number;
  readonly label: string;
  readonly story: string;
  readonly notes?: readonly DeskNote[];
  readonly seconds: number;
  readonly once?: boolean;
  readonly owner?: Footprint;
}

interface Viewer { readonly x: number; readonly z: number; readonly yaw: number; readonly pitch?: number }
export interface InteractionView { readonly prompt: string | null; readonly story: string; readonly notes?: readonly DeskNote[] }
const AXES = ["x", "z"] as const;

/** Test the finite horizontal sightline against a footprint at eye level. */
function blocks(view: Viewer, target: Landmark, obstacle: Footprint) {
  let enter = 0, exit = 1;
  for (const axis of AXES) {
    const origin = view[axis], delta = target[axis] - origin;
    const half = (axis === "x" ? obstacle.w : obstacle.d) / 2;
    const low = obstacle[axis] - half, high = obstacle[axis] + half;
    if (Math.abs(delta) < 1e-6) {
      if (origin < low || origin > high) return false;
      continue;
    }
    const a = (low - origin) / delta, b = (high - origin) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return enter < 0.998 && exit > 0.002;
}

export class HollowInteractions {
  private readonly used = new Set<string>();
  private target: Landmark | null = null;
  private last: Landmark | null = null;
  private active: Landmark | null = null;
  private elapsed = 0;
  private shownPrompt: string | null = null;
  private shownStory = "";
  private shownNotes: InteractionView["notes"];

  constructor(private readonly landmarks: readonly Landmark[], private readonly blockers: readonly Footprint[],
    private readonly onView: (view: InteractionView) => void) {}

  private reachable(view: Viewer, landmark: Landmark, distance: number) {
    if (distance > landmark.range) return false;
    for (const obstacle of this.blockers) {
      if (obstacle !== landmark.owner && blocks(view, landmark, obstacle)) return false;
    }
    return true;
  }

  available(view: Viewer, landmark: Landmark) {
    return this.reachable(view, landmark, Math.hypot(view.x - landmark.x, view.z - landmark.z));
  }

  update(view: Viewer) {
    let closest = Infinity;
    this.target = null;
    const sin = Math.sin(view.yaw), cos = Math.cos(view.yaw);
    const pitch = Math.cos(view.pitch ?? 0);
    for (const landmark of this.landmarks) {
      if (this.used.has(landmark.id)) continue;
      const dx = landmark.x - view.x, dz = landmark.z - view.z;
      const distance = Math.hypot(dx, dz);
      const facing = (-sin * dx - cos * dz) * pitch;
      if (distance >= closest || facing < distance * 0.48 || !this.reachable(view, landmark, distance)) continue;
      closest = distance;
      this.target = landmark;
    }
    if (!this.active && this.last && !this.available(view, this.last)) this.last = null;
    this.publish();
  }

  activate(view: Viewer) {
    this.update(view);
    if (this.active || !this.target) return null;
    const target = this.target;
    if (target.once) this.used.add(target.id);
    if (target.seconds === 0) return target.id;
    this.active = this.last = target;
    this.elapsed = 0;
    this.publish();
    return target.id;
  }

  advance(seconds: number, view: Viewer) {
    if (!this.active) return;
    this.elapsed += Math.max(0, seconds);
    if (this.elapsed < this.active.seconds) return;
    this.active = null;
    this.update(view);
  }

  get targetId() { return this.active ? null : this.target?.id ?? null; }
  get eventId() { return this.active?.id ?? null; }
  get progress() { return this.active ? this.elapsed / this.active.seconds : 0; }

  clear() {
    this.target = this.last = this.active = null;
    this.elapsed = 0;
    this.publish();
  }

  private publish() {
    const prompt = this.active ? null : this.target?.label ?? null;
    const story = this.last?.story ?? "";
    const notes = this.last?.notes;
    if (prompt === this.shownPrompt && story === this.shownStory && notes === this.shownNotes) return;
    this.shownPrompt = prompt;
    this.shownStory = story;
    this.shownNotes = notes;
    this.onView(notes ? { prompt, story, notes } : { prompt, story });
  }
}
