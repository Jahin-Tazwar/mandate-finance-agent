import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser calls /api/... on the web app's own address, and Vite forwards it
    // to Express. Same address for both = no CORS setup needed.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
