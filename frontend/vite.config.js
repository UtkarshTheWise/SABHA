import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  css: {
    // The app is plain CSS, no PostCSS. Passing an inline config stops Vite
    // walking up the directory tree looking for a postcss.config file, which on
    // Windows can reach the drive root and pick up an unrelated one.
    postcss: {},
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
});
