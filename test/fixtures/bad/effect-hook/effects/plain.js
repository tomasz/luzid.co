// Planted bad: test/data/catalog.test.js expects this to fail the catalog build.
export default {
  id: "plain",
  family: "plain",
  shape: "A",
  colors: 2,
  bg: "any",
  odds: 4,
  fonts: { deny: [], prefer: [] },
  palettes: { prefer: [] },
  params: {},
  bleed: () => ({ t: 0, r: 0, b: 0, l: 0 }),
  css: "",
  hover: null,
  motion: null,
};
