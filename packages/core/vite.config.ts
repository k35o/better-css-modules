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
        // A test typechecks the built declarations.
        dependsOn: ["build"],
        cache: false,
      },
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
      internal: "src/internal.ts",
    },
    dts: true,
    format: ["esm"],
    deps: {
      // oxc-walker ships ESM only; loaders that require() their way through the
      // dependency graph (Next.js reading next.config.ts) cannot load it, so it
      // travels inside this bundle instead.
      alwaysBundle: ["oxc-walker"],
    },
  },
  test: {},
});
