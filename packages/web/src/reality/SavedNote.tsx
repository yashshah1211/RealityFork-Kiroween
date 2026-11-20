/**
 * Where the open map is kept: every change is saved in this browser as it is made (RealityStore writes the same
 * bundle as the export on each change), so there is no Save button to forget. This says so, with the time of the last
 * change when one was recorded, and leads to the library, where maps are saved to a file or opened from one.
 */
import { createContext, useContext } from "react";
import type { Reality } from "@realityfork/core";
import type { RealityState } from "./store";

/** Navigation that is not part of the store's state: the library is a place in the app, not something saved. */
export const NavContext = createContext<{ readonly openLibrary: () => void; readonly openFile: () => void } | null>(null);
export const useNav = () => useContext(NavContext);

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? `today at ${time.format(d)}` : day.format(d);
}

export function SavedNote({ state, r }: { state: Pick<RealityState, "edited" | "realities">; r: Reality }) {
  const nav = useNav();
  const edited = state.edited[r.id];
  const saved = state.realities.some((x) => x.id === r.id);
  if (!saved) return null;
  return (
    <p className="saved-note" data-testid="saved-note">
      <span className="saved-mark" aria-hidden="true" />
      <span>Saved in this browser{edited ? <> · last change {whenText(edited)}</> : null}</span>
      {nav && <button type="button" className="link-btn" onClick={nav.openLibrary} data-testid="saved-open-library">Your maps</button>}
    </p>
  );
}
