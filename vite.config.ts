import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the app from a repository subpath; Vercel serves it at the domain root.
export default defineConfig({
  base: process.env.VERCEL ? "/" : "/Shadow-Imposter-Game/",
  plugins: [react()],
});
