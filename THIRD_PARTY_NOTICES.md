# Third-party notices

The MIT licence in `LICENSE` covers the code in this repository only. The fonts and the
colour data are third-party works under their own terms.

**Fonts.** Every shipped font has its own licence file at `fonts/licenses/<id>.txt`,
containing the upstream licence text and a notice of the changes made here (subsetting to
the glyphs of one name, hinting removed, vertical metrics normalized). The family, version,
copyright holder, source URL and SPDX identifier are recorded in `fonts/meta/<id>.json`.

**Colour data.** Each vendored dataset keeps its licence at `data/sources/<name>/LICENSE`,
next to the original data it came from.

This file is a pointer and is written once. It is deliberately not a generated table: a
shared file appended by every font and palette pull request would conflict on every merge.
`pnpm run build -- --notices` regenerates a readable table on demand.
