import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" && process.env.GITHUB_ACTIONS ? "/inkboard/" : "/",
  plugins: [react()],
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
