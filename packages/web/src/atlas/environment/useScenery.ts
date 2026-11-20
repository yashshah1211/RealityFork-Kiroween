/**
 * The scenery of one map for the views that draw it (Explore, Compare): the universe, each path's island, and the
 * user's appearance-only override. No three.js here: this file is shared with the main bundle.
 */
import { useMemo } from "react";
import type { Reality } from "@realityfork/core";
import { useSceneryOverride } from "./override";
import { pathScenery, resolveScenery, type PathScenery, type SceneryChoice, type SceneryOverride } from "./resolve";
import { UNIVERSES, type Universe } from "./universes";

export interface MapScenery {
  readonly choice: SceneryChoice;
  readonly universe: Universe;
  readonly paths: ReadonlyMap<string, PathScenery>;
  readonly override: SceneryOverride | null;
  readonly setOverride: (choice: SceneryOverride | null) => void;
}

export function useScenery(r: Reality): MapScenery {
  const [override, setOverride] = useSceneryOverride(r.id);
  const choice = useMemo(() => resolveScenery(r, override), [r, override]);
  const paths = useMemo(() => new Map(r.branches.map((b) => [b.id, pathScenery(r, b, choice)])), [r, choice]);
  return useMemo(() => ({ choice, universe: UNIVERSES[choice.family], paths, override, setOverride }), [choice, paths, override, setOverride]);
}

/** The page's sky colours for a universe (CSS custom properties), so the painted sky matches the 3D one. */
export const universeStyle = (u: Universe): Record<string, string> => ({ "--world-top": u.css.top, "--world-mid": u.css.mid, "--world-horizon": u.css.horizon });
