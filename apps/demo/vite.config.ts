import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      // shadcn 占位别名模型：registry 块按消费方别名引用基元与自身
      "@": new URL("./src", import.meta.url).pathname,
      "@blocks": new URL("../../registry", import.meta.url).pathname,
    },
  },
  server: {
    port: 5173,
  },
});
