/**
 * The scenery the user chose for a map, if they chose one: a family and, optionally, a setting within it. Appearance
 * only. It is kept for this browser session and never written into the map, its bundle or its fingerprints, so
 * exported and saved maps are unchanged.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { SceneryOverride } from "./resolve";

const chosen = new Map<string, SceneryOverride>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setSceneryOverride(mapId: string, choice: SceneryOverride | null) {
  if (choice) chosen.set(mapId, choice);
  else chosen.delete(mapId);
  version++;
  for (const l of listeners) l();
}

export function sceneryOverride(mapId: string): SceneryOverride | null {
  return chosen.get(mapId) ?? null;
}

/** The override for one map, and a setter (null = automatic). */
export function useSceneryOverride(mapId: string): [SceneryOverride | null, (choice: SceneryOverride | null) => void] {
  useSyncExternalStore(subscribe, () => version);
  const set = useCallback((choice: SceneryOverride | null) => setSceneryOverride(mapId, choice), [mapId]);
  return [chosen.get(mapId) ?? null, set];
}
