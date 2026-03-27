import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      index: 'src/index.ts',
      loader: 'src/loader.ts',
    },
    dts: true,
    format: ['esm', 'cjs'],
  },
  test: {},
});
