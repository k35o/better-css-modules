import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        // The bundle takes in the private unplugin package from its dist, so
        // a build that runs before unplugin's would import it instead.
        dependsOn: [{ task: "build", from: "devDependencies" }],
        cache: {
          input: [{ auto: true }, "!dist/**", "!node_modules/**"],
        },
      },
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: true,
    format: ["esm"],
    deps: {
      // The shared plugin factory is a private workspace package, so it cannot be
      // a runtime dependency of a published one; it ships inside this bundle.
      alwaysBundle: ["@better-css-modules/unplugin"],
    },
  },
});
