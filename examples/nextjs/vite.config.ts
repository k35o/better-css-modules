import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: "vp test",
        // next build loads the built Turbopack integration and core.
        dependsOn: [{ task: "build", from: "devDependencies" }],
        cache: false,
      },
    },
  },
  test: {},
});
