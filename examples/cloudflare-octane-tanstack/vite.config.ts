import { tanstackStart } from "@octanejs/tanstack-start/plugin/vite";
import { defineConfig } from "vite";

// Packages that reference the Start plugin's virtual modules
// (`#tanstack-start-entry` / `#tanstack-router-entry`). `alchemy dev`
// prebundles the server environment and its optimizer cannot resolve those
// specifiers, so exclude them from prebundling in both environments.
const START_DEPS = [
  "@tanstack/start-client-core",
  "@tanstack/start-server-core",
  "@octanejs/tanstack-router",
  "@octanejs/tanstack-start",
];

export default defineConfig({
  plugins: [tanstackStart()],
  optimizeDeps: {
    exclude: START_DEPS,
  },
  ssr: {
    optimizeDeps: {
      exclude: START_DEPS,
    },
  },
});
