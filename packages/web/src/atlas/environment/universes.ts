/**
 * The look of each universe: sky, clouds, fog, light and ambience. Data only, read by the 3D scene
 * (AtlasScene.setUniverse) and by the page behind it (the painted sky shown before the first frame and without WebGL).
 *
 * Every universe is a night: a darker sky never means a worse future, and all futures in one map share one universe,
 * so the light on two islands can always be compared. Families differ in colour, weather and what fills the distance:
 * moonlit towers and heavy cloud for a city, forested islands, clear sky and fireflies for energy and environment, low
 * roofs for shops and studios, ruins and violet mist for the abstract universe. None of it is a fact about a future.
 */
import type { Family } from "./resolve";

/** What stands on the small, distant islands that fill the background (decoration, never a path). */
export type Distant = "towers" | "forest" | "roofs" | "ruins";
/** What dresses the dark ledge in the foreground (wide screens only). */
export type Ledge = "city" | "wild" | "stones";

export interface Universe {
  readonly family: Family;
  readonly sky: {
    readonly top: string;
    readonly mid: string;
    readonly horizon: string;
    readonly below: string;
    readonly moon: string;
    /** Cosine of the moon's angular radius (0.99955 is about 1.7 degrees). */
    readonly moonSize: number;
    readonly stars: number;
    readonly haze: string;
    readonly hazeAmount: number;
    readonly clouds: number;
    readonly cloudDark: string;
    readonly cloudLit: string;
    readonly sea: number;
    readonly seaDark: string;
    readonly seaLit: string;
  };
  readonly fog: { readonly color: string; readonly density: number };
  readonly hemi: { readonly sky: string; readonly ground: string; readonly intensity: number };
  readonly moon: { readonly color: string; readonly intensity: number };
  readonly rim: { readonly color: string; readonly intensity: number };
  readonly mist: string;
  readonly exposure: number;
  readonly ambience: {
    readonly distant: Distant;
    /** Share of distant islands with lights, and their colour. */
    readonly lights: number;
    readonly lightColor: string;
    /** Banks of cloud drifting between and below the islands: how many, and their shadowed and lit colours. */
    readonly banks: number;
    readonly bankDark: string;
    readonly bankLit: string;
    readonly fireflies: number;
    readonly bats: number;
    readonly ledge: Ledge;
  };
  /** The page behind the canvas, so it fades in without a flash and the fallback matches. */
  readonly css: { readonly top: string; readonly mid: string; readonly horizon: string };
}

export const UNIVERSES: Readonly<Record<Family, Universe>> = {
  urban: {
    family: "urban",
    sky: {
      top: "#03040f", mid: "#0a0d2a", horizon: "#1d1d45", below: "#07081a", moon: "#f2f3ff", moonSize: 0.99952, stars: 0.5,
      haze: "#ff9f5a", hazeAmount: 0.06, clouds: 0.58, cloudDark: "#0d0e24", cloudLit: "#7c78b8", sea: 0.92, seaDark: "#0a0b20", seaLit: "#4a4785",
    },
    fog: { color: "#121332", density: 0.0021 },
    hemi: { sky: "#8a92e6", ground: "#3a2a3f", intensity: 1.55 },
    moon: { color: "#c3cdff", intensity: 3.2 },
    rim: { color: "#9a8bff", intensity: 1.35 },
    mist: "#9aa0d6",
    exposure: 1.2,
    ambience: { distant: "towers", lights: 0.9, lightColor: "#ffb565", banks: 10, bankDark: "#121331", bankLit: "#5f5b98", fireflies: 0, bats: 4, ledge: "city" },
    css: { top: "#04061a", mid: "#0f1440", horizon: "#2b2a5e" },
  },
  energy: {
    family: "energy",
    sky: {
      top: "#01060f", mid: "#05162c", horizon: "#123349", below: "#04101f", moon: "#f4f9ff", moonSize: 0.99958, stars: 1.35,
      haze: "#7fd2e8", hazeAmount: 0.05, clouds: 0.3, cloudDark: "#071628", cloudLit: "#5d8fae", sea: 0.7, seaDark: "#061626", seaLit: "#3b6c88",
    },
    fog: { color: "#0b2236", density: 0.0019 },
    hemi: { sky: "#86b4e6", ground: "#24322f", intensity: 1.6 },
    moon: { color: "#d2e6ff", intensity: 3.25 },
    rim: { color: "#7fc4e8", intensity: 1.2 },
    mist: "#9ab8d6",
    exposure: 1.18,
    ambience: { distant: "forest", lights: 0.3, lightColor: "#ffc77a", banks: 7, bankDark: "#0a2034", bankLit: "#4d7d9a", fireflies: 70, bats: 0, ledge: "wild" },
    css: { top: "#020a1a", mid: "#082040", horizon: "#1b4762" },
  },
  business: {
    family: "business",
    sky: {
      top: "#070410", mid: "#160c24", horizon: "#36203a", below: "#0d0714", moon: "#fff1e2", moonSize: 0.99955, stars: 0.45,
      haze: "#ffad66", hazeAmount: 0.08, clouds: 0.55, cloudDark: "#140b1c", cloudLit: "#8a6680", sea: 0.85, seaDark: "#120a19", seaLit: "#5e4258",
    },
    fog: { color: "#1c1124", density: 0.0023 },
    hemi: { sky: "#b49ad8", ground: "#3b2a2c", intensity: 1.5 },
    moon: { color: "#ffdcc0", intensity: 2.8 },
    rim: { color: "#c98bd8", intensity: 1.2 },
    mist: "#c2a3c8",
    exposure: 1.22,
    ambience: { distant: "roofs", lights: 0.8, lightColor: "#ffb36b", banks: 9, bankDark: "#1a0f20", bankLit: "#6b4d68", fireflies: 0, bats: 0, ledge: "city" },
    css: { top: "#0b0614", mid: "#1e1131", horizon: "#4a2a40" },
  },
  neutral: {
    family: "neutral",
    sky: {
      top: "#03030f", mid: "#0c0a2c", horizon: "#1e1a48", below: "#07061a", moon: "#f1f0ff", moonSize: 0.99952, stars: 1.25,
      haze: "#a99bff", hazeAmount: 0.05, clouds: 0.5, cloudDark: "#0e0c27", cloudLit: "#716bb3", sea: 0.9, seaDark: "#0b0a22", seaLit: "#4a4488",
    },
    fog: { color: "#131135", density: 0.0021 },
    hemi: { sky: "#8f8ae6", ground: "#2e2840", intensity: 1.55 },
    moon: { color: "#cfcaff", intensity: 3 },
    rim: { color: "#a08bff", intensity: 1.35 },
    mist: "#a3a0dc",
    exposure: 1.2,
    ambience: { distant: "ruins", lights: 0.4, lightColor: "#ffbf80", banks: 10, bankDark: "#131133", bankLit: "#5f59a0", fireflies: 0, bats: 3, ledge: "stones" },
    css: { top: "#05051a", mid: "#120f42", horizon: "#2b2462" },
  },
};
