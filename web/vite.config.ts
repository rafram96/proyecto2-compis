import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El worker del estudio empaqueta ../etl_dsl/*.py tal cual: hay que dejar que el servidor lea fuera de web/.
  server: { fs: { allow: [repo] } },
  worker: { format: "es" },
});
