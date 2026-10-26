import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Requests to /api go to the FastAPI backend, so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
