import { tanstackStart } from "@octanejs/tanstack-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";

// `cloudflare:*` modules are workerd runtime modules, not npm packages, so
// plain Vite/Rolldown cannot resolve them. Alchemy injects its own Cloudflare
// Vite plugin for `alchemy dev`/`deploy`; this plugin keeps standalone
// `vite build` working by externalizing them the same way (workerd provides
// them at runtime).
const cloudflareExternals = (): Plugin => ({
  name: "cloudflare-externals",
  resolveId(id) {
    if (id.startsWith("cloudflare:")) {
      return { id, external: true };
    }
  },
});

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
  plugins: [
    cloudflareExternals(),
    tanstackStart({
      server: {
        entry: "./server.ts",
      },
    }),
  ],
  optimizeDeps: {
    exclude: START_DEPS,
  },
  ssr: {
    optimizeDeps: {
      exclude: START_DEPS,
    },
  },
});
