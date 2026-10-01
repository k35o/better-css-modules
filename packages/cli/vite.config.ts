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
        // The tests run the built bin, which loads the built core.
        dependsOn: ["build", { task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
  pack: {
    entry: {
      cli: "src/cli.ts",
    },
    format: ["esm"],
  },
  test: {},
});
