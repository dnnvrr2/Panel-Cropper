import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: loadEnv(mode, ".", "PANEL_CROPPER_LAUNCHER").PANEL_CROPPER_LAUNCHER !== "1",
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
}));
