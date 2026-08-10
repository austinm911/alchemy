import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import Stack from "../alchemy.run.ts";

// Fresh `workers.dev` URLs transiently 404 while the route propagates.
// `HttpClient.execute`/`get` resolve successfully on that 404, so a plain
// `Effect.retry` never fires — `getWhenReady`/`executeWhenReady` fail on the
// cold-start window and retry until the real response comes back.
const { getWhenReady, executeWhenReady } = Test;

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  stage: "test",
});

const stack = beforeAll(deploy(Stack).pipe(Effect.tap(Console.log)));
afterAll(
  Effect.gen(function* () {
    if (!process.env.NO_DESTROY) {
      yield* destroy(Stack);
    }
  }),
);

// Octane streams loader data into the SSR HTML wrapped in markers that
// client-side hydration strips — observed as `count is >52<` (stream markers)
// or `count is <!--[-->52<!--]-->` (hydration boundaries). The count is the
// loader's server-fn result, persisted in KV.
const parseCount = (html: string): number | undefined => {
  const match = html.match(/count is (?:>|<!--\[-->)?(\d+)/);
  return match ? Number(match[1]) : undefined;
};

// A freshly-created KV namespace is only eventually consistent: the first SSR
// requests after deploy can throw inside the Worker, which Cloudflare serves
// as a status-200 error page (`error code: 1042`). Poll until a real count
// renders — every successful load increments the counter, so only the delta
// between the final two reads is asserted.
const pollCount = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const res = yield* client.get(`${url}/counter`);
    if (res.status !== 200) return undefined;
    return parseCount(yield* res.text);
  });

const readCount = (url: string) =>
  pollCount(url).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("2 seconds"),
      until: (count) => count !== undefined,
      times: 30,
    }),
  );

test(
  "deploys and exposes a url",
  Effect.gen(function* () {
    const { url } = yield* stack;
    expect(url).toMatch(/^https:\/\//);
  }),
  { timeout: 180_000 },
);

test(
  "server-renders the home route",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    const res = yield* getWhenReady(`${url}/`);
    expect(res.status).toBe(200);
    const html = yield* res.text;
    expect(html).toContain("Octane + TanStack Start");
    // The clickable link is client-routed, so it is only in the HTML when the
    // root layout rendered server-side.
    expect(html).toContain("Counter");
  }),
  { timeout: 180_000 },
);

test(
  "serves the client bundle as JavaScript",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    const page = yield* getWhenReady(`${url}/`);
    const html = yield* page.text;
    const script = html.match(/<script[^>]+src="(\/[^"]+\.js[^"]*)"/i)?.[1];
    expect(script).toBeDefined();

    const asset = yield* client.get(`${url}${script!}`);
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(yield* asset.text).not.toContain("<html");
  }),
  { timeout: 120_000 },
);

test(
  "counter server function increments the KV binding across requests",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // The loader runs the server function during SSR, so the first readable
    // response already carries an incremented count. Two reads land on
    // different Worker instances with no shared memory, so +1 between them
    // proves the counter persisted through the KV binding.
    const first = yield* readCount(url);
    expect(first).not.toBeUndefined();
    const second = yield* readCount(url);
    expect(second).toBe(first! + 1);
  }),
  { timeout: 180_000 },
);

// --- R2 + service-binding parity with examples/cloudflare-tanstack ----------
//
// The `/api/hello` route (src/routes/api.hello.ts) exposes TanStack Start
// route-level `server.handlers` — GET/PUT dispatched by method — exercising
// every way a Worker can reach another resource: the async R2 binding
// directly, the service binding via `fetch`, via an RPC method, and via the
// Effect HTTP client bridge.

const route = (url: string, params: Record<string, string>) =>
  `${url}/api/hello?${new URLSearchParams(params).toString()}`;

// Stable per-option keys so re-runs (e.g. NO_DESTROY=1) overwrite cleanly
// instead of leaving stale objects behind.
const KEYS = {
  binding: "integ:via-binding",
  fetch: "integ:via-fetch",
  rpc: "integ:via-rpc",
  httpClient: "integ:via-http-client",
};

test(
  "option 1 — direct R2 binding round-trips through PUT and GET",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;
    const key = KEYS.binding;

    const put = yield* executeWhenReady(
      HttpClientRequest.put(route(url, { key, via: "binding" })).pipe(
        HttpClientRequest.bodyText("hello-binding", "text/plain"),
      ),
    );
    expect(put.status).toBe(204);

    const get = yield* client.get(route(url, { key, via: "binding" }));
    expect(get.status).toBe(200);
    expect(yield* get.text).toBe("hello-binding");
  }),
  { timeout: 180_000 },
);

test(
  "option 2 — service-binding fetch into the Backend worker",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;
    const key = KEYS.fetch;

    // Write through option 2's PUT path (Backend's fetch handler stores it
    // in R2), then read it back through option 2's GET (also Backend.fetch).
    const put = yield* executeWhenReady(
      HttpClientRequest.put(route(url, { key, via: "fetch" })).pipe(
        HttpClientRequest.bodyText("hello-fetch", "text/plain"),
      ),
    );
    expect(put.status).toBe(204);

    const get = yield* client.get(route(url, { key, via: "fetch" }));
    expect(get.status).toBe(200);
    expect(yield* get.text).toBe("hello-fetch");
  }),
  { timeout: 180_000 },
);

test(
  "option 3 — service-binding RPC method via toPromiseApi",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;
    const key = KEYS.rpc;

    // Seed the bucket via option 1 (direct binding) so the RPC `hello`
    // method has something to read.
    const seed = yield* executeWhenReady(
      HttpClientRequest.put(route(url, { key, via: "binding" })).pipe(
        HttpClientRequest.bodyText("hello-rpc", "text/plain"),
      ),
    );
    expect(seed.status).toBe(204);

    // RPC GET reads through Backend.hello — exercises toPromiseApi.
    const get = yield* client.get(route(url, { key, via: "rpc" }));
    expect(get.status).toBe(200);
    expect(yield* get.text).toBe("hello-rpc");
  }),
  { timeout: 180_000 },
);

test(
  "option 4 — service-binding HTTP client",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;
    const key = KEYS.httpClient;

    // Seed the bucket via option 1 (direct binding) so the RPC `hello`
    // method has something to read.
    const seed = yield* executeWhenReady(
      HttpClientRequest.put(route(url, { key, via: "http-client" })).pipe(
        HttpClientRequest.bodyText("hello-http-client", "text/plain"),
      ),
    );
    expect(seed.status).toBe(204);

    // HTTP client GET reads through Backend.hello — exercises toPromiseApi.
    const get = yield* client.get(route(url, { key, via: "http-client" }));
    expect(get.status).toBe(200);
    expect(yield* get.text).toBe("hello-http-client");
  }),
  { timeout: 180_000 },
);

test(
  "missing `key` returns 400",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // `400` is the real answer; `getWhenReady` only retries the propagation
    // `404`/`5xx` window, so it returns the `400` as soon as the route is live.
    const res = yield* getWhenReady(route(url, { via: "binding" }));
    expect(res.status).toBe(400);
  }),
);

test(
  "RPC for a non-existent key returns 404",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    const res = yield* client.get(
      route(url, { key: "integ:does-not-exist", via: "rpc" }),
    );
    expect(res.status).toBe(404);
  }),
);

test(
  "PUT via=rpc returns 400 (RPC `hello` is read-only)",
  Effect.gen(function* () {
    const { url } = yield* stack;

    const res = yield* executeWhenReady(
      HttpClientRequest.put(
        route(url, { key: "integ:via-options", via: "rpc" }),
      ).pipe(HttpClientRequest.bodyText("nope")),
    );
    expect(res.status).toBe(400);
  }),
);
