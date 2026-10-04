import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { stridePwa } from "./scripts/pwa.mjs";
export default defineConfig({
  plugins: [react(), stridePwa()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
