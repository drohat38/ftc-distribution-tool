import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The canonical config + data live at the repo root (config/, data/) so the fetch
// scripts and the app share one source of truth. Alias them in and allow Vite to read
// outside the app folder.
export default defineConfig({
  base: "./", // relative asset paths → works on any host or subpath
  plugins: [react()],
  resolve: {
    alias: {
      "@config": resolve(__dirname, "../config"),
      "@data": resolve(__dirname, "../data")
    }
  },
  server: {
    fs: { allow: [resolve(__dirname, ".."), resolve(__dirname)] }
  },
  test: {
    // The matching-engine tests are pure logic — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"]
  }
});
