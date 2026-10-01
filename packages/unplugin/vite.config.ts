import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        cache: {
          input: [{ auto: true }, "!dist/**", "!node_modules/**"],
        },
      },
      test: {
        command: "vp test",
        // @better-css-modules/core resolves through its dist, which CI does
        // not build before running the tests.
        dependsOn: [{ task: "build", from: "dependencies" }],
        // Uncached like the package.json test scripts of the other packages.
        cache: false,
      },
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: true,
    format: ["esm"],
  },
  test: {
    // The tests run real builds with several bundlers.
    testTimeout: 30_000,
  },
});
