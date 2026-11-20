import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { plannerPlugin } from "./server/plugin";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // plannerPlugin: local POST /api/plan (GroqCloud free tier, server-side key). See server/planner.ts.
  plugins: [react(), plannerPlugin(repoRoot, webRoot)],
  // Allow importing the synthetic demo dataset from <repo>/data/synthetic.
  server: { fs: { allow: [repoRoot] }, port: 5173 },
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
});
