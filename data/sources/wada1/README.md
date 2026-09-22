# Sanzo Wada, volume 1 — vendored source

`colors.json` is a byte-for-byte copy of

    https://raw.githubusercontent.com/mattdesl/dictionary-of-colour-combinations/c142bd0bc8049ea48db4da5eb397981f047e8ef4/colors.json

| | |
|---|---|
| upstream | [mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations) |
| commit | `c142bd0bc8049ea48db4da5eb397981f047e8ef4` (2020-05-27) |
| bytes | 60,245 |
| sha256 | `555f11c32eb8133078fd470dd7d5320533aaa8b636f12fa06a8dd3d0ee2703b4` |
| licence | MIT — `LICENSE` (sha256 `4609449ccba0183743521db542c67a16e112e7f0043ee2d6ed2040c339e5dd72`) |

To re-vendor:

```sh
C=c142bd0bc8049ea48db4da5eb397981f047e8ef4
B=https://raw.githubusercontent.com/mattdesl/dictionary-of-colour-combinations/$C
curl -sSL -o data/sources/wada1/colors.json "$B/colors.json"
curl -sSL -o data/sources/wada1/LICENSE     "$B/LICENSE.md"
shasum -a 256 data/sources/wada1/colors.json data/sources/wada1/LICENSE
```

## Credit

The digitisation layer is MIT twice over: © 2020 Matt DesLauriers (this file's `LICENSE`,
which is the only licence text upstream ships) and © 2024 Dain M. Blodorn Kim, whose
`dblodorn/sanzo-wada` per-chapter swatch files mattdesl forked and corrected. Both notices
belong in `THIRD_PARTY_NOTICES.md`.

The underlying work is 配色總鑑 by 和田三造 (Sanzo Wada, 1883–1967), 博美社 1933–34,
reprinted by Seigensha as *A Dictionary of Color Combinations* (ISBN 978-4-86152-247-5).
Only factual values are used here — colour coordinates, colour names and which colours the
book groups together. No plate image, page scan, layout or Seigensha commentary is copied.

## What is in it

159 colours, each listing the combinations it belongs to; the 348 combinations are derived by
inverting that list. IDs 1–348 are contiguous: 1–120 are two-colour, 121–240 three-colour,
241–348 four-colour. `hex` comes from the book's CMYK through a U.S. Web Coated (SWOP) v2 →
sRGB ICC transform, which is why it is vivid enough for a display page.

`errata.json` is our own reviewed patch (four CMYK fixes and the name typos) applied on top at
build time by `scripts/palette-sources/wada1.mjs`; the upstream file is never edited. Read that
file for why the four corrected colours keep their old hex.

## Do not use these other datasets

`dblodorn/sanzo-wada` and every copy of it (`sanzo-wada.dmbk.io/assets/colors.json`,
`meodai/sanzoWadaColors`, `aliiscript/sanzo-combo`, `mrbooshehri/sanzo-wada`, `jmaasch/sanzo`)
carry corrupt data: 157 colours instead of 159 (Citrine and Chromium Green are missing), ten
one-colour and three five-colour combinations, and a naive CMYK→RGB conversion that shifts hues
badly (Hermosa Pink `#ffb3f0` there vs `#f9c1ce` here). `marcebollin/sanzo-wada-colors` and the
Shikifu Codex scrape in `estevesjh/sanzo-wada-colors` have no data licence.
