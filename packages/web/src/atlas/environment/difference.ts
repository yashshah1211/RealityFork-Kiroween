/**
 * A future's visual state in words: what its picture shows, and how that differs from the path it came from. Read only
 * from PathScenery (resolve.ts), so every item comes from a figure or a choice the path itself records (the number of
 * people at work, a battery that is "yes", "Approach: flood walls", the place it happens in), never from how good,
 * likely, wealthy or safe a future is. One mechanism for every family: shops and studios show people at work, energy
 * and environment show features, the city shows the place, and the open sky shows nothing about a future, by design.
 * Presentation only: nothing here changes the map, and the picture stays illustrative.
 */
import { FAMILY_NAME, PROP_WORDS, peopleWhere, peopleWords, THEME_NAME, type PathScenery, type Prop } from "./resolve";

export interface SceneChange {
  /** What differs: "place", "theme", "people", "what-if" or a detail (a Prop). */
  readonly key: string;
  /** This path's picture: "Two people at the counter". */
  readonly now: string;
  /** The same thing on the path it came from, starting in lower case: "one person". */
  readonly before: string;
}

/** What the panel says about a path's picture: how it differs from its parent's, or (for a start) what it shows. */
export interface SceneView {
  readonly changes: readonly SceneChange[];
  readonly items: readonly string[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const placeWords = (p: PathScenery) => (p.place === "london" ? "The detailed London model" : `${FAMILY_NAME[p.family]} scenery`);
const peopleLine = (p: PathScenery) => (p.people > 0 ? `${peopleWords(p.people)} ${peopleWhere(p.theme)}` : "Nobody drawn at work");

/** What a path's picture shows that the path records (a start has nothing to differ from). */
export function sceneItems(p: PathScenery): string[] {
  const out: string[] = [];
  if (p.place === "london") out.push(placeWords(p));
  if (p.people > 0) out.push(peopleLine(p));
  for (const x of p.props) out.push(PROP_WORDS[x].yes);
  if (p.hypothetical) out.push("Marked as a what-if: your own words are not drawn");
  return out;
}

/** How a path's picture differs from its parent's, item by item: empty when the two look the same. */
export function sceneChanges(parent: PathScenery, child: PathScenery): SceneChange[] {
  const out: SceneChange[] = [];
  if (child.place !== parent.place) out.push({ key: "place", now: placeWords(child), before: lower(placeWords(parent)) });
  if (child.theme !== parent.theme) out.push({ key: "theme", now: `Drawn as ${THEME_NAME[child.theme]}`, before: THEME_NAME[parent.theme] });
  if (child.people !== parent.people) out.push({ key: "people", now: peopleLine(child), before: parent.people > 0 ? lower(peopleWords(parent.people)) : "nobody drawn" });
  for (const x of new Set<Prop>([...parent.props, ...child.props])) {
    const was = parent.props.includes(x);
    const is = child.props.includes(x);
    if (was !== is) out.push({ key: x, now: is ? PROP_WORDS[x].yes : PROP_WORDS[x].no, before: lower(was ? PROP_WORDS[x].yes : PROP_WORDS[x].no) });
  }
  if (child.hypothetical !== parent.hypothetical) out.push({ key: "what-if", now: child.hypothetical ? "Marked as a what-if: your own words are not drawn" : "Not marked as a what-if", before: parent.hypothetical ? "marked as a what-if" : "not marked" });
  return out;
}

/** The scene view of one path, from the map's scenery (the parent's, when it has one). */
export function sceneView(here: PathScenery | undefined, parent: PathScenery | undefined): SceneView {
  if (!here) return { changes: [], items: [] };
  return { changes: parent ? sceneChanges(parent, here) : [], items: sceneItems(here) };
}
