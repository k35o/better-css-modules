import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      cli: 'src/cli.ts',
    },
    dts: true,
    format: ['esm', 'cjs'],
  },
});
