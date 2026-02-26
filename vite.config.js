import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(configDir, "index.html"),
        splash: resolve(configDir, "splash.html"),
      },
      output: {
        manualChunks(id) {
          const safeId = String(id || "");
          if (!safeId.includes("node_modules")) {
            return undefined;
          }
          if (safeId.includes("/three/")) {
            return "vendor-three";
          }
          if (safeId.includes("/katex/")) {
            return "vendor-katex";
          }
          if (safeId.includes("/highlight.js/")) {
            return "vendor-highlight";
          }
          if (safeId.includes("/@tauri-apps/")) {
            return "vendor-tauri";
          }
          return "vendor";
        },
      },
    },
  },
}));
