/**
 * The 3D Explore preview is opt-in: open the app with `?preview=atlas`. Without it nothing changes. With it, the
 * Explore stage is drawn in 3D and the standard Explore view stays one click away. Routes (`#staffing`), saved maps
 * and their format are untouched: the flag lives only in the address.
 *
 * Optional, for testing and measurement: `atlasQuality=low|high` overrides the device guess; `atlasDebug=1` exposes
 * read-only scene statistics as `window.__rfAtlas`.
 *
 * This file must not import three.js: it is part of the main bundle, and the 3D code loads only when asked for.
 */
export const ATLAS_PARAM = "preview";
export const ATLAS_VALUE = "atlas";

export function atlasRequested(search: string): boolean {
  return new URLSearchParams(search).get(ATLAS_PARAM) === ATLAS_VALUE;
}

export function atlasOption(search: string, name: "atlasQuality" | "atlasDebug"): string | null {
  return new URLSearchParams(search).get(name);
}

/** Can this browser draw WebGL? Checked before the 3D view is offered; if not, the standard view is shown and says why. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
