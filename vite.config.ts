import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" && process.env.GITHUB_ACTIONS ? "/inkboard/" : "/",
  plugins: [react()],
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
