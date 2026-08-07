import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import Backend, { Bucket } from "./src/backend.ts";

// KV namespace backing the `/counter` server function. Declared at module
// scope so the Website class can reference it as a binding; the stack
// materializes it below.
const Cache = Cloudflare.KV.Namespace("Cache");

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    CACHE: Cache,
    BUCKET: Bucket,
    BACKEND: Backend,
  },
  assets: {
    // Octane's Start server entry has no `env.ASSETS.fetch(request)`
    // fallthrough, so worker-first routing would shadow the client bundle
    // with SSR 404 HTML and the app would never hydrate. Asset-first lets
    // static files win while navigation misses still reach SSR.
    runWorkerFirst: false,
  },
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
  "CloudflareOctaneTanstackExample",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const cache = yield* Cache;
    const bucket = yield* Bucket;
    const backend = yield* Backend;
    const website = yield* Website;

    return {
      url: website.url.as<string>(),
      backendUrl: backend.url.as<string>(),
    };
  }),
);
