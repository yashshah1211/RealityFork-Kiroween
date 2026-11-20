# 3D Explore preview (vertical slice)

An opt-in preview of the Explore stage drawn in 3D. It is a presentation layer over the real app: the same
`RealityStore`, the same maps (saved and exported unchanged), the same core views for every word and number, and the
same operations for selecting, answering, branching and comparing. The standard Explore view is still the default
and stays one click away.

Open it with `?preview=atlas`:

```bash
npm run dev                      # then http://localhost:5173/?preview=atlas
npm run build && npm start       # then http://127.0.0.1:8080/?preview=atlas
```

Choose an example (or a saved map) and Explore opens in 3D. Without the flag the app is exactly as before, and no 3D
code, model or decoder is downloaded (checked in `e2e/atlas-fallback.spec.ts`).

## What is on screen

- **The world.** One floating island per path. The selected future is large in the free part of the screen; where it
  came from recedes to the left, other paths from the same parent float low on the left, and paths that continue from
  it wait on the right. *Overview* shows every path as a tree from the start (left) to the latest futures (right).
  Threads join each path to its parent; the line from the start to the selected future is amber.
- **The panel.** The selected future in words: where it came from, what is different from its parent, *Calculated*
  results with where each figure came from, *Known* (what you told us), *Possible* (labelled as possibilities, not
  predictions) and what is still unknown. A described change shows "What this change does" exactly as in the standard
  view. Actions: *Explore another path from here* (the standard view's sheet and `exploreChange` / `forkWith`),
  *Compare with another future* (the standard Compare stage), *All details (standard view)*.
- **Navigation.** Click an island or its label; breadcrumb; buttons for came from / previous / next / continues;
  *Focus* / *Overview*; drag to look around, scroll to zoom, *Recenter*.

## Which world a path gets (`src/atlas/worlds.ts`)

A detailed world is drawn only when the map itself says the path happens there:

1. a choice offering the place is set to it on the path (`City: London`), or
2. on maps without such a choice, the path or the path it continues is named for it ("Move to London").

A change described in words is a what-if RealityFork does not interpret, so a path that explores one is drawn as an
open landscape (unless the place is chosen again after it), and the panel says why. Everything else is an open
landscape: a seeded island with grass, a path, a lantern and autumn trees, which shows that a future exists and
nothing about what is in it. Only London has a detailed world.

## The London model

`src/atlas/assets/london_island.glb` is the Draco-compressed London export with the Wayfinder’s Shelter
(SHA-256 `4c502bbeeb6a93554508acf725e0c928922f9d9e7a5ce629c00b4bc0fcaf28af`). The shelter uses open timber framing, stone feet,
an asymmetrical slate roof, a recessed trail carving and a hanging lantern. The export preserves all 22
embedded textures and the existing island, water, landmark and nature geometry. It is loaded once per page with
three.js's `GLTFLoader` and the glTF Draco decoder that ships with three.js (served from this origin). The focused
London path gets the full model; other London paths get a copy with only the rock, river, tower, palace and bridge.
Copies share geometry, materials and textures.

The GLB has no lights, only 43 markers (`LIGHT_*` empties with kind, colour and range). In the browser:

- every marker gets a small warm glow sprite (one draw call per island);
- the focused island gets a fixed rig of 4 point lights placed at clusters of the lamp markers and 2 spot lights at
  clusters of the floodlight markers. The rig moves with the focus, so the light count never changes and shaders are
  never recompiled;
- moonlight is one directional light (the only shadow caster), with a hemisphere fill and a violet rim light.

Atmosphere is a shader sky with a moon and stars, exponential fog, and soft mist around each island's rock. There is
no post-processing pass.

## Fallbacks

| Situation | What happens |
|---|---|
| No WebGL | The standard Explore view, with "The 3D preview needs WebGL…" |
| The 3D code fails to load, or the GPU context is lost | The standard Explore view, with the reason |
| The London model fails to load | London paths are drawn as open landscapes; the status line and the panel say so; *Try again* reloads it |
| A slow device | Measured over 2.5 s after the model loads: under 12 frames, or a median frame over 40 ms, switches to a simpler mode (no shadows, no mist, pixel ratio 1, open landscapes instead of the far London copies, no idle animation, and idle frames are not redrawn). "Simplified for this device" is shown. `?atlasQuality=low` forces it |

## Accessibility

Labels are buttons (with the path's name, its relation to the selected one and what changed); the canvas is hidden
from assistive technology. Keyboard: ← → other paths from the same place, ↑ where it came from, ↓ a path that
continues, Home the start, O overview, Escape back. After every move, focus is on the selected future's heading.
With reduced motion, islands and the camera change place at once and nothing floats or pulses. Phones get the panel
as a bottom sheet (it can be hidden) and touch-sized controls.

## Evidence

- The [release gallery](../../submission/kiroween-2026/demo.md#screenshots-and-thumbnail) contains reviewed screenshots.
- The browser suites regenerate local evidence. Re-measure with:

  ```bash
  npm run build
  cd packages/web
  RF_E2E_PROD=1 RF_ATLAS_PERF=1 RF_ATLAS_PERF_LABEL=production-headless npx playwright test e2e/atlas-perf.spec.ts
  RF_E2E_PROD=1 RF_ATLAS_PERF=1 RF_ATLAS_PERF_LABEL=production-headed npx playwright test e2e/atlas-perf.spec.ts --headed
  ```

  Prior measurements used Chromium on a Windows laptop with integrated graphics and an emulated phone-sized viewport.

## Tests

| File | What it checks |
|---|---|
| `src/atlas/atlas.test.ts` | the flag; which world each path gets (examples, value changes, described changes, names); island placement; keyboard order |
| `e2e/atlas.spec.ts` | Mumbai to London and solar through the real store, with the GPU: select, overview, branch (saved, and visible in the standard view), compare and back; no `/api` request; no request off this server |
| `e2e/atlas-interaction.spec.ts` | keyboard, reduced motion, a London model that fails to load and *Try again*, 390 px phone layout; solar downloads no London model or decoder |
| `e2e/atlas-fallback.spec.ts` | software rendering (SwiftShader) switches to the simple mode; no WebGL; no flag |
| `e2e/atlas-perf.spec.ts` | measurements only, when `RF_ATLAS_PERF=1` |

The GPU specs pass `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` to Chromium; without them headless
Chromium uses SwiftShader, which is what the fallback spec relies on.

## Dependencies and assets

- `three` 0.187.0 (MIT): WebGL rendering, `GLTFLoader`, `DRACOLoader`, `OrbitControls`. Needed to draw the GLB in the
  browser; loaded only by the preview (`AtlasGate` imports the 3D view lazily). `@types/three` 0.187.0 (MIT), dev only.
- Draco glTF decoder (Apache-2.0), shipped inside the `three` package (`examples/jsm/libs/draco/gltf/`).
- London model and the six open-landscape textures (taken from the same GLB): original procedural work from the
  Blender milestone. The Wayfinder’s Shelter is original geometry and reuses the scene’s existing materials. [Asset credits](../../submission/kiroween-2026/asset-credits.md)
- Sky, moon, stars, glows and mist are drawn in shaders or on canvases; no image files.

## Known limitations

- Visual quality is below the approved cinematic reference: the open landscapes are simple, the mist is light (it is
  transparent overdraw, the most expensive thing on integrated GPUs), there are no clouds, bats or volumetric light,
  and the London model itself has the limits listed in its own milestone (soft procedural rock, card foliage).
- The overview makes islands small; it is for finding a path, not for looking at it.
- Simulated outcomes (the café example) are not run in the 3D panel; it points to the standard view. "Another look"
  (AI) is not offered in the 3D panel either; it is in the standard view.
- Performance was measured on one machine; no real phone or low-end GPU was tested. The step-down rule is a single
  threshold.
- Only London has a detailed world; adding a place means a new asset and an entry in `DETAILED_PLACES`.
