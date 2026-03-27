import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        input: [{ auto: true }, "!dist/**", "!node_modules/**"],
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
