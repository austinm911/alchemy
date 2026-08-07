import * as cf from "cloudflare:workers";
import type { WebsiteEnv } from "../alchemy.run.ts";

// In dev mode, `import { env } from "cloudflare:workers"` does not work at
// module top level. Route it through a proxy that reads the virtual module
// lazily.
export const env = new Proxy({} as WebsiteEnv, {
  get(_, prop) {
    return cf.env[prop as keyof typeof cf.env];
  },
});
