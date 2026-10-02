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
        cache: false,
      },
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
      // index.ts hands Turbopack this file's path; it is not imported.
      loader: "src/loader.ts",
    },
    dts: { resolve: false },
    format: ["esm"],
    deps: {
      neverBundle: ["next"],
    },
  },
  test: {},
});
