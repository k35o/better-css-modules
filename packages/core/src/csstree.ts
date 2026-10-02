import * as csstree from "css-tree";
import patches from "@csstools/css-syntax-patches-for-csstree/dist/index.json" with { type: "json" };

// css-tree's bundled syntax data lags behind the platform; the csstools patches
// (the pair stylelint ships) teach the lexer newer syntax such as shape(),
// calc-size() and relative colors so that value checks do not misfire on them.
const syntax = csstree.fork({
  atrules: patches.next.atrules,
  properties: patches.next.properties,
  types: patches.next.types,
});

export const { parse, generate, lexer } = syntax;
export const { walk, find, ident, property } = csstree;
