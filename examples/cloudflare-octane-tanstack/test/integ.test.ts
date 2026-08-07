import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import Stack from "../alchemy.run.ts";

// Fresh `workers.dev` URLs transiently 404 while the route propagates.
// `HttpClient.execute`/`get` resolve successfully on that 404, so a plain
// `Effect.retry` never fires — `getWhenReady` fails on the cold-start window
// and retries until the real response comes back.
const { getWhenReady } = Test;

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
