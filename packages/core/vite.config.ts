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
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
      loader: "src/loader.ts",
    },
    dts: true,
    format: ["esm", "cjs"],
  },
  test: {},
});
