import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import betterCssModules from "@better-css-modules/vite";

export default defineConfig({
  plugins: [react(), betterCssModules()],
});
