import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [react(), betterCssModules()],
  run: {
    tasks: {
      test: {
        command: "vp test",
        // The build loads the built Vite plugin and core.
        dependsOn: [{ task: "build", from: "devDependencies" }],
        cache: false,
      },
    },
  },
  test: {},
});
