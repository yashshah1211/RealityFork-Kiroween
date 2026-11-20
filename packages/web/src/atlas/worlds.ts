/**
 * Which world the 3D Explore preview draws for a path. Presentation only: it reads what the map records and never
 * changes it.
 *
 * A detailed world is shown only when the map itself says the path happens in that place: a choice offering the
 * place is set to it, or (on maps without such a choice) the path or the path it continues is named for it. Nothing
 * is read from the question, from descriptions, or from a change the user described in their own words: RealityFork
 * does not interpret those (they are hypotheticals, see isIntervention), so a path that explores one is drawn as an
 * open landscape unless the place was chosen again after it. Everything else is an open landscape too, which says
 * nothing about the future it stands for.
 */
import { changesFromParent, isIntervention, type Branch, type Reality, type Variable } from "@realityfork/core";

export type WorldKind = "london" | "generic";
export interface WorldChoice {
  readonly kind: WorldKind;
  /** Why, in plain words, for the screen. */
  readonly reason: string;
}

/** Places with a detailed, hand-made 3D world. */
export const DETAILED_PLACES: readonly { readonly kind: Exclude<WorldKind, "generic">; readonly place: string }[] = [{ kind: "london", place: "London" }];

export const OPEN_LANDSCAPE = "Shown as an open landscape: there is no detailed world for this path, and nothing in the picture is a fact about it.";
export const DESCRIBED_LANDSCAPE =
  "Shown as an open landscape: this path explores a change you described in your own words, which RealityFork does not interpret, so the picture assumes nothing about where it happens.";

const isPlace = (value: unknown, place: string) => typeof value === "string" && value.trim().toLowerCase() === place.toLowerCase();
/**
 * "Move to London", "Moving with family to London", "Live in London", "London, remote job". Anchored at the start, so
 * "Stay in Mumbai, visit London" and "Don't move to London" do not match.
 */
const namePattern = (place: string) =>
  new RegExp(`^(?:(?:move|moving|relocate|relocating|live|living|settle|settling|work|working|study|studying)\\b(?:\\s+[\\p{L}'-]+){0,3}?\\s+(?:to|in)\\s+)?${place}\\b`, "iu");

/** The first choice (category assumption) of the map that offers the place as an option. */
const placeChoice = (r: Reality, place: string): Variable | undefined => r.variables.find((v) => v.kind === "category" && v.options.some((o) => isPlace(o, place)));

/** The path, its parent, and so on up to where the map starts. */
export function lineOf(r: Reality, b: Branch): Branch[] {
  const out: Branch[] = [b];
  for (let x = b; x.parentId; ) {
    const p = r.branches.find((y) => y.id === x.parentId);
    if (!p || out.includes(p)) break;
    out.push(p);
    x = p;
  }
  return out;
}

/** True when this path was made from a change described in words (it is on this path and not on its parent). */
export const describedHere = (r: Reality, x: Branch) => changesFromParent(r, x).told.some((f) => f.to !== null && isIntervention(f));

export function worldFor(r: Reality, b: Branch): WorldChoice {
  const line = lineOf(r, b);
  for (const { kind, place } of DETAILED_PLACES) {
    const choice = placeChoice(r, place);
    // `at`: the step in the line (0 = this path) that made the path happen in the place.
    let at = -1;
    let reason = "";
    if (choice) {
      if (!isPlace(b.values[choice.key], place)) continue;
      at = 0;
      while (at + 1 < line.length && isPlace(line[at + 1]!.values[choice.key], place)) at++;
      reason = `Shown as ${place}: ${choice.label} is ${String(b.values[choice.key])} on this path.`;
    } else {
      at = line.findIndex((x) => namePattern(place).test(x.name.trim()));
      if (at === -1) continue;
      reason = at === 0 ? `Shown as ${place}: the path is called “${b.name.trim()}”.` : `Shown as ${place}: it continues “${line[at]!.name.trim()}”.`;
    }
    // A change described in words at that step or after it may change the place: nothing is assumed.
    if (line.slice(0, at + 1).some((x) => describedHere(r, x))) return { kind: "generic", reason: DESCRIBED_LANDSCAPE };
    return { kind, reason };
  }
  return { kind: "generic", reason: OPEN_LANDSCAPE };
}
