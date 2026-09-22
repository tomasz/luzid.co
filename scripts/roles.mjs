/**
 * Role assignment (PLAN §5.4). Pure, hand-rolled WCAG + OKLab, zero dependencies.
 *
 * A palette arrives as 2–4 unordered colours. A *role set* orders them into
 * `bg, fg, a1, a2` — the only four custom properties the runtime ever sees:
 *
 *     {o: '1023', dark: false, n: 4, derivedBg: null}
 *
 * `o` is four characters, one per role: a digit is an index into the row's `hex`,
 * `w`/`k` is the derived ground (see below) and `-` means the role is aliased, so
 * `--a1` and `--a2` are never undefined:
 *
 *     o[2] === '-'  →  --a1: var(--fg)
 *     o[3] === '-'  →  --a2: var(--bg)
 *
 * Tier A: keep ordered `(bg, fg)` pairs reaching WCAG 3:1 (the large-text threshold;
 * the name is always large text). Leftover colours become `a1`, `a2` in both orders.
 *
 * Tier C: about 42% of Wada vol. 1 combos are hue-contrast, not luminance-contrast, and
 * no pair reaches 3:1. Those get a ground derived from the hue of the combo's first
 * colour — washi paper `oklch(.97 .02 h)` or sumi ink `oklch(.16 .02 h)` — and every
 * original colour stays untouched as fg/a1/a2, which is what the book does anyway: it
 * prints its swatches on paper. This always terminates. Washi has Y ≈ .93, so it clears
 * 3:1 against anything with Y ≤ .275; sumi has Y ≈ .004, so it clears 3:1 against
 * anything with Y ≥ .112. The two ranges overlap, so every colour reaches one of them.
 *
 * Tier B of `research-color-assignment-contrast` (nudging fg lightness in OKLCH) is
 * deliberately not implemented: §5.4 does not ask for it and it would ship colours that
 * are no longer the book's.
 *
 * Output is committed to `data/palettes/<source>.json`, so a deploy runs no colour maths.
 */

/** WCAG 2.x relative luminance of an `#rrggbb` string. */
export function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio. Symmetric; black on white is exactly 21. Not rounded: 2.999 fails. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * The two derived grounds for a combo, in `w`, `k` order, tinted with its first colour's hue.
 * An exactly achromatic first colour has no hue to borrow, so its grounds stay neutral rather
 * than picking up the arbitrary tint that hue 0 would give.
 */
export function grounds(hex) {
  const [A, B] = oklab(hex[0])
  const [C, h] = Math.hypot(A, B) < 1e-4 ? [0, 0] : [0.02, Math.atan2(B, A)]
  return [oklch(0.97, C, h), oklch(0.16, C, h)]
}

/** Role sets for one combo of 2–4 `#rrggbb` colours, tier A if any pair passes, else tier C. */
export function roleSets(hex) {
  const n = hex.length
  const out = []
  const emit = (bg, o, derivedBg) => out.push({ o, dark: luminance(bg) < DARK, n, derivedBg })

  for (let bg = 0; bg < n; bg++) {
    for (let fg = 0; fg < n; fg++) {
      if (bg === fg || contrast(hex[bg], hex[fg]) < 3) continue
      for (const a of accents(n, [bg, fg])) emit(hex[bg], `${bg}${fg}${a}`, null)
    }
  }
  if (out.length > 0) return out

  const [washi, sumi] = grounds(hex)
  for (const [key, bg] of [
    ['w', washi],
    ['k', sumi],
  ]) {
    for (let fg = 0; fg < n; fg++) {
      if (contrast(bg, hex[fg]) < 3) continue
      for (const a of accents(n, [fg])) emit(bg, `${key}${fg}${a}`, key)
    }
  }
  return out
}

/** A ground is `dark` below this luminance: exactly where white starts out-contrasting black. */
const DARK = Math.sqrt(1.05 * 0.05) - 0.05

const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)

/** Ordered `a1 a2` pairs from the indices `taken` leaves over; `-` fills an empty slot. */
function accents(n, taken) {
  const rest = [...Array(n).keys()].filter((i) => !taken.includes(i))
  if (rest.length === 0) return ['--']
  if (rest.length === 1) return [`${rest[0]}-`]
  return rest.flatMap((a1) => rest.filter((a2) => a2 !== a1).map((a2) => `${a1}${a2}`))
}

/** The `a`, `b` of an `#rrggbb` string in OKLab (Ottosson's matrices; `L` is not needed here). */
function oklab(hex) {
  const [r, g, b] = channels(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLCH (hue in radians) → `#rrggbb`. Chroma here is tiny, so plain clipping is enough. */
function oklch(L, C, h) {
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)]
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${rgb.map(gamma).join('')}`
}

const gamma = (v) => {
  const c = Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
  return Math.round(c * 255)
    .toString(16)
    .padStart(2, '0')
}
