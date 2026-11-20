/**
 * Where the 3D Explore preview plugs into the real app. Without `?preview=atlas` it renders the standard Explore view
 * and nothing else (the 3D code is not even downloaded). With it, the 3D view is shown instead, and the standard view
 * stays one click away. If WebGL is missing, the 3D code fails to load or the GPU context is lost, the standard view
 * is shown with a sentence saying why.
 */
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { RealityStore } from "../reality/store";
import { atlasRequested, webglAvailable } from "./flag";

const AtlasExplore = lazy(() => import("./AtlasExplore"));

type Off = null | "classic" | "unavailable" | "lost" | "failed";
const WHY: Record<Exclude<Off, null | "classic">, string> = {
  unavailable: "The 3D preview needs WebGL, which this browser does not provide, so this is the standard view.",
  lost: "The 3D preview stopped because the graphics context was lost, so this is the standard view.",
  failed: "The 3D preview could not start, so this is the standard view.",
};

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function AtlasGate({ store, children }: { store: RealityStore; children: ReactNode }) {
  const [wanted] = useState(() => typeof window !== "undefined" && atlasRequested(window.location.search));
  const [off, setOff] = useState<Off>(() => (wanted && !webglAvailable() ? "unavailable" : null));
  if (!wanted) return <>{children}</>;
  if (off) {
    return (
      <>
        {off === "classic" ? (
          // The two views of the same map: a switch, not a notice. The standard view has every detail and editor.
          <div className="atlas-switch" data-testid="atlas-switch">
            <span className="atlas-switch-label">View</span>
            <span className="atlas-switch-seg" role="group" aria-label="How this map is shown">
              <button type="button" onClick={() => setOff(null)} data-testid="atlas-open">3D world</button>
              <button type="button" aria-pressed="true" disabled>Standard view, all details</button>
            </span>
          </div>
        ) : (
          <div className="atlas-switch unavailable" role="status" data-testid="atlas-switch">
            <svg className="atlas-switch-isle" viewBox="0 0 48 32" width="48" height="32" aria-hidden="true" focusable="false">
              <ellipse cx="24" cy="12" rx="20" ry="5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 3" />
              <path d="M5 12 L14 19 L20 28 L26 22 L34 18 L43 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 3" strokeLinejoin="round" />
            </svg>
            <span className="atlas-switch-text">
              <span data-testid="atlas-unavailable">{WHY[off]}</span>
              <span className="atlas-switch-sub">Every future, figure and action is here, exactly as in the 3D view.</span>
            </span>
          </div>
        )}
        {children}
      </>
    );
  }
  return (
    <Boundary onError={() => setOff("failed")}>
      <Suspense
        fallback={(
          <div className="atlas-root atlas-opening" role="status">
            <span className="atlas-opening-isle" aria-hidden="true" />
            <span>Opening the 3D view…</span>
          </div>
        )}
      >
        <AtlasExplore store={store} onClassic={() => setOff("classic")} onUnavailable={(why) => setOff(why)} />
      </Suspense>
    </Boundary>
  );
}
