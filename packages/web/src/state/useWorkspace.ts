import { useSyncExternalStore } from "react";
import type { Workspace } from "./workspace";

export function useWorkspace(ws: Workspace) {
  return useSyncExternalStore(ws.subscribe, ws.getState);
}
