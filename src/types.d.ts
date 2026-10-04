/**
 * The shapes that cross a boundary: data files into the catalog, the catalog into `pick()`,
 * a look into a scene, a scene into `fit()` and `render()`, and the engine into an effect. Type-only: nothing imports this at
 * runtime, and `vp check` is the only reader. The prose source of truth is
 * `docs/contracts.md`; where the two disagree, the contract wins and this file is wrong.
 */

import type { helpers } from "./helpers.js";

/** §5.3: `/^[0-9a-hjkmnp-tv-z]{1,16}$/`. */
export type Seed = string;

/** The six pinnable axes, in draw order. Also the `data/deny.json` rule keys. */
export type AxisKey = "f" | "v" | "p" | "r" | "e" | "l";

/** A request's pins: axis key → id. */
export type Pins = Partial<Record<AxisKey, string>>;

/** §5.3 taste buckets; called `archetype` in the data files. */
export type Bucket = "A" | "B" | "C" | "D" | "E" | "F" | "X";

/** §5.5 closed trait enum. Adding one is a `contract` PR. */
export type Trait =
  | "serif"
  | "sans"
  | "slab"
  | "script"
  | "brush"
  | "blackletter"
  | "deco"
  | "rounded"
  | "unicase"
  | "mono"
  | "fat"
  | "hairline"
  | "condensed"
  | "wide"
  | "inline"
  | "shaded"
  | "stencil"
  | "soft"
  | "groovy"
  | "connected"
  | "capsOnly"
  | "overlap"
  | "jp";

/** A quantized parameter: `[min, max, step]`. */
export type ParamSpec = readonly [min: number, max: number, step: number];

/** A keyed flag's probability, `numer / denom`. */
export type Chance = readonly [numer: number, denom: number];

/** One value per line: index 0 is "Tomasz", index 1 is "Cudziło". */
export type Pair = readonly [number, number];

/** A line's ink box at 1em: width, height, left side bearing, ink top above the baseline. */
export interface Ink {
  W: number;
  H: number;
  X: number;
  top: number;
}

export interface Variant {
  id: string;
  file: string;
  case: "none" | "uppercase" | "lowercase";
  css: { weight: number; style: string; feat: string };
  odds?: number;
  w1: Ink;
  w2: Ink;
}

/** A shipped font file. `asc`/`desc` are in font units; divide by the font's `upm` for em. */
export interface FontFile {
  id: string;
  asc: number;
  desc: number;
  /** Byte length of the woff2; added by `scripts/build.mjs`. */
  bytes: number;
  /** The woff2 as base64; added by `scripts/build.mjs`. */
  b64: string;
}

export interface Font {
  id: string;
  family: string;
  licenseId: string;
  copyright: string;
  odds: number;
  upm: number;
  archetype: readonly Bucket[];
  traits: readonly Trait[];
  files: readonly FontFile[];
  variants: readonly Variant[];
}

/**
 * §5.4 rule 3. `o` = bg, fg, a1, a2: a hex index, `w`/`k` for a derived ground, `-` for an
 * alias. `colors` and `ground` are derived from `o` by the catalog build, never stored.
 */
export interface RoleSet {
  o: string;
  dark: boolean;
  colors: number;
  ground: "w" | "k" | null;
  odds?: number;
}

/** `src` is the file name and `tier` the source adapter's, both filled by the catalog build. */
export interface Palette {
  id: string;
  src: string;
  tier?: string;
  /** Filled by the build when the row leaves it out. */
  odds: number;
  names: readonly string[];
  hex: readonly string[];
  roles: readonly RoleSet[];
}

/** A `data/deny.json` rule: it matches a pick whose value equals every key it names. */
export type DenyRule = Partial<Record<AxisKey, string>>;

/** `data/weights.json`: odds overrides per axis, keyed by id. */
export interface Weights {
  mode?: { free?: number; preset?: number };
  bucket?: Partial<Record<Bucket, number>>;
  preset?: Record<string, number>;
  f?: Record<string, number>;
  /** Keyed `<font>.<variant>`. */
  v?: Record<string, number>;
  p?: Record<string, number>;
  /** Keyed `<palette>.<o>`. */
  r?: Record<string, number>;
  e?: Record<string, number>;
  l?: Record<string, number>;
}

/** §5.7 `presets/<id>.json`. */
export interface Preset {
  id: string;
  odds: number;
  pins?: Pins;
  fonts?: { ids?: readonly string[]; traits?: readonly Trait[] };
  palettes?: { prefer?: readonly string[] };
  /** Forced params, per effect id. */
  params?: Record<string, Record<string, number>>;
}

/** `build/catalog.js`, as `scripts/build.mjs` writes it. */
export interface Catalog {
  fonts: readonly Font[];
  palettes: readonly Palette[];
  /** The build fills `odds` where an effect file leaves it out. */
  effects: readonly (Effect & { odds: number })[];
  presets: readonly Preset[];
  deny: readonly DenyRule[];
  weights: Weights;
}

/** How far an effect's ink reaches past each side of the fitted block, in u. */
export interface Bleed {
  t: number;
  r: number;
  b: number;
  l: number;
}

export type LayoutId = "stack-eq" | "stack-fit";

export type Align = "center" | "flex-end" | "flex-start";

/** A `src/layout.js` row. */
export interface Layout {
  id: LayoutId;
  odds: number;
  /** The §5.2 font-size divisors `F1`, `F2` for the two lines' ink boxes. */
  divisors: (w1: Ink, w2: Ink) => Pair;
}

/** The two lines' fitted geometry, in u: what the layout alone decides. */
export interface LineGeometry {
  fs: Pair;
  H: Pair;
  top: Pair;
  asc: Pair;
  desc: Pair;
  layout: string;
}

/** §5.6 `m`: the fitted geometry `css()`, `hover()` and `motion()` may read, in u. */
export interface Metrics extends LineGeometry {
  /** The final gap between the lines. */
  G: number;
  /** Block height over block width. */
  R: number;
}

/** The object effects receive as `h`. */
export type Helpers = typeof helpers;

/**
 * §5.6. `P` names the effect's params; each one is drawn from its `ParamSpec`, so the hooks
 * see a number per name.
 */
export interface Effect<P extends Record<string, number> = Record<string, number>> {
  id: string;
  family: string;
  shape: "A" | "B";
  colors: 2 | 3 | 4;
  bg: "any" | "dark" | "light";
  odds?: number;
  fonts: { deny: readonly Trait[]; prefer: readonly Trait[] };
  palettes: { prefer: readonly string[] };
  params: { readonly [K in keyof P]: ParamSpec };
  /** Sees the line geometry only: `G` and `R` depend on the bleed, so it cannot see them. */
  bleed: (p: P, lines: LineGeometry) => Bleed;
  css: (p: P, h: Helpers, m: Metrics) => string;
  /**
   * Declarations for `a.n:hover` / `a.n:active`; `render.js` owns the selector (R6). A
   * hover that reads no params may be the declaration string itself.
   */
  hover: string | ((p: P, h: Helpers, m: Metrics) => string) | null;
  motion: ((p: P, h: Helpers, m: Metrics) => string) | null;
}

/** The result of `pick()`: ids and drawn numbers only. Its text form is the Pick string. */
export interface Look {
  seed: Seed;
  mode: "free" | "preset";
  preset: string | null;
  bucket: Bucket;
  f: string;
  v: string;
  p: string;
  r: string;
  e: string;
  l: LayoutId;
  /** Effect params, quantized. */
  params: Record<string, number>;
  side: boolean;
  /** Line gap in u. */
  g: number;
  align: Align;
  /** The axes the request froze. */
  pinned: AxisKey[];
}

/** A look resolved back to the catalog rows `fit()` and `render()` need. */
export interface Scene {
  look: Look;
  font: Font;
  variant: Variant;
  file: FontFile;
  palette: Palette;
  roleSet: RoleSet;
  effect: Effect;
  layout: Layout;
}

/** The §5.2 numbers `fit.js` computes and `render.js` writes into the stylesheet. */
export interface Fit {
  F1: number;
  F2: number;
  L1: number;
  L2: number;
  G: number;
  R: number;
  BH: number;
  Y2: number;
  K1: number;
  K2: number;
  DX: number;
  DY: number;
  bleed: Bleed;
  m: Metrics;
}
