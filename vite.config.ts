import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: { external: ["electron", "sharp"] },
          },
        },
      },
      {
        entry: "src/preload/index.ts",
        vite: { build: { outDir: "dist-electron/preload" } },
      },
    ]),
  ],
  server: { port: 5174, strictPort: true },
});
