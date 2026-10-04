/**
 * Ordered conditional sampling: one pass down a fixed axis order, one draw per axis.
 *
 *   mode -> bucket -> font -> file+variant -> effect -> effect params
 *        -> palette -> role set -> layout + side + g
 *
 * Pins are fixed before any draw. Each drawn axis filters against everything already
 * fixed and removes the candidates that would complete a `data/deny.json` rule. Every
 * axis keeps a universal fallback (R5), so the candidate set is never empty and the pass
 * always terminates: there are no retries and no loops. The build guarantees every pool is
 * non-empty and `plain` and `qa-bw` exist (B2), so the engine never guards the catalog.
 *
 * `pick()` is pure. It never touches the network, the clock or `Math.random`.
 */

import { ALIGNS, GAP, LAYOUTS, SIDE } from "./layout.js";
import { AXIS_KEYS } from "./look.js";
import { flag, step, weighted } from "./rand.js";

/**
 * @import { AxisKey, Bucket, Catalog, DenyRule, Effect, Font, Look, Palette, ParamSpec,
 *   Pins, Preset, RoleSet, Scene, Seed, Weights } from "./types.js"
 */

/**
 * A pin naming something that does not exist, or a pin combination nothing satisfies: a
 * request error, which the worker answers with 400. A broken catalog throws a plain `Error`
 * instead, which surfaces as a 500 — it is the deploy that is wrong, not the request.
 */
export class PickError extends Error {
  /**
   * @param {'unknown' | 'incompatible'} kind
   * @param {string} axis
   */
  constructor(kind, axis) {
    super(`${kind} pin on axis ${axis}`);
    this.name = "PickError";
    this.kind = kind;
    this.axis = axis;
  }
}

/**
 * D4: 90% of visits draw from the six taste archetypes, equal share each.
 *
 * A soft 70s display serif · B ultra-heavy wide caps with inline or stencil cuts ·
 * C bold casual brush script · D fat groovy psychedelic caps · E rounded geometric
 * display · F elegant deco and nouveau serif with alternates · X everything else.
 *
 * They are taste buckets from the owner's reference images, not technical classes: a font
 * belongs to one because it looks like the reference, not because it measures a certain way.
 * @type {Record<Bucket, number>}
 */
export const BUCKET_ODDS = Object.freeze({ A: 3, B: 3, C: 3, D: 3, E: 3, F: 3, X: 2 });

const DEFAULT_ODDS = 4;

/** @param {number} n */
const clampOdds = (n) => {
  const i = Math.floor(n);
  return i < 0 ? 0 : i > 16 ? 16 : i;
};

/**
 * Does `rule` hold for a finished pick? A rule matches when every key it names equals the
 * look's value on that axis.
 *
 * @param {readonly DenyRule[]} deny
 * @param {Readonly<Partial<Record<AxisKey, string>>>} look a Look, or anything with axis ids
 */
export function denied(deny, look) {
  return deny.some((rule) => {
    const keys = /** @type {AxisKey[]} */ (
      Object.keys(rule).filter((k) => AXIS_KEYS.includes(/** @type {never} */ (k)))
    );
    return keys.length > 0 && keys.every((k) => look[k] === rule[k]);
  });
}

/**
 * Would choosing `id` on `axis` complete a deny rule, given everything fixed so far? A
 * rule that also names an axis nobody has drawn yet is not completed — it will be checked
 * again when that axis comes up.
 *
 * @param {readonly DenyRule[]} deny
 * @param {AxisKey} axis
 * @param {string} id
 * @param {Pins} fixed
 */
function completes(deny, axis, id, fixed) {
  return deny.some((rule) => {
    if (rule[axis] !== id) return false;
    const keys = /** @type {AxisKey[]} */ (Object.keys(rule));
    return keys.every((k) => k === axis || fixed[k] === rule[k]);
  });
}

/**
 * What every axis draw shares: the seed, the odds overrides, the deny rules, the effective
 * pins, and the ids fixed so far, which each draw extends.
 * @typedef {{seed: Seed, weights: Weights, deny: readonly DenyRule[], pins: Pins, fixed: Pins}} Draws
 */

/**
 * One axis: pin, then compatibility, then deny, then odds — each step relaxed rather than
 * allowed to empty the set, which is what makes the single pass total. The winner joins
 * `s.fixed`, so the axes after it see it.
 *
 * @template {{id: string}} T
 * @param {Draws} s
 * @param {object} a
 * @param {AxisKey} a.axis
 * @param {readonly T[]} a.pool every item the axis could ever produce
 * @param {(item: T) => boolean} [a.compatible]
 * @param {(item: T) => number} a.oddsOf
 * @param {(items: readonly T[]) => readonly T[]} [a.fallback]
 * @returns {T}
 */
function drawAxis(s, { axis, pool, compatible, oddsOf, fallback }) {
  // The build rejects an empty pool (B2), so this is a broken catalog, never a bad request.
  if (pool.length === 0) throw new Error(`empty pool on axis ${axis}`);

  const pin = s.pins[axis];
  if (pin != null) {
    const hit = pool.find((item) => item.id === pin);
    // A pin bypasses compatibility filtering on purpose: pins exist for tests, contact
    // sheets and bug reports, and a retired (odds 0) item stays resolvable by pin.
    if (!hit) throw new PickError("incompatible", axis);
    s.fixed[axis] = hit.id;
    return hit;
  }

  let cands = compatible ? pool.filter(compatible) : pool;
  if (cands.length === 0) cands = fallback ? fallback(pool) : pool;
  if (cands.length === 0) cands = pool;

  const allowed = cands.filter((item) => !completes(s.deny, axis, item.id, s.fixed));
  if (allowed.length > 0) cands = allowed;

  const live = cands.filter((item) => oddsOf(item) > 0);
  if (live.length > 0) cands = live;

  // Never null: `cands` is never empty, and `weighted` returns null only for an empty list.
  const hit = /** @type {T} */ (weighted(s.seed, axis, cands, oddsOf));
  s.fixed[axis] = hit.id;
  return hit;
}

/**
 * Does this palette prefer-token describe `palette` (with one of `sets` selected)?
 * Tokens: a source or id prefix (`kasane`), a polarity (`dark` / `light`), a colour count
 * (`n2`..`n4`) or a tier (`historical`).
 *
 * @param {string} token
 * @param {{id: string, src?: string, tier?: string}} palette
 * @param {readonly {dark: boolean, colors: number}[]} sets
 */
function prefers(token, palette, sets) {
  if (token === "dark") return sets.some((r) => r.dark);
  if (token === "light") return sets.some((r) => !r.dark);
  if (/^n[234]$/.test(token)) return sets.some((r) => r.colors === Number(token.slice(1)));
  if (palette.tier === token) return true;
  return palette.src === token || palette.id.startsWith(`${token}-`);
}

/**
 * Role sets this effect can paint on: enough colours, and the right ground polarity.
 *
 * @param {{colors: number, bg: string}} effect
 * @param {{dark: boolean, colors: number}} roleSet
 */
const roleFits = (effect, roleSet) =>
  roleSet.colors >= effect.colors &&
  (effect.bg === "any" || (effect.bg === "dark") === roleSet.dark);

/**
 * Free draw or preset. Without presets there is nothing to draw.
 *
 * @param {Seed} seed
 * @param {readonly Preset[]} presets
 * @param {Weights} weights
 * @returns {{mode: 'free' | 'preset', preset: Preset | null}}
 */
function drawMode(seed, presets, weights) {
  if (presets.length === 0) return { mode: "free", preset: null };
  const share = weights.mode ?? { free: 8, preset: 2 };
  /** @type {{id: 'free' | 'preset', odds: number}[]} */
  const modes = [
    { id: "free", odds: clampOdds(share.free ?? 8) },
    { id: "preset", odds: clampOdds(share.preset ?? 2) },
  ];
  // Never null: `weighted` returns null only for an empty list.
  const mode = /** @type {(typeof modes)[number]} */ (weighted(seed, "mode", modes, (m) => m.odds))
    .id;
  if (mode === "free") return { mode, preset: null };
  const preset = weighted(seed, "preset", presets, (x) =>
    clampOdds(weights.preset?.[x.id] ?? x.odds),
  );
  return { mode, preset };
}

/**
 * A preset's pins are data, not a request: an id that has been retired out of the catalog
 * must not turn a random visit into a 400. Unknown ones are dropped and the axis draws
 * normally. A request's own pins are never dropped — `pick()` validated them.
 *
 * @param {Pins} pins
 * @param {Preset | null} preset
 * @param {Record<AxisKey, Set<string>>} universe
 * @returns {Pins}
 */
function effectivePins(pins, preset, universe) {
  const out = { ...pins };
  for (const [k, v] of /** @type {[AxisKey, string][]} */ (Object.entries(preset?.pins ?? {}))) {
    if (out[k] == null && universe[k]?.has(v)) out[k] = v;
  }
  return out;
}

/**
 * @param {Draws} s
 * @returns {Bucket}
 */
function drawBucket(s) {
  const buckets = /** @type {Bucket[]} */ (Object.keys(BUCKET_ODDS)).map((id) => ({
    id,
    odds: clampOdds(s.weights.bucket?.[id] ?? BUCKET_ODDS[id]),
  }));
  return /** @type {(typeof buckets)[number]} */ (weighted(s.seed, "b", buckets, (b) => b.odds)).id;
}

/**
 * @param {Draws} s
 * @param {readonly Font[]} fonts
 * @param {Bucket} bucket
 * @param {Preset | null} preset
 */
function drawFont(s, fonts, bucket, preset) {
  const only = preset?.fonts ?? {};
  const v = s.pins.v;
  return drawAxis(s, {
    axis: "f",
    pool: fonts,
    compatible: (x) => {
      if (only.ids && !only.ids.includes(x.id)) return false;
      if (only.traits && !only.traits.every((t) => x.traits.includes(t))) return false;
      if (v && !x.variants.some((y) => y.id === v)) return false;
      return x.archetype.includes(bucket);
    },
    // Universal fallback: an empty bucket falls back to the flat pool.
    fallback: (pool) => pool.filter((x) => !v || x.variants.some((y) => y.id === v)),
    oddsOf: (x) => clampOdds(s.weights.f?.[x.id] ?? x.odds),
  });
}

/**
 * @param {Draws} s
 * @param {Font} font
 */
function drawVariant(s, font) {
  return drawAxis(s, {
    axis: "v",
    pool: font.variants,
    oddsOf: (x) => clampOdds(s.weights.v?.[`${font.id}.${x.id}`] ?? x.odds ?? DEFAULT_ODDS),
  });
}

/**
 * The effect's colour and polarity needs point *forward*, at the palette axis. They are
 * checked here rather than left to the palette's fallback: an effect that paints with
 * `--a1` on a 2-colour role set would paint its accent in the face colour and vanish.
 *
 * @param {Draws} s
 * @param {Catalog["effects"]} effects
 * @param {readonly Palette[]} palettes
 * @param {Font} font
 */
function drawEffect(s, effects, palettes, font) {
  const { p, r } = s.pins;
  const roleSetPool = palettes
    .filter((x) => !p || x.id === p)
    .flatMap((x) => x.roles.filter((y) => !r || y.o === r));
  const traits = new Set(font.traits);
  return drawAxis(s, {
    axis: "e",
    pool: effects,
    compatible: (x) =>
      !x.fonts.deny.some((t) => traits.has(t)) && roleSetPool.some((y) => roleFits(x, y)),
    // Universal fallback: `plain` fits every font, every palette and every layout.
    fallback: (pool) => pool.filter((x) => x.id === "plain"),
    oddsOf: (x) => {
      const base = clampOdds(s.weights.e?.[x.id] ?? x.odds);
      return x.fonts.prefer.some((t) => traits.has(t)) ? base * 2 : base;
    },
  });
}

/**
 * The effect's params, quantized, in name order. A preset may force any of them.
 *
 * @param {Seed} seed
 * @param {Effect} effect
 * @param {Readonly<Record<string, number>>} [forced]
 * @returns {Record<string, number>}
 */
export function drawParams(seed, effect, forced = {}) {
  /** @type {Record<string, number>} */
  const params = {};
  for (const name of Object.keys(effect.params).sort()) {
    params[name] =
      forced[name] ??
      step(seed, `e/${effect.id}/${name}`, /** @type {ParamSpec} */ (effect.params[name]));
  }
  return params;
}

/**
 * @param {Draws} s
 * @param {readonly Palette[]} palettes
 * @param {Required<Effect>} effect
 * @param {Preset | null} preset
 */
function drawPalette(s, palettes, effect, preset) {
  const r = s.pins.r;
  const preferTokens = [...effect.palettes.prefer, ...(preset?.palettes?.prefer ?? [])];
  /** @param {Palette} x */
  const setsOf = (x) => x.roles.filter((y) => roleFits(effect, y));
  return drawAxis(s, {
    axis: "p",
    pool: palettes,
    compatible: (x) => setsOf(x).length > 0 && (!r || x.roles.some((y) => y.o === r)),
    oddsOf: (x) => {
      const base = clampOdds(s.weights.p?.[x.id] ?? x.odds);
      return preferTokens.some((t) => prefers(t, x, setsOf(x))) ? base * 2 : base;
    },
  });
}

/**
 * @param {Draws} s
 * @param {Palette} palette
 * @param {Effect} effect
 * @returns {RoleSet}
 */
function drawRoleSet(s, palette, effect) {
  return drawAxis(s, {
    axis: "r",
    pool: palette.roles.map((y) => ({ ...y, id: y.o })),
    compatible: (y) => roleFits(effect, y),
    oddsOf: (y) => clampOdds(s.weights.r?.[`${palette.id}.${y.o}`] ?? y.odds ?? DEFAULT_ODDS),
  });
}

/** @param {Draws} s */
function drawLayout(s) {
  return drawAxis(s, {
    axis: "l",
    pool: LAYOUTS,
    oddsOf: (x) => clampOdds(s.weights.l?.[x.id] ?? x.odds),
  });
}

/**
 * The layout's own draws (R8, R9). No pin, weight or deny rule reaches them.
 *
 * @param {Seed} seed
 */
export function drawLayoutAxes(seed) {
  return {
    side: flag(seed, "l/side", SIDE[0], SIDE[1]),
    g: step(seed, "l/g", GAP),
    align: /** @type {(typeof ALIGNS)[number]} */ (weighted(seed, "l/a", ALIGNS, (x) => x.odds)).id,
  };
}

/**
 * @param {Catalog} catalog
 * @param {Seed} seed
 * @param {Pins} [pins]
 * @returns {Look}
 */
export function pick(catalog, seed, pins = {}) {
  const { fonts, palettes, effects } = catalog;

  // Unknown ids are rejected before anything is drawn, so a typo never renders a page.
  /** @type {Record<AxisKey, Set<string>>} */
  const universe = {
    f: new Set(fonts.map((x) => x.id)),
    v: new Set(fonts.flatMap((x) => x.variants.map((y) => y.id))),
    p: new Set(palettes.map((x) => x.id)),
    r: new Set(palettes.flatMap((x) => x.roles.map((y) => y.o))),
    e: new Set(effects.map((x) => x.id)),
    l: new Set(LAYOUTS.map((x) => x.id)),
  };
  /** @type {AxisKey[]} */
  const pinned = [];
  for (const k of AXIS_KEYS) {
    const v = pins[k];
    if (v == null) continue;
    if (!universe[k].has(v)) throw new PickError("unknown", k);
    pinned.push(k);
  }
  /** @type {Pins} */
  const fixed = {};
  for (const k of pinned) fixed[k] = pins[k];

  const weights = catalog.weights;
  const { mode, preset } = drawMode(seed, catalog.presets, weights);
  /** @type {Draws} */
  const s = {
    seed,
    weights,
    deny: catalog.deny,
    pins: effectivePins(pins, preset, universe),
    fixed,
  };

  const bucket = drawBucket(s);
  const font = drawFont(s, fonts, bucket, preset);
  const variant = drawVariant(s, font);
  const effect = drawEffect(s, effects, palettes, font);
  const params = drawParams(seed, effect, preset?.params?.[effect.id]);
  const palette = drawPalette(s, palettes, effect, preset);
  const roleSet = drawRoleSet(s, palette, effect);
  const layout = drawLayout(s);
  const { side, g, align } = drawLayoutAxes(seed);

  return {
    seed,
    mode,
    preset: preset?.id ?? null,
    bucket,
    f: font.id,
    v: variant.id,
    p: palette.id,
    r: roleSet.o,
    e: effect.id,
    l: layout.id,
    params,
    side,
    g,
    align,
    pinned,
  };
}

/**
 * Resolve a look's ids back to the catalog rows the fit and the renderer need.
 *
 * @param {Catalog} catalog
 * @param {Look} look
 * @returns {Scene}
 */
export function resolve(catalog, look) {
  const { fonts, palettes, effects } = catalog;
  // The optional chains guard the look, not the catalog: a look `pick()` did not draw from
  // this catalog may name ids it lacks. The edge resolves only its own picks: an invariant.
  const font = fonts.find((x) => x.id === look.f);
  const variant = font?.variants.find((x) => x.id === look.v);
  const file = font?.files.find((x) => x.id === variant?.file);
  const palette = palettes.find((x) => x.id === look.p);
  const roleSet = palette?.roles.find((x) => x.o === look.r);
  const effect = effects.find((x) => x.id === look.e);
  const layout = LAYOUTS.find((x) => x.id === look.l);
  if (!font || !variant || !file || !palette || !roleSet || !effect || !layout) {
    throw new Error("the look does not resolve against this catalog");
  }
  return { look, font, variant, file, palette, roleSet, effect, layout };
}
