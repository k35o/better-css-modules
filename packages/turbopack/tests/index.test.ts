import { describe, it, expect } from "vitest";
import { withBetterCssModules } from "../src/index.js";

// `silent`: the first call also generates types for this package, which has none.
const rulesOf = (nextConfig: Parameters<typeof withBetterCssModules>[0]) =>
  withBetterCssModules(nextConfig, { silent: true }).turbopack?.rules;

const ours = {
  loader: expect.stringMatching(/loader\.mjs$/),
  options: { cwd: process.cwd(), overrides: { silent: true } },
};

describe("withBetterCssModules: the layer loader", () => {
  it("adds a rule for CSS Modules files that keeps them CSS Modules", () => {
    expect(rulesOf({ reactStrictMode: true })).toEqual({ "*.module.css": { loaders: [ours] } });
  });

  it("hands the loader the options it was given over the config file", () => {
    const rules = withBetterCssModules({}, { layer: "components" }).turbopack?.rules;
    expect(rules).toEqual({
      "*.module.css": {
        loaders: [{ ...ours, options: { cwd: process.cwd(), overrides: { layer: "components" } } }],
      },
    });
  });

  it("keeps the rules already there", () => {
    expect(rulesOf({ turbopack: { rules: { "*.svg": ["svg-loader"] } } })).toEqual({
      "*.svg": ["svg-loader"],
      "*.module.css": { loaders: [ours] },
    });
  });

  it("runs before the loaders a rule for CSS Modules files already has", () => {
    expect(
      rulesOf({ turbopack: { rules: { "*.module.css": { loaders: ["a-loader"], as: "*.js" } } } }),
    ).toEqual({ "*.module.css": { loaders: ["a-loader", ours], as: "*.js" } });
    expect(rulesOf({ turbopack: { rules: { "*.module.css": ["a-loader"] } } })).toEqual({
      "*.module.css": ["a-loader", ours],
    });
  });

  it("refuses several rules for CSS Modules files, which it cannot tell apart", () => {
    expect(() =>
      rulesOf({
        turbopack: {
          rules: { "*.module.css": [{ loaders: ["a"], condition: "browser" }, { loaders: ["b"] }] },
        },
      }),
    ).toThrow('turbopack.rules["*.module.css"] lists several rules');
  });
});
