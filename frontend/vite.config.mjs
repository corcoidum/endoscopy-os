import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["localhost", "127.0.0.1", "terminal.local"],
    proxy: {
      "/api": {
        target:
          process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react()],
});
