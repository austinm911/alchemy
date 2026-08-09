import { createStartHandler, defaultStreamHandler } from "@octanejs/tanstack-start/server";

// The default server entry has no `env.ASSETS.fetch(request)` fallthrough.
// With `runWorkerFirst: true` the worker answers every request, so asset
// requests (client bundle, dev modules) would receive SSR 404 HTML and the
// app would never hydrate. This entry hands non-route requests to the
// assets layer.
//
// The handler's declared signature is (request, options); the worker calls
// fetch(request, env, ctx). The package's own entry spreads the worker
// arguments through, so mirror that here.
const start = createStartHandler(defaultStreamHandler);

interface AssetsEnv {
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(...args: unknown[]) {
    const response = await (start as (...a: unknown[]) => Promise<Response>)(...args);
    if (response.status !== 404) {
      return response;
    }
    const request = args[0] as Request;
    const env = (args[1] ?? {}) as AssetsEnv;
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return response;
  },
};
