import { defineConfig } from "vite";

/**
 * Library build. The type declarations are produced by `tsc` (see
 * tsconfig.build.json); Vite bundles the ESM JavaScript output only.
 */
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    // Do not wipe the .d.ts files emitted by tsc before this runs.
    emptyOutDir: false,
    sourcemap: true,
    target: "es2022",
    minify: false,
  },
});
