import { resolve } from "node:path"
import { rm } from "node:fs/promises"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "exclude-local-terrain-from-build",
      async closeBundle() {
        await rm(resolve(import.meta.dirname, "dist/maps/local"), { recursive: true, force: true })
      },
    },
  ],
  build: {
    outDir: "dist",
  },
  server: {
    host: "127.0.0.1",
    port: 10252,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 10252,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
