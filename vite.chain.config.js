import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        nicechunkChain: resolve(root, "src/chain/nicechunkChain.js"),
        localGameWallet: resolve(root, "src/localGameWallet.js"),
      },
      output: {
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === "nicechunkChain") return "assets/nicechunkChain.js";
          if (chunkInfo.name === "localGameWallet") return "assets/localGameWallet.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
