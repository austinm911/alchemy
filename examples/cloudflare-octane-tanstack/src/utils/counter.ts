import { createServerFn } from "@octanejs/tanstack-start";
import { env } from "../env.ts";

const KEY = "octane-tanstack:count";

// Server function: reads and increments a counter in the KV namespace bound
// as CACHE. Runs inside the deployed Worker; the client bundle keeps a stub
// that calls back over HTTP.
export const getAndIncrementCount = createServerFn({ method: "GET" }).handler(
  async () => {
    const cache = env.CACHE;
    const current = Number((await cache.get(KEY)) ?? "0") + 1;
    await cache.put(KEY, String(current));
    return { count: current };
  },
);
